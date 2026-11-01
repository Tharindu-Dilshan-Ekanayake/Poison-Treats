import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import { BoxGeometry, Color, DoubleSide, MeshBasicMaterial, MeshLambertMaterial, Object3D, PlaneGeometry } from 'three'

import { effectQueue } from '../net/liveState'
import { useDisposable } from './useDisposable'

/**
 * Pooled particle effects: confetti over a match's winner, the loser's body
 * "breaking apart" into blocks, candy crumbs on every bite and a green puff of
 * poison. Fixed-size pools, preallocated typed arrays, one
 * instanced draw call per effect; nothing is allocated per frame or per spawn.
 *
 * Only mounted on presets with particles enabled (see GameScene).
 */

const CONFETTI = 160
const PIECES = 32
const CRUMBS = 48
const GOO = 40
const GRAVITY = 9

const CONFETTI_COLORS = ['#ff3b3b', '#ffb21e', '#ffee32', '#3bff6f', '#33c8ff', '#b14dff', '#ff4fb8']
const PIECE_COLORS = ['#1c1c1c', '#f2f2f2', '#2b4fa8', '#e8b98f']
const CRUMB_COLORS = ['#e8202a', '#ffffff', '#ff6a6a']
const GOO_COLORS = ['#2fd14f', '#7dff3a', '#1f9e3a', '#b4ff6a']

const _obj = new Object3D()
const _color = new Color()

/** A pool of particles stored struct-of-arrays style. */
function createPool(size) {
  return {
    size,
    next: 0,
    life: new Float32Array(size),
    pos: new Float32Array(size * 3),
    vel: new Float32Array(size * 3),
    rot: new Float32Array(size * 3),
    spin: new Float32Array(size * 3),
  }
}

function spawn(pool, count, x, y, z, speed, up, spread = 0.6, life = 2.2) {
  for (let n = 0; n < count; n += 1) {
    const i = pool.next
    pool.next = (pool.next + 1) % pool.size
    const a = Math.random() * Math.PI * 2
    const r = Math.random() * speed
    const o = i * 3
    pool.life[i] = life + Math.random() * life * 0.45
    pool.pos[o] = x + (Math.random() - 0.5) * spread
    pool.pos[o + 1] = y + Math.random() * spread * 1.3
    pool.pos[o + 2] = z + (Math.random() - 0.5) * spread
    pool.vel[o] = Math.cos(a) * r
    pool.vel[o + 1] = up + Math.random() * up
    pool.vel[o + 2] = Math.sin(a) * r
    for (let k = 0; k < 3; k += 1) {
      pool.rot[o + k] = Math.random() * 6
      pool.spin[o + k] = (Math.random() - 0.5) * 12
    }
  }
}

/** Integrates a pool and writes its instance matrices. `drag` slows confetti's fall. */
function step(pool, mesh, dt, drag, floor) {
  let alive = false
  for (let i = 0; i < pool.size; i += 1) {
    const o = i * 3
    if (pool.life[i] <= 0) {
      _obj.scale.setScalar(0)
    } else {
      alive = true
      pool.life[i] -= dt
      pool.vel[o + 1] -= GRAVITY * dt
      if (drag) {
        pool.vel[o] *= 1 - drag * dt
        pool.vel[o + 1] = Math.max(pool.vel[o + 1], -1.6)
        pool.vel[o + 2] *= 1 - drag * dt
      }
      pool.pos[o] += pool.vel[o] * dt
      pool.pos[o + 1] += pool.vel[o + 1] * dt
      pool.pos[o + 2] += pool.vel[o + 2] * dt
      if (pool.pos[o + 1] < floor) {
        pool.pos[o + 1] = floor
        pool.vel[o] *= 0.6
        pool.vel[o + 1] *= -0.3
        pool.vel[o + 2] *= 0.6
      }
      for (let k = 0; k < 3; k += 1) pool.rot[o + k] += pool.spin[o + k] * dt
      _obj.position.set(pool.pos[o], pool.pos[o + 1], pool.pos[o + 2])
      _obj.rotation.set(pool.rot[o], pool.rot[o + 1], pool.rot[o + 2])
      _obj.scale.setScalar(Math.min(1, pool.life[i] * 2))
    }
    _obj.updateMatrix()
    mesh.setMatrixAt(i, _obj.matrix)
  }
  mesh.visible = alive
  if (alive) mesh.instanceMatrix.needsUpdate = true
}

