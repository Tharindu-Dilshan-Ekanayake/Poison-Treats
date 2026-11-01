import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  BoxGeometry,
  CanvasTexture,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { useGame } from '../net/gameStore'
import { useCulled } from './culling'
import { fontReady, GAME_FONT, Label } from './labels'
import { chairById, DATA, RARITY_AURA, RARITY_COLORS, TABLE, seatPosition } from './layout'
import { useSettings } from './quality'
import Auras from './Aura'
import {
  createChairCushionGeometry,
  createChairFrameGeometry,
  createThroneGemGeometry,
  createThroneGeometry,
  cushionColor,
} from './furniture'
import Instanced from './Instanced'
import { mergedBoxes, setInstanceColor, writeInstances } from './instancing'
import { useDisposable } from './useDisposable'

/** An unclaimed seat: dark wood frame, cream cushion. */
const EMPTY_CHAIR = '#6b4329'
const EMPTY_CUSHION = '#e9dcc3'
const PAPER_Y = TABLE.height + 0.001
/** Where a number card stands on the table, relative to the table's centre. */
const CARD_Z = -0.47
const CARD_W = 0.46
const CARD_H = 0.4
/**
 * Each face of the tent card rises this far from flat (radians). Low enough that
 * the card never hides the seated players from the duel camera.
 */
const CARD_TILT = 0.55
const CARD_TEX_W = 256
const CARD_TEX_H = 224

/**
 * Stands a flat piece up as the front face of a tent card: hinged at its bottom
 * edge and leaning back, so it faces the duel camera on the table's -Z side.
 * Expects the piece flat (facing +Y) with its top towards +Z.
 */
function standUp(geometry, lift = 0) {
  return geometry.translate(0, lift, CARD_H / 2).rotateX(-CARD_TILT)
}

/** A white tent card: two leaning faces meeting at the top. */
function createCardGeometry() {
  const front = standUp(new BoxGeometry(CARD_W, 0.02, CARD_H), 0.01)
  const back = standUp(new BoxGeometry(CARD_W, 0.02, CARD_H), 0.01)
    .rotateY(Math.PI)
    .translate(0, 0, 2 * CARD_H * Math.cos(CARD_TILT))
  const merged = mergeGeometries([front, back])
  front.dispose()
  back.dispose()
  return merged
}

/**
 * Everything of a desk below its top, in one geometry: a dark trim under the top's
 * edge, a frame (apron) joining the legs, four legs and a footrest bar.
 */
function createTableBase() {
  const top = TABLE.height - 0.12
  const x = TABLE.width / 2 - 0.18
  const z = TABLE.depth / 2 - 0.18
  return mergedBoxes([
    { size: [TABLE.width + 0.08, 0.06, TABLE.depth + 0.08], at: [0, top - 0.03, 0] },
    { size: [TABLE.width - 0.3, 0.16, 0.06], at: [0, top - 0.14, z] },
    { size: [TABLE.width - 0.3, 0.16, 0.06], at: [0, top - 0.14, -z] },
    { size: [0.06, 0.16, TABLE.depth - 0.3], at: [x, top - 0.14, 0] },
    { size: [0.06, 0.16, TABLE.depth - 0.3], at: [-x, top - 0.14, 0] },
    ...[-x, x].flatMap((lx) => [-z, z].map((lz) => ({ size: [0.13, top, 0.13], at: [lx, top / 2, lz] }))),
    { size: [TABLE.width - 0.36, 0.06, 0.06], at: [0, 0.18, 0] },
  ])
}

const ONE = [1, 1, 1]
const ZERO = [0, 0, 0]

const SEATS = DATA.tables.flatMap((t) => [0, 1].map((i) => ({ table: t, index: i, ...seatPosition(t.id, i) })))
/** Per-seat throne placement, rewritten when seats change (scale 0 = not a throne). */
const thronePlacement = SEATS.map((s) => ({ p: [s.x, 0, s.z], s: ZERO, c: '#ffffff' }))
const gemPlacement = SEATS.map((s) => ({ p: [s.x, 0, s.z], s: ZERO, c: '#ffffff' }))

/**
 * All ten tables: tops, legs, both chairs and both papers each, as four instanced
 * meshes. The chair mesh also carries the display chairs in the chair shop, and
 * each seat's chair takes the colour of the chair its occupant has equipped.
 */
