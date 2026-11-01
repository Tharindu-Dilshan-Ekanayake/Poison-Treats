import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import { Quaternion, Vector3 } from 'three'

import { sfx } from '../audio/sfx'
import { useGame } from '../net/gameStore'
import { avatarAnchors, localPlayer, SELF_ANCHOR, touchInput } from '../net/liveState'
import { COLLIDERS, PLAYER_HEIGHT, WORLD_HALF } from './layout'
import Nametag from './Nametag'
import PlayerAvatar from './PlayerAvatar'
import { clearSeatPose, poseAtSeat } from './seatPose'
import useKeyboard from './useKeyboard'

const RADIUS = 0.4

const MOVE_SPEED = 7
const SPRINT_MULTIPLIER = 1.6
const GRAVITY = 30
/** v = sqrt(2 g h) for a ~1.4 unit jump. */
const JUMP_SPEED = Math.sqrt(2 * GRAVITY * 1.4)
/** Longest step integrated at once, so a frame hitch can't tunnel through a table. */
const MAX_STEP = 1 / 30

// Scratch objects, reused each frame so the loop allocates nothing.
const _move = new Vector3()
const _camForward = new Vector3()
const _camRight = new Vector3()
const _targetQuat = new Quaternion()
const _up = new Vector3(0, 1, 0)

/**
 * Pushes a circle of `RADIUS` at (pos.x, pos.z) out of every collider box. The world
 * is a flat island with a handful of static boxes, so this replaces a full physics
 * engine (and its ~2 MB of WASM) with a few comparisons per frame.
 */
function resolveCollisions(pos) {
  for (const c of COLLIDERS) {
    const cx = Math.min(Math.max(pos.x, c.minX), c.maxX)
    const cz = Math.min(Math.max(pos.z, c.minZ), c.maxZ)
    const dx = pos.x - cx
    const dz = pos.z - cz
    const d2 = dx * dx + dz * dz
    if (d2 >= RADIUS * RADIUS) continue

    if (d2 > 1e-8) {
      const d = Math.sqrt(d2)
      pos.x = cx + (dx / d) * RADIUS
      pos.z = cz + (dz / d) * RADIUS
    } else {
      // Centre is inside the box: leave by the nearest face.
      const left = pos.x - c.minX
      const right = c.maxX - pos.x
      const back = pos.z - c.minZ
      const front = c.maxZ - pos.z
      const m = Math.min(left, right, back, front)
      if (m === left) pos.x = c.minX - RADIUS
      else if (m === right) pos.x = c.maxX + RADIUS
      else if (m === back) pos.z = c.minZ - RADIUS
      else pos.z = c.maxZ + RADIUS
    }
  }
  const edge = WORLD_HALF - RADIUS
  pos.x = Math.min(edge, Math.max(-edge, pos.x))
  pos.z = Math.min(edge, Math.max(-edge, pos.z))
}

/**
 * The local player: a kinematic character on the island's flat ground, with the
 * assembled Bloxity avatar as its visual. Writes its transform to `localPlayer`
 * for the camera, lights and network to read.
 *
 * @param {{ onAvatarReady?: () => void }} props
 */
