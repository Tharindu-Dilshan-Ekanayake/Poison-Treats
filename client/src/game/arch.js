import { ARCH } from './layout'

/**
 * The welcome gate's dimensions and boxes. The boxes join the world's shared
 * scenery instanced mesh (no draw calls of their own); ArchGate.jsx draws the sign.
 */

const H = ARCH.height
export const X = ARCH.halfWidth
export const Z = ARCH.z

export const BLUE = '#2f5bd8'
const BLUE_DARK = '#1f3f9e'
export const GOLD = '#ffc93d'
const STONE = '#a7aeb8'
const WOOD = '#5b3520'

/** Sign board size (world units) and where it hangs. */
export const BOARD_W = 6.8
export const BOARD_H = 1.55
export const BOARD_Y = H + 0.42
/** Pillar plaques. */
export const PLAQUE = 0.78
export const PLAQUE_Y = 3.9

/** Atlas: the board fills the top of the canvas, the two plaques sit below it. */
export const ATLAS_W = 512
export const BOARD_PX = Math.round((ATLAS_W * BOARD_H) / BOARD_W)
export const PLAQUE_PX = 112
export const ATLAS_H = 256

/** Bulb blink rate. */
export const CHASE_S = 0.42

/** Every box of the gate, for the scenery instanced mesh. */
export function archBoxes() {
  const boxes = []
  const add = (p, s, c, ry = 0) => boxes.push({ p, s, c, ry })

  for (const side of [-1, 1]) {
    const x = side * X
    // Stepped stone base.
    add([x, 0.22, Z], [1.5, 0.44, 1.5], STONE)
    add([x, 0.55, Z], [1.22, 0.22, 1.22], GOLD)
    // Shaft, with darker corner strips for depth and gold bands.
    const shaftTop = H - 0.25
    const shaftH = shaftTop - 0.66
    add([x, 0.66 + shaftH / 2, Z], [0.92, shaftH, 0.92], BLUE)
    for (const cx of [-1, 1]) {
      for (const cz of [-1, 1]) {
        add([x + cx * 0.42, 0.66 + shaftH / 2, Z + cz * 0.42], [0.14, shaftH, 0.14], BLUE_DARK)
      }
    }
    for (const y of [1.7, 2.9, 5.0]) add([x, y, Z], [1.04, 0.16, 1.04], GOLD)
    // Turret above the beam: gold block, a pink jewel, a flagpole and a pennant.
    add([x, H + 1.45, Z], [1.25, 0.42, 1.25], GOLD)
    add([x, H + 1.78, Z], [0.95, 0.24, 0.95], BLUE)
    add([x, H + 2.12, Z], [0.5, 0.5, 0.5], '#ff4fd8', Math.PI / 4)
    add([x, H + 2.85, Z], [0.07, 1.25, 0.07], '#f4f4f4')
    add([x + side * 0.32, H + 3.22, Z], [0.58, 0.36, 0.05], side < 0 ? '#ff4040' : '#33c8ff')
  }

  // Beam behind the sign, with a gold lip top and bottom.
  add([0, BOARD_Y, Z - 0.05], [2 * X + 1.4, BOARD_H + 0.35, 0.5], WOOD)
  add([0, BOARD_Y + BOARD_H / 2 + 0.2, Z], [2 * X + 1.6, 0.16, 0.62], GOLD)
  add([0, BOARD_Y - BOARD_H / 2 - 0.2, Z], [2 * X + 1.6, 0.16, 0.62], GOLD)
  // Stepped crown in the middle, topped with a star-ish jewel.
  add([0, BOARD_Y + BOARD_H / 2 + 0.48, Z - 0.05], [2.6, 0.4, 0.45], BLUE)
  add([0, BOARD_Y + BOARD_H / 2 + 0.86, Z - 0.05], [1.4, 0.36, 0.45], GOLD)
  add([0, BOARD_Y + BOARD_H / 2 + 1.3, Z - 0.05], [0.52, 0.52, 0.52], '#ffe84d', Math.PI / 4)
  return boxes
}
