import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  Color,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  TorusGeometry,
  Vector3,
} from 'three'

import { useGame } from '../net/gameStore'
import { avatarAnchors, hiddenUntil, localPlayer, SELF_ANCHOR } from '../net/liveState'
import { haloById, PLAYER_HEIGHT } from './layout'
import { useDisposable } from './useDisposable'

/** Room for every player in a full room. */
const MAX_HALOS = 20
/** Little gems orbiting each halo. */
const GEMS = 3
/** Legendary and mythic halos get a second, larger ring. */
const BIG = new Set(['legendary', 'mythic'])
/** Height of the halo above the avatar's feet. */
const HALO_Y = PLAYER_HEIGHT + 0.28

const _obj = new Object3D()
const _pos = new Vector3()
const _color = new Color()

/** True if the object and all its ancestors are visible. */
function isShown(object) {
  for (let o = object; o; o = o.parent) if (!o.visible) return false
  return true
}

/**
 * Head auras: a glowing ring floating over the head of every player wearing one
 * (bought in the shop's Auras tab), with a soft halo glow around it.
 *
 * All halos share two instanced meshes (ring + glow): 2 draw calls for the whole
 * room. Each frame they follow their owner's avatar (sitting, dancing, walking);
 * the rainbow halo cycles its colour. No allocation in the frame loop.
 */
export function Halos() {
  const ringRef = useRef(null)
  const glowRef = useRef(null)
  const gemRef = useRef(null)
  const outerRef = useRef(null)

  // "id:halo" pairs; a string selector only re-renders when someone changes halo.
  const key = useGame((s) => {
    const parts = []
    for (const p of Object.values(s.players)) {
      if (p.halo) parts.push(`${p.id === s.selfId ? SELF_ANCHOR : p.id}:${p.halo}`)
    }
    return parts.join(',')
  })
  const wearers = useMemo(
    () =>
      key
        ? key.split(',').map((pair) => {
            const [id, haloId] = pair.split(':')
            return { id, halo: haloById(haloId) }
          })
        : [],
    [key],
  )

  const res = useDisposable(
    () => ({
      ringGeometry: new TorusGeometry(0.3, 0.04, 8, 32).rotateX(Math.PI / 2),
      glowGeometry: new TorusGeometry(0.3, 0.09, 8, 32).rotateX(Math.PI / 2),
      outerGeometry: new TorusGeometry(0.42, 0.018, 6, 40).rotateX(Math.PI / 2),
      gemGeometry: new OctahedronGeometry(0.06, 0),
      ringMaterial: new MeshBasicMaterial({ toneMapped: false, fog: false }),
      glowMaterial: new MeshBasicMaterial({
        transparent: true,
        opacity: 0.18,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      }),
    }),
    [],
  )

  // Instance colours have to exist before first render.
  useLayoutEffect(() => {
    for (const mesh of [ringRef.current, glowRef.current, outerRef.current, gemRef.current]) {
      for (let i = 0; i < MAX_HALOS * GEMS; i += 1) if (i < mesh.instanceMatrix.count) mesh.setColorAt(i, _color.set('#ffffff'))
      mesh.count = 0
    }
  }, [])

  useFrame(({ clock }) => {
    const ring = ringRef.current
    const glow = glowRef.current
    const gems = gemRef.current
    const outer = outerRef.current
    const t = clock.elapsedTime
    const now = Date.now()
    let n = 0
    let g = 0
    let o = 0

    for (let i = 0; i < wearers.length && n < MAX_HALOS; i += 1) {
      const { id, halo } = wearers[i]
      const anchor = avatarAnchors.get(id)
      if (!anchor || !halo || !isShown(anchor)) continue
      // Hidden while a loser's avatar is "broken apart".
      if (id === SELF_ANCHOR ? now < localPlayer.hiddenUntil : (hiddenUntil.get(id) || 0) > now) continue

      anchor.getWorldPosition(_pos)
      _obj.position.set(_pos.x, _pos.y + HALO_Y + Math.sin(t * 2 + i) * 0.04, _pos.z)
      _obj.rotation.set(0.12 * Math.sin(t * 0.9 + i), t * 1.2, 0.12 * Math.cos(t * 0.7 + i))
      _obj.scale.setScalar(1)
      _obj.updateMatrix()
      ring.setMatrixAt(n, _obj.matrix)
      _obj.scale.setScalar(1 + Math.sin(t * 3 + i) * 0.06)
      _obj.updateMatrix()
      glow.setMatrixAt(n, _obj.matrix)

      if (halo.rainbow) _color.setHSL((t * 0.15 + i * 0.1) % 1, 0.9, 0.6)
      else _color.set(halo.color)
      ring.setColorAt(n, _color)
      glow.setColorAt(n, _color)

      // A slower, tilted outer ring for the rarest halos.
      if (BIG.has(halo.rarity)) {
        _obj.rotation.set(0.35 * Math.sin(t * 0.6 + i), -t * 0.7, 0.35 * Math.cos(t * 0.5 + i))
        _obj.scale.setScalar(1)
        _obj.updateMatrix()
        outer.setMatrixAt(o, _obj.matrix)
        outer.setColorAt(o, _color)
        o += 1
      }

      // Gems circling the ring, bobbing out of step.
      const cy = _obj.position.y
      const cx = _obj.position.x
      const cz = _obj.position.z
      for (let k = 0; k < GEMS; k += 1) {
        const a = t * 1.8 + (k / GEMS) * Math.PI * 2
        _obj.position.set(cx + Math.cos(a) * 0.36, cy + Math.sin(t * 3 + k * 2) * 0.06, cz + Math.sin(a) * 0.36)
        _obj.rotation.set(0, t * 4 + k, 0)
        _obj.scale.setScalar(1)
        _obj.updateMatrix()
        gems.setMatrixAt(g, _obj.matrix)
        gems.setColorAt(g, _color)
        g += 1
      }
      n += 1
    }

    for (const [mesh, count] of [
      [gems, g],
      [outer, o],
    ]) {
      mesh.count = count
      mesh.visible = count > 0
      if (count) {
        mesh.instanceMatrix.needsUpdate = true
        mesh.instanceColor.needsUpdate = true
      }
    }

    for (const mesh of [ring, glow]) {
      mesh.count = n
      mesh.visible = n > 0
      if (n) {
        mesh.instanceMatrix.needsUpdate = true
        mesh.instanceColor.needsUpdate = true
      }
    }
  })

  return (
    <>
      <instancedMesh ref={ringRef} args={[res.ringGeometry, res.ringMaterial, MAX_HALOS]} frustumCulled={false} />
      <instancedMesh ref={outerRef} args={[res.outerGeometry, res.ringMaterial, MAX_HALOS]} frustumCulled={false} />
      <instancedMesh ref={gemRef} args={[res.gemGeometry, res.ringMaterial, MAX_HALOS * GEMS]} frustumCulled={false} />
      <instancedMesh
        ref={glowRef}
        args={[res.glowGeometry, res.glowMaterial, MAX_HALOS]}
        frustumCulled={false}
        renderOrder={4}
      />
    </>
  )
}

export default Halos
