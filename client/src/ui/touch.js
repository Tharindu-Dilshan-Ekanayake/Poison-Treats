import { create } from 'zustand'

/**
 * Whether to show the on-screen joystick and jump button.
 *
 * Guessed at start-up from the device, then corrected live: the first real touch
 * on the screen turns them on (a phone in "desktop site" mode, or a phone emulator
 * opened after the page loaded, reports no touch support up front).
 */
const initial =
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches ||
    navigator.maxTouchPoints > 0 ||
    'ontouchstart' in window)

export const useTouch = create(() => ({ touch: Boolean(initial) }))

if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'touch' && !useTouch.getState().touch) useTouch.setState({ touch: true })
    },
    { passive: true },
  )
}
