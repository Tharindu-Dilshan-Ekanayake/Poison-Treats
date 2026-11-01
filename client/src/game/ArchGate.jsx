import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { CanvasTexture, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import {
  ATLAS_H,
  ATLAS_W,
  BOARD_H,
  BOARD_PX,
  BOARD_W,
  BOARD_Y,
  CHASE_S,
  GOLD,
  PLAQUE,
  PLAQUE_PX,
  PLAQUE_Y,
  X,
  Z,
} from './arch'
import { fontReady, GAME_FONT } from './labels'
import { useDisposable } from './useDisposable'

/**
 * The welcome gate over the spawn path, toy-brick carnival style.
 *
 * The structure (plinths, banded pillars, beam, crown, flags) is plain boxes, added
 * to the world's shared scenery mesh by archBoxes() in arch.js, so it costs no draw
 * calls of its own. The marquee sign and the "1" / "100" pillar plaques are one mesh with
 * one atlas texture: 1 draw call. The bulbs "chase" by swapping between two
 * pre-drawn textures a few times a second, so nothing is redrawn or re-uploaded
 * after start-up.
 */

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function rainbow(ctx, x0, x1) {
  const g = ctx.createLinearGradient(x0, 0, x1, 0)
  ;['#ff3b3b', '#ff9a1e', '#ffee32', '#3bff6f', '#33c8ff', '#b14dff'].forEach((c, i, a) =>
    g.addColorStop(i / (a.length - 1), c),
  )
  return g
}

/** Draws the whole atlas; `phase` (0/1) picks which bulbs are lit. */
function drawAtlas(canvas, phase) {
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, ATLAS_W, ATLAS_H)

  // ---- Marquee board ----
  const w = ATLAS_W
  const h = BOARD_PX
  roundRect(ctx, 1, 1, w - 2, h - 2, 18)
  const bg = ctx.createLinearGradient(0, 0, 0, h)
  bg.addColorStop(0, '#4a1f86')
  bg.addColorStop(1, '#22104a')
  ctx.fillStyle = bg
  ctx.fill()
  ctx.lineWidth = 6
  ctx.strokeStyle = GOLD
  ctx.stroke()

  // Bulbs around the edge, alternating which half is lit.
  const inset = 9
  const step = 17
  let i = 0
  const bulb = (x, y) => {
    const on = (i++ + phase) % 2 === 0
    ctx.beginPath()
    ctx.arc(x, y, on ? 4.2 : 3.4, 0, Math.PI * 2)
    ctx.fillStyle = on ? '#fff6b0' : '#8a6a2a'
    ctx.shadowColor = on ? '#ffd23d' : 'transparent'
    ctx.shadowBlur = on ? 8 : 0
    ctx.fill()
  }
  for (let x = inset + 8; x <= w - inset - 8; x += step) bulb(x, inset)
  for (let y = inset + step; y <= h - inset - 4; y += step) bulb(w - inset, y)
  for (let x = w - inset - 8; x >= inset + 8; x -= step) bulb(x, h - inset)
  for (let y = h - inset - step; y >= inset + 4; y -= step) bulb(inset, y)
  ctx.shadowBlur = 0

  // Title.
  const size = Math.round(h * 0.46)
  ctx.font = `700 ${size}px ${GAME_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  const text = 'Guess My Number'
  const tw = ctx.measureText(text).width
  ctx.lineWidth = size * 0.2
  ctx.strokeStyle = '#120720'
  ctx.strokeText(text, w / 2, h * 0.53)
  ctx.fillStyle = rainbow(ctx, w / 2 - tw / 2, w / 2 + tw / 2)
  ctx.fillText(text, w / 2, h * 0.53)
  // Twinkling stars either side of the title.
  ctx.font = `700 ${Math.round(size * 0.7)}px ${GAME_FONT}`
  ctx.fillStyle = phase ? '#ffe84d' : '#ffffff'
  ctx.fillText('★', w / 2 - tw / 2 - size * 0.55, h * 0.5)
  ctx.fillStyle = phase ? '#ffffff' : '#ffe84d'
  ctx.fillText('★', w / 2 + tw / 2 + size * 0.55, h * 0.5)

  // ---- Pillar plaques: "1" and "100", the range you guess in ----
  const py = BOARD_PX + 8
  ;['1', '100'].forEach((label, k) => {
    const px = 8 + k * (PLAQUE_PX + 16)
    roundRect(ctx, px, py, PLAQUE_PX, PLAQUE_PX, 16)
    ctx.fillStyle = '#ffd92e'
    ctx.fill()
    ctx.lineWidth = 6
    ctx.strokeStyle = '#1b1b1b'
    ctx.stroke()
    ctx.font = `700 ${label.length > 1 ? 52 : 74}px ${GAME_FONT}`
    ctx.lineWidth = 9
    ctx.strokeStyle = '#1b1b1b'
    ctx.strokeText(label, px + PLAQUE_PX / 2, py + PLAQUE_PX / 2 + 4)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(label, px + PLAQUE_PX / 2, py + PLAQUE_PX / 2 + 4)
  })
}

/** A plane showing the atlas region [u0,v0]-[u1,v1] (pixels, top-left origin). */
function atlasPlane(w, h, [x0, y0, x1, y1], at) {
  const g = new PlaneGeometry(w, h)
  const uv = g.getAttribute('uv')
  for (let i = 0; i < uv.count; i += 1) {
    uv.setXY(
      i,
      (x0 + uv.getX(i) * (x1 - x0)) / ATLAS_W,
      1 - (y0 + (1 - uv.getY(i)) * (y1 - y0)) / ATLAS_H,
    )
  }
  return g.translate(...at)
}

function createSignGeometry() {
  const py = BOARD_PX + 8
  const parts = [
    atlasPlane(BOARD_W, BOARD_H, [0, 0, ATLAS_W, BOARD_PX], [0, BOARD_Y, Z + 0.24]),
    atlasPlane(PLAQUE, PLAQUE, [8, py, 8 + PLAQUE_PX, py + PLAQUE_PX], [-X, PLAQUE_Y, Z + 0.47]),
    atlasPlane(PLAQUE, PLAQUE, [8 + PLAQUE_PX + 16, py, 8 + 2 * PLAQUE_PX + 16, py + PLAQUE_PX], [X, PLAQUE_Y, Z + 0.47]),
  ]
  const merged = mergeGeometries(parts)
  for (const g of parts) g.dispose()
  return merged
}

function makeTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = ATLAS_W
  canvas.height = ATLAS_H
  const t = new CanvasTexture(canvas)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 4
  return t
}

/** The gate's sign and plaques (the boxes come from archBoxes). */
export function ArchSign() {
  const [drawn, setDrawn] = useState(false)
  const res = useDisposable(() => {
    const textures = [makeTexture(), makeTexture()]
    return {
      textureA: textures[0],
      textureB: textures[1],
      geometry: createSignGeometry(),
      material: new MeshBasicMaterial({ map: textures[0], transparent: true }),
    }
  }, [])
  const clock = useRef({ t: 0, phase: 0 })

  // Drawn once the game font is in, in idle time so it never competes with loading.
  useEffect(() => {
    let cancelled = false
    const draw = () => {
      if (cancelled) return
      drawAtlas(res.textureA.image, 0)
      drawAtlas(res.textureB.image, 1)
      res.textureA.needsUpdate = true
      res.textureB.needsUpdate = true
      setDrawn(true)
    }
    fontReady.then(() =>
      window.requestIdleCallback ? window.requestIdleCallback(draw, { timeout: 1500 }) : setTimeout(draw, 50),
    )
    return () => {
      cancelled = true
    }
  }, [res])

  useFrame((_state, delta) => {
    const c = clock.current
    c.t += delta
    if (c.t < CHASE_S) return
    c.t = 0
    c.phase ^= 1
    // Same kind of texture either way: swapping it is free (no shader change).
    res.material.map = c.phase ? res.textureB : res.textureA
  })

  return <mesh geometry={res.geometry} material={res.material} visible={drawn} />
}

export default ArchSign
