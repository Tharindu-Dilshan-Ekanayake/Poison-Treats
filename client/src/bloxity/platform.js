import { create } from 'zustand'

import DATA from '../../../shared/gameData.json'
import { boxityEnv } from './env'
import { getSDK, safeCall, waitForSDK } from './sdk'

/**
 * The Bloxity integration, in one place: SDK init, the platform features this game
 * services (emotes, leaderboards), ad breaks, synced settings, player events, chat
 * and screen ads. BloxityProvider owns auth and avatar on top of this.
 *
 * Platform state the UI reacts to lives in `usePlatform`; gameplay code registers
 * handlers for platform events with `onPlatformEvent`.
 */

export const GAME_SLUG = import.meta.env.VITE_GAME_SLUG || DATA.bloxity.gameSlug

export const usePlatform = create(() => ({
  /** Running inside a Bloxity page: Bloxity draws login, menu, chat and emote UI. */
  embedded: false,
  /** An ad break is running: simulation paused and audio muted. */
  paused: false,
  /** Synced settings (see SETTINGS below). */
  showFps: false,
  chatEnabled: true,
  /** 'Low' | 'Medium' | 'High' | 'Ultra', or null until told. */
  graphics: null,
  cameraSensitivity: 1,
  masterVolume: 0.8,
  musicVolume: 0.6,
}))

/** @type {{ playEmote?: (id: string) => void, respawn?: () => void, chat?: (m: object) => void,
 *           breakStart?: () => void, breakEnd?: () => void }} */
const handlers = {}

/** Registers the game's handler for a platform event (one handler per event). */
export function onPlatformEvent(name, fn) {
  handlers[name] = fn
}

/**
 * Settings this game supports. Registering a listener also makes the control appear
 * in the Bloxity menu, so only keys the game really applies are listed.
 */
const SETTINGS = {
  master_volume: (v) => usePlatform.setState({ masterVolume: clamp01(Number(v) / 100, 0.8) }),
  music_volume: (v) => usePlatform.setState({ musicVolume: clamp01(Number(v) / 100, 0.6) }),
  graphics_quality: (v) => usePlatform.setState({ graphics: v || null }),
  show_fps: (v) => usePlatform.setState({ showFps: v === 'true' }),
  camera_sensitivity: (v) => {
    const n = Number(v)
    usePlatform.setState({ cameraSensitivity: Number.isFinite(n) && n > 0 ? Math.min(5, n) : 1 })
  },
  enable_chat: (v) => usePlatform.setState({ chatEnabled: v !== 'false' }),
}

const clamp01 = (n, fallback) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback)

let initPromise = null

/**
 * Waits for the SDK script, then initialises it exactly once (a module-level latch
 * survives React StrictMode's double mount) and wires every platform feature.
 * Resolves with the SDK.
 */
export function initPlatform(gameSlug = GAME_SLUG) {
  if (!initPromise) {
    initPromise = waitForSDK().then(async (sdk) => {
      // Dev server only (this branch is not in production builds): a standalone page
      // on localhost that was told no environment makes the SDK point itself at the
      // page's own origin, i.e. the Vite server, where login can never work. Telling
      // it the SDK's own default (prod) keeps login working. An embedded page is
      // left alone: the local portal's handshake tells it the environment.
      if (import.meta.env.DEV && !window.BLOXITY_ENV && window.self === window.top) {
        window.BLOXITY_ENV = sdk.environment()
      }

      await sdk.init({ gameSlug })

      // As soon as init resolves, not after assets load: the portal decides which
      // buttons to show as soon as the game is up.
      safeCall(() => sdk.game.registerFeature('emotes'))
      // Declares the boards (and shows Bloxity's trophy button). Scores are
      // submitted by the game server.
      safeCall(() => sdk.leaderboard.define(DATA.bloxity.leaderboards))

      usePlatform.setState({ embedded: Boolean(safeCall(() => sdk.portal.isEmbeddedInLegion())) })
      wireAds(sdk)
      wireSettings(sdk)
      wireEvents(sdk)
      wireChat(sdk)
      wireReservedAreas(sdk)
      return sdk
    })
    // A failed init shouldn't poison every later attempt (e.g. HMR reload).
    initPromise.catch(() => {
      initPromise = null
    })
  }
  return initPromise
}

