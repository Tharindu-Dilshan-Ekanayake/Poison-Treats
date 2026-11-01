// Bloxity cross-pod room directory: pushes this pod's live rooms to the matchmaker
// every ~2s so "Open Rooms", friend joins and join-by-id work across pods.
// No-op unless deployed by Bloxity hosting (BLOXITY_REPORT_TOKEN, MATCHMAKER_REPORT_URL,
// BLOXITY_GAME_ID), so it is safe locally. Call installRoomReporter() after listen().
// (The Bloxity starter's legion-room-reporter.ts, as CommonJS.)
const { matchMaker } = require('@colyseus/core')

const { boxity } = require('./config')

function installRoomReporter() {
  const base = boxity.matchmakerReportUrl
  const token = boxity.reportToken
  const gameId = boxity.gameId
  if (!base || !token || !gameId) return

  const url = `${base.replace(/\/$/, '')}/${gameId}/rooms`
  const tick = async () => {
    try {
      const listings = await matchMaker.query({})
      const rooms = listings.map((listing) => {
        const metadata = listing.metadata || {}
        return {
          colyseusRoomId: listing.roomId,
          name: listing.name || undefined,
          clients: listing.clients ?? 0,
          maxClients: listing.maxClients ?? 0,
          locked: !!listing.locked,
          private: !!listing.private,
          started: !!metadata.started,
          metadata: listing.metadata || undefined,
        }
      })
      const players = rooms.reduce((total, room) => total + (room.clients || 0), 0)
      await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ podName: boxity.podName, players, rooms }),
        signal: AbortSignal.timeout(4000),
      })
    } catch {
      /* best-effort; the directory tolerates gaps */
    }
  }
  setInterval(() => void tick(), 2000).unref()
  void tick()
}

module.exports = { installRoomReporter }
