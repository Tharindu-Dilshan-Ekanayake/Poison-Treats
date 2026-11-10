const { Room, ServerError } = require('@colyseus/core')

const { resolveIdentity } = require('../bloxity/identity')
const { flushScores, submitScore } = require('../bloxity/leaderboards')
const Bot = require('./Bot')
const DATA = require('./data')
const profiles = require('./profiles')
const { GameState, PlayerState, TableState } = require('./schema')
const { cleanName, Session } = require('./Session')
const Table = require('./Table')

const TICK_MS = 100
/** 10 Hz state patches: positions are interpolated client-side, so more buys nothing. */
const PATCH_MS = 100
/** How long a dropped player keeps their place (and table seat) while reconnecting. */
const RECONNECT_SECONDS = 20
const LEADERBOARD_PUSH_MS = 15000
/** How often time in the game is counted for everyone connected. */
const PLAYTIME_TICK_MS = 30000
/** Close code for a session replaced by the same account joining from elsewhere. */
const REPLACED = 4100
/** Close code for a player removed for being away (the client shows "Play again"). */
const AFK_KICK = 4200
const AFK_TICK_MS = 5000

/** profile id -> live session, across every room in this process. */
const liveByProfile = new Map()

/**
 * One game server: up to 20 players sharing the island and its ten tables.
 *
 * Colyseus matchmaking fills a room to `maxClients`, locks it, and `joinOrCreate`
 * then opens a new one, so "server size 20" is just the cap here.
 */
class GameRoom extends Room {
  maxClients = DATA.roomSize
  patchRate = PATCH_MS
  /** Clients over this are disconnected; normal play sends ~12/s. */
  maxMessagesPerSecond = 40

  onCreate() {
    this.state = new GameState()
    /** session id -> Session, including players mid-reconnect. */
    this.sessions = new Map()
    this.lastBoard = ''

    this.tables = DATA.tables.map((def) => {
      const state = new TableState()
      this.state.tables.set(String(def.id), state)
      const table = new Table(def, this, state)
      table.sync()
      return table
    })

    this.onMessage('*', (client, type, message) => {
      this.sessions.get(client.sessionId)?.handle(type, message, Date.now())
    })

    this.clock.setInterval(() => {
      const now = Date.now()
      for (const table of this.tables) table.tick(now)
    }, TICK_MS)
    this.clock.setInterval(() => this.pushLeaderboard(), LEADERBOARD_PUSH_MS)
    this.lastPlaytimeTick = Date.now()
    this.clock.setInterval(() => this.tickPlaytime(), PLAYTIME_TICK_MS)
    this.clock.setInterval(() => this.tickAfk(), AFK_TICK_MS)

    /** bot id -> Bot: practice opponents, kept apart from real players' sessions. */
    this.bots = new Map()
    this.botSerial = 0
  }

  /**
   * Runs before a seat is granted: verifies the Bloxity token, then loads the
   * profile. The result becomes `client.auth`.
   */
  async onAuth(_client, options) {
    const identity = await resolveIdentity(options, cleanName)
    if (!identity) throw new ServerError(400, 'Missing player identity')
    const profile = await profiles.loadProfile(identity.profileId, identity.name, {
      carriedFrom: identity.carriedFrom,
    })
    return { identity, profile }
  }

  onJoin(client, options) {
    const now = Date.now()
    const { identity, profile } = client.auth

    // One account, one place: a second tab replaces the first.
    const previous = liveByProfile.get(identity.profileId)
    if (previous) {
      previous.toast('You joined from another window')
      previous.room.kick(previous)
    }

    const player = new PlayerState()
    const session = new Session(client, this, player, identity, profile, options, now)
    this.sessions.set(client.sessionId, session)
    liveByProfile.set(identity.profileId, session)
    this.state.players.set(client.sessionId, player)
    // Puts players who levelled up before the Level board existed on it (it keeps each player's best).
    if (profile.level > 1) submitScore(session.userId, 'level', profile.level)
    this.sendWelcome(session, now)
  }

  onDrop(client) {
    const session = this.sessions.get(client.sessionId)
    // A kicked session must not get a reconnection window (it would linger as a
    // ghost for RECONNECT_SECONDS); without one, Colyseus goes straight to onLeave.
    if (session && !session.kicked) {
      session.reconnection = this.allowReconnection(client, RECONNECT_SECONDS)
    }
  }

