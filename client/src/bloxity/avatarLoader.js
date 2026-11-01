import { TextureLoader } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'

import { configureAvatarTexture } from '../game/avatarRig'

/**
 * Imperative loaders for the equipped-cosmetic assets.
 *
 * Why not drei's `useGLTF` / `useLoader` for these: the set of equipped slots is
 * dynamic (0-8 parts, changing at runtime via `onAvatarChanged`), and React hooks
 * cannot be called conditionally or in a variable-length loop. The base `player.glb`
 * is a fixed URL and *is* loaded with `useGLTF` in PlayerAvatar; everything dynamic
 * goes through here.
 *
 * Every loader resolves to `null` instead of throwing on failure - a 404 on an
 * unequipped or delisted asset must degrade to the base mesh, never break the scene.
 */

const gltfLoader = new GLTFLoader()
const objLoader = new OBJLoader()
const textureLoader = new TextureLoader()

/** url -> Promise<result|null>. Keeps a re-equip from re-downloading known parts. */
const cache = new Map()

function cached(url, produce) {
  if (!cache.has(url)) {
    cache.set(
      url,
      produce().catch((err) => {
        console.warn(`[bloxity] avatar asset unavailable, using base mesh: ${url}`, err)
        return null
      }),
    )
  }
  return cache.get(url)
}

/**
 * Loads a part GLB.
 * Not cloned: `applyPart` only reads geometry off it and clones that itself.
 * @returns {Promise<import('three').Object3D|null>}
 */
export function loadPartGLB(url) {
  return cached(url, () => gltfLoader.loadAsync(url).then((gltf) => gltf.scene))
}

/**
 * Loads an accessory OBJ. Cloned per call, since the result is added to the scene
 * graph and would otherwise be reparented away from any other user of it.
 * @returns {Promise<import('three').Object3D|null>}
 */
export function loadOBJ(url) {
  return cached(url, () => objLoader.loadAsync(url)).then((obj) =>
    obj ? obj.clone(true) : null,
  )
}

/** @returns {Promise<import('three').Texture|null>} */
export function loadTexture(url) {
  return cached(url, () =>
    textureLoader.loadAsync(url).then((tex) => configureAvatarTexture(tex)),
  )
}

/** Clears the module cache. Only useful for tests / a forced refresh. */
export function clearAvatarCache() {
  cache.clear()
}