export function Player({ onAvatarReady }) {
  const groupRef = useRef(null)
  const visualRef = useRef(null)
  const tagRef = useRef(null)
  const atSeat = useRef(false)
  const keys = useKeyboard()
  const velocity = useRef({ x: 0, y: 0, z: 0 })
  const jumpHeld = useRef(false)
  const selfId = useGame((s) => s.selfId)
  const name = useGame((s) => s.profile?.name)
  const streak = useGame((s) => s.profile?.streak ?? 0)
  const title = useGame((s) => s.profile?.equippedTitle ?? '')

  // Where this player's halo floats (see Halos).
  useLayoutEffect(() => {
    avatarAnchors.set(SELF_ANCHOR, visualRef.current)
    return () => avatarAnchors.delete(SELF_ANCHOR)
  }, [])

  /** Motion state handed to the avatar for posing. A ref: written every frame. */
  const motionRef = useRef({ time: 0, speed: 0, grounded: true, maxSpeed: MOVE_SPEED, seated: false })

  useFrame((state, delta) => {
    const group = groupRef.current
    const visual = visualRef.current
    if (!group || !visual) return

    const dt = Math.min(delta, MAX_STEP)
    const pos = localPlayer.position
    const vel = velocity.current
    const motion = motionRef.current
    motion.time += delta

    visual.visible = Date.now() >= localPlayer.hiddenUntil

    // --- At a table: pinned to the chair (or dancing on it after a win) ----------
    const seat = localPlayer.seat
    if (seat) {
      pos.set(seat.x, 0, seat.z)
      vel.x = vel.y = vel.z = 0
      localPlayer.ry = seat.ry
      localPlayer.speed = 0
      localPlayer.grounded = true
      group.position.copy(pos)
      poseAtSeat(visual, tagRef.current, seat, motion, delta)
      atSeat.current = true
      localPlayer.emote = null
      motion.emote = null
      return
    }
    if (atSeat.current) {
      atSeat.current = false
      vel.x = vel.y = vel.z = 0
      clearSeatPose(visual, tagRef.current, motion)
    }

    // --- Input: keyboard and the touch joystick, relative to the camera ----------
    const k = keys.current
    let ix = (k.right ? 1 : 0) - (k.left ? 1 : 0) + touchInput.x
    let iz = (k.backward ? 1 : 0) - (k.forward ? 1 : 0) + touchInput.y
    const len = Math.hypot(ix, iz)
    if (len > 1) {
      ix /= len
      iz /= len
    }

    const sprint = k.sprint ? SPRINT_MULTIPLIER : 1
    // A Bloxity emote plays until the player moves (or a one-shot clip ends).
    if (len > 0.05 || localPlayer.emote?.done) localPlayer.emote = null
    motion.emote = localPlayer.emote
    if (len > 0.05) {
      state.camera.getWorldDirection(_camForward)
      _camForward.y = 0
      _camForward.normalize()
      _camRight.crossVectors(_camForward, _up).normalize()
      // iz is -1 for "forward" (W / joystick up), ix +1 for "right".
      _move.set(0, 0, 0).addScaledVector(_camForward, -iz).addScaledVector(_camRight, ix)

      // A quick ramp up to speed (~0.2 s) instead of a standing-start snap.
      const speed = MOVE_SPEED * sprint
      const accel = 1 - Math.pow(0.00001, dt)
      vel.x += (_move.x * speed - vel.x) * accel
      vel.z += (_move.z * speed - vel.z) * accel

      localPlayer.ry = Math.atan2(_move.x, _move.z)
      _targetQuat.setFromAxisAngle(_up, localPlayer.ry)
      visual.quaternion.slerp(_targetQuat, 1 - Math.pow(0.0001, delta))
    } else {
      // Frame-rate independent damping to a stop.
      const damp = Math.pow(0.0005, dt)
      vel.x *= damp
      vel.z *= damp
    }

    // --- Jump + gravity ------------------------------------------------------------
    const wantJump = k.jump || touchInput.jump
    if (wantJump && !jumpHeld.current && localPlayer.grounded) {
      vel.y = JUMP_SPEED
      sfx.jump()
    }
    jumpHeld.current = wantJump
    vel.y -= GRAVITY * dt

    pos.x += vel.x * dt
    pos.y += vel.y * dt
    pos.z += vel.z * dt

    if (pos.y <= 0) {
      pos.y = 0
      vel.y = 0
      localPlayer.grounded = true
    } else {
      localPlayer.grounded = false
    }

    resolveCollisions(pos)
    group.position.copy(pos)

    // --- Publish motion state ----------------------------------------------------------
    localPlayer.speed = Math.hypot(vel.x, vel.z)
    motion.speed = localPlayer.speed
    motion.grounded = localPlayer.grounded
    motion.maxSpeed = MOVE_SPEED * sprint
  })

  return (
    <group ref={groupRef} position={localPlayer.position.toArray()}>
      <group ref={visualRef} rotation={[0, localPlayer.ry, 0]}>
        <PlayerAvatar onReady={onAvatarReady} targetHeight={PLAYER_HEIGHT} motionRef={motionRef} />
      </group>
      <group ref={tagRef}>
        {selfId && <Nametag id={selfId} name={name || 'You'} streak={streak} title={title} isSelf />}
      </group>
    </group>
  )
}

export default Player