  onReconnect(client) {
    const session = this.sessions.get(client.sessionId)
    if (!session) return
    session.client = client
    session.reconnection = null
    session.touch(Date.now())
    // Private messages sent while they were away are lost; resend what matters.
    this.sendWelcome(session, Date.now())
  }

  onLeave(client) {
    const session = this.sessions.get(client.sessionId)
    if (!session) return
    const now = Date.now()
    session.seat?.table.leave(session, now)
    session.close(now)
    profiles.release(session.profile)
    this.sessions.delete(client.sessionId)
    this.state.players.delete(client.sessionId)
    if (liveByProfile.get(session.profile.id) === session) liveByProfile.delete(session.profile.id)
  }

  onUncaughtException(error, methodName) {
    console.error(`[game] room ${this.roomId} ${methodName} failed:`, error)
  }

  /** Disconnects a session, including one that is mid-reconnect. */
  kick(session) {
    session.kicked = true
    if (session.reconnection) session.reconnection.reject(new Error('replaced'))
    else session.client.leave(REPLACED)
  }

  sendWelcome(session, now) {
    session.send('welcome', {
      capacity: DATA.roomSize,
      // Lets clients turn the state's server-clock deadlines into local ones.
      serverNow: now,
      profile: session.profileView(now),
      lb: profiles.leaderboards(),
    })
    if (session.seat) session.seat.table.sync(now)
  }

  pushLeaderboard() {
    const board = profiles.leaderboards()
    const json = JSON.stringify(board)
    if (json === this.lastBoard) return
    this.lastBoard = json
    this.broadcast('lb', board)
  }

  /**
   * Frees the slots of players who have walked away: a warning after `warnSeconds`
   * without doing anything, removal after `kickSeconds`. A match in progress is never
   * interrupted (the table has its own rule for players who stop picking).
   */
  tickAfk() {
    const now = Date.now()
    const { warnSeconds, kickSeconds } = DATA.afk
    for (const session of this.sessions.values()) {
      if (session.kicked || session.reconnection) continue
      const phase = session.seat?.table.phase
      if (phase && phase !== 'waiting') {
        session.touch(now)
        continue
      }
      const idle = (now - session.lastActiveAt) / 1000
      if (idle >= kickSeconds) {
        session.kicked = true
        session.client.leave(AFK_KICK) // onLeave stands them up and frees the slot
      } else if (idle >= warnSeconds && !session.afkWarned) {
        session.afkWarned = true
        session.send('afkWarn', { inMs: Math.round((kickSeconds - idle) * 1000) })
      }
    }
  }

  /**
   * The "Play Bot" button: gives a player who is waiting alone at a table a practice
   * opponent. Nothing happens unless they ask for it.
   */
  requestBot(session, now) {
    const table = session.seat?.table
    if (!table) {
      session.toast('Sit at a table first')
      return
    }
    // Already started, or a real player has sat down too: nothing to do.
    if (table.phase !== 'waiting' || table.seats.some((s) => s && s !== session)) return
    if (!DATA.bots.enabled || this.bots.size >= DATA.bots.maxBots) {
      session.toast('All practice bots are busy, try again in a moment')
      return
    }
    this.spawnBot(table, session, now)
  }

  spawnBot(table, human, now) {
    const taken = new Set([...this.bots.values()].map((b) => b.name))
    const free = DATA.bots.names.filter((n) => !taken.has(`${n} 🤖`))
    const pool = free.length ? free : DATA.bots.names
    const bot = new Bot(this, `bot_${(this.botSerial += 1)}`, `${pool[Math.floor(Math.random() * pool.length)]} 🤖`)
    this.bots.set(bot.id, bot)
    this.state.players.set(bot.id, bot.player)
    if (table.sit(bot, now)) {
      this.removeBot(bot)
      return
    }
    bot.placeAt(table)
    const pct = Math.round(DATA.bots.rewardScale * 100)
    human.toast(`${bot.name} joined for a practice match: ${pct}% rewards, no leaderboard points`)
  }

  removeBot(bot) {
    if (!this.bots.delete(bot.id)) return
    bot.dispose()
    this.state.players.delete(bot.id)
  }

  /** Counts time played for everyone here; whole minutes go to the Bloxity board. */
  tickPlaytime() {
    const now = Date.now()
    const seconds = Math.min(60, (now - this.lastPlaytimeTick) / 1000)
    this.lastPlaytimeTick = now
    for (const session of this.sessions.values()) {
      const minutes = profiles.addPlaytime(session.profile, seconds)
      if (minutes > 0) submitScore(session.userId, 'playtime', minutes)
    }
  }