/** Bloxity may start an ad break at any time: pause and mute until it ends. */
function wireAds(sdk) {
  safeCall(() =>
    sdk.ads.onBreakStart(() => {
      usePlatform.setState({ paused: true })
      handlers.breakStart?.()
    }),
  )
  safeCall(() =>
    sdk.ads.onBreakEnd(() => {
      usePlatform.setState({ paused: false })
      handlers.breakEnd?.()
    }),
  )
}

function wireSettings(sdk) {
  for (const [key, apply] of Object.entries(SETTINGS)) {
    safeCall(() =>
      sdk.settings.listen(key, (value) => {
        // Outside Bloxity the game's own settings panel owns these (and the SDK
        // would only report its defaults, overwriting the player's saved choices).
        if (usePlatform.getState().embedded) apply(String(value ?? ''))
      }),
    )
  }
}

function wireEvents(sdk) {
  safeCall(() =>
    sdk.player.onEvent((event, data) => {
      if (event === 'play_emote' && typeof data === 'string') handlers.playEmote?.(data)
      else if (event === 'respawn_request') handlers.respawn?.()
    }),
  )
}

/** Chat bubbles: Bloxity draws the chat; the game shows messages over heads. */
function wireChat(sdk) {
  safeCall(() =>
    sdk.chat.onMessage((m) => {
      if (!usePlatform.getState().chatEnabled) return
      handlers.chat?.({
        userId: String(m.userId || '').replace(/^legion_/, ''),
        isLocalPlayer: Boolean(m.isLocalPlayer),
        text: sdk.chat.bubbleText(m),
        seconds: sdk.chat.bubbleSeconds || 4,
      })
    }),
  )
}

/** Margins (px) round our top-right bar: from the screen edge, and from Bloxity's areas. */
const BAR_EDGE = 12
const BAR_GAP = 8

/**
 * Where our top-right bar (❓, ⚙️, name card) goes, given Bloxity's reserved areas
 * ({ id: 'toolbar' | 'chat', left, top, width, height }, CSS px). It is as tall as
 * the toolbar's visible pill (the reported box has ~8 px of padding round it) and
 * tries, in order: beside the toolbar, centred on it; under the toolbar; under the
 * chat feed. It takes the first row with room for the whole bar on the right, so it
 * never covers anything Bloxity draws.
 *
 * `stacked` (portrait): the bar is a narrow column (name card over the buttons,
 * then cash/wins), so it needs less width but more height.
 */
export function placeTopBar(areas, width = window.innerWidth, buttons = 2, stacked = false) {
  const toolbar = areas.find((a) => a.id === 'toolbar' && a.width > 0)
  const h = toolbar ? Math.round(Math.min(48, Math.max(36, toolbar.height - 16))) : 44
  const need = stacked ? 200 : buttons * (h + 6) + 150
  const band = stacked ? 2 * h + 100 : h
  // Rightmost edge of anything Bloxity draws in the band [y, y + band].
  const blockedTo = (y) =>
    areas.reduce((x, a) => (a.top < y + band && a.top + a.height > y ? Math.max(x, a.left + a.width) : x), 0)

  const rows = [toolbar ? toolbar.top + (toolbar.height - h) / 2 : 8]
  for (const a of [...areas].sort((p, q) => p.top + p.height - (q.top + q.height))) rows.push(a.top + a.height + 6)
  for (const y of rows) {
    const room = width - BAR_EDGE - blockedTo(y) - (blockedTo(y) ? BAR_GAP : 0)
    if (room >= need) return { top: Math.max(0, Math.round(y)), h, maxWidth: Math.floor(room) }
  }
  const lowest = Math.max(0, ...areas.map((a) => a.top + a.height))
  return { top: Math.round(lowest + 6), h, maxWidth: width - 2 * BAR_EDGE }
}

/**
 * Bloxity's toolbar and chat feed take the top-left of the screen. The SDK reports
 * their rectangles and sets --boxity-ui-top itself. From them:
 *   --reserved-left-bottom        the left HUD column starts below anything on the left
 *   --bar-top / -h / -maxw        where our top-right bar goes (see placeTopBar)
 */
