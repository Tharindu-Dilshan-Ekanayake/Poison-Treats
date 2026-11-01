import { Object3D } from 'three'

const baseUpdate = Object3D.prototype.updateMatrixWorld

/**
 * three.js walks every child in updateMatrixWorld even when it is hidden, so a
 * hidden avatar (a far-away player drawn as a crowd stand-in) still pays for its
 * ~30 bones and meshes every frame. This makes `object` skip its whole subtree
 * while hidden, and recompute it in full the frame it is shown again.
 */
export function skipWhenHidden(object) {
  if (!object || object.__skipsWhenHidden) return
  object.__skipsWhenHidden = true
  let wasHidden = false
  object.updateMatrixWorld = function updateMatrixWorld(force) {
    if (!this.visible) {
      wasHidden = true
      return
    }
    if (wasHidden) {
      wasHidden = false
      force = true
    }
    baseUpdate.call(this, force)
  }
}