export function Effects() {
  const confettiRef = useRef(null)
  const piecesRef = useRef(null)
  const crumbsRef = useRef(null)
  const gooRef = useRef(null)
  const pools = useRef({
    confetti: createPool(CONFETTI),
    pieces: createPool(PIECES),
    crumbs: createPool(CRUMBS),
    goo: createPool(GOO),
  })

  const res = useDisposable(
    () => ({
      confettiGeometry: new PlaneGeometry(0.16, 0.09),
      confettiMaterial: new MeshBasicMaterial({ side: DoubleSide }),
      pieceGeometry: new BoxGeometry(0.28, 0.28, 0.28),
      pieceMaterial: new MeshLambertMaterial(),
      crumbGeometry: new BoxGeometry(0.045, 0.045, 0.045),
      gooGeometry: new BoxGeometry(0.12, 0.12, 0.12),
      flatMaterial: new MeshBasicMaterial(),
    }),
    [],
  )

  useLayoutEffect(() => {
    for (let i = 0; i < CONFETTI; i += 1) {
      confettiRef.current.setColorAt(i, _color.set(CONFETTI_COLORS[i % CONFETTI_COLORS.length]))
    }
    for (let i = 0; i < PIECES; i += 1) {
      piecesRef.current.setColorAt(i, _color.set(PIECE_COLORS[i % PIECE_COLORS.length]))
    }
    for (let i = 0; i < CRUMBS; i += 1) {
      crumbsRef.current.setColorAt(i, _color.set(CRUMB_COLORS[i % CRUMB_COLORS.length]))
    }
    for (let i = 0; i < GOO; i += 1) {
      gooRef.current.setColorAt(i, _color.set(GOO_COLORS[i % GOO_COLORS.length]))
    }
    for (const r of [confettiRef, piecesRef, crumbsRef, gooRef]) r.current.visible = false
  }, [])

  useFrame((_state, delta) => {
    const dt = Math.min(delta, 0.05)
    const { confetti, pieces, crumbs, goo } = pools.current
    while (effectQueue.length) {
      const e = effectQueue.shift()
      if (e.kind === 'confetti') spawn(confetti, 80, e.x, e.y, e.z, 4, 4)
      else if (e.kind === 'crumbs') spawn(crumbs, 8, e.x, e.y, e.z, 1.4, 1.2, 0.12, 0.9)
      else if (e.kind === 'goo') spawn(goo, 20, e.x, e.y, e.z, 1.8, 2.4, 0.4, 1.2)
      else spawn(pieces, 10, e.x, e.y, e.z, 3, 3)
    }
    step(confetti, confettiRef.current, dt, 1.5, 0.02)
    step(pieces, piecesRef.current, dt, 0, 0.14)
    step(crumbs, crumbsRef.current, dt, 0, 0.84)
    step(goo, gooRef.current, dt, 1.2, 0.05)
  })

  return (
    <>
      <instancedMesh ref={confettiRef} args={[res.confettiGeometry, res.confettiMaterial, CONFETTI]} frustumCulled={false} />
      <instancedMesh ref={piecesRef} args={[res.pieceGeometry, res.pieceMaterial, PIECES]} frustumCulled={false} />
      <instancedMesh ref={crumbsRef} args={[res.crumbGeometry, res.flatMaterial, CRUMBS]} frustumCulled={false} />
      <instancedMesh ref={gooRef} args={[res.gooGeometry, res.flatMaterial, GOO]} frustumCulled={false} />
    </>
  )
}

export default Effects
