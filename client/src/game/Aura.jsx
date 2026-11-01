import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three'

import { useDisposable } from './useDisposable'

/**
 * Rarity auras: a glowing ring on the floor, a soft column of light rising from it
 * and (optionally) sparkles drifting up, tinted per item.
 *
 * Every aura in a group shares three instanced meshes, so any number of them costs
 * at most 3 draw calls. Animation moves textures and a few instance matrices: no
 * allocation and no React state in the frame loop.
 */

const SPARKLES_PER_AURA = 7
const COLUMN_HEIGHT = 2.6

const _obj = new Object3D()
const _color = new Color()

function createRingTexture() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,0.25)')
  g.addColorStop(0.55, 'rgba(255,255,255,0.35)')
  g.addColorStop(0.72, 'rgba(255,255,255,1)')
  g.addColorStop(0.8, 'rgba(255,255,255,0.35)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  // Four brighter notches so the slow spin reads.
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2
    ctx.beginPath()
    ctx.arc(64 + Math.cos(a) * 46, 64 + Math.sin(a) * 46, 5, 0, Math.PI * 2)
    ctx.fill()
  }
  const t = new CanvasTexture(canvas)
  t.colorSpace = SRGBColorSpace
  t.center.set(0.5, 0.5)
  return t
}

/** Fades out towards the top; faint horizontal bands scroll upward. */
function createColumnTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  for (let y = 0; y < 64; y += 1) {
    const fade = 1 - y / 63
    const band = 0.75 + 0.25 * Math.sin((y / 64) * Math.PI * 6)
    ctx.fillStyle = `rgba(255,255,255,${(fade * fade * band * 0.9).toFixed(3)})`
    // Canvas row 0 is the texture's top (v = 1).
    ctx.fillRect(0, 63 - y, 4, 1)
  }
  const t = new CanvasTexture(canvas)
  t.colorSpace = SRGBColorSpace
  t.wrapT = RepeatWrapping
  return t
}

const glowMaterial = (map) =>
  new MeshBasicMaterial({
    map,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    fog: false,
    toneMapped: false,
  })

/**
 * @param {{ items: Array<{ x: number, y: number, z: number, color: string, strength: number }>,
 *           sparkles?: boolean }} props
 *   `y` is the floor the aura stands on; `strength` comes from RARITY_AURA (layout.js).
 */
export function Auras({ items, sparkles = false }) {
  const ringRef = useRef(null)
  const columnRef = useRef(null)
  const sparkRef = useRef(null)

  const res = useDisposable(() => {
    const ringTexture = createRingTexture()
    const columnTexture = createColumnTexture()
    return {
      ringTexture,
      columnTexture,
      ringGeometry: new PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
      // Open-ended: the ring is the floor of the column.
      columnGeometry: new CylinderGeometry(0.85, 0.95, COLUMN_HEIGHT, 20, 1, true).translate(0, COLUMN_HEIGHT / 2, 0),
      sparkGeometry: new OctahedronGeometry(0.07, 0),
      ringMaterial: glowMaterial(ringTexture),
      columnMaterial: glowMaterial(columnTexture),
      sparkMaterial: new MeshBasicMaterial({ blending: AdditiveBlending, transparent: true, depthWrite: false, fog: false }),
    }
  }, [])

  const capacity = Math.max(1, items.length)

  // Static parts: rings and columns sit still; only their textures animate.
  useLayoutEffect(() => {
    const ring = ringRef.current
    const column = columnRef.current
    items.forEach((it, i) => {
      _color.set(it.color)
      _obj.rotation.set(0, 0, 0)
      _obj.position.set(it.x, it.y + 0.02, it.z)
      _obj.scale.setScalar(it.strength)
      _obj.updateMatrix()
      ring.setMatrixAt(i, _obj.matrix)
      ring.setColorAt(i, _color)
      _obj.position.set(it.x, it.y, it.z)
      _obj.scale.set(it.strength, 0.8 + it.strength * 0.4, it.strength)
      _obj.updateMatrix()
      column.setMatrixAt(i, _obj.matrix)
      column.setColorAt(i, _color.multiplyScalar(0.8))
    })
    for (const mesh of [ring, column]) {
      mesh.count = items.length
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
    }
    const spark = sparkRef.current
    if (spark) {
      for (let i = 0; i < items.length * SPARKLES_PER_AURA; i += 1) {
        spark.setColorAt(i, _color.set(items[Math.floor(i / SPARKLES_PER_AURA)].color))
      }
      spark.count = items.length * SPARKLES_PER_AURA
      if (spark.instanceColor) spark.instanceColor.needsUpdate = true
    }
  }, [items, sparkles])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    res.ringTexture.rotation = t * 0.6
    res.columnTexture.offset.y = -t * 0.35
    res.ringMaterial.opacity = 0.75 + Math.sin(t * 2.4) * 0.2
    res.columnMaterial.opacity = 0.55 + Math.sin(t * 1.7) * 0.15

    const spark = sparkRef.current
    if (!spark || !spark.visible) return
    for (let a = 0; a < items.length; a += 1) {
      const it = items[a]
      for (let k = 0; k < SPARKLES_PER_AURA; k += 1) {
        // Deterministic per sparkle: each rises on its own phase and spirals.
        const phase = (k / SPARKLES_PER_AURA + a * 0.37) % 1
        const rise = (t * 0.45 + phase) % 1
        const angle = phase * Math.PI * 2 + t * 0.9
        const r = 0.55 * it.strength
        _obj.position.set(
          it.x + Math.cos(angle) * r,
          it.y + 0.2 + rise * COLUMN_HEIGHT * it.strength,
          it.z + Math.sin(angle) * r,
        )
        _obj.rotation.set(0, t * 3 + k, 0)
        _obj.scale.setScalar((1 - rise) * (0.8 + it.strength * 0.5))
        _obj.updateMatrix()
        spark.setMatrixAt(a * SPARKLES_PER_AURA + k, _obj.matrix)
      }
    }
    spark.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <instancedMesh ref={ringRef} args={[res.ringGeometry, res.ringMaterial, capacity]} renderOrder={2} />
      <instancedMesh ref={columnRef} args={[res.columnGeometry, res.columnMaterial, capacity]} renderOrder={3} />
      {sparkles && (
        <instancedMesh
          ref={sparkRef}
          args={[res.sparkGeometry, res.sparkMaterial, capacity * SPARKLES_PER_AURA]}
          frustumCulled={false}
        />
      )}
    </>
  )
}

export default Auras