  flushScores() {
    void flushScores()
  }

  bubble(session, text) {
    if (session) this.broadcast('bubble', { id: session.id, text })
  }

  table(id) {
    return this.tables.find((t) => t.id === id) || null
  }

  /**
   * A safe bite pays a little straight away. Returns the cash granted. In a practice
   * match (`vsBot`) it pays a share and doesn't count towards the treats quest.
   */
  recordSafeBite(session, now, vsBot = false) {
    if (session.isBot) return 0
    const p = session.profile
    const scale = vsBot ? DATA.bots.rewardScale : 1
    const cash = Math.round(
      DATA.safeReward * (profiles.isWeekend(now) ? 2 : 1) * (p.passes.includes('cash2x') ? 2 : 1) * scale,
    )
    p.cash += cash
    if (!vsBot) profiles.addQuestEvent(p, 'safe', 1, now)
    profiles.markDirty(p)
    session.pushProfile(now)
    return cash
  }

  /**
   * Awards a win and returns the cash granted. A win over a practice bot (`vsBot`) pays
   * a share of the usual cash and XP, and counts for no wins, streaks, win quests or
   * leaderboards, so bots can't be farmed for rank.
   */
  recordWin(session, now, vsBot = false) {
    if (session.isBot) return 0
    const p = session.profile
    const has = (pass) => p.passes.includes(pass)
    const scale = vsBot ? DATA.bots.rewardScale : 1
    const cash = Math.round(DATA.winReward * (profiles.isWeekend(now) ? 2 : 1) * (has('cash2x') ? 2 : 1) * scale)
    p.cash += cash
    profiles.addQuestEvent(p, 'play', 1, now)

    if (!vsBot) {
      const streakBefore = p.streak
      p.wins += has('wins2x') ? 2 : 1
      p.streak += has('streak2x') ? 2 : 1
      p.bestStreak = Math.max(p.bestStreak, p.streak)
      profiles.addQuestEvent(p, 'win', 1, now)
      if (p.streak >= 3) profiles.addQuestEvent(p, 'streak3', 1, now)

      // Win-streak milestones pay a bonus, announced to the whole server.
      for (const [milestone, bonus] of Object.entries(DATA.streakBonuses)) {
        const m = Number(milestone)
        if (streakBefore < m && p.streak >= m) {
          p.cash += bonus
          session.toast(`🔥 ${m} win streak! +$${bonus}`)
          this.broadcast('toast', { text: `🔥 ${session.player.name} is on a ${m} win streak!` }, { except: session.client })
        }
      }

      // Bloxity leaderboards, from server-owned state only.
      submitScore(session.userId, 'wins', has('wins2x') ? 2 : 1)
      submitScore(session.userId, 'best_streak', p.bestStreak)
      session.player.streak = p.streak
    }
    profiles.markDirty(p)

    this.giveXp(session, Math.round(DATA.xp.win * scale))
    session.pushProfile(now)
    return cash
  }

  /** XP for a match; a level-up is celebrated for the player and shown to the room. */
  giveXp(session, amount) {
    const reached = profiles.addXp(session.profile, amount)
    session.player.level = session.profile.level
    if (reached.length) submitScore(session.userId, 'level', session.profile.level)
    for (const level of reached) {
      const reward = Math.min(DATA.xp.rewardCap, DATA.xp.rewardPerLevel * level)
      const title = DATA.titles.find((t) => t.level === level)
      session.send('levelUp', { level, reward, title: title?.name ?? null })
    }
  }

  /**
   * A lost match still pays a little (and XP), so every game moves you forward.
   * Quitting or timing out pays nothing. Returns the cash given. Against a practice
   * bot (`vsBot`) the payout shrinks and the win streak is left alone.
   */
  recordLoss(session, now, reason = 'poisoned', vsBot = false) {
    if (session.isBot) return 0
    const p = session.profile
    const scale = vsBot ? DATA.bots.rewardScale : 1
    if (!vsBot) p.streak = 0
    profiles.addQuestEvent(p, 'play', 1, now)
    const finished = reason === 'poisoned'
    const cash = finished ? Math.round(DATA.lossReward * (profiles.isWeekend(now) ? 2 : 1) * scale) : 0
    p.cash += cash
    profiles.markDirty(p)
    if (!vsBot) session.player.streak = 0
    if (finished) this.giveXp(session, Math.round(DATA.xp.loss * scale))
    session.pushProfile(now)
    return cash
  }
}

module.exports = GameRoom
