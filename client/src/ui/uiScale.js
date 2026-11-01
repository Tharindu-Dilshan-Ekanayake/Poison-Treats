/**
 * Scales the whole HUD with the screen by setting the root font size: every UI size
 * is in rem, so one layout fits a phone held either way and a desktop monitor.
 *
 * Landscape screens are measured against 1280x720 (short phones against 620 px of
 * height, or everything ends up tiny), portrait ones against 720x1280; the smaller
 * ratio wins so nothing overflows. Clamped so text stays readable on small phones
 * and doesn't balloon on 4K.
 */
const MIN_PX = 11
const MAX_PX = 22

function apply() {
  const vv = window.visualViewport
  const w = vv?.width || window.innerWidth
  const h = vv?.height || window.innerHeight
  const s = w >= h ? Math.min(w / 1280, h / (h < 520 ? 620 : 720)) : Math.min(w / 720, h / 1280)
  const px = Math.max(MIN_PX, Math.min(MAX_PX, 16 * s * (w >= h ? 1 : 1.55)))
  document.documentElement.style.fontSize = `${px.toFixed(2)}px`
}

export function installUiScale() {
  apply()
  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', apply)
  window.visualViewport?.addEventListener('resize', apply)
}
