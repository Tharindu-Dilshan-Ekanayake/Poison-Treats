import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { BoxGeometry, CanvasTexture, MeshBasicMaterial, MeshLambertMaterial, RepeatWrapping, SRGBColorSpace } from 'three'

import { useGame } from '../net/gameStore'
import { useCulled } from './culling'
import { Label } from './labels'
import { chairById, DATA, RARITY_AURA, RARITY_COLORS, TABLE, seatPosition } from './layout'
import { useSettings } from './quality'
import Auras from './Aura'
import Candies from './Candies'
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

/** A pink-and-white gingham cloth for the treats to sit on: 64 px, repeated. */
function createClothTexture() {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff6fa'
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = 'rgba(255, 92, 160, 0.45)'
  ctx.fillRect(0, 0, size / 2, size)
  ctx.fillRect(0, 0, size, size / 2)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.wrapS = tex.wrapT = RepeatWrapping
  tex.repeat.set(6, 4)
  return tex
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
/** Chair models face -Z unrotated; an avatar faces -Z at yaw PI, so a chair turns by yaw + PI. */
const chairYaw = (seat) => seat.ry + Math.PI
/** Per-seat throne placement, rewritten when seats change (scale 0 = not a throne). */
const thronePlacement = SEATS.map((s) => ({ p: [s.x, 0, s.z], ry: chairYaw(s), s: ZERO, c: '#ffffff' }))
const gemPlacement = SEATS.map((s) => ({ p: [s.x, 0, s.z], ry: chairYaw(s), s: ZERO, c: '#ffffff' }))

/**
 * All ten tables: tops, cloths, legs and both facing chairs each, as instanced
 * meshes, plus every table's treats (see Candies). The chair mesh also carries the display chairs in the chair shop, and
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
      cloth: new BoxGeometry(TABLE.width - 0.22, 0.012, TABLE.depth - 0.22),
      clothTexture: createClothTexture(),
      wood: new MeshLambertMaterial({ color: '#b98256' }),
      darkWood: new MeshLambertMaterial({ color: '#4e3120' }),
      tinted: new MeshLambertMaterial({ color: '#ffffff' }),
    }),
    [],
  )

  const tops = useMemo(() => DATA.tables.map((t) => ({ p: [t.x, TABLE.height - 0.06, t.z] })), [])
  const legs = useMemo(() => DATA.tables.map((t) => ({ p: [t.x, 0, t.z] })), [])
  const cloths = useMemo(() => DATA.tables.map((t) => ({ p: [t.x, TABLE.height + 0.006, t.z] })), [])
  const clothMaterial = useDisposable(() => new MeshLambertMaterial({ map: res.clothTexture }), [res])
  const chairs = useMemo(() => SEATS.map((s) => ({ p: [s.x, 0, s.z], ry: chairYaw(s), c: EMPTY_CHAIR })), [])

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
      <Instanced geometry={res.cloth} material={clothMaterial} items={cloths} receiveShadow />
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
      <Candies />
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
  // Mid-match the players' own speech bubbles say what's happening.
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

export default Tables
