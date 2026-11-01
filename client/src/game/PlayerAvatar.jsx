import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { Box3, MeshLambertMaterial, Vector3 } from 'three'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'

import {
  assetUrls,
  baseBodyUrl,
  isRealId,
  ITEM_SLOTS,
  PART_SLOTS,
  skinCompositeUrl,
  skinIdOrDefault,
} from '../bloxity/avatarAssets'
import { loadOBJ, loadPartGLB, loadTexture } from '../bloxity/avatarLoader'
import { useBloxity } from '../bloxity/BloxityContext'
import { platform } from '../bloxity/platform'
import { DEFAULT_PROPORTIONS } from '../bloxity/store'
import {
  animateRig,
  applyEmote,
  applyPart,
  applyProportions,
  applySkin,
  attachItem,
  collectRestInverses,
  collectRig,
  updateFollowers,
} from './avatarRig'
import { mergeBody, unmergeBody } from './mergeBody'

/**
 * Keeps the avatar breathing when it is rendered outside the game (a menu preview,
 * say) with no physics body feeding it motion.
 */
const _idleMotion = { time: 0, speed: 0, grounded: true, maxSpeed: 6 }
function fallbackMotion(delta) {
  _idleMotion.time += delta
  return _idleMotion
}

/** True only if the object and every ancestor are visible, i.e. it will be drawn. */
function isShown(object) {
  for (let o = object; o; o = o.parent) if (!o.visible) return false
  return true
}

/** Head and torso bones whose items a custom character fits with characterAccessoryMatrix. */
const FITTED_BONES = new Set(['Neck1', 'Spine1', 'Spine2'])

/**
 * The player's uploaded custom character, if they wear one: the SDK's character
 * data plus its loaded GLB scene, or null for the regular avatar (also on a failed
 * download, which falls back to the regular avatar).
 */
