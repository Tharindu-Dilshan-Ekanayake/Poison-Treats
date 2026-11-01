import DATA from '../../../shared/gameData.json'

/**
 * World layout derived from shared/gameData.json, which the server also reads, so
 * table positions and seat checks can never disagree between the two.
 */

export { DATA }
export const TABLE = DATA.table
export const WORLD_HALF = DATA.world.half
export const SPAWN = DATA.world.spawn

export const PLAYER_HEIGHT = 1.8
/** How far a seated avatar's hips drop and slide back onto the chair. */
export const SEATED_DROP = -0.36
export const SEATED_BACK = 0.12
/**
 * Where a match's winner dances: up on the tabletop, this far in front of their
 * seat (towards the table's middle).
 */
export const DANCE_FORWARD = 0.85

/**
 * The two seats face each other across the table: seat 0 on its -Z side looking
 * +Z (yaw 0), seat 1 on its +Z side looking -Z (yaw PI). `ry` is the avatar's yaw.
 */
export function seatPosition(tableId, index) {
  const t = DATA.tables.find((x) => x.id === tableId)
  if (!t) return null
  return {
    x: t.x,
    z: t.z + (index === 0 ? -TABLE.seatZ : TABLE.seatZ),
    ry: index === 0 ? 0 : Math.PI,
  }
}

/* ---- Treats ------------------------------------------------------------------- */

export const CANDY = DATA.candies
export const CANDY_COUNT = CANDY.cols * CANDY.rows
export const CANDY_RADIUS = 0.135
export const CANDY_HEIGHT = 0.1
/** Height of a treat's base: resting on the tablecloth. */
export const CANDY_Y = TABLE.height + 0.012

/** A treat's offset from its table's centre: columns along X, rows along Z. */
export function candyOffset(i) {
  const col = i % CANDY.cols
  const row = Math.floor(i / CANDY.cols)
  return [(col - (CANDY.cols - 1) / 2) * CANDY.spacingX, (row - (CANDY.rows - 1) / 2) * CANDY.spacingZ]
}

/** The treat under a point on the tabletop (table-relative), or -1. */
export function candyAt(dx, dz) {
  const col = Math.round(dx / CANDY.spacingX + (CANDY.cols - 1) / 2)
  const row = Math.round(dz / CANDY.spacingZ + (CANDY.rows - 1) / 2)
  if (col < 0 || col >= CANDY.cols || row < 0 || row >= CANDY.rows) return -1
  const i = row * CANDY.cols + col
  const [cx, cz] = candyOffset(i)
  return Math.hypot(dx - cx, dz - cz) <= CANDY_RADIUS * 1.35 ? i : -1
}

/** The giant spinning treat in the middle of the ring of tables. */
export const CENTERPIECE = DATA.ring

export const SHOP_CHAIRS = DATA.chairs.filter((c) => c.shop)

/** Chair shop row: display pedestals along the east side of the plaza. */
export const CHAIR_SHOP = { x: 26.5, zMin: -13, zMax: 13 }
/** The shop's two rows of pedestals (see gameData chairs[].shop). */
export const CHAIR_ROWS = [24.6, 28.4]

export const EMOTE_SHOP = DATA.emoteShop

/** Voxel trees, only around the edge of the island so the play area stays clear. */
export const TREES = [
  [-27.5, -27.5], [-17, -28], [17, -28], [27.5, -27.5],
  [-27.5, 27.5], [-15, 28], [15, 28], [27.5, 27.5],
]

/**
 * Paving as [x, z, width, depth] rectangles: the round plaza the ring of tables
 * stands on, the walk up from spawn, the floors of the two shops and the strip
 * in front of the leaderboards.
 */
export const PATHS = [
  [0, -1.5, 34, 32],
  [0, 19, 5, 14],
  [26.5, 0, 8.6, 26],
  [-26.5, 1, 6, 10],
  [0, -20, 46, 4],
]

/** A rug under each table and its two chairs: [x, z, width, depth]. */
export const RUGS = DATA.tables.map((t) => [t.x, t.z, TABLE.width + 1.4, TABLE.depth + 3.6])

/**
 * The welcome arch over the spawn path: pillars at ±ARCH.halfWidth. Tall enough
 * that the follow camera (~5 units up by default) passes under the beam.
 */
export const ARCH = { z: 17.5, halfWidth: 3.4, height: 6 }

/** Rocks along the beach, just outside the fence: [x, z, size]. */
export const ROCKS = [
  [-33.5, -20, 1.6], [-33, 6, 1.1], [-34, 25, 1.9], [-12, 33.5, 1.3], [9, 34, 1.8],
  [33.5, 22, 1.2], [33, -4, 1.7], [34, -24, 1.1], [14, -33.5, 1.5], [-6, -34, 1.2],
  [-25, -33.5, 1.8], [26, 33.5, 1.4],
]

/** Distant islands out in the ocean: [x, z, width, depth]. */
export const ISLANDS = [
  [-110, -150, 60, 34],
  [130, -170, 46, 30],
  [-170, 60, 40, 50],
  [160, 90, 34, 40],
  [20, 190, 70, 26],
]

/**
 * Axis-aligned boxes the player can't walk through, in XZ.
 * @type {{ minX: number, maxX: number, minZ: number, maxZ: number }[]}
 */
export const COLLIDERS = []

const box = (x, z, w, d) =>
  COLLIDERS.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 })

for (const t of DATA.tables) box(t.x, t.z, TABLE.width, TABLE.depth)
box(CENTERPIECE.x, CENTERPIECE.z, 3.2, 3.2)
for (const lb of DATA.leaderboards) box(lb.x, lb.z, 6, 0.6)
for (const c of SHOP_CHAIRS) box(c.shop[0], c.shop[1], 2, 2)
box(EMOTE_SHOP.x, EMOTE_SHOP.z, 1.6, 5)
for (const [x, z] of TREES) box(x, z, 1, 1)
for (const side of [-1, 1]) box(side * ARCH.halfWidth, ARCH.z, 1.5, 1.5)

/** What the player can interact with by walking up to it and pressing E. */
export const INTERACTABLES = [
  ...DATA.tables.map((t) => ({ kind: 'table', id: t.id, x: t.x, z: t.z, range: TABLE.sitRange })),
  ...SHOP_CHAIRS.map((c) => ({ kind: 'chair', id: c.id, x: c.shop[0] - 1.6, z: c.shop[1], range: 2.6 })),
  { kind: 'emoteShop', id: 'emotes', x: EMOTE_SHOP.x + 1.6, z: EMOTE_SHOP.z, range: 3.5 },
]

export const RARITY_COLORS = {
  common: '#9aa3ad',
  uncommon: '#2fd14f',
  rare: '#3aa0ff',
  epic: '#ff7a1f',
  legendary: '#c04dff',
  mythic: '#ff3dc8',
}

/** How strong a chair's aura is per rarity (scales its size, glow and sparkles). */
export const RARITY_AURA = {
  common: 0.75,
  uncommon: 0.9,
  rare: 1.05,
  epic: 1.2,
  legendary: 1.4,
  mythic: 1.6,
}

export const titleById = (id) => DATA.titles.find((t) => t.id === id) || null

export const haloById = (id) => DATA.halos.find((h) => h.id === id) || null

export const chairById = (id) => DATA.chairs.find((c) => c.id === id) || DATA.chairs[0]
export const emoteById = (id) => DATA.emotes.find((e) => e.id === id)
