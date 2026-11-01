import { Callbacks, Client } from '@colyseus/sdk'

import { sfx } from '../audio/sfx'
import { boxityEnv } from '../bloxity/env'
import { loadEmoteCatalog, onPlatformEvent, platform } from '../bloxity/platform'
import { DATA, seatPosition, SPAWN } from '../game/layout'
import { getSettings } from '../game/quality'
import { useGame } from './gameStore'
import {
  bubbles,
  effectQueue,
  hiddenUntil,
  localPlayer,
  pushRemote,
  remoteEmotes,
  remotes,
  remoteSeats,
  setBubble,
} from './liveState'

/**
 * Colyseus client for the game server (server/src/game/GameRoom.js).
 *
 * Public world state (players, their positions, the tables) arrives as Colyseus
 * state patches at 10 Hz. Positions go straight into liveState so they never cause
 * a React render; everything else lands in the zustand store for the UI. Private
 * data (this player's duel, profile) and one-off events (bubbles, results, toasts)
 * arrive as room messages.
 *
 * Where it connects (see endpointFor):
 * - Bloxity hosting (VITE_BLOXITY_HOSTING_ID set): through Bloxity's matchmaker,
 *   resolving a fresh endpoint for every connection. Never <id>.host.bloxity.io.
 * - Otherwise a game server directly: the local Bloxity stack's server, the dev
 *   server on :3000, or (self-hosted) this page's own origin / VITE_SERVER_URL.
 */

const ROOM_NAME = DATA.bloxity.roomName
const HOSTING_ID = import.meta.env.VITE_BLOXITY_HOSTING_ID || ''
const POS_INTERVAL_MS = 100
const HEARTBEAT_MS = 1000
const LOSS_HIDE_MS = 2200
/** How long the Higher / Lower answer stays on screen. */
const REVEAL_HOLD_MS = 1700
/** A cold start can take ~45 s; stop retrying after this long without a room. */
const GIVE_UP_MS = 60000
/** Players already in the room when we join get playerInRoom, later ones playerJoined. */
const INITIAL_SYNC_MS = 1500
/** The server's close code when this account joined from another window. */
const KICKED_REPLACED = 4100
/** Consented leave (we called room.leave()). */
const CONSENTED = 4000

let room = null
/** Matchmaker relay room the current room was reached through (hosting only). */
let relayRoomId = null
let hello = null
/** Bumped on every connect/disconnect so a slow, stale join can't attach itself. */
let joinToken = 0
let retryDelay = 500
let retryTimer = null
let firstAttemptAt = 0
let posTimer = null
/** server clock - local clock, from the welcome message. */
let clockOffset = 0
/** `?roomId=` from Bloxity's Join button or an invite, used for the first join only. */
let deepLinkRoomId = new URLSearchParams(window.location.search).get('roomId')
/** After signing in mid-game: the room to rejoin with the new identity. */
let rejoinTarget = null
const lastSent = { x: 0, y: 0, z: 0, ry: 0, s: 0, g: true, at: 0 }

const viaMatchmaker = () => Boolean(HOSTING_ID) && boxityEnv().env !== 'local'
const toWs = (url) => url.replace(/^http/i, 'ws')

/** Where to open the next connection: `{ url, relayRoomId? }`. */
async function endpointFor() {
  if (viaMatchmaker()) {
    const resolved = await platform.resolveEndpoint(HOSTING_ID, { userId: hello?.userId })
    if (resolved.cold) useGame.getState().pushToast('Waking up a server…')
    return { url: resolved.endpoint, relayRoomId: resolved.roomId }
  }
  if (import.meta.env.VITE_SERVER_URL) return { url: import.meta.env.VITE_SERVER_URL }
  // Told it is on a local Bloxity stack: the "matchmaker" is your local game server.
  // (Only when told: the SDK also calls any localhost page 'local', without one.)
  const told = window.BLOXITY_ENV
  if (told?.env === 'local' && told.playUrl) return { url: told.playUrl }
  // Dev: Vite serves the page on :5173, the game server runs on :3000. Self-hosted
  // production: the game server serves the page itself.
  if (import.meta.env.DEV) return { url: `${window.location.protocol}//${window.location.hostname}:3000` }
  return { url: window.location.origin }
}