export function Tables() {
  const { shadows, particles } = useSettings()
  const chairsRef = useRef(null)
  const cushionsRef = useRef(null)
  const thronesRef = useRef(null)
  const gemsRef = useRef(null)

  const res = useDisposable(
    () => ({
      top: new BoxGeometry(TABLE.width, 0.12, TABLE.depth),
      legs: createTableBase(),
      chair: createChairFrameGeometry(),
      cushion: createChairCushionGeometry(),
      throne: createThroneGeometry(),
      gems: createThroneGemGeometry(),
      gemMaterial: new MeshBasicMaterial({ color: '#ffffff' }),
      paper: createCardGeometry(),
      wood: new MeshLambertMaterial({ color: '#b98256' }),
      darkWood: new MeshLambertMaterial({ color: '#4e3120' }),
      tinted: new MeshLambertMaterial({ color: '#ffffff' }),
      paperMaterial: new MeshLambertMaterial({ color: '#fbfbf6' }),
    }),
    [],
  )

  const tops = useMemo(() => DATA.tables.map((t) => ({ p: [t.x, TABLE.height - 0.06, t.z] })), [])
  const legs = useMemo(() => DATA.tables.map((t) => ({ p: [t.x, 0, t.z] })), [])
  const papers = useMemo(
    () => SEATS.map((s) => ({ p: [s.x, PAPER_Y, s.table.z + CARD_Z] })),
    [],
  )
  const chairs = useMemo(
    () => [
      ...SEATS.map((s) => ({ p: [s.x, 0, s.z], c: EMPTY_CHAIR })),
    ],
    [],
  )

  // Seat colours follow whoever sits there. Subscribing (rather than selecting)
  // means table updates repaint 20 instance colours without re-rendering React.
  useEffect(() => {
    const paint = (tables) => {
      const frames = chairsRef.current
      const cushions = cushionsRef.current
      if (!frames || !cushions) return
      SEATS.forEach((s, i) => {
        const occupant = tables[s.table.id]?.seats[s.index]
        const chair = occupant ? chairById(occupant.chair) : null
        const color = chair ? chair.color : EMPTY_CHAIR
        setInstanceColor(frames, i, color)
        setInstanceColor(cushions, i, chair ? `#${cushionColor(color)}` : EMPTY_CUSHION)
        // Thrones get their crest, armrests and jewels; other seats hide them.
        const throne = chair?.style === 'throne'
        thronePlacement[i].s = throne ? ONE : ZERO
        thronePlacement[i].c = color
        gemPlacement[i].s = throne ? ONE : ZERO
        gemPlacement[i].c = RARITY_COLORS[chair?.rarity] ?? '#ffffff'
      })
      writeInstances(thronesRef.current, thronePlacement)
      writeInstances(gemsRef.current, gemPlacement)
    }
    paint(useGame.getState().tables)
    return useGame.subscribe((state, prev) => {
      if (state.tables !== prev.tables) paint(state.tables)
    })
  }, [])

  useLayoutEffect(() => {
    writeInstances(chairsRef.current, chairs)
    writeInstances(cushionsRef.current, chairs)
  }, [chairs])

  return (
    <>
      <Instanced geometry={res.top} material={res.wood} items={tops} castShadow={shadows} receiveShadow />
      <Instanced geometry={res.legs} material={res.darkWood} items={legs} castShadow={shadows} />
      <Instanced geometry={res.paper} material={res.paperMaterial} items={papers} />
      <instancedMesh
        ref={chairsRef}
        args={[res.chair, res.tinted, chairs.length]}
        castShadow={shadows}
        receiveShadow
      />
      <instancedMesh ref={cushionsRef} args={[res.cushion, res.tinted, chairs.length]} receiveShadow />
      <instancedMesh ref={thronesRef} args={[res.throne, res.tinted, chairs.length]} castShadow={shadows} />
      <instancedMesh ref={gemsRef} args={[res.gems, res.gemMaterial, chairs.length]} />
      {DATA.tables.map((t) => (
        <TableLabel key={t.id} table={t} />
      ))}
      <SeatPapers />
      {/* Seat auras are a nice-to-have: off on the LOW preset (which has no particles). */}
      {particles && <SeatAuras />}
    </>
  )
}


/**
 * A rarity aura under every occupied seat whose player has a bought chair equipped.
 * The selector returns a string, so React only re-renders when that set changes.
 */
function SeatAuras() {
  const key = useGame((s) =>
    SEATS.map((seat) => {
      const chair = s.tables[seat.table.id]?.seats[seat.index]?.chair
      return chair && chair !== 'basic' ? chair : ''
    }).join(','),
  )
  const items = useMemo(
    () =>
      key
        .split(',')
        .map((id, i) => {
          if (!id) return null
          const chair = chairById(id)
          const seat = SEATS[i]
          return {
            x: seat.x,
            y: 0,
            z: seat.z,
            color: RARITY_COLORS[chair.rarity],
            strength: RARITY_AURA[chair.rarity] * 0.7,
          }
        })
        .filter(Boolean),
    [key],
  )
  if (items.length === 0) return null
  return <Auras items={items} />
}

function tableLines(table, weekend, now) {
  const reward = DATA.winReward * (weekend ? 2 : 1)
  const prize = weekend
    ? { text: `Win $${reward} (x2)`, size: 34, rainbow: true }
    : { text: `Win $${reward}`, size: 34, color: '#5cff5c' }
  if (!table || table.phase === 'waiting') {
    const n = table ? table.seats.filter(Boolean).length : 0
    return [{ text: `${n}/2 Players`, size: 40 }, prize]
  }
  if (table.phase === 'countdown') {
    return [{ text: `Starting in ${Math.max(1, Math.ceil((table.endsAt - now) / 1000))}`, size: 40 }]
  }
  // Mid-duel the players' own speech bubbles say what's happening.
  return []
}

