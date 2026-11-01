const fs = require('fs')
const path = require('path')

const { matchMaker, Server } = require('@colyseus/core')
const { WebSocketTransport } = require('@colyseus/ws-transport')
const compression = require('compression')
const cors = require('cors')
const express = require('express')

const { boxity } = require('./bloxity/config')
const { flushScores, installLeaderboardReporter } = require('./bloxity/leaderboards')
const { installRoomReporter } = require('./bloxity/roomReporter')
const DATA = require('./game/data')
const GameRoom = require('./game/GameRoom')
const profiles = require('./game/profiles')
const { recordGemGrant } = require('./game/gemGrants')

const PORT = Number(process.env.PORT) || 3000
const PRODUCTION = process.env.NODE_ENV === 'production'

// Vite's dev server, plus the game site Bloxity hosting tells us about.
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  boxity.clientOrigin,
].filter(Boolean)

/** The told portal's domain: game pages are served from its subdomains. */
const PORTAL_HOST = new URL(boxity.portalUrl).host

/**
 * Who may open a game connection or call the API: a known origin, a page on the
 * Bloxity platform this server was deployed to, or the page this server itself
 * served. Outside production any origin is accepted, so phones on the LAN can test
 * against a dev machine.
 */
function originAllowed(origin, host) {
  if (!origin || !PRODUCTION || ALLOWED_ORIGINS.includes(origin)) return true
  try {
    const h = new URL(origin).host
    return h === host || h === PORTAL_HOST || h.endsWith(`.${PORTAL_HOST}`)
  } catch {
    return false
  }
}

/**
 * HTTP routes. Colyseus serves its own matchmaking routes (`/matchmake/...`) first
 * and hands every other request to this app.
 */
function configureApp(app) {
  app.use(
    cors({
      origin: (origin, done) => done(null, originAllowed(origin, '')),
      credentials: true,
    }),
  )
  app.use(express.json())

  // Bloxity hosting's readiness/liveness probe: must answer fast.
  app.get('/health', (_req, res) => {
    res.status(200).send('ok')
  })
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true })
  })

  /** Live room occupancy, handy while testing the 20-player cap. */
  app.get('/api/rooms', async (_req, res) => {
    const rooms = await matchMaker.query({ name: DATA.bloxity.roomName })
    res.json(rooms.map((r) => ({ id: r.roomId, players: r.clients, max: r.maxClients, locked: r.locked })))
  })

  /**
   * Auth passthrough for the Bloxity SDK.
   *
   * The frontend will POST `{ token, user }` here from
   * `Legion.SDK.auth.authenticateWithServer('/api/legion-auth')`.
   *
   * NOTE: not wired up on the frontend yet — this milestone is login + avatar +
   * movement. When you do wire it, call `authenticateWithServer` from
   * `client/src/bloxity/BloxityProvider.jsx` inside the `onUserChanged` handler, right
   * after a non-null user arrives, and stash the returned accessToken for your own
   * API calls.
   */
  app.post('/api/legion-auth', (req, res) => {
    console.log('[legion-auth] payload:', JSON.stringify(req.body, null, 2))

    // TODO: verify the Bloxity JWT here before trusting req.body.user.
    // Until that happens `req.body.user` is attacker-controlled — anyone can POST any
    // legionId they like. Verify `req.body.token` against Bloxity's public key /
    // introspection endpoint and derive the user from the *verified* claims, not from
    // the body.

    res.json({
      accessToken: 'stub',
      user: { legionId: req.body.user?._id },
    })
  })

  /**
   * Gems purchase fulfilment, sent server-to-server by Bloxity. Anything but a 2xx
   * auto-refunds the buyer. On hosting this can land on any pod, so the grant is
   * recorded in the shared store keyed by transactionId (deduplicated) rather than
   * looked up in this pod's memory.
   */
  app.post('/api/legion-webhook', async (req, res) => {
    if (boxity.webhookSecret && req.get('x-legion-webhook-secret') !== boxity.webhookSecret) {
      return res.sendStatus(401)
    }
    const { transactionId, userId, sku } = req.body || {}
    if (!transactionId || !userId || !sku) return res.sendStatus(400)
    try {
      await recordGemGrant(req.body)
      return res.sendStatus(200)
    } catch (err) {
      console.error('[legion-webhook] could not record grant:', err.message)
      return res.sendStatus(500)
    }
  })

  // Serve the production client build, when there is one, from this same origin.
  const CLIENT_DIST = path.join(__dirname, '..', '..', 'client', 'dist')
  if (fs.existsSync(CLIENT_DIST)) {
    const index = path.join(CLIENT_DIST, 'index.html')
    // gzip cuts the JS from ~1.3 MB to ~370 KB on the wire.
    app.use(compression())
    app.use(express.static(CLIENT_DIST, { maxAge: '1h', index: false }))
    // An explicit "/" also stops Colyseus adding its own text-only root route.
    app.get('/', (_req, res) => res.sendFile(index))
    app.get(/^\/(?!api\/|matchmake\/).*/, (_req, res) => res.sendFile(index))
  }
}

const gameServer = new Server({
  transport: new WebSocketTransport({
    beforeUpgrade: (request) => {
      if (!originAllowed(request.headers.get('origin'), request.headers.get('host'))) {
        return new Response('Forbidden origin', { status: 403 })
      }
      return undefined
    },
  }),
  express: configureApp,
  greet: false,
})

// NOTE: like /api/legion-auth above, the game trusts the Bloxity user id the client
// sends when joining (see Session.resolveIdentity). Verify the Bloxity token there
// before real money or leaderboards depend on it.
gameServer.define(DATA.bloxity.roomName, GameRoom)
// Colyseus owns SIGINT/SIGTERM: it lets every room run onLeave (which banks
// progress) before this final save.
gameServer.onShutdown(async () => {
  await Promise.all([profiles.flushNow(), flushScores()])
})

profiles
  .init()
  .then(() => gameServer.listen(PORT))
  .then(() => {
    installRoomReporter() // no-op outside a Bloxity hosting deployment
    installLeaderboardReporter() // likewise
    console.log(`Server listening on http://localhost:${PORT} (Colyseus room "game", ${GameRoom.name})`)
  })
  .catch((err) => {
    console.error('[server] failed to start:', err)
    process.exit(1)
  })
