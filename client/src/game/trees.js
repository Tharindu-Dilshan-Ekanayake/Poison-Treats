/**
 * Voxel trees, built from boxes for the world's shared scenery mesh (no draw calls
 * of their own). Three kinds, picked per tree, each turned and scaled a little so
 * no two look alike:
 *
 *   oak    - chunky rounded canopy in two greens, a branch, roots and a few apples
 *   pine   - stacked tiers, each turned 45 degrees from the last
 *   cherry - like the oak, in pink blossom
 */

const BARK = '#7a4a26'
const BARK_DARK = '#5e3820'

/** Deterministic 0..1 per tree, so the forest is the same on every load. */
const rand = (i, k) => {
  const v = Math.sin(i * 91.17 + k * 47.31) * 43758.5453
  return v - Math.floor(v)
}

/** Boxes of an oak-style tree: [offset, size, colour, extra yaw]. */
function roundTree(leaves, accent) {
  const [base, shade, light] = leaves
  const parts = [
    // Trunk, roots and one branch.
    [[0, 1.3, 0], [0.7, 2.6, 0.7], BARK],
    [[0.45, 0.15, 0], [0.4, 0.3, 0.4], BARK_DARK],
    [[-0.45, 0.15, 0.1], [0.4, 0.3, 0.4], BARK_DARK],
    [[0, 0.15, 0.45], [0.4, 0.3, 0.4], BARK_DARK],
    [[0.65, 2.3, 0], [0.9, 0.26, 0.26], BARK],
    // Canopy: a core, four side bulges, a top and a crown.
    [[0, 3.7, 0], [3.2, 2.2, 3.2], base],
    [[1.75, 3.5, 0.2], [0.9, 1.5, 2.2], shade],
    [[-1.75, 3.6, -0.2], [0.9, 1.5, 2.2], shade],
    [[0.2, 3.5, 1.75], [2.2, 1.5, 0.9], shade],
    [[-0.2, 3.6, -1.75], [2.2, 1.5, 0.9], shade],
    [[0, 5.0, 0], [2.4, 1.0, 2.4], light],
    [[0.2, 5.7, -0.1], [1.3, 0.6, 1.3], light],
  ]
  if (accent) {
    // Fruit / flowers dotted over the canopy.
    for (const at of [[1.62, 3.9, 1.0], [-1.0, 4.3, 1.62], [0.6, 3.0, -1.62], [-1.62, 3.2, -0.6]]) {
      parts.push([at, [0.3, 0.3, 0.3], accent])
    }
  }
  return parts
}

function pineTree() {
  const parts = [
    [[0, 1.0, 0], [0.55, 2.0, 0.55], BARK_DARK],
    [[0.32, 0.12, 0], [0.32, 0.24, 0.32], BARK_DARK],
    [[-0.3, 0.12, -0.12], [0.32, 0.24, 0.32], BARK_DARK],
  ]
  const tiers = [3.4, 2.8, 2.2, 1.6, 1.05]
  tiers.forEach((w, k) => {
    parts.push([[0, 2.3 + k * 0.95, 0], [w, 1.05, w], k % 2 ? '#2f8f3c' : '#267a33', k % 2 ? Math.PI / 4 : 0])
  })
  parts.push([[0, 7.0, 0], [0.42, 0.6, 0.42], '#38a548'])
  return parts
}

const OAK = () => roundTree(['#3fae3a', '#379a33', '#5fd65a'], '#e8382f')
const CHERRY = () => roundTree(['#ff9ecf', '#f580b9', '#ffc2e0'], '#ffffff')
const KINDS = [OAK, pineTree, OAK, CHERRY, pineTree, OAK, CHERRY, pineTree]

/**
 * Every box of every tree, as instances ({ p, s, c, ry }).
 * @param {Array<[number, number]>} spots tree positions [x, z]
 */
export function treeBoxes(spots) {
  const boxes = []
  spots.forEach(([x, z], i) => {
    const parts = KINDS[i % KINDS.length]()
    const scale = 0.85 + rand(i, 1) * 0.35
    const yaw = rand(i, 2) * Math.PI * 2
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)
    for (const [[ox, oy, oz], [w, h, d], c, ry = 0] of parts) {
      boxes.push({
        p: [x + (ox * cos + oz * sin) * scale, oy * scale, z + (-ox * sin + oz * cos) * scale],
        s: [w * scale, h * scale, d * scale],
        c,
        ry: yaw + ry,
      })
    }
  })
  return boxes
}
