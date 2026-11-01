import { DANCE_FORWARD, SEATED_BACK, SEATED_DROP, TABLE } from './layout'

/** Seconds for the winner's jump from the chair up onto the table. */
const CLIMB_S = 0.55
const HOP_HEIGHT = 0.8
/** Side-to-side wiggle of the whole body while dancing, in radians. */
const WIGGLE = 0.35
/** How long a bite takes: hand up to the mouth, munch, hand back down. */
export const EAT_MS = 1400

/**
 * Poses a player who is at a table: sitting, or, for a duel's winner
 * (`seat.dancing`), jumping up onto the table and dancing on it until the result
 * clears. Shared by the local player and remote players so both look
 * identical.
 *
 * @param {import('three').Object3D} visual the avatar's group (feet at its origin)
 * @param {import('three').Object3D|null} tag the name tag's group, lifted with them
 * @param {{ ry: number, dancing?: boolean }} seat
 * @param {object} motion the avatar's motion state (see animateRig)
 * @param {number} delta frame time in seconds
 * @param {number} [eatStart] epoch ms this player started eating a treat (0 = not)
 */
export function poseAtSeat(visual, tag, seat, motion, delta, eatStart = 0) {
  motion.speed = 0
  const eatT = eatStart ? (Date.now() - eatStart) / EAT_MS : 1
  motion.eat = eatT >= 0 && eatT < 1 ? eatT : 0
  if (!seat.dancing) {
    motion.danceT = null
    motion.dancing = false
    motion.seated = true
    motion.grounded = true
    // Slide back (away from the table) along the seat's facing.
    visual.position.set(-Math.sin(seat.ry) * SEATED_BACK, SEATED_DROP, -Math.cos(seat.ry) * SEATED_BACK)
    visual.rotation.set(0, seat.ry, 0)
    if (tag) tag.position.set(0, 0, 0)
    return
  }

  motion.danceT = (motion.danceT ?? 0) + delta
  const t = Math.min(1, motion.danceT / CLIMB_S)
  const landed = t >= 1
  const y = TABLE.height * t + Math.sin(t * Math.PI) * HOP_HEIGHT
  // "Forward" onto the table is the seat's facing (yaw 0 looks along +Z).
  const forward = DANCE_FORWARD * t
  const fx = Math.sin(seat.ry) * forward
  const fz = Math.cos(seat.ry) * forward

  motion.seated = false
  // Mid-hop the rig uses its airborne tuck, then breaks into the dance.
  motion.grounded = landed
  motion.dancing = landed
  visual.position.set(fx, y, fz)
  visual.rotation.set(0, seat.ry + (landed ? Math.sin(motion.time * 4) * WIGGLE : 0), 0)
  if (tag) tag.position.set(fx, y, fz)
}

/** Back to a normal standing pose after leaving the seat. */
export function clearSeatPose(visual, tag, motion) {
  motion.seated = false
  motion.dancing = false
  motion.danceT = null
  motion.eat = 0
  visual.position.set(0, 0, 0)
  if (tag) tag.position.set(0, 0, 0)
}
