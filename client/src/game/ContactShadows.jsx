import { useMemo } from 'react'
import { CanvasTexture, MeshBasicMaterial, PlaneGeometry } from 'three'

import Instanced from './Instanced'
import { ARCH, DATA, SHOP_CHAIRS, TABLE, TREES } from './layout'
import { useDisposable } from './useDisposable'

/**
 * Soft "baked" shadows on the ground under the props: tables, trees, the gate's
 * pillars, the shop pedestals and the leaderboards. Used when realtime shadows are
 * off (LOW), so the world keeps its depth: one instanced quad mesh, one draw call,
 * no shadow map.
 */
function createBlobTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(0,0,0,0.42)')
  g.addColorStop(0.55, 'rgba(0,0,0,0.25)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  return new CanvasTexture(canvas)
}

/** [x, z, width, depth] of every shadow, offset a little away from the sun. */
function shadowSpots() {
  const spots = []
  for (const t of DATA.tables) spots.push([t.x + 0.15, t.z + 0.4, TABLE.width + 1.4, TABLE.depth + 2.6])
  for (const [x, z] of TREES) spots.push([x + 0.4, z, 4.2, 4.2])
  for (const side of [-1, 1]) spots.push([side * ARCH.halfWidth + 0.3, ARCH.z, 2.6, 2.6])
  for (const c of SHOP_CHAIRS) spots.push([c.shop[0] + 0.2, c.shop[1], 2.8, 2.8])
  for (const lb of DATA.leaderboards) spots.push([lb.x + 0.3, lb.z, 7, 1.8])
  return spots
}

export function ContactShadows() {
  const res = useDisposable(() => {
    const texture = createBlobTexture()
    return {
      texture,
      geometry: new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      material: new MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        // Above the paving and rugs, below everything standing on them.
        polygonOffset: true,
        polygonOffsetFactor: -4,
      }),
    }
  }, [])
  const items = useMemo(() => shadowSpots().map(([x, z, w, d]) => ({ p: [x, 0.03, z], s: [w, 1, d] })), [])
  return <Instanced geometry={res.geometry} material={res.material} items={items} />
}

export default ContactShadows
