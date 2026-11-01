import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Vector3 } from 'three'

import { usePlatform } from '../bloxity/platform'
import { useGame } from '../net/gameStore'
import { localPlayer } from '../net/liveState'
import { DATA, TABLE } from './layout'

/** How high above the player's feet the camera aims. */
const LOOK_HEIGHT = 2
/**
 * Extra height on the aim point only (not the camera): tilts the view up a little so
 * the world sits lower in the frame, below the top HUD, with the player still clear.
 */
const AIM_ABOVE = 0.9

const MIN_DISTANCE = 4
const MAX_DISTANCE = 22
const START_DISTANCE = 10

// Pitch limits, in radians. Stops the camera flipping over the top or sinking
// under the ground.
const MIN_PITCH = -0.1
const MAX_PITCH = 1.25
const START_PITCH = 0.32

const DRAG_SENSITIVITY = 0.005
const TOUCH_SENSITIVITY = 0.008
const ZOOM_SENSITIVITY = 0.01

// Higher = snappier. Framerate-independent via the pow() smoothing below.
const POSITION_SMOOTHING = 4
const LOOK_SMOOTHING = 8
const TABLE_SMOOTHING = 3

/** Seated view: across the table from the two players, looking at them. */
const TABLE_CAM_BACK = 3.1
const TABLE_CAM_HEIGHT = 1.9
const TABLE_LOOK_HEIGHT = 1.15
/** Looks higher while the winner dances up on the table. */
const TABLE_LOOK_HEIGHT_WIN = 1.9

const _desired = new Vector3()
const _target = new Vector3()

/**
 * Third-person orbit camera that trails the local player.
 * Right-drag (mouse) or one-finger drag (touch) orbits; the wheel zooms.
 *
 * While the player is seated at a table it swings round to face both seats, the
 * duel view, and orbiting is disabled.
 */
export function FollowCamera() {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)

  // Spherical offset from the player. A ref, not state: pointer events write to it
  // every move and the frame loop reads it.
  const orbit = useRef({ yaw: 0, pitch: START_PITCH, distance: START_DISTANCE })
  const lookAt = useRef(new Vector3())
  const initialised = useRef(false)

  useEffect(() => {
    const el = gl.domElement
    if (!el) return undefined

    let dragId = null
    let lastX = 0
    let lastY = 0

    const onPointerDown = (e) => {
      // Mouse: left or right button (the UI is DOM above the canvas, so a click on
      // the canvas is always meant for the camera). Touch: any finger that lands on
      // the canvas (the joystick and buttons are DOM, above it).
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return
      if (dragId !== null) return
      dragId = e.pointerId
      lastX = e.clientX
      lastY = e.clientY
      el.setPointerCapture?.(e.pointerId)
      if (e.pointerType === 'mouse') el.style.cursor = 'grabbing'
    }

    const onPointerMove = (e) => {
      if (e.pointerId !== dragId) return
      // Bloxity's camera_sensitivity setting scales both.
      const k =
        (e.pointerType === 'touch' ? TOUCH_SENSITIVITY : DRAG_SENSITIVITY) *
        usePlatform.getState().cameraSensitivity
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY

      const o = orbit.current
      o.yaw -= dx * k
      o.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, o.pitch + dy * k))
    }

    const endDrag = (e) => {
      if (e.pointerId !== dragId) return
      dragId = null
      el.releasePointerCapture?.(e.pointerId)
      el.style.cursor = 'grab'
    }

    const onWheel = (e) => {
      // Without this the page scrolls behind the canvas.
      e.preventDefault()
      const o = orbit.current
      o.distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, o.distance + e.deltaY * ZOOM_SENSITIVITY))
    }

    // Right-dragging otherwise opens the browser context menu mid-orbit.
    const onContextMenu = (e) => e.preventDefault()

    el.style.cursor = 'grab'
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', endDrag)
    el.addEventListener('pointercancel', endDrag)
    el.addEventListener('contextmenu', onContextMenu)
    // passive:false is required for preventDefault() on wheel to take effect.
    el.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', endDrag)
      el.removeEventListener('pointercancel', endDrag)
      el.removeEventListener('contextmenu', onContextMenu)
      el.removeEventListener('wheel', onWheel)
    }
  }, [gl])

  useFrame((_state, delta) => {
    const match = useGame.getState().match
    const table = match && DATA.tables.find((t) => t.id === match.table)

    if (table) {
      // A winner dancing up on the table is tall: step back so they fit in frame.
      _desired.set(table.x, match.won ? 2.3 : TABLE_CAM_HEIGHT, table.z - (match.won ? 3.9 : TABLE_CAM_BACK))
      _target.set(table.x, match.won ? TABLE_LOOK_HEIGHT_WIN : TABLE_LOOK_HEIGHT, table.z + TABLE.seatZ * 0.7)
      const k = 1 - Math.pow(0.001, delta * (TABLE_SMOOTHING / 10) * 3)
      camera.position.lerp(_desired, k)
      lookAt.current.lerp(_target, k)
      camera.lookAt(lookAt.current)
      // Standing up again: resume orbiting from behind the player.
      orbit.current.yaw = 0
      return
    }

    const pos = localPlayer.position
    _target.copy(pos)

    // Spherical -> cartesian. yaw 0 puts the camera behind the player on +Z.
    const { yaw, pitch, distance } = orbit.current
    const horizontal = Math.cos(pitch) * distance
    _desired.set(
      _target.x + Math.sin(yaw) * horizontal,
      _target.y + Math.sin(pitch) * distance + LOOK_HEIGHT,
      _target.z + Math.cos(yaw) * horizontal,
    )

    if (!initialised.current || localPlayer.snapCamera) {
      // Avoid a long swoop in from wherever the camera was (first frame, respawn).
      localPlayer.snapCamera = false
      camera.position.copy(_desired)
      lookAt.current.copy(_target).setY(_target.y + LOOK_HEIGHT + AIM_ABOVE)
      initialised.current = true
    }

    // 1 - pow(x, delta) keeps the easing rate consistent across framerates.
    camera.position.lerp(_desired, 1 - Math.pow(0.001, delta * (POSITION_SMOOTHING / 10)))

    _target.y += LOOK_HEIGHT + AIM_ABOVE
    lookAt.current.lerp(_target, 1 - Math.pow(0.001, delta * (LOOK_SMOOTHING / 10)))
    camera.lookAt(lookAt.current)
  })

  return null
}

export default FollowCamera
