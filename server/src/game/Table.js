const DATA = require('./data')

const T = DATA.timing
/** Treats on every table, laid out in a cols x rows grid. */
const COUNT = DATA.candies.cols * DATA.candies.rows

const isCandy = (n) => Number.isInteger(n) && n >= 0 && n < COUNT
const pickRandom = (list) => list[Math.floor(Math.random() * list.length)]

/**
 * One two-seat table and the match played at it. The players sit face to face
 * across a grid of treats.
 *
 * Phases:
 *   waiting   - zero or one player seated
 *   countdown - both seats filled, "Starting in 3..."
 *   poisoning - each player secretly poisons one treat
 *   eating    - players take turns eating a treat; whoever bites a poisoned one
 *               (either player's) loses
 *   ended     - result on screen; both players are stood up when it runs out
 *
 * The server holds both poisons. A client only ever learns its own poison until
 * the match is over.
 */
class Table {
  /**
   * @param {{ id: number, x: number, z: number }} def
   * @param {import('./GameRoom')} room
   * @param {object} state this table's synced TableState, for every client to see
   */
  constructor(def, room, state) {
    this.id = def.id
    this.x = def.x
    this.z = def.z
    this.room = room
    this.state = state
    /** @type {Array<import('./Session')|null>} */
    this.seats = [null, null]
    this.token = 0
    this.reset()
  }

  reset() {
    this.phase = 'waiting'
    this.endsAt = 0
    /** poison[i] = the treat seat i poisoned, -1 until chosen. */
    this.poison = [-1, -1]
    this.eaten = new Array(COUNT).fill(false)
    /** Safe treats each seat has eaten this match. */
    this.safe = [0, 0]
    this.turn = 0
    /** Seat index of the winner once the match has ended, else -1. */
    this.winner = -1
    /** The treat that ended the match (or -1). */
    this.fatal = -1
    this.timeouts = [0, 0]
    /** True between a bite and its outcome, so a second bite can't sneak in. */
    this.pending = false
    // Invalidates any setTimeout scheduled for the previous match.
    this.token += 1
  }

  seatOf(session) {
    return this.seats.indexOf(session)
  }

  sit(session, now) {
    if (this.phase !== 'waiting') return 'This table is already playing'
    const free = this.seats.indexOf(null)
    if (free < 0) return 'This table is full'

    this.seats[free] = session
    session.seat = { table: this, index: free }

    if (this.seats[0] && this.seats[1]) {
      this.phase = 'countdown'
      this.endsAt = now + T.countdown * 1000
    }
    this.sync(now)
    return null
  }

  /** A seated player stands up or disconnects. */
  leave(session, now) {
    const i = this.seatOf(session)
    if (i < 0) return
    const other = this.seats[1 - i]

    if (this.phase === 'eating') {
      this.finish(1 - i, i, 'forfeit', now)
    } else if (this.phase === 'countdown' || this.phase === 'poisoning') {
      other?.toast('Your opponent left the table')
    }

    this.unseat(i)
    if (this.phase !== 'ended') {
      // The remaining player (if any) keeps their seat and waits for someone new.
      this.reset()
      if (other) this.room.bubble(other, '')
    }
    this.sync(now)
  }

  unseat(i) {
    const session = this.seats[i]
    if (!session) return
    this.seats[i] = null
    session.seat = null
    session.send('match', { match: null })
  }

  /** Secretly poisons one treat. */
  poisonCandy(session, n, now) {
    const i = this.seatOf(session)
    if (i < 0 || this.phase !== 'poisoning' || this.poison[i] >= 0 || !isCandy(n)) return
    this.poison[i] = n
    this.room.bubble(session, 'Poisoned one 🧪')
    if (this.poison[1 - i] >= 0) this.startEating(now)
    else this.sync(now)
  }

  /** Bites a treat. The outcome lands after a moment of suspense. */
  eat(session, n, now) {
    const i = this.seatOf(session)
    if (i < 0 || this.phase !== 'eating' || this.turn !== i || this.pending) return
    if (!isCandy(n) || this.eaten[n]) return
    this.timeouts[i] = 0
    this.bite(i, n, now)
  }

  bite(i, n, now) {
    this.eaten[n] = true
    this.pending = true
    // Everyone nearby sees the treat lifted and munched.
    this.room.broadcast('eat', { table: this.id, i: n, by: this.seats[i]?.id ?? '' })
    this.sync(now)

    const token = this.token
    // Room clock: cleared automatically if the room is disposed meanwhile.
    this.room.clock.setTimeout(() => {
      if (this.token !== token || this.phase !== 'eating') return
      this.resolveBite(i, n, Date.now())
    }, T.eatReveal * 1000)
  }

  resolveBite(i, n, now) {
    const eater = this.seats[i]
    const poisoned = this.poison[0] === n || this.poison[1] === n
    if (poisoned) {
      this.room.broadcast('bite', { table: this.id, i: n, by: eater?.id ?? '', poisoned: true })
      this.fatal = n
      this.finish(1 - i, i, 'poisoned', now)
      return
    }

    this.safe[i] += 1
    let reward = 0
    if (eater) {
      reward = this.room.recordSafeBite(eater, now)
      this.room.bubble(eater, 'SAFE 😋')
    }
    this.room.broadcast('bite', { table: this.id, i: n, by: eater?.id ?? '', poisoned: false, reward })
    this.turn = 1 - i
    this.beginTurn(now)
  }

