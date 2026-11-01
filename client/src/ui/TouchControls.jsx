import { useRef } from 'react'

import { useGame } from '../net/gameStore'
import { touchInput } from '../net/liveState'

const STICK_RADIUS = 52

/**
 * On-screen joystick (bottom left) and jump button (bottom right) for touch screens.
 * Writes straight into `touchInput`, which the player controller reads each frame.
 * Dragging anywhere else on the screen orbits the camera (see FollowCamera).
 */
export function TouchControls() {
  const seated = useGame((s) => Boolean(s.match))
  const knobRef = useRef(null)
  const origin = useRef(null)

  const move = (e) => {
    if (!origin.current || e.pointerId !== origin.current.id) return
    let dx = e.clientX - origin.current.x
    let dy = e.clientY - origin.current.y
    const len = Math.hypot(dx, dy)
    if (len > STICK_RADIUS) {
      dx = (dx / len) * STICK_RADIUS
      dy = (dy / len) * STICK_RADIUS
    }
    touchInput.x = dx / STICK_RADIUS
    touchInput.y = dy / STICK_RADIUS
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`
  }

  const end = (e) => {
    if (!origin.current || e.pointerId !== origin.current.id) return
    origin.current = null
    touchInput.x = 0
    touchInput.y = 0
    if (knobRef.current) knobRef.current.style.transform = 'translate(0px, 0px)'
  }

  if (seated) return null

  return (
    <>
      <div
        // Clear of the Shop / Items / Rewards column (left-3 + 5.25rem wide).
        className="pointer-events-auto touch-pad-pos absolute bottom-[max(1rem,6%)] z-30 touch-pad flex size-[136px] touch-none items-center justify-center rounded-full"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          const r = e.currentTarget.getBoundingClientRect()
          origin.current = { id: e.pointerId, x: r.left + r.width / 2, y: r.top + r.height / 2 }
          move(e)
        }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div
          ref={knobRef}
          className="size-16 rounded-full border-[3px] border-white bg-gradient-to-b from-white/90 to-[#bfe4ff]/80 shadow-[0_0.25rem_0.5rem_rgba(0,0,0,0.3)]"
        />
      </div>
      <button
        type="button"
        className="pointer-events-auto absolute bottom-[max(1.25rem,7%)] right-6 z-30 btn-3d flex size-[92px] touch-none flex-col items-center justify-center rounded-full bg-gradient-to-b from-[#5fd0ff] to-[#2a6bff] text-white"
        onPointerDown={() => (touchInput.jump = true)}
        onPointerUp={() => (touchInput.jump = false)}
        onPointerCancel={() => (touchInput.jump = false)}
        onPointerLeave={() => (touchInput.jump = false)}
      >
        <span className="stroke-text text-3xl leading-none">⬆</span>
        <span className="stroke-thin text-xs font-bold leading-none">JUMP</span>
      </button>
    </>
  )
}

export default TouchControls
