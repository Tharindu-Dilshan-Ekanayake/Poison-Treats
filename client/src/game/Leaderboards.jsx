import { useEffect, useState } from 'react'
import { BoxGeometry, CanvasTexture, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, SRGBColorSpace } from 'three'

import { useGame } from '../net/gameStore'
import Instanced from './Instanced'
import { fontReady, GAME_FONT } from './labels'
import { DATA } from './layout'
import { useSettings } from './quality'
import { useDisposable } from './useDisposable'

const BOARD_W = 5.4
const BOARD_H = 6.6
const BOARD_Y = 4.1
// Same aspect as the board, inside the 512 px mobile texture budget.
const TEX_W = 420
const TEX_H = 512

const FRAMES = DATA.leaderboards.map((lb) => ({ p: [lb.x, BOARD_Y, lb.z], s: [BOARD_W + 0.6, BOARD_H + 0.6, 0.4] }))
const LEGS = DATA.leaderboards.flatMap((lb) =>
  [-1, 1].map((side) => ({ p: [lb.x + side * 2.2, 0.5, lb.z], s: [0.5, 1, 0.5] })),
)
const WOOD_PARTS = [...FRAMES, ...LEGS]

/** How a board's number reads: "Lv 12", "3h 20m", or a plain count. */
function formatValue(value, format) {
  if (format === 'level') return `Lv ${value}`
  if (format === 'duration') {
    const minutes = Math.floor(value / 60)
    return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`
  }
  return String(value)
}

function drawBoard(canvas, title, rows, format) {
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#2b6f8f'
  ctx.fillRect(0, 0, TEX_W, TEX_H)
  ctx.fillStyle = '#1f566f'
  ctx.fillRect(0, 0, TEX_W, 78)

  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.textAlign = 'center'
  ctx.font = `700 38px ${GAME_FONT}`
  ctx.lineWidth = 7
  ctx.strokeStyle = '#000'
  ctx.strokeText(title, TEX_W / 2, 42)
  ctx.fillStyle = '#ffb21e'
  ctx.fillText(title, TEX_W / 2, 42)

  const rowH = (TEX_H - 92) / 14
  ctx.font = `700 22px ${GAME_FONT}`
  ctx.lineWidth = 5
  for (let i = 0; i < 14; i += 1) {
    const y = 92 + rowH * (i + 0.5)
    if (i % 2 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)'
      ctx.fillRect(8, y - rowH / 2, TEX_W - 16, rowH)
    }
    const row = rows[i]
    const rankColor = ['#ffd700', '#d9d9d9', '#e08a3c'][i] || '#62ff7a'
    ctx.textAlign = 'left'
    ctx.strokeText(`#${i + 1}`, 18, y)
    ctx.fillStyle = rankColor
    ctx.fillText(`#${i + 1}`, 18, y)
    if (!row) continue
    const name = row.name.length > 16 ? `${row.name.slice(0, 15)}…` : row.name
    ctx.strokeText(name, 70, y)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(name, 70, y)
    ctx.textAlign = 'right'
    const shown = formatValue(row.value, format)
    ctx.strokeText(shown, TEX_W - 18, y)
    ctx.fillStyle = '#ffe23d'
    ctx.fillText(shown, TEX_W - 18, y)
  }
}

/** One board: the frame is shared/instanced, the face is a canvas texture. */
function Board({ def, geometry }) {
  const rows = useGame((s) => s.lb[def.id])
  const res = useDisposable(() => {
    const canvas = document.createElement('canvas')
    canvas.width = TEX_W
    canvas.height = TEX_H
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    return { texture, material: new MeshBasicMaterial({ map: texture }) }
  }, [])

  const [drawn, setDrawn] = useState(false)

  // Drawn once the game font is in (a fallback-font pass would only be thrown away),
  // in idle time so it never competes with start-up, and again only when rows change.
  useEffect(() => {
    let cancelled = false
    const draw = () => {
      if (cancelled) return
      drawBoard(res.texture.image, def.title, rows || [], def.format)
      res.texture.needsUpdate = true
      setDrawn(true)
    }
    fontReady.then(() => (window.requestIdleCallback ? window.requestIdleCallback(draw, { timeout: 2000 }) : setTimeout(draw, 50)))
    return () => {
      cancelled = true
    }
  }, [res, def.title, def.format, rows])

  return (
    <mesh
      geometry={geometry}
      material={res.material}
      position={[def.x, BOARD_Y, def.z + 0.21]}
      visible={drawn}
    />
  )
}

/** The four lobby boards (levels, streaks, wins, playtime), fed by the server's `lb` messages. */
export function Leaderboards() {
  const { shadows } = useSettings()
  const res = useDisposable(
    () => ({
      box: new BoxGeometry(1, 1, 1),
      wood: new MeshLambertMaterial({ color: '#8a4f2a' }),
      face: new PlaneGeometry(BOARD_W, BOARD_H),
    }),
    [],
  )
  return (
    <>
      <Instanced geometry={res.box} material={res.wood} items={WOOD_PARTS} castShadow={shadows} />
      {DATA.leaderboards.map((lb) => (
        <Board key={lb.id} def={lb} geometry={res.face} />
      ))}
    </>
  )
}

export default Leaderboards
