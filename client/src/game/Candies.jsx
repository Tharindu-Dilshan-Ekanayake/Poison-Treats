import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useRef } from 'react'
import {
  CanvasTexture,
  Color,
  CylinderGeometry,
  IcosahedronGeometry,
  LatheGeometry,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  Plane,
  Raycaster,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three'

import { sfx } from '../audio/sfx'
import { send } from '../net/api'
import { useGame } from '../net/gameStore'
import { candyBites, candyHover, effectQueue, localPlayer } from '../net/liveState'
import {
  CANDY_COUNT,
  CANDY_HEIGHT,
  CANDY_RADIUS,
  CANDY_Y,
  candyAt,
  candyOffset,
  CENTERPIECE,
  DATA,
  seatPosition,
} from './layout'
import { getSettings, useSettings } from './quality'
import { useDisposable } from './useDisposable'

/**
 * Every table's treats, as two instanced meshes: a detailed one for the table the
 * player is at (or standing nearest), and a low-poly one for all the others. Each
 * treat is a peppermint swirl whose stripe colour is its instance colour, so
 * a poisoned treat is just a colour change.
 *
 * Bites are animated here from liveState.candyBites: the treat lifts to the eater's
 * mouth and disappears in three crunchy bites.
 */

const TABLES = DATA.tables
const ALL = TABLES.length * CANDY_COUNT
/** Both seats of every table, looked up in the frame loop without allocating. */
const SEATS = new Map(TABLES.map((t) => [t.id, [seatPosition(t.id, 0), seatPosition(t.id, 1)]]))
/** The giant treat's size, and how far its centre sits from its base. */
const GIANT_SCALE = 14
const GIANT_CENTRE = (CANDY_HEIGHT / 2) * GIANT_SCALE
/** Standing closer than this to a table makes it the detailed one. */
const FOCUS_RANGE = 9

const RED = '#e8202a'
const POISON = '#2fd14f'
const POISON_PREVIEW = '#7dff3a'

/** Bite timeline, in seconds from the 'eat' message. */
const LIFT_S = 0.45
const BITES = [0.6, 0.85, 1.1]
const BITE_SCALE = [1, 0.72, 0.45, 0]
const POP_S = 0.45

/** Peppermint pillow profile (radius, height), from the bottom centre round to the top. */
function profile(detailed) {
  const r = CANDY_RADIUS
  const h = CANDY_HEIGHT
  const pts = detailed
    ? [
        [0, 0], [r * 0.82, 0], [r * 0.96, h * 0.12], [r, h * 0.35], [r, h * 0.62],
        [r * 0.95, h * 0.86], [r * 0.8, h * 0.98], [r * 0.4, h * 1.04], [0, h * 1.06],
      ]
    : [[0, 0], [r * 0.9, 0], [r, h * 0.5], [r * 0.88, h], [0, h * 1.04]]
  return pts.map(([x, y]) => new Vector2(x, y))
}

/** A treat, with UVs projected straight down so the swirl wraps the top and stripes the rim. */
function createCandyGeometry(detailed) {
  const g = new LatheGeometry(profile(detailed), detailed ? 28 : 10)
  const pos = g.getAttribute('position')
  const uv = g.getAttribute('uv')
  for (let i = 0; i < pos.count; i += 1) {
    uv.setXY(i, pos.getX(i) / (2 * CANDY_RADIUS) + 0.5, pos.getZ(i) / (2 * CANDY_RADIUS) + 0.5)
  }
  return g
}

/** Swirl mask: red channel 1 where the stripe colour goes, 0 for white. 128 px. */
function createSwirlTexture() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = '#fff'
  const c = size / 2
  const wedges = 8
  const twist = 0.035
  const reach = size * 0.75
  for (let k = 0; k < wedges; k += 1) {
    const a0 = (k / wedges) * Math.PI * 2
    const a1 = a0 + (Math.PI * 2) / wedges / 2
    ctx.beginPath()
    for (let r = 0; r <= reach; r += 4) ctx.lineTo(c + Math.cos(a0 + r * twist) * r, c + Math.sin(a0 + r * twist) * r)
    for (let r = reach; r >= 0; r -= 4) ctx.lineTo(c + Math.cos(a1 + r * twist) * r, c + Math.sin(a1 + r * twist) * r)
    ctx.fill()
  }
  // A white dot in the middle, like a real peppermint.
  ctx.fillStyle = '#000'
  ctx.beginPath()
  ctx.arc(c, c, size * 0.07, 0, Math.PI * 2)
  ctx.fill()
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  return tex
}