/** Sends `{ t: type, ...payload }` to the room; dropped while not connected. */
export function send(msg) {
  if (!room || useGame.getState().status !== 'online') return
  const { t, ...payload } = msg
  room.send(t, payload)
}

/**
 * Joins a game room, or rejoins with a new identity (login/logout). A player who
 * signs in mid-game goes back into the SAME room rather than being re-matchmade
 * away from their friends.
 */
export function connect(joinOptions) {
  hello = joinOptions
  const previousRelay = relayRoomId
  const previous = detachRoom()
  rejoinTarget = previous ? { roomId: previous.roomId, relayRoomId: previousRelay } : null
  firstAttemptAt = 0
  retryDelay = 500
  join().finally(() => previous?.leave(true).catch(() => {}))
}

export function disconnect() {
  hello = null
  detachRoom()?.leave(true).catch(() => {})
}

/** Stops listening to the current room and resets the world; returns the room. */
function detachRoom() {
  joinToken += 1
  clearTimeout(retryTimer)
  clearInterval(posTimer)
  const old = room
  room = null
  relayRoomId = null
  if (old) {
    old.removeAllListeners()
    platform.updateRoom('')
  }
  resetWorld()
  return old
}

// Closing or leaving the tab frees the seat at once. Only unexpected drops
// (network blips) hold it for the server's reconnection window.
window.addEventListener('pagehide', () => {
  platform.gameplayEnd()
  room?.leave(true).catch(() => {})
})

/** A specific room by id; null when it is gone or full (then we matchmake). */
async function joinById(url, roomId) {
  try {
    return await new Client(url).joinById(roomId, hello)
  } catch {
    return null
  }
}

/**
 * The room behind a `?roomId=` link. On hosting, a bare joinById would land on
 * whichever pod the matchmaker picks, so the room's own pod is looked up in the
 * cross-pod room directory first.
 */
async function joinDeepLink(roomId, target) {
  if (!viaMatchmaker()) return joinById(target.url, roomId)
  try {
    const res = await fetch(`${boxityEnv().playUrl}/v1/dir/${encodeURIComponent(HOSTING_ID)}/list`)
    const body = await res.json()
    const rooms = Array.isArray(body) ? body : body.rooms || []
    const entry = rooms.find((r) => (r.colyseusRoomId || r.roomId || r.id) === roomId)
    if (!entry?.joinUrl) return null
    return joinById(toWs(entry.joinUrl), roomId)
  } catch {
    return null
  }
}

async function join() {
  const token = ++joinToken
  clearTimeout(retryTimer)
  firstAttemptAt ||= Date.now()
  useGame.setState({ status: 'connecting' })
  try {
    // Every connection resolves a fresh endpoint and builds a new Client from it:
    // each endpoint is pinned to one pod.
    const target = await endpointFor()
    let joined = null
    let via = target.relayRoomId || null

    if (rejoinTarget) {
      const back = rejoinTarget
      rejoinTarget = null
      const url = back.relayRoomId ? `${toWs(boxityEnv().playUrl)}/v1/ws/${back.relayRoomId}` : target.url
      joined = await joinById(url, back.roomId)
      if (joined) via = back.relayRoomId
    } else if (deepLinkRoomId) {
      const id = deepLinkRoomId
      deepLinkRoomId = null
      joined = await joinDeepLink(id, target)
    }
    // joinOrCreate fills a room to its 20 players before opening the next one.
    joined ||= await new Client(target.url).joinOrCreate(ROOM_NAME, hello)

    if (token !== joinToken) {
      joined.leave(true).catch(() => {})
      return
    }
    room = joined
    relayRoomId = via
    retryDelay = 500
    firstAttemptAt = 0
    attach(joined)
  } catch (err) {
    if (token !== joinToken) return
    console.warn('[net] could not join the game server:', err?.message || err)
    if (Date.now() - firstAttemptAt > GIVE_UP_MS) {
      useGame.setState({ status: 'failed' })
      return
    }
    useGame.setState({ status: 'offline' })
    scheduleRejoin()
  }
}

/** After giving up: the "Retry" button. */
export function retryConnection() {
  if (!hello) return
  firstAttemptAt = 0
  retryDelay = 500
  join()
}

function scheduleRejoin() {
  if (!hello) return
  clearTimeout(retryTimer)
  retryTimer = setTimeout(join, retryDelay)
  retryDelay = Math.min(retryDelay * 2, 8000)
}

