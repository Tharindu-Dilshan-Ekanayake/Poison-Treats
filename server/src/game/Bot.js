const DATA = require('./data')
const { PlayerState } = require('./schema')

const COUNT = DATA.candies.cols * DATA.candies.rows

const rand = (lo, hi) => lo + Math.random() * (hi - lo)
const randomInt = (lo, hi) => Math.floor(rand(lo, hi + 1))
const pick = (list) => list[Math.floor(Math.random() * list.length)]

/** Chairs a bot may sit on: the cheaper ones, so it looks like an ordinary newcomer. */
const BOT_CHAIRS = DATA.chairs.filter((c) => c.price <= 1200).map((c) => c.id)
/** How long a bot "thinks" before acting, in ms: a range, so it doesn't feel scripted. */
const THINK_MS = { poison: [1200, 3500], eat: [1500, 4200], leave: [500, 900] }

/**
 * A practice opponent: stands in for a second player so nobody waits at a table for
 * ever. It plays through the same Table methods a real player does (poisonCandy,
 * eat), so the rules are enforced identically, and it learns the state of the match
 * from the same private `match` messages a client receives (plus the table's public
 * synced state, which every client sees too: which treats are eaten).
 *
 * Bots live only for one match: they appear when a player waiting alone asks for one,
 * and are removed when the match is over or their opponent leaves. They never touch
 * profiles, leaderboards or the profile store (see GameRoom.recordWin / recordLoss).
 */
class Bot {
  /**
   * @param {import('./GameRoom')} room
   * @param {string} id unique id in the room's player map
   * @param {string} name display name
   */
  constructor(room, id, name) {
    this.isBot = true
    this.room = room
    this.id = id
    this.name = name
    this.userId = ''
    this.seat = null
    this.timer = null
    this.key = ''

    // The bits of a profile that Table and GameRoom read.
    this.profile = {
      equippedChair: pick(BOT_CHAIRS),
      passes: [],
    }

    const [x, y, z] = DATA.world.spawn
    const p = new PlayerState()
    p.name = name
    p.uid = ''
    p.uname = ''
    p.streak = 0
    p.level = randomInt(1, 6)
    p.title = ''
    p.halo = ''
    p.avatar = JSON.stringify({ equipped: null, proportions: null })
    p.x = x
    p.y = y
    p.z = z
    p.g = true
    this.player = p
  }

  /** Stand where the seat is, so anything reading the player's position agrees. */
  placeAt(table) {
    if (!this.seat) return
    const p = this.player
    p.x = table.x
    p.z = table.z + (this.seat.index === 0 ? -DATA.table.seatZ : DATA.table.seatZ)
  }

  // The Session surface that Table and GameRoom call. Bots have no screen to update.
  toast() {}
  pushProfile() {}
  respawn() {}

  /** Private messages from the table: the only one a bot cares about is `match`. */
  send(type, payload) {
    if (type === 'match') this.onMatch(payload?.match)
  }

  onMatch(m) {
    if (!m) {
      // Stood up (match over, or their opponent left): the bot's job is done.
      this.clear()
      this.key = ''
      this.room.removeBot(this)
      return
    }
    if (m.phase === 'waiting') {
      // Their opponent left: nobody to play with, so go too.
      this.later(THINK_MS.leave, () => this.leave())
      return
    }

    // The table syncs many times per phase; act once per distinct situation.
    const key = `${m.phase}:${m.mySafe + m.theirSafe}:${m.myTurn ? 1 : 0}:${m.myPoison >= 0 ? 1 : 0}`
    if (key === this.key) return
    this.key = key
    this.clear()

    const table = this.seat?.table
    if (!table) return
    if (m.phase === 'poisoning' && m.myPoison < 0) {
      this.later(THINK_MS.poison, () => table.poisonCandy(this, randomInt(0, COUNT - 1), Date.now()))
    } else if (m.phase === 'eating' && m.myTurn) {
      this.later(THINK_MS.eat, () => {
        const n = this.chooseTreat(table.state.eaten, m.myPoison)
        if (n >= 0) table.eat(this, n, Date.now())
      })
    }
  }

  /**
   * Plays as well as a careful player can: it never eats its own poison while there
   * is anything else, and otherwise picks at random, since the opponent's poison is
   * hidden from it exactly as it is from a person. The little wobble: it tends to
   * reach for treats on its own side of the table first, like people do.
   */
  chooseTreat(eatenMask, myPoison) {
    const left = []
    for (let n = 0; n < COUNT; n += 1) if (eatenMask?.charCodeAt(n) !== 49) left.push(n)
    const choices = left.filter((n) => n !== myPoison)
    const pool = choices.length ? choices : left
    if (pool.length === 0) return -1
    if (Math.random() < 0.35) {
      // Rows nearest its seat: low rows for seat 0 (on the table's -Z side), high for seat 1.
      const rows = DATA.candies.rows
      const near = pool.filter((n) => {
        const row = Math.floor(n / DATA.candies.cols)
        return this.seat?.index === 0 ? row < rows / 2 : row >= rows / 2
      })
      if (near.length) return pick(near)
    }
    return pick(pool)
  }

  leave() {
    this.seat?.table.leave(this, Date.now())
    this.room.removeBot(this)
  }

  later([lo, hi], fn) {
    this.clear()
    this.timer = this.room.clock.setTimeout(() => {
      this.timer = null
      fn()
    }, rand(lo, hi))
  }

  clear() {
    this.timer?.clear()
    this.timer = null
  }

  dispose() {
    this.clear()
  }
}

module.exports = Bot
