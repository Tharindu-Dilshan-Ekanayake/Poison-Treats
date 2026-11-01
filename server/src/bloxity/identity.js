const DATA = require('../game/data')
const { boxity } = require('./config')

const VERIFY_TIMEOUT_MS = 5000
const PRODUCTION = process.env.NODE_ENV === 'production'

/**
 * Verifies a player's Bloxity token with the platform and returns who they really
 * are. The client's claimed user id is never trusted on its own.
 *
 * @returns {Promise<{ userId: string, username: string, displayName: string,
 *                     carriedFrom: string[] } | null>} null = not a verified account
 */
async function verifyBloxityToken(token) {
  if (typeof token !== 'string' || token.length < 10 || token.length > 4096) return null
  const res = await fetch(`${boxity.apiUrl}/v1/auth/game-token/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ gameSlug: DATA.bloxity.gameSlug }),
    signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.valid || !body.user) return null
  const user = body.user
  const userId = String(user._id ?? user.id ?? '')
  if (!userId) return null
  return {
    userId,
    username: String(user.username || ''),
    displayName: String(user.displayName || user.username || ''),
    carriedFrom: Array.isArray(body.carriedFrom) ? body.carriedFrom.map(String).slice(0, 5) : [],
  }
}

/**
 * Who a join request is: a verified Bloxity account, or a guest keyed by their
 * guest id (the Bloxity guest's id when the SDK has one).
 *
 * Outside production, an unreachable Bloxity API falls back to the client's
 * claimed user id so offline development still works; production never does.
 *
 * @returns {Promise<{ profileId: string, userId: string, username: string,
 *   name: string, carriedFrom: string[] } | null>}
 */
async function resolveIdentity(options, cleanName) {
  const guestId =
    typeof options?.guestId === 'string' && /^[a-z0-9_-]{8,64}$/i.test(options.guestId)
      ? options.guestId
      : ''

  if (options?.token) {
    try {
      const verified = await verifyBloxityToken(options.token)
      if (verified) {
        return {
          profileId: `u:${verified.userId}`,
          userId: verified.userId,
          username: verified.username,
          name: cleanName(verified.displayName || options.name),
          carriedFrom: verified.carriedFrom,
        }
      }
    } catch (err) {
      const claimed = typeof options.userId === 'string' ? options.userId.slice(0, 64) : ''
      if (!PRODUCTION && claimed) {
        console.warn('[identity] Bloxity verify unreachable; trusting claimed id in dev:', err.message)
        return {
          profileId: `u:${claimed}`,
          userId: claimed,
          username: String(options.username || ''),
          name: cleanName(options.name),
          carriedFrom: [],
        }
      }
      console.warn('[identity] Bloxity verify failed:', err.message)
    }
  }

  // Unverified: play as a guest. A claimed user id without a valid token is ignored.
  if (!guestId) return null
  return { profileId: `g:${guestId}`, userId: '', username: '', name: cleanName(options?.name), carriedFrom: [] }
}

module.exports = { resolveIdentity }
