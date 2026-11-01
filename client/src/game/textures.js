import {
  BoxGeometry,
  CanvasTexture,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three'

/**
 * Procedural textures and geometry for the toy-brick look.
 *
 * The stud pattern is drawn on a canvas at runtime rather than shipped as an image, so
 * recolouring the world is just a matter of editing sceneStyle.js.
 */

/** Blends a '#rrggbb' colour towards white (amount > 0) or black (amount < 0). */
function shade(hex, amount) {
  const value = parseInt(hex.slice(1), 16)
  const target = amount > 0 ? 255 : 0
  const t = Math.abs(amount)
  const channel = (shift) => {
    const c = (value >> shift) & 0xff
    return Math.round(c + (target - c) * t)
  }
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`
}

function fillCircle(ctx, x, y, r) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

/** One raised stud, lit from the top-left like the rest of the scene. */
function drawStud(ctx, x, y, cell, color) {
  const r = cell * 0.3

  // Drop shadow down-right, so the stud reads as raised off the plate.
  ctx.fillStyle = shade(color, -0.16)
  fillCircle(ctx, x + cell * 0.035, y + cell * 0.055, r * 1.04)

  // The stud's side: rim-lit top-left, darker bottom-right.
  const rim = ctx.createLinearGradient(x - r, y - r, x + r, y + r)
  rim.addColorStop(0, shade(color, 0.3))
  rim.addColorStop(1, shade(color, -0.12))
  ctx.fillStyle = rim
  fillCircle(ctx, x, y, r)

  // Flat top face.
  ctx.fillStyle = shade(color, 0.06)
  fillCircle(ctx, x, y, r * 0.8)
}

/**
 * A tileable studded-plate texture: a checker of `cellsPerTile` x `cellsPerTile`
 * cells alternating `base` / `alt`, each holding `studsPerCell` x `studsPerCell` studs.
 *
 * @param {{ base: string, alt?: string, studsPerCell?: number, cellsPerTile?: number,
 *           size?: number }} options
 */
export function createStudTexture({
  base,
  alt = base,
  studsPerCell = 2,
  cellsPerTile = 2,
  size = 512,
}) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  const cellPx = size / cellsPerTile
  const studPx = cellPx / studsPerCell

  for (let cy = 0; cy < cellsPerTile; cy += 1) {
    for (let cx = 0; cx < cellsPerTile; cx += 1) {
      const color = (cx + cy) % 2 === 0 ? base : alt
      ctx.fillStyle = color
      ctx.fillRect(cx * cellPx, cy * cellPx, cellPx, cellPx)

      for (let sy = 0; sy < studsPerCell; sy += 1) {
        for (let sx = 0; sx < studsPerCell; sx += 1) {
          drawStud(
            ctx,
            cx * cellPx + (sx + 0.5) * studPx,
            cy * cellPx + (sy + 0.5) * studPx,
            studPx,
            color,
          )
        }
      }

      // Faint seam between bricks.
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.07)'
      ctx.lineWidth = 2
      ctx.strokeRect(cx * cellPx + 1, cy * cellPx + 1, cellPx - 2, cellPx - 2)
    }
  }

  const texture = new CanvasTexture(canvas)
  // Canvas pixels are sRGB; without this the colours render washed out.
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  // three clamps this to what the GPU supports. Keeps the studs crisp at grazing
  // angles instead of smearing into a blur down the track.
  texture.anisotropy = 16
  return texture
}

/**
 * A box whose UVs are in world units divided by `tileSize`, on every face.
 *
 * Box UVs normally run 0..1 per face, which stretches a tiling texture differently on
 * each side of a long, thin box. World-scaled UVs keep the studs the same size on
 * every surface, whatever the box's dimensions.
 */
export function createWorldBoxGeometry(width, height, depth, tileSize) {
  const geometry = new BoxGeometry(width, height, depth)
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const uv = geometry.getAttribute('uv')

  for (let i = 0; i < position.count; i += 1) {
    // Measured from a corner so the pattern starts on a stud boundary.
    const x = position.getX(i) + width / 2
    const y = position.getY(i) + height / 2
    const z = position.getZ(i) + depth / 2

    let u
    let v
    if (Math.abs(normal.getX(i)) > 0.5) {
      u = z
      v = y
    } else if (Math.abs(normal.getY(i)) > 0.5) {
      u = x
      v = z
    } else {
      u = x
      v = y
    }
    uv.setXY(i, u / tileSize, v / tileSize)
  }

  uv.needsUpdate = true
  return geometry
}

/** A plane with UVs in world units divided by `tileSize`. See createWorldBoxGeometry. */
export function createWorldPlaneGeometry(width, height, tileSize) {
  const geometry = new PlaneGeometry(width, height)
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < uv.count; i += 1) {
    uv.setXY(i, (uv.getX(i) * width) / tileSize, (uv.getY(i) * height) / tileSize)
  }
  uv.needsUpdate = true
  return geometry
}
