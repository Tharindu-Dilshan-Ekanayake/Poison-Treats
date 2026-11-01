import { BoxGeometry, Color, Object3D } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const _obj = new Object3D()
const _color = new Color()

/**
 * @typedef {{ p: [number, number, number], ry?: number,
 *             s?: [number, number, number], c?: string }} InstanceDef
 */

/** Writes position / yaw / scale / colour for every instance of `mesh`. */
export function writeInstances(mesh, items) {
  if (!mesh) return
  items.forEach((it, i) => {
    _obj.position.set(it.p[0], it.p[1], it.p[2])
    _obj.rotation.set(0, it.ry || 0, 0)
    if (it.s) _obj.scale.set(it.s[0], it.s[1], it.s[2])
    else _obj.scale.set(1, 1, 1)
    _obj.updateMatrix()
    mesh.setMatrixAt(i, _obj.matrix)
    if (it.c) mesh.setColorAt(i, _color.set(it.c))
  })
  mesh.count = items.length
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.computeBoundingSphere()
}

export function setInstanceColor(mesh, i, hex) {
  mesh.setColorAt(i, _color.set(hex))
  mesh.instanceColor.needsUpdate = true
}

/**
 * Merges several boxes into one geometry, so a multi-part prop (a chair, a table's
 * legs) is a single instanced draw call.
 * @param {Array<{ size: [number, number, number], at: [number, number, number] }>} parts
 */
export function mergedBoxes(parts) {
  const boxes = parts.map(({ size, at }) => new BoxGeometry(...size).translate(...at))
  const merged = mergeGeometries(boxes)
  for (const b of boxes) b.dispose()
  return merged
}
