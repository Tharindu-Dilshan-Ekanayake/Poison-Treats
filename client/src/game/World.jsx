import { useLayoutEffect, useMemo } from 'react'
import {
  BoxGeometry,
  CanvasTexture,
  MeshLambertMaterial,
  MeshPhongMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { ISLANDS, PATHS, ROCKS, RUGS, TREES, WORLD_HALF } from './layout'
import Leaderboards from './Leaderboards'
import { useSettings } from './quality'
import { FENCE, GROUND, OCEAN } from './sceneStyle'
import Shops from './Shops'
import Tables from './Tables'
import { createStudTexture, createWorldBoxGeometry, createWorldPlaneGeometry } from './textures'
import { archBoxes } from './arch'
import { treeBoxes } from './trees'
import ContactShadows from './ContactShadows'
import ArchSign from './ArchGate'
import Instanced from './Instanced'
import { mergedBoxes } from './instancing'
import { useDisposable } from './useDisposable'

/** World size of one ground texture repeat (4 x 4 studs of 0.5 units). */
const GROUND_TILE = 2
const FENCE_HEIGHT = 1.3
const FENCE_POST_SPACING = 3

/** Every post position for a straight fence from [x1, z1] to [x2, z2]. */
function fencePosts(x1, z1, x2, z2) {
  const length = Math.hypot(x2 - x1, z2 - z1)
  const count = Math.max(2, Math.round(length / FENCE_POST_SPACING) + 1)
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1)
    return { p: [x1 + (x2 - x1) * t, FENCE_HEIGHT / 2, z1 + (z2 - z1) * t] }
  })
}

/** Two rails for a straight, axis-aligned fence. */
function fenceRails(x1, z1, x2, z2) {
  const alongX = Math.abs(x2 - x1) > Math.abs(z2 - z1)
  const length = Math.hypot(x2 - x1, z2 - z1)
  const cx = (x1 + x2) / 2
  const cz = (z1 + z2) / 2
  return [0.5, 1.0].map((y) => ({
    size: alongX ? [length, 0.2, 0.12] : [0.12, 0.2, length],
    at: [cx, y, cz],
  }))
}

const H = WORLD_HALF
const SAND = '#f3d98d'

/** Rug colours, alternating along each row of desks. */
const RUG_COLORS = ['#c0392b', '#2c5aa0']

/**
 * A rug pattern in light tones (instance colour tints it): a plain field, a
 * patterned border band and a thin inner line. 128 px, one shared texture.
 */
function createRugTexture() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#e8e8e8'
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, 14)
  ctx.fillRect(0, size - 14, size, 14)
  ctx.fillRect(0, 0, 14, size)
  ctx.fillRect(size - 14, 0, 14, size)
  ctx.fillStyle = '#9a9a9a'
  for (let i = 4; i < size; i += 12) {
    ctx.fillRect(i, 5, 4, 4)
    ctx.fillRect(i, size - 9, 4, 4)
    ctx.fillRect(5, i, 4, 4)
    ctx.fillRect(size - 9, i, 4, 4)
  }
  ctx.strokeStyle = '#bcbcbc'
  ctx.lineWidth = 2
  ctx.strokeRect(20, 20, size - 40, size - 40)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/** Every stone path as one flat geometry with world-scaled UVs. */
function createPathGeometry() {
  const parts = PATHS.map(([x, z, w, d]) =>
    createWorldPlaneGeometry(w, d, GROUND_TILE).rotateX(-Math.PI / 2).translate(x, 0, z),
  )
  const merged = mergeGeometries(parts)
  for (const g of parts) g.dispose()
  return merged
}

/** Small deterministic hash so decoration varies but never between reloads. */
const vary = (i, k) => {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
  return v - Math.floor(v)
}

/**
 * All the box-built scenery (beach, distant islands, trees, bushes and flowers,
 * rocks, the welcome arch) as instances of one unit cube: one draw call.
 */
function sceneryBoxes() {
  const items = [
    // The island's beach, a ring of sand showing around the baseplate.
    { p: [0, -0.6, 0], s: [H * 2 + 10, 1, H * 2 + 10], c: SAND },
  ]
  for (const [x, z, w, d] of ISLANDS) {
    items.push({ p: [x, -0.6, z], s: [w + 6, 1.2, d + 6], c: SAND })
    items.push({ p: [x, 0, z], s: [w, 1.6, d], c: GROUND.base })
  }
  items.push(...treeBoxes(TREES))
  ROCKS.forEach(([x, z, size], i) => {
    items.push({ p: [x, -0.1 + size * 0.25, z], s: [size, size * 0.7, size * 0.9], ry: vary(i, 9) * 3, c: i % 2 ? '#8c9096' : '#a3a6ab' })
  })
  items.push(...archBoxes())
  return items
}
const FENCES = [
  [-H, -H, H, -H],
  [-H, H, H, H],
  [-H, -H, -H, H],
  [H, -H, H, H],
]