function wireReservedAreas(sdk) {
  let last = []
  const apply = () => {
    const root = document.documentElement.style
    // The SDK reports these areas even when the game runs on its own, where nothing
    // is drawn there: only keep clear of them inside Bloxity.
    const embedded = usePlatform.getState().embedded
    const areas = embedded ? last : []
    let bottom = 0
    for (const a of areas) if (a.left < window.innerWidth / 3) bottom = Math.max(bottom, a.top + a.height)
    root.setProperty('--reserved-left-bottom', `${Math.round(bottom)}px`)
    // Inside Bloxity there is no ⚙️ (Bloxity's ☰ has the settings): one button fewer.
    const portrait = window.innerHeight > window.innerWidth
    const bar = placeTopBar(areas, window.innerWidth, embedded ? 1 : 2, portrait)
    root.setProperty('--bar-top', `${bar.top}px`)
    root.setProperty('--bar-h', `${bar.h}px`)
    root.setProperty('--bar-maxw', `${bar.maxWidth}px`)
  }
  safeCall(() =>
    sdk.ui.onReservedAreasChange((areas) => {
      last = Array.isArray(areas) ? areas : []
      apply()
    }),
  )
  window.addEventListener('resize', apply)
  usePlatform.subscribe((s, prev) => {
    if (s.embedded !== prev.embedded) apply()
  })
}

/* ---- Calls the game makes into the platform ----------------------------------- */

const sdk = () => getSDK()

export const platform = {
  loadingStep: (label) => safeCall(() => sdk()?.game.loadingStep(label)),
  loadingEnd: () => safeCall(() => sdk()?.game.loadingEnd()),
  gameplayStart: () => safeCall(() => sdk()?.game.gameplayStart()),
  gameplayEnd: () => safeCall(() => sdk()?.game.gameplayEnd()),
  /** Joinable room id for friends and invites; '' when not in a room. */
  updateRoom: (roomId) => safeCall(() => sdk()?.game.updateRoom(roomId || '')),
  playerJoined: (username) => username && safeCall(() => sdk()?.game.playerJoined(username)),
  playerInRoom: (username) => username && safeCall(() => sdk()?.game.playerInRoom(username)),
  showMenu: () => safeCall(() => sdk()?.portal.showMenu(true)),
  token: () => safeCall(() => sdk()?.auth.getToken()) || null,
  guest: () => safeCall(() => sdk()?.auth.getGuest?.()) || null,

  /** Hosted multiplayer: ask the matchmaker which pod to join. */
  resolveEndpoint: (hostingId, opts) => sdk().net.resolveEndpoint(hostingId, opts),

  /** Custom-character data for an equipped set (null for the regular avatar). */
  characterFor: (equipped) =>
    Promise.resolve(safeCall(() => sdk()?.avatar.getCharacterFor?.(equipped))).catch(() => null),
  characterAccessoryMatrix: (character, bone) =>
    safeCall(() => sdk()?.avatar.characterAccessoryMatrix(character, bone)) || null,
}

/* ---- Screen ads ------------------------------------------------------------------ */

let screen = null
let screenType = null

/**
 * Tells Bloxity which screen is showing so it can place banners around it. Our HUD
 * keeps the top-right corner (profile and quests), so that position stays free.
 * Pass null when no listed screen is showing.
 */
export function setAdScreen(type) {
  if (type === screenType) return
  screenType = type
  const s = sdk()
  if (!s?.ads?.screen) return
  if (!type) {
    safeCall(() => screen?.hide())
    screen = null
    return
  }
  screen = safeCall(() => s.ads.screen(type, { skip: ['top-right'] })) || null
}

/* ---- Emote catalogue ---------------------------------------------------------- */

let emoteCatalog = null

/**
 * Bloxity emotes by id: { id, name, clip: { len, loop, tracks } }. Fetched once.
 * @returns {Promise<Map<string, object>>}
 */
export function loadEmoteCatalog() {
  if (!emoteCatalog) {
    emoteCatalog = fetch(`${boxityEnv().apiUrl}/v1/avatar/emotes`)
      .then((r) => (r.ok ? r.json() : { emotes: [] }))
      .then((body) => {
        const list = Array.isArray(body) ? body : body.emotes || []
        return new Map(list.filter((e) => e?.id && e.clip?.tracks).map((e) => [e.id, e]))
      })
      .catch(() => {
        emoteCatalog = null
        return new Map()
      })
  }
  return emoteCatalog
}

