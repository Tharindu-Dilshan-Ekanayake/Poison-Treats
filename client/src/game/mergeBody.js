import { BufferAttribute, MeshLambertMaterial, SkinnedMesh } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** Attributes a skinned body part needs; anything else (tangents, uv2...) is dropped. */
const KEEP = ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']

/** A copy of `geometry` with only KEEP attributes, in consistent array types. */
function normalise(geometry, indexed) {
  let g = geometry
  if (!indexed && g.index) g = g.toNonIndexed()
  const out = g === geometry ? geometry.clone() : g
  for (const name of Object.keys(out.attributes)) if (!KEEP.includes(name)) out.deleteAttribute(name)
  for (const name of KEEP) if (!out.getAttribute(name)) return null
  // mergeGeometries needs the same typed-array type across parts.
  const si = out.getAttribute('skinIndex')
  if (!(si.array instanceof Uint16Array)) out.setAttribute('skinIndex', new BufferAttribute(Uint16Array.from(si.array), 4))
  const sw = out.getAttribute('skinWeight')
  if (!(sw.array instanceof Float32Array)) {
    const f = new Float32Array(sw.count * 4)
    for (let i = 0; i < sw.count; i += 1) {
      f[i * 4] = sw.getX(i)
      f[i * 4 + 1] = sw.getY(i)
      f[i * 4 + 2] = sw.getZ(i)
      f[i * 4 + 3] = sw.getW(i)
    }
    out.setAttribute('skinWeight', new BufferAttribute(f, 4))
  }
  for (const name of ['position', 'normal', 'uv']) {
    const a = out.getAttribute(name)
    if (!(a.array instanceof Float32Array) || a.normalized) {
      const f = new Float32Array(a.count * a.itemSize)
      for (let i = 0; i < a.count; i += 1) for (let k = 0; k < a.itemSize; k += 1) f[i * a.itemSize + k] = a.getComponent(i, k)
      out.setAttribute(name, new BufferAttribute(f, a.itemSize))
    }
  }
  out.morphAttributes = {}
  out.clearGroups()
  return out
}

/**
 * glTF gives every skinned mesh its own Skeleton object even when they drive the
 * same bones; they are interchangeable when the bones (and their order, which the
 * skinIndex attribute refers to) and the bind inverses match.
 */
function sameSkeleton(a, b) {
  if (a === b) return true
  if (!a || !b || a.bones.length !== b.bones.length) return false
  for (let i = 0; i < a.bones.length; i += 1) {
    if (a.bones[i] !== b.bones[i] || !a.boneInverses[i].equals(b.boneInverses[i])) return false
  }
  return true
}

/**
 * Merges an assembled avatar's body-part meshes (head, torso, arms, legs: six
 * SkinnedMeshes on one skeleton with one skin texture) into a single SkinnedMesh:
 * one draw call per avatar instead of six. The parts stay in the scene, hidden, so
 * a later rebuild can restore them.
 *
 * Only merges when it is exact: same bones, same bind matrix, same local
 * transform and same texture on every part. Otherwise returns null and the
 * separate meshes keep drawing.
 *
 * @returns {import('three').SkinnedMesh | null}
 */
export function mergeBody(meshes, { castShadow = true } = {}) {
  if (meshes.length < 2) return null
  const first = meshes[0]
  const parent = first.parent
  const map = first.material?.map ?? null
  for (const m of meshes) {
    if (
      m.parent !== parent ||
      !sameSkeleton(m.skeleton, first.skeleton) ||
      !m.bindMatrix.equals(first.bindMatrix) ||
      !m.matrix.equals(first.matrix) ||
      (m.material?.map ?? null) !== map
    ) {
      return null
    }
  }

  const indexed = meshes.every((m) => m.geometry.index)
  const parts = meshes.map((m) => normalise(m.geometry, indexed))
  if (parts.some((g) => !g)) return null
  const geometry = mergeGeometries(parts)
  for (const g of parts) g.dispose()
  if (!geometry) return null

  const merged = new SkinnedMesh(geometry, new MeshLambertMaterial({ color: 0xffffff, map }))
  merged.name = 'mergedBody'
  merged.position.copy(first.position)
  merged.quaternion.copy(first.quaternion)
  merged.scale.copy(first.scale)
  merged.castShadow = castShadow
  merged.receiveShadow = castShadow
  merged.bind(first.skeleton, first.bindMatrix)
  parent.add(merged)
  for (const m of meshes) m.visible = false
  return merged
}

/** Undoes mergeBody: removes the merged mesh and shows the parts again. */
export function unmergeBody(merged, meshes) {
  if (!merged) return
  merged.parent?.remove(merged)
  merged.geometry.dispose()
  merged.material.dispose()
  for (const m of meshes) m.visible = true
}
