import { CanvasTexture, LinearFilter, Sprite, SpriteMaterial, SRGBColorSpace } from 'three'

/**
 * Billboard text drawn onto a small canvas, shown as a Sprite.
 *
 * Avoids a text-rendering library (troika is ~100 KB): world labels here are short
 * and change rarely. Each visible label is one draw call, so callers cull them by
 * distance.
 *
 * Load-time costs are kept off the critical path:
 *  - identical labels share one canvas texture (all ten "0/2 Players" table signs
 *    are drawn once);
 *  - nothing is drawn until the web font has loaded, so nothing is drawn twice;
 *  - non-urgent labels are drawn in idle time rather than during start-up.
 */

export const GAME_FONT = "'Fredoka', 'Segoe UI', system-ui, sans-serif"
/** Canvas width cap; keeps every label texture under the 512 px mobile budget. */
const MAX_WIDTH = 512
const PADDING = 10
/** Idle-time budget per slice when requestIdleCallback is unavailable, in ms. */
const IDLE_SLICE_MS = 6

/**
 * Resolves once the game font is usable (or failed to load, in which case the
 * fallback font is drawn).
 */
export const fontReady =
  typeof document !== 'undefined' && document.fonts
    ? document.fonts.load(`700 48px ${GAME_FONT}`).catch(() => {})
    : Promise.resolve()

let fontsReady = false
fontReady.then(() => {
  fontsReady = true
})

const requestIdle =
  typeof window !== 'undefined' && window.requestIdleCallback
    ? (cb) => window.requestIdleCallback(cb, { timeout: 400 })
    : (cb) => setTimeout(() => cb(null), 16)

/**
 * @typedef {{ text: string, size?: number, color?: string, stroke?: string,
 *             rainbow?: boolean }} LabelLine
 */

/** key -> shared canvas texture and the labels showing it. */
const entries = new Map()
const drawQueue = []
let pumping = false

function createEntry(key, lines) {
  const canvas = document.createElement('canvas')
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.generateMipmaps = false
  const entry = { key, lines, canvas, texture, drawn: false, scale: 1, users: new Set() }
  entries.set(key, entry)
  return entry
}

function releaseEntry(entry, label) {
  entry.users.delete(label)
  if (entry.users.size === 0) {
    entries.delete(entry.key)
    entry.texture.dispose()
  }
}

function drawEntry(entry) {
  if (entry.drawn || entry.users.size === 0) return
  const { canvas, lines } = entry
  const ctx = canvas.getContext('2d')

  let width = 0
  let height = PADDING * 2
  for (const line of lines) {
    ctx.font = `700 ${line.size ?? 40}px ${GAME_FONT}`
    width = Math.max(width, ctx.measureText(line.text).width)
    height += (line.size ?? 40) * 1.15
  }
  const scale = Math.min(1, (MAX_WIDTH - PADDING * 2) / Math.max(1, width))
  canvas.width = Math.min(MAX_WIDTH, Math.ceil(width * scale + PADDING * 2))
  canvas.height = Math.ceil(height * scale)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'

  let y = PADDING * scale
  for (const line of lines) {
    const size = (line.size ?? 40) * scale
    ctx.font = `700 ${size}px ${GAME_FONT}`
    y += size * 0.575
    const x = canvas.width / 2
    ctx.lineWidth = Math.max(3, size * 0.16)
    ctx.strokeStyle = line.stroke ?? '#000000'
    ctx.strokeText(line.text, x, y)
    if (line.rainbow) {
      const w = ctx.measureText(line.text).width
      const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0)
      ;['#ff3b3b', '#ffb21e', '#ffee32', '#3bff6f', '#33c8ff', '#b14dff'].forEach((c, i, a) =>
        g.addColorStop(i / (a.length - 1), c),
      )
      ctx.fillStyle = g
    } else {
      ctx.fillStyle = line.color ?? '#ffffff'
    }
    ctx.fillText(line.text, x, y)
    y += size * 0.575
  }

  entry.scale = scale
  entry.drawn = true
  entry.texture.needsUpdate = true
  for (const label of entry.users) label.fit()
}

function pump(deadline) {
  const start = performance.now()
  const hasTime = () =>
    deadline
      ? deadline.timeRemaining() > 1 || deadline.didTimeout
      : performance.now() - start < IDLE_SLICE_MS
  while (drawQueue.length && hasTime()) drawEntry(drawQueue.shift())
  if (drawQueue.length) requestIdle(pump)
  else pumping = false
}

function schedule(entry, urgent) {
  if (urgent) {
    if (fontsReady) drawEntry(entry)
    else fontReady.then(() => drawEntry(entry))
    return
  }
  drawQueue.push(entry)
  if (!pumping) {
    pumping = true
    fontReady.then(() => requestIdle(pump))
  }
}

export class Label {
  /**
   * @param {{ height?: number, depthTest?: boolean, urgent?: boolean }} [options]
   *   `height` is the world-space height of one 40 px line; bigger lines and extra
   *   lines grow the sprite in proportion. `urgent` labels (speech bubbles) are
   *   drawn immediately instead of in idle time.
   */
  constructor({ height = 1, depthTest = true, urgent = false } = {}) {
    this.height = height
    this.urgent = urgent
    this.entry = null
    this.material = new SpriteMaterial({ transparent: true, depthWrite: false, depthTest, fog: false })
    this.sprite = new Sprite(this.material)
  }

  /** @param {LabelLine[]} lines */
  set(lines) {
    const key = lines.length ? JSON.stringify(lines) : ''
    if ((this.entry?.key ?? '') === key) return

    if (this.entry) releaseEntry(this.entry, this)
    this.entry = null
    if (!key) return

    let entry = entries.get(key)
    const fresh = !entry
    if (fresh) entry = createEntry(key, lines)
    entry.users.add(this)
    this.entry = entry

    if (this.material.map !== entry.texture) {
      // null -> texture changes the shader; texture -> texture doesn't.
      if (!this.material.map) this.material.needsUpdate = true
      this.material.map = entry.texture
    }
    if (entry.drawn) this.fit()
    else if (fresh) schedule(entry, this.urgent)
  }

  /** Sizes the sprite to its texture, in unscaled pixels so capped labels keep their line height. */
  fit() {
    const { canvas, scale } = this.entry
    const k = this.height / (46 * scale)
    this.sprite.scale.set(canvas.width * k, canvas.height * k, 1)
  }

  /** True while there is nothing worth showing (no text, or not drawn yet). */
  get empty() {
    return !this.entry || !this.entry.drawn
  }

  dispose() {
    if (this.entry) releaseEntry(this.entry, this)
    this.entry = null
    this.material.dispose()
  }
}
