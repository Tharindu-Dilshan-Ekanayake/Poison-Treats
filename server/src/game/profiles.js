const { boxity } = require('../bloxity/config')
const DATA = require('./data')
const { createStore } = require('./profileStore')

/**
 * Persistent player profiles: cash, wins, streaks, inventory, quests.
 *
 * Profiles of connected players live in memory; changes are written back a couple
 * of seconds after the last edit. On Bloxity hosting the store is the game's
 * managed MongoDB (shared by every pod); locally it is a JSON file.
 */

const SAVE_DELAY_MS = 2000
const LEADERBOARD_SIZE = 14
const LEADERBOARD_REFRESH_MS = 15000

const DEFAULT_EMOTES = DATA.emotes.filter((e) => e.price === 0).map((e) => e.id)

const store = createStore(boxity.mongoUri)

/** Profiles held in memory: everyone connected (plus, for the file store, everyone). */
/** @type {Map<string, object>} */
const profiles = new Map()
/** Profiles changed since the last save. */
const dirty = new Set()
let saveTimer = null
let leaderboardCache = { streaks: [], wins: [], levels: [], playtime: [] }

const dayKey = (now) => new Date(now).toISOString().slice(0, 10)
const isWeekend = (now) => [0, 6].includes(new Date(now).getUTCDay())

function msUntilUtcMidnight(now) {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now
}

function createProfile(id, name) {
  return {
    id,
    name,
    cash: 0,
    wins: 0,
    streak: 0,
    bestStreak: 0,
    ownedChairs: ['basic'],
    equippedChair: 'basic',
    ownedEmotes: [...DEFAULT_EMOTES],
    /** Head auras bought in the shop, and the one worn ('' = none). */
    ownedHalos: [],
    equippedHalo: '',
    /** Experience and level: every finished duel gives XP; levels pay cash. */
    xp: 0,
    level: 1,
    /** Total time in the game, in seconds (a leaderboard). */
    playSeconds: 0,
    /** Titles shown above the name (earned by level or bought), and the worn one. */
    ownedTitles: [],
    equippedTitle: '',
    passes: [],
    starterPack: false,
    quests: { day: '', progress: {}, claimed: {} },
    daily: { lastDay: '', streak: 0 },
    /** Seconds of play banked toward the next mystery gift. */
    giftProgress: 0,
    /** Set on a guest profile once its progress moved into an account (see carryGuestProgress). */
    carriedTo: '',
  }
}

/** Fills in fields added after a profile was first saved. */
function normalise(raw) {
  const { _id, ...rest } = raw
  const p = { ...createProfile(rest.id || _id, rest.name || 'Player'), ...rest }
  for (const id of DEFAULT_EMOTES) if (!p.ownedEmotes.includes(id)) p.ownedEmotes.push(id)
  if (!p.ownedChairs.includes('basic')) p.ownedChairs.unshift('basic')
  for (const t of DATA.titles) {
    if (t.level && t.level <= p.level && !p.ownedTitles.includes(t.id)) p.ownedTitles.push(t.id)
  }
  return p
}

async function flush() {
  saveTimer = null
  if (dirty.size === 0) return
  const batch = [...dirty]
  dirty.clear()
  try {
    await store.save(batch, profiles)
  } catch (err) {
    console.error('[profiles] save failed:', err.message)
    for (const p of batch) dirty.add(p)
    if (!saveTimer) saveTimer = setTimeout(flush, SAVE_DELAY_MS * 5)
  }
}

/** Queues a profile to be saved. */
function markDirty(p) {
  if (p) dirty.add(p)
  if (!saveTimer) saveTimer = setTimeout(flush, SAVE_DELAY_MS)
}

/** A profile with no progress worth keeping. */
const isFresh = (p) => p.wins === 0 && p.cash === 0 && p.ownedChairs.length === 1 && p.passes.length === 0