/**
 * "0/2 Players / Win $200" above a table. Polled, since the countdown ticks. Hidden
 * at the player's own table, where the HUD shows the same thing.
 */
function TableLabel({ table }) {
  const label = useDisposable(() => new Label({ height: 0.42 }), [])

  useEffect(() => {
    const update = () => {
      const s = useGame.getState()
      label.set(
        s.match?.table === table.id ? [] : tableLines(s.tables[table.id], s.profile?.weekend, Date.now()),
      )
    }
    update()
    const id = setInterval(update, 250)
    return () => clearInterval(id)
  }, [label, table.id])

  useCulled(label.sprite, table.x, table.z, { label, group: 'tables' })
  return <primitive object={label.sprite} position={[table.x, 3.3, table.z]} />
}

/**
 * The face of a number card: a small label and a big, dark number, drawn on a
 * transparent canvas over the white card. Sized and filtered to stay crisp at the
 * duel camera's angle even at 1x resolution (LOW).
 */
function useCardTexture(label, text, color) {
  const tex = useDisposable(() => {
    const canvas = document.createElement('canvas')
    canvas.width = CARD_TEX_W
    canvas.height = CARD_TEX_H
    const t = new CanvasTexture(canvas)
    t.colorSpace = SRGBColorSpace
    // Seen at an angle: anisotropic filtering keeps the digits sharp.
    t.anisotropy = 8
    return t
  }, [])

  useEffect(() => {
    let cancelled = false
    const draw = () => {
      if (cancelled) return
      const canvas = tex.image
      const ctx = canvas.getContext('2d')
      const w = CARD_TEX_W
      const h = CARD_TEX_H
      ctx.clearRect(0, 0, w, h)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineJoin = 'round'

      // Label strip across the top.
      ctx.fillStyle = color
      ctx.globalAlpha = 0.14
      ctx.fillRect(10, 10, w - 20, 36)
      ctx.globalAlpha = 1
      ctx.font = `700 24px ${GAME_FONT}`
      ctx.fillStyle = '#3a3f4b'
      ctx.fillText(label, w / 2, 29)

      if (text) {
        const size = text.length > 2 ? 108 : 132
        ctx.font = `700 ${size}px ${GAME_FONT}`
        // A soft light halo, then the number in a strong dark colour.
        ctx.lineWidth = 12
        ctx.strokeStyle = '#ffffff'
        ctx.strokeText(text, w / 2, h * 0.6)
        ctx.fillStyle = color
        ctx.fillText(text, w / 2, h * 0.6)
      }
      // Underline, like a number written on a form.
      ctx.fillStyle = '#c9ccd3'
      ctx.fillRect(40, h - 22, w - 80, 5)
      tex.needsUpdate = true
    }
    fontReady.then(draw)
    return () => {
      cancelled = true
    }
  }, [tex, label, text, color])

  return tex
}

/**
 * The two number cards at the player's own table: their number on their card, "?"
 * (or the revealed number) on the opponent's. Nobody else's cards show anything,
 * so this is never more than two extra draw calls.
 */
function SeatPapers() {
  const match = useGame((s) => s.match)
  const playing = match && match.phase !== 'waiting' && match.phase !== 'countdown'

  const mine = playing && match.myNumber != null ? String(match.myNumber) : ''
  const theirs = playing && match.phase !== 'choosing' ? String(match.revealed ?? '?') : ''
  const myTex = useCardTexture('YOUR NUMBER', mine, '#1d4ed8')
  const theirTex = useCardTexture('THEIR NUMBER', theirs, match?.revealed != null ? '#7c3aed' : '#dc2626')

  // On the front face of the card, a hair in front of it.
  const geometry = useDisposable(
    () => standUp(new PlaneGeometry(CARD_W * 0.94, CARD_H * 0.94).rotateX(-Math.PI / 2).rotateY(Math.PI), 0.024),
    [],
  )
  const materials = useDisposable(
    () => ({
      mine: new MeshBasicMaterial({ map: myTex, transparent: true, depthWrite: false }),
      theirs: new MeshBasicMaterial({ map: theirTex, transparent: true, depthWrite: false }),
    }),
    [myTex, theirTex],
  )

  if (!playing) return null
  const table = DATA.tables.find((t) => t.id === match.table)
  const mySeat = seatPosition(table.id, match.seat)
  const theirSeat = seatPosition(table.id, 1 - match.seat)

  return (
    <>
      <mesh geometry={geometry} material={materials.mine} position={[mySeat.x, PAPER_Y, table.z + CARD_Z]} />
      <mesh geometry={geometry} material={materials.theirs} position={[theirSeat.x, PAPER_Y, table.z + CARD_Z]} />
    </>
  )
}

export default Tables
