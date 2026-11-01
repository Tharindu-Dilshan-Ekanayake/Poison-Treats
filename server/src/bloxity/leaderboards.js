const DATA = require('../game/data')
const { boxity } = require('./config')

const FLUSH_MS = 15000
const MAX_PER_CALL = 200

/** Pending scores, reported in batches. Only verified Bloxity accounts rank. */
let queue = []
let timer = null

const enabled = () => Boolean(boxity.reportToken && boxity.gameId)

/**
 * Queues a score for a Bloxity account. For 'sum' boards pass the amount just
 * gained; for 'best' boards the score itself. Values come only from server state.
 */
function submitScore(userId, board, score) {
  if (!enabled() || !userId || !Number.isFinite(score) || score < 0) return
  // Identities are "legion_<id>"; strip any "#m..." mode suffix.
  const id = String(userId).replace(/^legion_/, '').split('#m')[0]
  queue.push({ board, userId: `legion_${id}`, score })
}

async function flush() {
  if (!enabled() || queue.length === 0) return
  const batch = queue
  queue = []
  for (let i = 0; i < batch.length; i += MAX_PER_CALL) {
    const scores = batch.slice(i, i + MAX_PER_CALL)
    try {
      const res = await fetch(`${boxity.apiUrl}/v1/leaderboards/hosted/${boxity.gameId}/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${boxity.reportToken}` },
        body: JSON.stringify({ boards: DATA.bloxity.leaderboards, scores }),
        signal: AbortSignal.timeout(8000),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) console.warn('[leaderboards] report failed', res.status, body)
      else if (body.dropped && Object.values(body.dropped).some((n) => n > 0)) {
        console.warn('[leaderboards] dropped scores:', body.dropped)
      }
    } catch (err) {
      console.warn('[leaderboards] report error:', err.message)
    }
  }
}

/** Starts the periodic flush. Does nothing without a report token (local dev). */
function installLeaderboardReporter() {
  if (!enabled() || timer) return
  timer = setInterval(() => void flush(), FLUSH_MS)
  timer.unref()
}

module.exports = { submitScore, flushScores: flush, installLeaderboardReporter }
