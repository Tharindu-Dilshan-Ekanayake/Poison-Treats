import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  MeshBasicMaterial,
  Object3D,
  MeshLambertMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three'

import { useGame } from '../net/gameStore'
import Auras from './Aura'
import { useCulled } from './culling'
import Instanced from './Instanced'
import { mergedBoxes } from './instancing'
import { Label } from './labels'
import {
  createChairCushionGeometry,
  createChairFrameGeometry,
  createThroneGemGeometry,
  createThroneGeometry,
  cushionColor,
} from './furniture'
import { CHAIR_ROWS, EMOTE_SHOP, RARITY_AURA, RARITY_COLORS, SHOP_CHAIRS } from './layout'
import { useSettings } from './quality'
import { useDisposable } from './useDisposable'

/** Pink-and-white awning stripes, 64 px tall: tiny on the GPU. */
function createStripeTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 16
  const ctx = canvas.getContext('2d')
  for (let i = 0; i < 8; i += 1) {
    ctx.fillStyle = i % 2 ? '#ffffff' : '#ff4fb8'
    ctx.fillRect(i * 16, 0, 16, 16)
  }
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.wrapS = tex.wrapT = RepeatWrapping
  return tex
}

function chairLines(chair, profile) {
  const owned = profile?.ownedChairs.includes(chair.id)
  const equipped = profile?.equippedChair === chair.id
  const color = RARITY_COLORS[chair.rarity]
  return [
    { text: chair.rarity.toUpperCase(), size: 24, color },
    { text: chair.name, size: 38, color },
    equipped
      ? { text: 'EQUIPPED', size: 30, color: '#ffe23d' }
      : owned
        ? { text: 'OWNED', size: 30, color: '#ffe23d' }
        : { text: `$${chair.price.toLocaleString('en-US')}`, size: 32, color: '#5cff5c' },
  ]
}

function ChairLabel({ chair }) {
  const label = useDisposable(() => new Label({ height: 0.34 }), [])
  const profile = useGame((s) => s.profile)
  useEffect(() => label.set(chairLines(chair, profile)), [label, chair, profile])
  useCulled(label.sprite, chair.shop[0], chair.shop[1], { label })
  return <primitive object={label.sprite} position={[chair.shop[0], 3.4, chair.shop[1]]} />
}

/** A fixed world sign, culled with the other labels. */
export function Sign({ lines, position, height = 0.6, scale = 1.6 }) {
  const label = useDisposable(() => new Label({ height }), [height])
  const key = JSON.stringify(lines)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => label.set(lines), [label, key])
  useCulled(label.sprite, position[0], position[2], { scale })
  return <primitive object={label.sprite} position={position} />
}

const PEDESTAL_TOP = 0.5
const DISPLAY_SCALE = 1.35
const _obj = new Object3D()
const _color = new Color()

/** Display chairs on the pedestals: each slowly turns and floats. One draw call. */
function DisplayChairs() {
  const frameRef = useRef(null)
  const cushionRef = useRef(null)
  const throneRef = useRef(null)
  const gemRef = useRef(null)
  const res = useDisposable(
    () => ({
      frame: createChairFrameGeometry(),
      cushion: createChairCushionGeometry(),
      throne: createThroneGeometry(),
      gems: createThroneGemGeometry(),
      material: new MeshLambertMaterial({ color: '#ffffff' }),
      gemMaterial: new MeshBasicMaterial({ color: '#ffffff' }),
    }),
    [],
  )

  useLayoutEffect(() => {
    SHOP_CHAIRS.forEach((c, i) => {
      frameRef.current.setColorAt(i, _color.set(c.color))
      cushionRef.current.setColorAt(i, _color.set(`#${cushionColor(c.color)}`))
      throneRef.current.setColorAt(i, _color.set(c.color))
      gemRef.current.setColorAt(i, _color.set(RARITY_COLORS[c.rarity]))
    })
    for (const r of [frameRef, cushionRef, throneRef, gemRef]) r.current.instanceColor.needsUpdate = true
  }, [])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    SHOP_CHAIRS.forEach((c, i) => {
      _obj.position.set(c.shop[0], PEDESTAL_TOP + 0.15 + Math.sin(t * 1.6 + i) * 0.08, c.shop[1])
      _obj.rotation.set(0, t * 0.5 + i * 1.3, 0)
      _obj.scale.setScalar(DISPLAY_SCALE)
      _obj.updateMatrix()
      frameRef.current.setMatrixAt(i, _obj.matrix)
      cushionRef.current.setMatrixAt(i, _obj.matrix)
      if (c.style !== 'throne') _obj.scale.setScalar(0)
      _obj.updateMatrix()
      throneRef.current.setMatrixAt(i, _obj.matrix)
      gemRef.current.setMatrixAt(i, _obj.matrix)
    })
    for (const r of [frameRef, cushionRef, throneRef, gemRef]) r.current.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <instancedMesh ref={frameRef} args={[res.frame, res.material, SHOP_CHAIRS.length]} castShadow frustumCulled={false} />
      <instancedMesh ref={cushionRef} args={[res.cushion, res.material, SHOP_CHAIRS.length]} frustumCulled={false} />
      <instancedMesh ref={throneRef} args={[res.throne, res.material, SHOP_CHAIRS.length]} castShadow frustumCulled={false} />
      <instancedMesh ref={gemRef} args={[res.gems, res.gemMaterial, SHOP_CHAIRS.length]} frustumCulled={false} />
    </>
  )
}