function resetWorld() {
  remotes.clear()
  remoteSeats.clear()
  remoteEmotes.clear()
  bubbles.clear()
  hiddenUntil.clear()
  localPlayer.seat = null
  localPlayer.emote = null
  useGame.setState({ players: {}, tables: {}, match: null })
}

/** Wires a freshly joined room's state callbacks and messages into the client. */
function attach(r) {
  const cb = Callbacks.get(r)
  const joinedAt = Date.now()
  useGame.setState({ selfId: r.sessionId, roomId: r.roomId })
  // Friends can now join this room from Bloxity (invites, "Open Rooms").
  platform.updateRoom(r.roomId)

  for (const [type, handler] of Object.entries(handlers)) r.onMessage(type, handler)

  cb.onAdd('players', (player, id) => {
    setPlayerMeta(id, player)
    cb.listen(player, 'streak', () => setPlayerMeta(id, player), false)
    cb.listen(player, 'avatar', () => setPlayerMeta(id, player), false)
    cb.listen(player, 'halo', () => setPlayerMeta(id, player), false)
    cb.listen(player, 'level', () => setPlayerMeta(id, player), false)
    cb.listen(player, 'title', () => setPlayerMeta(id, player), false)
    if (id === r.sessionId) return

    // Bloxity's friend-join toasts.
    if (Date.now() - joinedAt < INITIAL_SYNC_MS) platform.playerInRoom(player.uname)
    else platform.playerJoined(player.uname)

    pushRemote(id, player.x, player.y, player.z, player.ry, player.s, player.g)
    cb.onChange(player, () => pushRemote(id, player.x, player.y, player.z, player.ry, player.s, player.g))
    cb.listen(
      player,
      'emoteSeq',
      () => {
        if (player.emote) startRemoteEmote(id, player.emote)
      },
      false,
    )
  })
  cb.onRemove('players', (_player, id) => removePlayer(id))

  cb.onAdd('tables', (table, key) => {
    applyTable(Number(key), table)
    cb.onChange(table, () => applyTable(Number(key), table))
  })

  // A dropped connection: Colyseus reconnects on its own and the server holds our
  // place (and table seat) meanwhile.
  r.onDrop(() => {
    clearInterval(posTimer)
    useGame.setState({ status: 'offline' })
  })
  r.onReconnect(() => {
    useGame.setState({ status: 'online' })
    startPositionUpdates()
  })
  r.onLeave((code) => {
    if (room !== r) return
    room = null
    clearInterval(posTimer)
    platform.updateRoom('')
    resetWorld()
    useGame.setState({ status: 'offline' })
    if (code === KICKED_REPLACED || code === CONSENTED) return
    // Closed unexpectedly (e.g. its pod is being replaced): resolve again and rejoin.
    scheduleRejoin()
  })
  r.onError((code, message) => console.warn('[net] room error', code, message))

  startPositionUpdates()
}

/* ---- Platform events ------------------------------------------------------------ */

/** Bloxity's emote picker chose an emote: play it here and replicate it. */
onPlatformEvent('playEmote', async (id) => {
  if (localPlayer.seat || !room) return
  const emote = (await loadEmoteCatalog()).get(id)
  // Unknown ids are ignored silently; Bloxity only sends emotes the player owns.
  if (!emote) return
  localPlayer.emote = { clip: emote.clip, start: performance.now() / 1000 }
  room.send('anim', { id })
})

async function startRemoteEmote(id, emoteId) {
  const emote = (await loadEmoteCatalog()).get(emoteId)
  if (emote) remoteEmotes.set(id, { clip: emote.clip, start: performance.now() / 1000 })
}

/** Bloxity menu "Reset Character": stand up and go back to the spawn point. */
onPlatformEvent('respawn', () => {
  if (useGame.getState().match) send({ t: 'leave' })
  localPlayer.seat = null
  localPlayer.emote = null
  localPlayer.position.set(SPAWN[0], SPAWN[1], SPAWN[2])
  localPlayer.ry = Math.PI
  localPlayer.snapCamera = true
})

/** A chat message from Bloxity's chat: shown over the sender's head. */
onPlatformEvent('chat', (m) => {
  const { selfId, players } = useGame.getState()
  const id = m.isLocalPlayer
    ? selfId
    : Object.values(players).find((p) => p.uid && p.uid === m.userId)?.id
  if (id) setBubble(id, m.text, m.seconds * 1000)
})

