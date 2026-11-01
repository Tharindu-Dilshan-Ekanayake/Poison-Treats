import { useEffect, useRef } from 'react'

import { useBloxity } from '../bloxity/BloxityContext'
import { platform } from '../bloxity/platform'
import { connect, disconnect, send } from './api'

const GUEST_KEY = 'gmn-guest-id'

/**
 * A stable guest id: the Bloxity guest's id when the SDK has one (so a guest's
 * progress can follow them when they sign in, via the server's carriedFrom check),
 * otherwise one this browser keeps.
 */
function guestId(guest) {
  const fromBloxity = guest?._id ?? guest?.id
  if (fromBloxity && /^[a-z0-9_-]{8,64}$/i.test(String(fromBloxity))) return String(fromBloxity)
  let id = localStorage.getItem(GUEST_KEY)
  if (!id) {
    id = crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
    localStorage.setItem(GUEST_KEY, id)
  }
  return id
}

/**
 * Joins the game server once the Bloxity session has settled, and rejoins (into the
 * same room) when the player logs in or out: their profile follows the account.
 * Plays as a guest if the SDK fails to load, so the game never hard-depends on it.
 *
 * Signed-in players send their Bloxity token; the server verifies it with Bloxity
 * and never trusts the user id on its own.
 */
export function useConnection() {
  const { status, user, guest, identity, avatar, proportions } = useBloxity()
  const settled = status === 'ready' || status === 'error'

  const userId = user ? String(user._id ?? user.id ?? '') : ''
  const gid = guestId(guest)
  const name =
    identity?.displayName || identity?.username || `Guest${gid.replace(/[^a-z0-9]/gi, '').slice(0, 4)}`

  // Latest avatar for the join options, without making it a reconnect trigger.
  const avatarRef = useRef({ avatar, proportions })
  useEffect(() => {
    avatarRef.current = { avatar, proportions }
  })

  // Disconnect on unmount only: an identity change must keep the current room so
  // connect() can rejoin that same room with the new identity.
  useEffect(() => disconnect, [])

  useEffect(() => {
    if (!settled) return
    // Colyseus join options; the server verifies them in GameRoom.onAuth.
    connect({
      userId: userId || undefined,
      username: user?.username,
      token: userId ? platform.token() || undefined : undefined,
      guestId: gid,
      name,
      equipped: avatarRef.current.avatar,
      proportions: avatarRef.current.proportions,
    })
    // `user` is read for its username only; userId is the reconnect trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, userId, gid, name])

  useEffect(() => {
    if (settled) send({ t: 'avatar', equipped: avatar, proportions })
  }, [settled, avatar, proportions])
}