const SHOP_AURAS = SHOP_CHAIRS.map((c) => ({
  x: c.shop[0],
  y: PEDESTAL_TOP,
  z: c.shop[1],
  color: RARITY_COLORS[c.rarity],
  strength: RARITY_AURA[c.rarity],
}))

/**
 * The chair shop (pedestals down the east side of the plaza, each with a turning
 * chair in a glowing rarity aura) and the emote shop stall on the west side. Walk up
 * and press E — see InteractPrompt.
 */
export function Shops() {
  const { shadows, particles } = useSettings()

  const res = useDisposable(() => {
    const stripes = createStripeTexture()
    stripes.repeat.set(4, 1)
    return {
      stripes,
      box: new BoxGeometry(1, 1, 1),
      tinted: new MeshLambertMaterial({ color: '#ffffff' }),
      stallWood: new MeshLambertMaterial({ color: '#8a5a3c' }),
      stall: mergedBoxes([
        // Counter, then four posts.
        { size: [1.4, 1.1, 5], at: [0, 0.55, 0] },
        ...[-0.6, 0.6].flatMap((x) => [-2.4, 2.4].map((z) => ({ size: [0.2, 3.1, 0.2], at: [x, 1.55, z] }))),
      ]),
      awning: new MeshLambertMaterial({ map: stripes }),
      awningGeometry: new BoxGeometry(2.6, 0.18, 5.8),
    }
  }, [])

  // Two tiers: a stone base and a slab trimmed in the chair's rarity colour.
  const pedestals = useMemo(
    () =>
      SHOP_CHAIRS.flatMap((c) => [
        { p: [c.shop[0], 0.19, c.shop[1]], s: [2, 0.38, 2], c: '#b9bec6' },
        { p: [c.shop[0], 0.44, c.shop[1]], s: [1.7, 0.12, 1.7], c: RARITY_COLORS[c.rarity] },
      ]),
    [],
  )

  return (
    <>
      <Instanced geometry={res.box} material={res.tinted} items={pedestals} castShadow={shadows} receiveShadow />
      <DisplayChairs />
      <Auras items={SHOP_AURAS} sparkles={particles} />
      {SHOP_CHAIRS.map((c) => (
        <ChairLabel key={c.id} chair={c} />
      ))}
      <Sign
        lines={[
          { text: 'CHAIRS 🪑', size: 56, color: '#4fd8ff' },
          { text: 'Walk up & press E', size: 26 },
        ]}
        position={[CHAIR_ROWS[1] + 1.8, 4.8, 0]}
        height={0.7}
        scale={2}
      />

      <group position={[EMOTE_SHOP.x, 0, EMOTE_SHOP.z]}>
        <mesh geometry={res.stall} material={res.stallWood} castShadow={shadows} receiveShadow />
        <mesh geometry={res.awningGeometry} material={res.awning} position={[0.3, 3.15, 0]} rotation={[0, 0, -0.12]} castShadow={shadows} />
      </group>
      <Sign
        lines={[{ text: 'Emote Shop 😡🥳', size: 48, color: '#e04dff' }]}
        position={[EMOTE_SHOP.x, 4.3, EMOTE_SHOP.z]}
        height={0.6}
        scale={2}
      />
    </>
  )
}

export default Shops