/**
 * The island: a lime studded baseplate fenced in on all sides, ringed by ocean, with
 * voxel trees around the edge and smaller islands on the horizon.
 *
 * Repeated props are instanced and multi-part props are merged, so the whole
 * landscape is a dozen draw calls.
 *
 * @param {{ extras?: 'off' | 'warming' | 'on' }} props `extras` controls the shops and
 *   leaderboards, which GameScene holds back until the game is playable.
 */
// Static: built once at module load.
const SCENERY = sceneryBoxes()
const RUG_ITEMS = RUGS.map(([x, z, w, d], i) => ({ p: [x, 0.02, z], s: [w, 1, d], c: RUG_COLORS[i % 2] }))

export function World({ extras = 'on' }) {
  const settings = useSettings()
  const shadows = settings.shadows

  const res = useDisposable(() => {
    const groundTexture = createStudTexture({ base: GROUND.base, alt: GROUND.alt })
    return {
      groundTexture,
      ground: new MeshLambertMaterial({ map: groundTexture }),
      baseGeometry: createWorldBoxGeometry(H * 2, 1, H * 2, GROUND_TILE),
      ocean: new MeshPhongMaterial({ color: OCEAN.color, shininess: 60, specular: '#cfefff' }),
      oceanGeometry: new PlaneGeometry(1600, 1600),
      box: new BoxGeometry(1, 1, 1),
      // Instance colour does the tinting; the base colour stays white.
      tinted: new MeshLambertMaterial({ color: '#ffffff' }),
      wood: new MeshLambertMaterial({ color: FENCE.rail }),
      post: new MeshLambertMaterial({ color: FENCE.post }),
      postGeometry: new BoxGeometry(0.3, FENCE_HEIGHT, 0.3),
      railGeometry: mergedBoxes(FENCES.flatMap((f) => fenceRails(...f))),
      pathTexture: createStudTexture({ base: '#e3dccb', alt: '#d6cdb7', size: 256 }),
      pathGeometry: createPathGeometry(),
      rugTexture: createRugTexture(),
      rugGeometry: new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    }
  }, [])
  const pathMaterial = useDisposable(
    () =>
      new MeshLambertMaterial({
        map: res.pathTexture,
        // Sits just above the baseplate; the offset stops distant flicker.
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    [res],
  )

  const rugMaterial = useDisposable(
    () =>
      new MeshLambertMaterial({
        map: res.rugTexture,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    [res],
  )

  useLayoutEffect(() => {
    for (const t of [res.groundTexture, res.pathTexture]) {
      t.anisotropy = settings.anisotropy
      t.needsUpdate = true
    }
  }, [res, settings.anisotropy])

  const posts = useMemo(() => FENCES.flatMap((f) => fencePosts(...f)), [])

  return (
    <>
      <mesh geometry={res.baseGeometry} material={res.ground} position={[0, -0.5, 0]} receiveShadow />
      <mesh geometry={res.oceanGeometry} material={res.ocean} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.7, 0]} />

      <mesh geometry={res.pathGeometry} material={pathMaterial} position={[0, 0.01, 0]} receiveShadow />
      <Instanced geometry={res.rugGeometry} material={rugMaterial} items={RUG_ITEMS} receiveShadow />
      <Instanced geometry={res.box} material={res.tinted} items={SCENERY} castShadow={shadows} receiveShadow />
      <Instanced geometry={res.postGeometry} material={res.post} items={posts} castShadow={shadows} />
      <mesh geometry={res.railGeometry} material={res.wood} castShadow={shadows} />
      <ArchSign />
      {/* Realtime shadows are off on LOW: soft baked ones keep the depth. */}
      {!shadows && <ContactShadows />}

      <Tables />
      {extras !== 'off' && (
        // Mounted hidden while their shaders compile in the background (see
        // ShaderWarmup in GameScene), then shown.
        <group visible={extras === 'on'}>
          <Shops />
          <Leaderboards />
        </group>
      )}
    </>
  )
}

export default World
