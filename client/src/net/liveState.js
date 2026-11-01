import { Vector3 } from 'three'

import { SPAWN } from '../game/layout'

/**
 * High-frequency game state that must never go through React or zustand: it is read
 * and written inside useFrame loops and by the 10 Hz network snapshot handler.
 * Plain module-level objects, mutated in place.
 */

/** The local player. Written by Player's frame loop, read by camera, lights, net. */
export const localPlayer = {
  position: new Vector3(SPAWN[0], SPAWN[1], SPAWN[2]),
  ry: Math.PI,
  speed: 0,
  grounded: true,
  /** { x, z, ry } while sitting at a table, else null. */
  seat: null,
  /** Epoch ms until which the avatar is "broken apart" after a loss. */
  hiddenUntil: 0,
  /** Set on a teleport (respawn) so the camera jumps instead of swooping. */
  snapCamera: false,
  /** Bloxity emote playing on the local avatar: { clip, start } (seconds), or null. */
  emote: null,
}

/** Key of the local player's avatar in `avatarAnchors`. */
export const SELF_ANCHOR = 'self'

/** Each avatar's visual group (seated/dance offsets included), for halos: id -> Object3D. */
export const avatarAnchors = new Map()

/** Bloxity emotes playing on remote players: id -> { clip, start }. */
export const remoteEmotes = new Map()

/**
 * Remote players' interpolated transforms.
 * id -> { x, y, z, ry, s, g, fx, fy, fz, fry, tx, ty, tz, try, alpha }
 * `f*` is where interpolation started, `t*` the latest snapshot.
 */
export const remotes = new Map()

/** Remote players' seats, from table updates: id -> { x, z, ry }. */
export const remoteSeats = new Map()

/** Speech bubbles: id -> { text, until, version }. */
export const bubbles = new Map()

/** Remote players hidden by the loss effect: id -> epoch ms. */
export const hiddenUntil = new Map()

/** Virtual joystick + jump button, written by TouchControls. */
export const touchInput = { x: 0, y: 0, jump: false }

/** Requests for the particle system: { kind: 'confetti'|'break', x, y, z }. */
export const effectQueue = []

/** Latest renderer stats, for the HUD perf readout and automated checks. */
export const renderStats = { calls: 0, triangles: 0, textures: 0, geometries: 0, fps: 0 }
if (typeof window !== 'undefined') window.__perf = renderStats

let bubbleVersion = 0
export function setBubble(id, text, durationMs = 2800) {
  bubbleVersion += 1
  bubbles.set(id, { text, until: text ? Date.now() + durationMs : 0, version: bubbleVersion })
}

/** Snapshot entry for one remote player: start a new interpolation leg. */
export function pushRemote(id, x, y, z, ry, s, g) {
  let r = remotes.get(id)
  if (!r) {
    r = { x, y, z, ry, s, g, fx: x, fy: y, fz: z, fry: ry, tx: x, ty: y, tz: z, try: ry, alpha: 1 }
    remotes.set(id, r)
    return
  }
  r.fx = r.x
  r.fy = r.y
  r.fz = r.z
  r.fry = r.ry
  r.tx = x
  r.ty = y
  r.tz = z
  r.try = ry
  r.s = s
  r.g = g
  r.alpha = 0
}