onPlatformEvent('breakStart', () => sfx.setMuted(true))
onPlatformEvent('breakEnd', () => sfx.setMuted(false))

function startPositionUpdates() {
  clearInterval(posTimer)
  lastSent.at = 0
  posTimer = setInterval(sendPosition, POS_INTERVAL_MS)
}

/** Sends the local transform when it changed, plus a slow heartbeat. */
function sendPosition() {
  if (localPlayer.seat || !room) return
  const p = localPlayer.position
  const now = Date.now()
  const moved =
    Math.abs(p.x - lastSent.x) > 0.02 ||
    Math.abs(p.y - lastSent.y) > 0.02 ||
    Math.abs(p.z - lastSent.z) > 0.02 ||
    Math.abs(localPlayer.ry - lastSent.ry) > 0.03 ||
    Math.abs(localPlayer.speed - lastSent.s) > 0.2 ||
    localPlayer.grounded !== lastSent.g
  if (!moved && now - lastSent.at < HEARTBEAT_MS) return

  lastSent.x = p.x
  lastSent.y = p.y
  lastSent.z = p.z
  lastSent.ry = localPlayer.ry
  lastSent.s = localPlayer.speed
  lastSent.g = localPlayer.grounded
  lastSent.at = now
  room.send('pos', { x: p.x, y: p.y, z: p.z, ry: localPlayer.ry, s: localPlayer.speed, g: localPlayer.grounded })
}

function parseAvatar(json) {
  try {
    const { equipped = null, proportions = null } = JSON.parse(json || '{}')
    return { equipped, proportions }
  } catch {
    return { equipped: null, proportions: null }
  }
}

function setPlayerMeta(id, player) {
  const { equipped, proportions } = parseAvatar(player.avatar)
  useGame.setState((s) => ({
    players: {
      ...s.players,
      [id]: {
        id,
        name: player.name,
        uid: player.uid,
        streak: player.streak,
        level: player.level,
        title: player.title,
        halo: player.halo,
        equipped,
        proportions,
      },
    },
  }))
}

function removePlayer(id) {
  remotes.delete(id)
  remoteEmotes.delete(id)
  remoteSeats.delete(id)
  bubbles.delete(id)
  hiddenUntil.delete(id)
  useGame.setState((s) => {
    const players = { ...s.players }
    delete players[id]
    return { players }
  })
}

/** Mirrors who is sitting where (and who is dancing after a win) for remote players' pose. */
function indexSeats(table) {
  for (const [id, seat] of remoteSeats) if (seat.table === table.id) remoteSeats.delete(id)
  table.seats.forEach((s, i) => {
    if (!s) return
    const dancing = table.phase === 'ended' && table.winner === s.id
    remoteSeats.set(s.id, { ...seatPosition(table.id, i), table: table.id, dancing })
  })
}

/** Synced TableState -> the plain shape the UI uses, with a local-clock deadline. */
function applyTable(id, t) {
  const table = {
    id,
    phase: t.phase,
    seats: [t.seat0 ? { id: t.seat0, chair: t.chair0 } : null, t.seat1 ? { id: t.seat1, chair: t.chair1 } : null],
    turn: t.turn || null,
    winner: t.winner || null,
    endsAt: t.endsAt ? t.endsAt - clockOffset : 0,
  }
  indexSeats(table)
  useGame.setState((s) => ({ tables: { ...s.tables, [id]: table } }))
}

const withDeadline = (obj) => (obj ? { ...obj, endsAt: Date.now() + (obj.endsInMs || 0) } : null)

function withProfileDeadlines(profile) {
  const now = Date.now()
  return { ...profile, giftAt: now + profile.giftInMs, questResetAt: now + profile.questResetInMs }
}

function positionOf(id) {
  if (id === useGame.getState().selfId) return localPlayer.position
  const seat = remoteSeats.get(id)
  if (seat) return { x: seat.x, y: 0, z: seat.z }
  return remotes.get(id) || null
}

/** The server's confirmations come as toasts; each kind gets its sound. */
function playToastSound(text) {
  if (/not enough|need \$|busy|full|walk closer|already|too slow|out of time/i.test(text)) sfx.error()
  else if (/bought|unlocked|claimed/i.test(text)) sfx.buy()
  else if (/quest complete|gift|reward|streak/i.test(text)) sfx.reward()
  else if (/hint|their number is/i.test(text)) sfx.turn()
}