/**
 * Loads (or creates) a profile and keeps it in memory while its player is here.
 *
 * `carriedFrom` lists Bloxity guest ids this browser played as before signing in.
 * If the account has no progress here yet, the first of those guests' progress
 * moves into it, once: the guest save is marked so it can never be copied again.
 */
async function loadProfile(id, name, { carriedFrom = [], now = Date.now() } = {}) {
  let p = profiles.get(id)
  if (!p) {
    const raw = await store.load(id)
    p = profiles.get(id) || (raw ? normalise(raw) : null)
    if (!p) {
      p = createProfile(id, name)
      dirty.add(p)
    }
    profiles.set(id, p)
  }

  if (carriedFrom.length && isFresh(p)) {
    for (const guestId of carriedFrom) {
      const guestKey = `g:${guestId}`
      const raw = profiles.get(guestKey) || (await store.load(guestKey))
      if (!raw) continue
      const guest = normalise(raw)
      if (guest.carriedTo || isFresh(guest)) continue
      Object.assign(p, { ...guest, id, name: p.name, carriedTo: '' })
      guest.carriedTo = id
      profiles.set(guestKey, guest)
      dirty.add(guest)
      console.log(`[profiles] carried guest progress ${guestKey} -> ${id}`)
      break
    }
  }

  if (name) p.name = name
  refreshQuests(p, now)
  markDirty(p)
  return p
}

/** Drops a disconnected player's profile from memory (after saving it). */
function release(p) {
  if (!store.keepsAll) {
    markDirty(p)
    // Saved by the next flush; forget it afterwards so memory stays bounded.
    setTimeout(() => {
      if (!dirty.has(p)) profiles.delete(p.id)
    }, SAVE_DELAY_MS * 3).unref()
  }
}

/** XP needed to go from `level` to the next. */
function xpToNext(level) {
  return DATA.xp.base + DATA.xp.step * (level - 1)
}

/**
 * Adds XP, levelling up as many times as it covers. Each level pays cash and may
 * unlock a title. Returns the levels reached (for the celebration), e.g. [5].
 */
function addXp(p, amount) {
  const reached = []
  p.xp += amount
  while (p.xp >= xpToNext(p.level)) {
    p.xp -= xpToNext(p.level)
    p.level += 1
    p.cash += Math.min(DATA.xp.rewardCap, DATA.xp.rewardPerLevel * p.level)
    for (const t of DATA.titles) {
      if (t.level && t.level <= p.level && !p.ownedTitles.includes(t.id)) p.ownedTitles.push(t.id)
    }
    reached.push(p.level)
  }
  markDirty(p)
  return reached
}

/**
 * Adds time spent in the game. Saved (and counted for the leaderboards) once per
 * whole minute; returns the whole minutes just completed.
 */
function addPlaytime(p, seconds) {
  const before = Math.floor(p.playSeconds / 60)
  p.playSeconds += seconds
  const minutes = Math.floor(p.playSeconds / 60) - before
  if (minutes > 0) markDirty(p)
  return minutes
}

/** Resets quest progress when the UTC day has rolled over. */
function refreshQuests(p, now) {
  const today = dayKey(now)
  if (p.quests.day !== today) {
    p.quests = { day: today, progress: {}, claimed: {} }
  }
}

function getProfile(id, name, now = Date.now()) {
  let p = profiles.get(id)
  if (!p) {
    p = createProfile(id, name)
    profiles.set(id, p)
  }
  if (name) p.name = name
  refreshQuests(p, now)
  markDirty()
  return p
}

/**
 * Today's quests: DATA.questsPerDay picked from the pool, the same for everyone on
 * a given UTC day, so there is something new to chase every day.
 */
function todaysQuests(now) {
  const key = dayKey(now)
  let seed = 0
  // 32-bit integer math: plain multiplication would lose the low bits.
  for (let i = 0; i < key.length; i += 1) seed = (Math.imul(seed, 31) + key.charCodeAt(i)) >>> 0
  const pool = [...DATA.quests]
  const picked = []
  while (picked.length < DATA.questsPerDay && pool.length) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
    picked.push(pool.splice((seed >>> 16) % pool.length, 1)[0])
  }
  return picked
}