/**
 * Lambert with the swirl: white where the mask is 0, the instance colour where it
 * is 1. One material, so every treat (and the giant one) shares one program.
 */
function createCandyMaterial(map) {
  const m = new MeshLambertMaterial({ color: '#ffffff', map })
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_fragment>', '')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float stripe = texture2D( map, vMapUv ).r;
        diffuseColor.rgb = mix( vec3( 1.0 ), diffuseColor.rgb, stripe );`,
      )
  }
  m.customProgramCacheKey = () => 'candy-swirl'
  return m
}

const _obj = new Object3D()
const _color = new Color()
const _from = new Vector3()
const _to = new Vector3()

const easeOut = (t) => 1 - (1 - t) * (1 - t)
/** Overshoots a little then settles: the pop-in when a table is refilled. */
const backOut = (t) => {
  const s = 1.9
  const u = t - 1
  return 1 + (s + 1) * u * u * u + s * u * u
}

/** Where the eater's mouth is: above their seat, leaning in towards the table. */
function mouthOf(tableId, seat, out) {
  const s = SEATS.get(tableId)[seat]
  return out.set(s.x + Math.sin(s.ry) * 0.3, 1.2, s.z + Math.cos(s.ry) * 0.3)
}

/**
 * Writes one treat's matrix into `_obj` for the current moment. Returns false when
 * it isn't drawn (eaten). `hover` lifts it a little.
 */
function placeCandy(table, i, eatenMask, bite, popAt, now, hover) {
  const [ox, oz] = candyOffset(i)
  _obj.rotation.set(0, i * 0.7, 0)

  if (bite && bite.i === i) {
    const t = (now - bite.start) / 1000
    if (t >= BITES[2] + 0.05) return false
    _from.set(table.x + ox, CANDY_Y, table.z + oz)
    mouthOf(table.id, bite.seat, _to)
    if (t < LIFT_S) {
      const u = easeOut(t / LIFT_S)
      _obj.position.lerpVectors(_from, _to, u)
      _obj.position.y += Math.sin(u * Math.PI) * 0.25
    } else {
      _obj.position.copy(_to)
    }
    // Stand the disc up to face the eater as it rises.
    const tilt = Math.min(1, t / LIFT_S) * 1.25
    // Positive X rotation tips the top towards +Z: towards seat 1, away from seat 0.
    _obj.rotation.set(bite.seat === 0 ? -tilt : tilt, 0, 0)
    let step = 0
    while (step < 3 && t >= BITES[step]) step += 1
    const s = BITE_SCALE[step]
    _obj.scale.set(s, s, s)
    return s > 0
  }

  if (eatenMask && eatenMask.charCodeAt(i) === 49) return false
  _obj.position.set(table.x + ox, CANDY_Y, table.z + oz)
  let s = 1
  if (popAt) {
    const t = (now - popAt) / 1000 - i * 0.025
    s = t <= 0 ? 0 : t >= POP_S ? 1 : Math.max(0, backOut(t / POP_S))
  }
  if (hover) {
    _obj.position.y += 0.05 + Math.sin(now / 160) * 0.012
    s *= 1.14
    _obj.rotation.y += now / 600
  }
  _obj.scale.set(s, s, s)
  return s > 0
}

/** Stripe colour of a treat on the focused table, from what this player knows. */
function focusColor(i, match, poisons, hovering) {
  if (poisons && (poisons[0] === i || poisons[1] === i)) return POISON
  if (match) {
    if (match.myPoison === i) return POISON
    if (hovering && match.phase === 'poisoning' && match.myPoison < 0) return POISON_PREVIEW
  }
  return RED
}

const parsedPoisons = new Map()
/** "a,b" -> [a, b], memoised so the frame loop doesn't allocate. */
function parsePoisons(str) {
  if (!str) return null
  let out = parsedPoisons.get(str)
  if (!out) {
    out = str.split(',').map(Number)
    parsedPoisons.set(str, out)
  }
  return out
}

/* ---- Input: tap / click a treat ------------------------------------------------------ */

const _ray = new Raycaster()
const _ndc = new Vector2()
const _plane = new Plane(new Vector3(0, 1, 0), -(CANDY_Y + CANDY_HEIGHT))
const _hit = new Vector3()

/** What a tap does right now at the player's table: 'poison', 'eat' or null. */
function pickMode(match) {
  if (!match) return null
  if (match.phase === 'poisoning' && match.myPoison < 0) return 'poison'
  if (match.phase === 'eating' && match.myTurn && !match.pending) return 'eat'
  return null
}

/**
 * Turns pointer positions on the canvas into treats: a ray onto the tabletop plane,
 * then the grid cell under it. No mesh raycasting, so it costs nothing per move.
 */
function CandyPicker() {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)

  useEffect(() => {
    const el = gl.domElement
    const candyUnder = (e) => {
      const { match, tables } = useGame.getState()
      if (!pickMode(match)) return -1
      const rect = el.getBoundingClientRect()
      _ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      _ray.setFromCamera(_ndc, camera)
      if (!_ray.ray.intersectPlane(_plane, _hit)) return -1
      const table = TABLES.find((t) => t.id === match.table)
      const i = candyAt(_hit.x - table.x, _hit.z - table.z)
      const eaten = tables[match.table]?.eaten
      return i >= 0 && eaten?.charCodeAt(i) !== 49 ? i : -1
    }
    const setHover = (i) => {
      const match = useGame.getState().match
      if (i !== candyHover.i && i >= 0) sfx.hover()
      candyHover.table = match?.table ?? 0
      candyHover.i = i
      el.style.cursor = i >= 0 ? 'pointer' : ''
    }

    let down = null
    const onDown = (e) => {
      down = { x: e.clientX, y: e.clientY }
      // Touch has no hover: show which treat the finger landed on.
      if (e.pointerType !== 'mouse') setHover(candyUnder(e))
    }
    const onMove = (e) => {
      if (e.pointerType === 'mouse') setHover(candyUnder(e))
    }
    const onUp = (e) => {
      const d = down
      down = null
      // A drag is not a tap. No time limit: slow phones can take a while between the two.
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12) return
      const i = candyUnder(e)
      if (i < 0) return
      const { match, tables } = useGame.getState()
      const mode = pickMode(match)
      if (mode === 'poison') {
        sfx.poisonPick()
        send({ t: 'poison', n: i })
      } else if (mode === 'eat') {
        const eaten = tables[match.table]?.eaten || ''
        const left = eaten.split('').filter((c) => c === '0').length
        // Your own poison is only worth eating when it's the last treat left.
        if (i === match.myPoison && left > 1) {
          sfx.error()
          useGame.getState().pushToast("That's YOUR poison! ☠️ Pick another")
          return
        }
        sfx.click()
        send({ t: 'eat', n: i })
      }
      setHover(-1)
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      candyHover.i = -1
    }
  }, [camera, gl])

  return null
}

/* ---- Poison bubbles ------------------------------------------------------------------- */

const BUBBLES = 18
/** Up to two fizzing treats' positions, written by Candies each frame. */
const bubbleSources = { count: 0, pos: new Float32Array(6) }

/** Little green bubbles fizzing up from the poisoned treats this player can see. */
function PoisonBubbles({ geometry, material }) {
  const sources = bubbleSources
  const ref = useRef(null)
  const pool = useRef({ life: new Float32Array(BUBBLES), pos: new Float32Array(BUBBLES * 3), next: 0, acc: 0 })

  useFrame((_s, delta) => {
    const mesh = ref.current
    if (!mesh) return
    const p = pool.current
    const dt = Math.min(delta, 0.05)
    // Spawn a few per second from each source.
    if (sources.count > 0) {
      p.acc += dt * 7 * sources.count
      while (p.acc >= 1) {
        p.acc -= 1
        const src = Math.floor(Math.random() * sources.count) * 3
        const b = p.next
        p.next = (p.next + 1) % BUBBLES
        p.life[b] = 1
        p.pos[b * 3] = sources.pos[src] + (Math.random() - 0.5) * 0.14
        p.pos[b * 3 + 1] = sources.pos[src + 1]
        p.pos[b * 3 + 2] = sources.pos[src + 2] + (Math.random() - 0.5) * 0.14
      }
    }
    let alive = false
    for (let b = 0; b < BUBBLES; b += 1) {
      if (p.life[b] > 0) {
        alive = true
        p.life[b] -= dt * 1.1
        p.pos[b * 3 + 1] += dt * 0.35
        p.pos[b * 3] += Math.sin(p.life[b] * 12 + b) * dt * 0.08
        const s = Math.sin(Math.max(0, p.life[b]) * Math.PI) * (0.6 + (b % 3) * 0.25)
        _obj.position.set(p.pos[b * 3], p.pos[b * 3 + 1], p.pos[b * 3 + 2])
        _obj.rotation.set(0, 0, 0)
        _obj.scale.set(s, s, s)
      } else {
        _obj.scale.set(0, 0, 0)
      }
      _obj.updateMatrix()
      mesh.setMatrixAt(b, _obj.matrix)
    }
    mesh.visible = alive
    if (alive) mesh.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[geometry, material, BUBBLES]} frustumCulled={false} />
}

/* ---- The treats ---------------------------------------------------------------------- */

export function Candies() {
  const { particles, shadows } = useSettings()
  const nearRef = useRef(null)
  const farRef = useRef(null)
  const giantRef = useRef(null)

  const res = useDisposable(() => {
    const swirl = createSwirlTexture()
    return {
      swirl,
      near: createCandyGeometry(true),
      far: createCandyGeometry(false),
      material: createCandyMaterial(swirl),
      pedestal: new CylinderGeometry(1.9, 2.2, 0.7, 24),
      pedestalMaterial: new MeshLambertMaterial({ color: '#ff8fc8' }),
      bubble: new IcosahedronGeometry(0.035, 1),
      bubbleMaterial: new MeshBasicMaterial({ color: '#7dff3a', transparent: true, opacity: 0.85 }),
    }
  }, [])

  /** Frame-loop state: never goes through React. */
  const st = useRef({
    focus: 0,
    farDirty: true,
    masks: new Map(),
    popAt: new Map(),
    crumbStep: new Map(),
  })

  // Any table update (a bite, a reset) redraws the low-poly treats once.
  useEffect(
    () =>
      useGame.subscribe((s, prev) => {
        if (s.tables !== prev.tables) st.current.farDirty = true
      }),
    [],
  )

  // Colours exist from the first frame, so the shader is compiled once, with them.
  useLayoutEffect(() => {
    _color.set(RED)
    for (const mesh of [nearRef.current, farRef.current, giantRef.current]) {
      for (let i = 0; i < mesh.count; i += 1) mesh.setColorAt(i, _color)
      mesh.instanceColor.needsUpdate = true
    }
  }, [])

  useFrame((state) => {
    const near = nearRef.current
    const far = farRef.current
    if (!near || !far) return
    const s = st.current
    const now = Date.now()
    const { tables, match } = useGame.getState()

    // The giant treat in the middle of the plaza turns slowly on its edge.
    // Stood on its edge (X), then spun about the world's up axis (Y); the base is
    // the pivot, so it is moved back by the spun half-thickness to turn on the spot.
    const giant = giantRef.current
    const spin = state.clock.elapsedTime * 0.5
    _obj.position.set(
      CENTERPIECE.x - Math.sin(spin) * GIANT_CENTRE,
      2.75 + Math.sin(state.clock.elapsedTime * 1.3) * 0.12,
      CENTERPIECE.z - Math.cos(spin) * GIANT_CENTRE,
    )
    _obj.rotation.set(Math.PI / 2, spin, 0, 'YXZ')
    _obj.scale.set(GIANT_SCALE, GIANT_SCALE, GIANT_SCALE)
    _obj.updateMatrix()
    _obj.rotation.order = 'XYZ'
    giant.setMatrixAt(0, _obj.matrix)
    giant.instanceMatrix.needsUpdate = true

    // Which table gets the detailed treats.
    let focus = match?.table ?? 0
    if (!focus) {
      let best = FOCUS_RANGE
      const p = localPlayer.position
      for (const t of TABLES) {
        const d = Math.hypot(t.x - p.x, t.z - p.z)
        if (d < best) {
          best = d
          focus = t.id
        }
      }
    }
    if (focus !== s.focus) {
      s.focus = focus
      s.farDirty = true
    }

    // Refills: a table's eaten mask going back to all zeros pops its treats in.
    for (const t of TABLES) {
      const mask = tables[t.id]?.eaten || ''
      const prev = s.masks.get(t.id)
      if (prev !== mask) {
        if (prev && prev.includes('1') && !mask.includes('1')) {
          s.popAt.set(t.id, now)
          candyBites.delete(t.id)
        }
        s.masks.set(t.id, mask)
      }
      const pop = s.popAt.get(t.id)
      if (pop && now - pop > (POP_S + CANDY_COUNT * 0.025) * 1000 + 100) {
        s.popAt.delete(t.id)
        s.farDirty = true
      }
    }

    // Bites in progress: crumbs on each chomp, and the far mesh keeps animating.
    let farAnimating = false
    for (const [tableId, bite] of candyBites) {
      const t = (now - bite.start) / 1000
      if (t > BITES[2] + 0.3) {
        candyBites.delete(tableId)
        s.crumbStep.delete(tableId)
        s.farDirty = true
        continue
      }
      if (tableId !== focus || s.popAt.has(tableId)) farAnimating = true
      let step = 0
      while (step < 3 && t >= BITES[step]) step += 1
      if (step !== (s.crumbStep.get(tableId) ?? 0)) {
        s.crumbStep.set(tableId, step)
        if (getSettings().particles && step > 0) {
          mouthOf(tableId, bite.seat, _to)
          effectQueue.push({ kind: 'crumbs', x: _to.x, y: _to.y, z: _to.z })
        }
      }
    }
    for (const id of s.popAt.keys()) if (id !== focus) farAnimating = true

    // --- Detailed treats at the focused table, every frame -----------------------------
    const ft = focus ? TABLES.find((t) => t.id === focus) : null
    const poisons = ft ? parsePoisons(tables[focus]?.poisons) : null
    const myMatch = match && match.table === focus ? match : null
    bubbleSources.count = 0
    if (ft) {
      const mask = tables[focus]?.eaten || ''
      const bite = candyBites.get(focus)
      const pop = s.popAt.get(focus)
      const canPick = Boolean(pickMode(myMatch))
      for (let i = 0; i < CANDY_COUNT; i += 1) {
        const hovering = canPick && candyHover.table === focus && candyHover.i === i
        const shown = placeCandy(ft, i, mask, bite, pop, now, hovering)
        if (!shown) _obj.scale.set(0, 0, 0)
        _obj.updateMatrix()
        near.setMatrixAt(i, _obj.matrix)
        near.setColorAt(i, _color.set(focusColor(i, myMatch, poisons, hovering)))
        // Poison you know about fizzes.
        const fizz =
          shown &&
          (poisons ? poisons.includes(i) : myMatch && myMatch.myPoison === i)
        if (fizz && bubbleSources.count < 2) {
          const o = bubbleSources.count * 3
          bubbleSources.pos[o] = _obj.position.x
          bubbleSources.pos[o + 1] = _obj.position.y + CANDY_HEIGHT
          bubbleSources.pos[o + 2] = _obj.position.z
          bubbleSources.count += 1
        }
      }
      near.count = CANDY_COUNT
    } else {
      near.count = 0
    }
    near.instanceMatrix.needsUpdate = true
    if (near.instanceColor) near.instanceColor.needsUpdate = true

    // --- Low-poly treats everywhere else, only when something changed ----------------
    if (s.farDirty || farAnimating) {
      s.farDirty = false
      TABLES.forEach((t, ti) => {
        const mask = tables[t.id]?.eaten || ''
        const bite = candyBites.get(t.id)
        const pop = s.popAt.get(t.id)
        const tablePoisons = parsePoisons(tables[t.id]?.poisons)
        for (let i = 0; i < CANDY_COUNT; i += 1) {
          const k = ti * CANDY_COUNT + i
          const shown = t.id !== focus && placeCandy(t, i, mask, bite, pop, now, false)
          if (!shown) _obj.scale.set(0, 0, 0)
          _obj.updateMatrix()
          far.setMatrixAt(k, _obj.matrix)
          far.setColorAt(k, _color.set(tablePoisons?.includes(i) ? POISON : RED))
        }
      })
      far.instanceMatrix.needsUpdate = true
      if (far.instanceColor) far.instanceColor.needsUpdate = true
    }
  })

  return (
    <>
      <instancedMesh ref={nearRef} args={[res.near, res.material, CANDY_COUNT]} frustumCulled={false} castShadow={shadows} />
      <instancedMesh ref={farRef} args={[res.far, res.material, ALL]} frustumCulled={false} />
      <instancedMesh ref={giantRef} args={[res.near, res.material, 1]} frustumCulled={false} castShadow={shadows} />
      <mesh
        geometry={res.pedestal}
        material={res.pedestalMaterial}
        position={[CENTERPIECE.x, 0.35, CENTERPIECE.z]}
        receiveShadow
        castShadow={shadows}
      />
      {particles && <PoisonBubbles geometry={res.bubble} material={res.bubbleMaterial} />}
      <CandyPicker />
    </>
  )
}

export default Candies