const handlers = {
  welcome(msg) {
    clockOffset = msg.serverNow - Date.now()
    useGame.setState({
      status: 'online',
      capacity: msg.capacity,
      profile: withProfileDeadlines(msg.profile),
      lb: msg.lb,
    })
    // Table deadlines decoded before this message used a zero clock offset.
    room?.state.tables.forEach((t, key) => applyTable(Number(key), t))
  },

  match(msg) {
    const prev = useGame.getState().match
    const next = withDeadline(msg.match)
    sfx.setDucked(Boolean(next))
    localPlayer.seat = next ? { ...seatPosition(next.table, next.seat), dancing: Boolean(next.won) } : null

    if (next && prev) {
      if (next.phase === 'choosing' && prev.phase !== 'choosing') sfx.go()
      if (next.myTurn && !prev.myTurn) sfx.turn()
    }
    useGame.setState({ match: next })
  },

  /** Lost a duel: back to the lobby spawn point, visible again. */
  respawn(msg) {
    localPlayer.seat = null
    localPlayer.position.set(msg.x, msg.y, msg.z)
    localPlayer.ry = msg.ry
    localPlayer.hiddenUntil = 0
    localPlayer.snapCamera = true
  },

  profile(msg) {
    useGame.setState({ profile: withProfileDeadlines(msg.profile) })
  },

  /** A guess landing, then its Higher / Lower answer, for the reveal card. */
  duel(msg) {
    const now = Date.now()
    if (msg.t === 'guessed') {
      sfx.drum()
      useGame.setState({ reveal: { mine: msg.mine, n: msg.n, answer: null, until: now + 5000 } })
    } else if (msg.t === 'answer') {
      if (msg.answer === 'higher') sfx.higher()
      else if (msg.answer === 'lower') sfx.lower()
      // A correct guess hands over to the result banner quickly.
      const hold = msg.answer === 'correct' ? 900 : REVEAL_HOLD_MS
      useGame.setState({ reveal: { mine: msg.mine, n: msg.n, answer: msg.answer, until: now + hold } })
    }
  },

  bubble(msg) {
    setBubble(msg.id, msg.text)
  },

  toast(msg) {
    useGame.getState().pushToast(msg.text)
    playToastSound(msg.text)
  },

  lb(msg) {
    useGame.setState({ lb: { streaks: msg.streaks, wins: msg.wins, levels: msg.levels, playtime: msg.playtime } })
  },

  /** Levelled up: a banner, a sparkle sound and confetti over your head. */
  levelUp(msg) {
    // Shown after the duel result has had its moment.
    const delay = useGame.getState().result ? 2200 : 0
    setTimeout(() => {
      sfx.reward()
      if (getSettings().particles) {
        const p = localPlayer.position
        effectQueue.push({ kind: 'confetti', x: p.x, y: 3, z: p.z })
      }
      useGame.setState({ levelUp: { ...msg, until: Date.now() + 3200 } })
    }, delay)
  },

  result(msg) {
    const { selfId, match } = useGame.getState()
    const now = Date.now()

    // The particle system only exists on presets that allow particles; queuing
    // without it would grow the queue forever.
    if (getSettings().particles) {
      const winnerPos = msg.winner && positionOf(msg.winner)
      if (winnerPos) effectQueue.push({ kind: 'confetti', x: winnerPos.x, y: 2.5, z: winnerPos.z })
      const loserPos = msg.loser && positionOf(msg.loser)
      if (loserPos) effectQueue.push({ kind: 'break', x: loserPos.x, y: 1, z: loserPos.z })
    }
    if (msg.loser === selfId) localPlayer.hiddenUntil = now + LOSS_HIDE_MS
    else if (msg.loser) hiddenUntil.set(msg.loser, now + LOSS_HIDE_MS)

    if (msg.winner === selfId || msg.loser === selfId) {
      const win = msg.winner === selfId
      const mySeat = match?.seat ?? 0
      win ? sfx.win() : sfx.lose()
      useGame.setState({
        result: {
          win,
          reward: win ? msg.reward : msg.consolation || 0,
          theirNumber: msg.numbers[1 - mySeat],
          reason: msg.reason,
          until: now + 3800,
        },
      })
    }
  },
}