/** Records a gameplay event ('play', 'win', 'quickwin', 'streak3', 'emote', 'hint'). */
function addQuestEvent(p, event, amount = 1, now = Date.now()) {
  refreshQuests(p, now)
  let changed = false
  for (const quest of todaysQuests(now)) {
    if (quest.event !== event) continue
    p.quests.progress[quest.id] = Math.min(quest.goal, (p.quests.progress[quest.id] || 0) + amount)
    changed = true
  }
  if (changed) markDirty(p)
}

function dailyRewardFor(p, now) {
  const yesterday = dayKey(now - 86400000)
  const nextStreak = p.daily.lastDay === yesterday ? p.daily.streak + 1 : 1
  const days = Math.min(nextStreak, DATA.daily.maxDays)
  return { streak: nextStreak, amount: DATA.daily.base * days }
}

/**
 * The owner's view of their profile. `giftReadyAt` is per session (see Session) and
 * turned into a relative time so client clock skew doesn't matter.
 */
function view(p, { now = Date.now(), giftReadyAt = now } = {}) {
  refreshQuests(p, now)
  const daily = dailyRewardFor(p, now)
  return {
    name: p.name,
    cash: p.cash,
    wins: p.wins,
    streak: p.streak,
    bestStreak: p.bestStreak,
    ownedChairs: p.ownedChairs,
    equippedChair: p.equippedChair,
    ownedEmotes: p.ownedEmotes,
    ownedHalos: p.ownedHalos,
    equippedHalo: p.equippedHalo,
    level: p.level,
    xp: p.xp,
    xpToNext: xpToNext(p.level),
    ownedTitles: p.ownedTitles,
    equippedTitle: p.equippedTitle,
    passes: p.passes,
    starterPack: p.starterPack,
    quests: todaysQuests(now).map((q) => ({
      ...q,
      progress: p.quests.progress[q.id] || 0,
      claimed: Boolean(p.quests.claimed[q.id]),
    })),
    questResetInMs: msUntilUtcMidnight(now),
    dailyAvailable: p.daily.lastDay !== dayKey(now),
    dailyStreak: daily.streak,
    dailyReward: daily.amount,
    giftInMs: Math.max(0, giftReadyAt - now),
    weekend: isWeekend(now),
  }
}

/** In-world boards (wins, streaks, levels, playtime), refreshed from the store every 15 s. */
function leaderboards() {
  return leaderboardCache
}

async function refreshLeaderboards() {
  try {
    const [streaks, wins, levels, playtime] = await Promise.all([
      store.top('bestStreak', LEADERBOARD_SIZE, profiles),
      store.top('wins', LEADERBOARD_SIZE, profiles),
      // Level 1 is everyone; the board starts at level 2. Equal levels rank by XP.
      store.top('level', LEADERBOARD_SIZE, profiles, { min: 1, then: 'xp' }),
      store.top('playSeconds', LEADERBOARD_SIZE, profiles),
    ])
    leaderboardCache = { streaks, wins, levels, playtime }
  } catch (err) {
    console.warn('[profiles] leaderboard refresh failed:', err.message)
  }
}

/** Writes any pending changes now. Called on server shutdown. */
async function flushNow() {
  clearTimeout(saveTimer)
  await flush()
}

async function init() {
  await store.init(profiles, normalise)
  await refreshLeaderboards()
  setInterval(() => void refreshLeaderboards(), LEADERBOARD_REFRESH_MS).unref()
}

module.exports = {
  init,
  flushNow,
  loadProfile,
  release,
  markDirty,
  addQuestEvent,
  addXp,
  addPlaytime,
  todaysQuests,
  dailyRewardFor,
  view,
  leaderboards,
  dayKey,
  isWeekend,
}