  startPoisoning(now) {
    this.phase = 'poisoning'
    this.endsAt = now + T.poison * 1000
    for (const s of this.seats) this.room.bubble(s, 'Poisoning… 🧪')
    this.sync(now)
  }

  startEating(now) {
    this.phase = 'eating'
    this.turn = Math.random() < 0.5 ? 0 : 1
    this.beginTurn(now)
  }

  beginTurn(now) {
    this.pending = false
    this.endsAt = now + T.turn * 1000
    this.sync(now)
  }

  /** Uneaten treats, leaving out `avoid` when anything else is left. */
  choices(avoid) {
    const all = []
    for (let n = 0; n < COUNT; n += 1) if (!this.eaten[n]) all.push(n)
    const others = all.filter((n) => n !== avoid)
    return others.length ? others : all
  }

  finish(w, l, reason, now) {
    this.phase = 'ended'
    this.endsAt = now + T.results * 1000
    this.pending = false
    this.winner = w

    const winner = this.seats[w]
    const loser = this.seats[l]
    let reward = 0

    if (winner) reward = this.room.recordWin(winner, now)
    let consolation = 0
    if (loser) consolation = this.room.recordLoss(loser, now, reason)
    if (loser) this.room.bubble(loser, reason === 'poisoned' ? 'BLEHH ☠️' : '')
    if (winner) this.room.bubble(winner, reason === 'poisoned' ? 'Hehe 😈' : 'GG 👍')

    this.room.broadcast('result', {
      table: this.id,
      winner: winner?.id ?? null,
      loser: loser?.id ?? null,
      poisons: [...this.poison],
      fatal: this.fatal,
      reward,
      consolation,
      reason,
    })
    this.sync(now)
    // Round end: report leaderboard scores now rather than at the next batch.
    this.room.flushScores()

    // The poisoned player falls apart at the table, then respawns back in the
    // lobby while the winner keeps dancing on their chair.
    const token = this.token
    this.room.clock.setTimeout(() => {
      if (this.token !== token || this.seats[l] !== loser || !loser) return
      this.unseat(l)
      loser.respawn()
      this.sync(Date.now())
    }, T.loserRespawn * 1000)
  }

  tick(now) {
    if (this.phase === 'waiting' || now < this.endsAt) return

    if (this.phase === 'countdown') {
      this.startPoisoning(now)
    } else if (this.phase === 'poisoning') {
      // Too slow to choose: the server poisons one for you.
      this.poison.forEach((p, i) => {
        if (p >= 0) return
        this.poison[i] = Math.floor(Math.random() * COUNT)
        this.seats[i]?.toast('Out of time! A random treat was poisoned 🧪')
      })
      this.startEating(now)
    } else if (this.phase === 'eating' && !this.pending) {
      const slow = this.turn
      this.timeouts[slow] += 1
      if (this.timeouts[slow] >= 2) {
        this.finish(1 - slow, slow, 'afk', now)
      } else {
        // Too slow: a random treat (never your own poison, if there's a choice).
        this.seats[slow]?.toast('Too slow! A random treat was picked')
        this.bite(slow, pickRandom(this.choices(this.poison[slow])), now)
      }
    } else if (this.phase === 'ended') {
      this.unseat(0)
      this.unseat(1)
      this.reset()
      this.sync(now)
    }
  }

  privateState(i, now) {
    const o = 1 - i
    return {
      table: this.id,
      seat: i,
      phase: this.phase,
      endsInMs: Math.max(0, this.endsAt - now),
      myPoison: this.poison[i],
      myTurn: this.phase === 'eating' && this.turn === i && !this.pending,
      theirTurn: this.phase === 'eating' && this.turn === o,
      pending: this.pending,
      mySafe: this.safe[i],
      theirSafe: this.safe[o],
      won: this.phase === 'ended' && this.winner === i,
      opponent: this.seats[o]?.id ?? null,
      opponentReady: this.poison[o] >= 0,
    }
  }

  /**
   * Publishes the table: the public part through the synced state (Colyseus sends
   * only fields that changed), the private part to each seated player.
   */
  sync(now = Date.now()) {
    const st = this.state
    st.phase = this.phase
    st.seat0 = this.seats[0]?.id ?? ''
    st.seat1 = this.seats[1]?.id ?? ''
    st.chair0 = this.seats[0]?.profile.equippedChair ?? ''
    st.chair1 = this.seats[1]?.profile.equippedChair ?? ''
    st.turn = this.phase === 'eating' ? (this.seats[this.turn]?.id ?? '') : ''
    st.winner = this.phase === 'ended' ? (this.seats[this.winner]?.id ?? '') : ''
    st.endsAt = this.phase === 'waiting' ? 0 : this.endsAt
    st.eaten = this.eaten.map((e) => (e ? '1' : '0')).join('')
    // Both poisons go public once the match is over, for everyone watching.
    st.poisons = this.phase === 'ended' ? this.poison.join(',') : ''
    this.seats.forEach((s, i) => s?.send('match', { match: this.privateState(i, now) }))
  }
}

Table.COUNT = COUNT

module.exports = Table
