const DATA = require('./data')

const MIN = DATA.numberMin
const MAX = DATA.numberMax
const T = DATA.timing

const randomInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1))
const isValidNumber = (n) => Number.isInteger(n) && n >= MIN && n <= MAX

/**
 * One two-seat table and the duel played at it.
 *
 * Phases:
 *   waiting   - zero or one player seated
 *   countdown - both seats filled, "Starting in 3..."
 *   choosing  - each player secretly picks 1-100
 *   guessing  - players take turns guessing the other's number; the server answers
 *               "Higher" / "Lower" on the opponent's behalf
 *   ended     - result on screen; both players are stood up when it runs out
 *
 * The server holds both secrets. A client only ever learns its own number, the range
 * its guesses have narrowed the opponent's down to, and the opponent's number if it
 * paid to reveal it.
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
    this.secrets = [null, null]
    /** ranges[i] = what seat i has narrowed seat (1-i)'s number down to. */
    this.ranges = [
      [MIN, MAX],
      [MIN, MAX],
    ]
    this.guesses = [0, 0]
    /** history[i] = seat i's guesses so far: [{ n, answer: 'higher'|'lower'|'correct' }]. */
    this.history = [[], []]
    this.turn = 0
    /** Seat index of the winner once the duel has ended, else -1. */
    this.winner = -1
    this.revealed = [false, false]
    this.timeouts = [0, 0]
    /** True between a guess and its answer, so a second guess can't sneak in. */
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

    if (this.phase === 'guessing') {
      this.finish(1 - i, i, 'forfeit', now)
    } else if (this.phase === 'countdown' || this.phase === 'choosing') {
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

  pick(session, n, now) {
    const i = this.seatOf(session)
    if (i < 0 || this.phase !== 'choosing' || this.secrets[i] !== null) return
    if (!isValidNumber(n)) return

    this.secrets[i] = n
    this.room.bubble(session, 'Ready ✅')
    if (this.secrets[1 - i] !== null) this.startGuessing(now)
    else this.sync(now)
  }

  guess(session, n, now) {
    const i = this.seatOf(session)
    if (i < 0 || this.phase !== 'guessing' || this.turn !== i || this.pending) return
    const [lo, hi] = this.ranges[i]
    if (!isValidNumber(n) || n < lo || n > hi) return

    this.guesses[i] += 1
    this.timeouts[i] = 0
    this.pending = true
    this.room.bubble(session, `Is your number ${n}? 🤔`)
    // Both players see the guess land, then (after the suspense) the answer.
    this.tell({ t: 'guessed', by: i, n })
    this.sync(now)

    const token = this.token
    // Room clock: cleared automatically if the room is disposed meanwhile.
    this.room.clock.setTimeout(() => {
      if (this.token !== token || this.phase !== 'guessing') return
      this.resolveGuess(i, n, Date.now())
    }, T.guessReveal * 1000)
  }

  resolveGuess(i, n, now) {
    const o = 1 - i
    const secret = this.secrets[o]
    if (n === secret) {
      this.history[i].push({ n, answer: 'correct' })
      this.tell({ t: 'answer', by: i, n, answer: 'correct' })
      this.finish(i, o, 'guessed', now)
      return
    }
    const answer = n < secret ? 'higher' : 'lower'
    this.history[i].push({ n, answer })
    this.tell({ t: 'answer', by: i, n, answer })
    if (answer === 'higher') {
      this.ranges[i][0] = n + 1
      this.room.bubble(this.seats[o], 'Higher 👆')
    } else {
      this.ranges[i][1] = n - 1
      this.room.bubble(this.seats[o], 'Lower 👇')
    }
    this.turn = o
    this.beginTurn(now)
  }

  /**
   * A duel event for both seated players, from each one's point of view: `mine`
   * is true for the player who made the guess.
   */
  tell({ t, by, ...rest }) {
    this.seats.forEach((s, i) => s?.send('duel', { t, mine: i === by, ...rest }))
  }

  /** Paid power-ups. Returns an error string, or null on success. */
  power(session, kind, now) {
    const i = this.seatOf(session)
    if (i < 0 || this.phase !== 'guessing') return 'Power-ups work during guessing'
    const cost = DATA.powers[kind]
    if (cost === undefined) return 'Unknown power-up'
    if (session.profile.cash < cost) return `You need $${cost}`

    if (kind === 'hint') {
      const [lo, hi] = this.ranges[i]
      const width = hi - lo + 1
      if (width <= 3) return 'Already narrowed down!'
      const secret = this.secrets[1 - i]
      const span = Math.max(3, Math.ceil(width / 4))
      const start = randomInt(Math.max(lo, secret - span + 1), Math.min(secret, hi - span + 1))
      this.ranges[i] = [start, start + span - 1]
      session.toast(`Hint: it's between ${start} and ${start + span - 1}`)
    } else if (kind === 'reveal') {
      if (this.revealed[i]) return 'Already revealed'
      this.revealed[i] = true
      session.toast(`Their number is ${this.secrets[1 - i]} 👀`)
    }
    if (kind === 'hint') this.room.questEvent(session, 'hint', now)

    session.profile.cash -= cost
    session.pushProfile(now)
    this.sync(now)
    return null
  }

  startChoosing(now) {
    this.phase = 'choosing'
    this.endsAt = now + T.choose * 1000
    for (const s of this.seats) this.room.bubble(s, 'Choosing 🤔')
    this.sync(now)
  }

  startGuessing(now) {
    this.phase = 'guessing'
    this.turn = Math.random() < 0.5 ? 0 : 1
    this.beginTurn(now)
  }

  beginTurn(now) {
    this.pending = false
    this.endsAt = now + T.turn * 1000
    this.sync(now)
  }

  finish(w, l, reason, now) {
    this.phase = 'ended'
    this.endsAt = now + T.results * 1000
    this.pending = false
    this.winner = w

    const winner = this.seats[w]
    const loser = this.seats[l]
    let reward = 0

    if (winner) reward = this.room.recordWin(winner, this.guesses[w], now)
    let consolation = 0
    if (loser) consolation = this.room.recordLoss(loser, now, reason)
    if (loser) this.room.bubble(loser, 'NOOO! 💀')
    if (winner) this.room.bubble(winner, reason === 'forfeit' ? 'GG 👍' : 'Got it! 😎')

    this.room.broadcast('result', {
      table: this.id,
      winner: winner?.id ?? null,
      loser: loser?.id ?? null,
      numbers: [...this.secrets],
      reward,
      consolation,
      reason,
    })
    this.sync(now)
    // Round end: report leaderboard scores now rather than at the next batch.
    this.room.flushScores()

    // The loser falls apart at the table, then respawns back in the lobby while
    // the winner keeps dancing on their chair.
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
      this.startChoosing(now)
    } else if (this.phase === 'choosing') {
      // Too slow to choose: the server chooses for you.
      this.secrets.forEach((s, i) => {
        if (s === null) {
          this.secrets[i] = randomInt(MIN, MAX)
          this.seats[i]?.toast(`Out of time! Your number is ${this.secrets[i]}`)
        }
      })
      this.startGuessing(now)
    } else if (this.phase === 'guessing' && !this.pending) {
      const slow = this.turn
      this.timeouts[slow] += 1
      if (this.timeouts[slow] >= 2) {
        this.finish(1 - slow, slow, 'afk', now)
      } else {
        this.seats[slow]?.toast('Too slow! Turn skipped')
        this.turn = 1 - slow
        this.beginTurn(now)
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
      myNumber: this.secrets[i],
      range: [...this.ranges[i]],
      myTurn: this.phase === 'guessing' && this.turn === i && !this.pending,
      theirTurn: this.phase === 'guessing' && this.turn === o,
      pending: this.pending,
      guesses: this.guesses[i],
      myHistory: this.history[i],
      theirHistory: this.history[o],
      won: this.phase === 'ended' && this.winner === i,
      revealed: this.revealed[i] ? this.secrets[o] : null,
      opponent: this.seats[o]?.id ?? null,
      opponentReady: this.secrets[o] !== null,
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
    st.turn = this.phase === 'guessing' ? (this.seats[this.turn]?.id ?? '') : ''
    st.winner = this.phase === 'ended' ? (this.seats[this.winner]?.id ?? '') : ''
    st.endsAt = this.phase === 'waiting' ? 0 : this.endsAt
    this.seats.forEach((s, i) => s?.send('match', { match: this.privateState(i, now) }))
  }
}

module.exports = Table