function useCustomCharacter(equipped) {
  const characterId = equipped?.characterId
  const [loaded, setLoaded] = useState(null)

  useEffect(() => {
    if (!isRealId(characterId)) return undefined
    let cancelled = false
    platform
      .characterFor(equipped)
      .then((data) => (data?.glbUrl ? loadPartGLB(data.glbUrl).then((scene) => scene && { data, scene }) : null))
      .then((result) => {
        if (!cancelled) setLoaded(result || null)
      })
      .catch(() => {
        if (!cancelled) setLoaded(null)
      })
    return () => {
      cancelled = true
    }
    // Only a different character id needs a rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId])

  return isRealId(characterId) && loaded?.data?.id === characterId ? loaded : null
}

/**
 * A Bloxity avatar, assembled at runtime: the player's own by default, or anyone's
 * when `equipped` / `proportions` are passed (remote players).
 *
 * `player.glb` is the base humanoid rig: six skinned meshes (head, torso, two arms,
 * two legs) sharing one skeleton. Assembly means, per equipped slot:
 *   - body parts   -> swap the matching mesh's geometry
 *   - worn items   -> hat, hair, mask, back, neck, chest, waist, hands, shoes
 *                     (see ITEM_SLOTS and attachItem)
 *   - skin         -> one texture (face, shirt and pants drawn on) on every mesh
 *
 * A custom character (equipped.characterId) replaces player.glb entirely: same
 * bones, so every animation plays on it, but no skin, body parts or proportions.
 *
 * Any slot that is unequipped or 404s leaves the base body's own part in place. The
 * whole thing re-assembles when `onAvatarChanged` / `onProportionsChanged` fire, so
 * changing cosmetics in the Bloxity portal updates the character live.
 *
 * @param {{ onReady?: () => void, targetHeight?: number, equipped?: object|null,
 *           proportions?: object, silent?: boolean, castShadow?: boolean }} props
 *   `silent` keeps a remote avatar out of the Bloxity loading screen.
 *   `targetHeight` is the world-space height to fit the avatar into, in the game's
 *   own units. Bloxity authors the rig ~6.4 units tall with the feet at y=0, which is
 *   far bigger than a metric-scale physics capsule, so the model is measured and
 *   rescaled rather than trusted at native size.
 *   `motionRef.current.emote` ({ clip, start }) plays a Bloxity emote; it gets
 *   `done: true` when a non-looping clip finishes.
 */
export const PlayerAvatar = forwardRef(function PlayerAvatar(
  {
    onReady,
    targetHeight = 1.8,
    motionRef,
    equipped: equippedProp,
    proportions: proportionsProp,
    silent = false,
    castShadow = true,
    ...props
  },
  ref,
) {
  const bloxity = useBloxity()
  const equipped = equippedProp !== undefined ? equippedProp : bloxity.avatar
  const proportions = proportionsProp || bloxity.proportions
  const game = bloxity.game
  const rootRef = useRef(null)
  const { scene: baseScene } = useGLTF(baseBodyUrl())
  const custom = useCustomCharacter(equipped)
  const [assembled, setAssembled] = useState(false)

  // player.glb's rest pose: hands and shoes keep this placement on custom characters.
  const baseRest = useMemo(() => collectRestInverses(baseScene), [baseScene])

  // The GLTF cache hands back one shared scene. Clone via SkeletonUtils so this
  // instance gets an independent, still-working skeleton.
  const character = useMemo(() => cloneSkeleton(custom?.scene || baseScene), [custom, baseScene])

  // Rig lookup tables (bones, part meshes, pristine geometries) built once per clone.
  const rig = useMemo(() => {
    const collected = collectRig(character)

    // The base body ships with an empty texture; give every skinned mesh its own
    // material instance so a skin swap here can't leak into another avatar.
    if (!custom) {
      for (const mesh of collected.skinnedMeshes) {
        mesh.material = new MeshLambertMaterial({ color: 0xffffff })
      }
    }
    for (const mesh of collected.skinnedMeshes) {
      mesh.castShadow = castShadow
      mesh.receiveShadow = castShadow
    }

    if (!collected.skeleton) {
      console.warn('[bloxity] avatar model has no skeleton - avatar will not deform')
    }
    return collected
  }, [character, custom, castShadow])

  // Per-instance materials and geometry copies are this avatar's own; textures and
  // part GLBs are shared through the loader cache and stay alive.
  useEffect(
    () => () => {
      if (!custom) for (const mesh of rig.skinnedMeshes) mesh.material?.dispose()
      for (const geometry of Object.values(rig.originalGeometries)) geometry.dispose()
    },
    [rig, custom],
  )

  // Measured once from player.glb's bind pose; custom characters share its scale
  // (both are 6.4-unit rigs with the feet at y=0).
  const fit = useMemo(() => {
    const box = new Box3().setFromObject(baseScene)
    const size = box.getSize(new Vector3())
    if (!Number.isFinite(size.y) || size.y <= 0) return { scale: 1, footOffset: 0 }
    const scale = targetHeight / size.y
    // The rig's feet sit at its bbox minimum; drop the group so they land on y=0
    // of the parent (which Player positions at the bottom of the capsule).
    return { scale, footOffset: -box.min.y * scale }
  }, [baseScene, targetHeight])

  /** Hand and shoe items, moved onto their bones every frame. */
  const followers = useRef([])

  // --- Assemble equipped cosmetics --------------------------------------------
  useEffect(() => {
    let cancelled = false
    // Items are re-attached on every rebuild; track them so the previous ones can
    // be removed rather than stacking up.
    const attached = []
    let merged = null
    followers.current = []

    if (!silent) game.loadingStep('Loading avatar…')

    const jobs = []

    if (custom) {
      // The character's own texture; never the skin, face, shirt or pants.
      if (custom.data.textureUrl) {
        jobs.push(loadTexture(custom.data.textureUrl).then((texture) => ({ kind: 'charTexture', texture })))
      }
    } else {
      // Skin always loads - "0" is the fallback, since the base body has no baked
      // map. With a face, shirt or pants worn it's the server-composited version; if
      // that can't be fetched, the bare skin is better than an untextured body.
      const compositeUrl = skinCompositeUrl(equipped)
      const plainSkinUrl = assetUrls.skinTexture(skinIdOrDefault(equipped?.skinId))
      jobs.push(
        (compositeUrl ? loadTexture(compositeUrl) : Promise.resolve(null))
          .then((texture) => texture || loadTexture(plainSkinUrl))
          .then((texture) => ({ kind: 'skin', texture })),
      )

      // Body parts: fetch only real ids; a missing slot resets to the base geometry.
      for (const [slot, cfg] of Object.entries(PART_SLOTS)) {
        const id = equipped?.[cfg.idKey]
        if (!isRealId(id)) {
          jobs.push(Promise.resolve({ kind: 'part', slot, scene: null }))
          continue
        }
        jobs.push(loadPartGLB(assetUrls.part(slot, id)).then((scene) => ({ kind: 'part', slot, scene })))
      }
    }

    // Worn items: only slots with a real equipped id are fetched.
    for (const slot of ITEM_SLOTS) {
      const id = equipped?.[slot.idKey]
      if (!isRealId(id)) continue
      jobs.push(
        Promise.all([loadOBJ(assetUrls.itemMesh(slot.dir, id)), loadTexture(assetUrls.itemTexture(slot.dir, id))]).then(
          ([object, texture]) => ({ kind: 'item', slot, object, texture }),
        ),
      )
    }

    Promise.all(jobs)
      .then((results) => {
        if (cancelled) return

        for (const result of results) {
          // One bad slot must not take the rest of the character down.
          try {
            if (result.kind === 'skin') {
              applySkin(rig, result.texture)
            } else if (result.kind === 'charTexture') {
              if (result.texture) {
                for (const mesh of rig.skinnedMeshes) {
                  if (mesh.material && !mesh.material.map) {
                    mesh.material.map = result.texture
                    mesh.material.needsUpdate = true
                  }
                }
              }
            } else if (result.kind === 'part') {
              applyPart(rig, result.slot, result.scene)
            } else if (result.kind === 'item' && result.object) {
              if (result.texture) {
                result.object.traverse((child) => {
                  if (child.isMesh) child.material = new MeshLambertMaterial({ map: result.texture })
                })
              }
              const { slot } = result
              const accessoryMatrix =
                custom && FITTED_BONES.has(slot.bone)
                  ? platform.characterAccessoryMatrix(custom.data, slot.bone)
                  : null
              const { objects, followers: moving } = attachItem(rig, slot, result.object, {
                character: custom?.data ?? null,
                accessoryMatrix,
                baseRest,
              })
              for (const object of objects) {
                if (!castShadow) object.traverse((child) => (child.castShadow = false))
                attached.push(object)
              }
              followers.current.push(...moving)
            }
          } catch (err) {
            console.warn(`[bloxity] failed to apply ${result.kind}`, err)
          }
        }

        // One draw call for the whole body instead of six (custom characters keep
        // their own meshes and materials).
        if (!custom) {
          try {
            merged = mergeBody(rig.skinnedMeshes, { castShadow })
            if (!merged && import.meta.env.DEV) console.info('[avatar] body parts not mergeable; drawing separately')
          } catch (err) {
            console.warn('[avatar] body merge failed; drawing parts separately', err)
          }
        }

        setAssembled(true)
      })
      .catch((err) => {
        console.warn('[bloxity] avatar assembly failed; showing base body', err)
        if (!cancelled) setAssembled(true)
      })

    return () => {
      cancelled = true
      unmergeBody(merged, rig.skinnedMeshes)
      followers.current = []
      for (const object of attached) {
        object.parent?.remove(object)
        object.traverse((child) => {
          child.geometry?.dispose()
          child.material?.dispose?.()
        })
      }
    }
  }, [rig, custom, baseRest, equipped, game, silent, castShadow])

  // --- Proportions -------------------------------------------------------------
  // Applied per frame rather than in an effect: every bone is reset to its rest pose
  // and re-scaled each pass, which keeps it idempotent and survives anything else
  // that touches the skeleton. Custom characters take no proportions.
  const proportionsRef = useRef(proportions)
  useEffect(() => {
    proportionsRef.current = custom ? DEFAULT_PROPORTIONS : proportions
  }, [custom, proportions])

  useFrame((_state, delta) => {
    // Culled or LOD-swapped avatars skip their bone work entirely.
    if (!isShown(rootRef.current)) return
    try {
      const motion = motionRef?.current ?? fallbackMotion(delta)
      // Order matters: proportions reset every bone to its rest pose, the animation
      // rotates on top of that clean base, and an emote blends over both.
      applyProportions(rig, proportionsRef.current)
      animateRig(rig, motion)
      if (motion.emote && !motion.emote.done && !applyEmote(rig, motion.emote, performance.now() / 1000)) {
        motion.emote.done = true
      }
      updateFollowers(rig, followers.current)
    } catch {
      // A malformed payload must not kill the render loop.
    }
  })

  // Signal readiness only once the model is actually standing there.
  useEffect(() => {
    if (assembled) onReady?.()
  }, [assembled, onReady])

  return (
    <group ref={ref} {...props}>
      {/* Fit scale lives on this wrapper, not on `character` - applyProportions
          overwrites the character's own scale every frame. */}
      <group ref={rootRef} scale={fit.scale} position={[0, fit.footOffset, 0]}>
        <primitive object={character} />
      </group>
    </group>
  )
})

useGLTF.preload(baseBodyUrl())

export default PlayerAvatar
