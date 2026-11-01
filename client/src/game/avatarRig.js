import { Euler, Matrix4, NearestFilter, Quaternion, SRGBColorSpace, Vector3 } from 'three'

import { BACK_BONE, HAT_BONE, NECK_OFFSET_BONE, PART_SLOTS } from '../bloxity/avatarAssets'

/**
 * Rig manipulation for the base `player.glb` character.
 *
 * The rig's real structure (confirmed by reading player.glb directly):
 *   character
 *     - default_arm_L / default_arm_R / default_head
 *     - default_leg_L / default_leg_R / default_torso   (6 SkinnedMeshes, 1 skeleton)
 *     - Rig1
 *         - Spine1 > Spine2 > { ArmL_Offset > ArmL1 > ArmL2,
 *                               ArmR_Offset > ArmR1 > ArmR2,
 *                               Neck_Offset > Neck1 }
 *         - LegL_Offset > LegL1 > LegL2, LegR_Offset > LegR1 > LegR2
 *
 * Two consequences drive everything below:
 *  1. Body parts are NOT attached to bones. Each is a separate SkinnedMesh sharing one
 *     skeleton, so equipping a part means swapping that mesh's geometry (remapping
 *     skin indices into the base skeleton's bone order first).
 *  2. Accessories DO attach to bones: hats to `Neck1`, back items to `Spine2`.
 *
 * player.glb ships no animation clips, so the character is posed, not animated.
 */

/**
 * Walks the loaded rig and collects everything later operations need.
 *
 * @param {import('three').Object3D} root
 */
export function collectRig(root) {
  const rig = {
    root,
    skeleton: null,
    /** slot -> SkinnedMesh */
    partMeshes: {},
    /** slot -> the pristine geometry to restore on unequip */
    originalGeometries: {},
    /** bone name -> { bone, origPos, origQuat, origScale } */
    bones: {},
    hatBone: null,
    backBone: null,
    neckOffsetBindY: 0,
    skinnedMeshes: [],
    /** Rest Y of the character root, so the run-cycle bob can return to it. */
    rootRestY: root.position.y,
  }

  const meshBySlot = new Map(
    Object.entries(PART_SLOTS).map(([slot, cfg]) => [cfg.mesh.toLowerCase(), slot]),
  )

  root.traverse((node) => {
    if (node.isSkinnedMesh) {
      node.castShadow = true
      node.receiveShadow = true
      rig.skinnedMeshes.push(node)
      if (!rig.skeleton) rig.skeleton = node.skeleton

      const slot = meshBySlot.get((node.name || '').toLowerCase())
      if (slot) {
        rig.partMeshes[slot] = node
        rig.originalGeometries[slot] = node.geometry.clone()
      }
    } else if (node.isMesh) {
      node.castShadow = true
      node.receiveShadow = true
    }
  })

  const skeleton = rig.skeleton
  if (skeleton) {
    for (const bone of skeleton.bones) {
      // Proportions are re-applied every frame from these rest values.
      bone.matrixAutoUpdate = true
      rig.bones[bone.name] = {
        bone,
        origPos: bone.position.clone(),
        origQuat: bone.quaternion.clone(),
        origScale: bone.scale.clone(),
      }
    }

    // Bone local axes are NOT world-aligned in this rig: a limb bone's local X
    // points along world -Z and its local Z along world -X, so rotating a leg about
    // its local X swings it sideways instead of forward/back. The offsets differ per
    // bone (Spine1 is identity, ArmL2 is off by ~14 degrees), so rather than hardcode
    // an axis, record for each bone the local-space axis matching each character-space
    // axis and animate about those.
    root.updateMatrixWorld(true)
    const rootQuat = new Quaternion()
    root.getWorldQuaternion(rootQuat)
    const rootQuatInv = rootQuat.invert()
    const boneWorld = new Quaternion()

    for (const bone of skeleton.bones) {
      const entry = rig.bones[bone.name]
      if (!entry) continue
      bone.getWorldQuaternion(boneWorld)
      // Bone orientation relative to the character, then inverted: this maps a
      // character-space axis into the bone's own local frame.
      const relInv = rootQuatInv.clone().multiply(boneWorld).invert()
      /** Local axis to rotate about for forward/back swing. */
      entry.axisX = new Vector3(1, 0, 0).applyQuaternion(relInv).normalize()
      /** Local axis to rotate about for lateral sway. */
      entry.axisZ = new Vector3(0, 0, 1).applyQuaternion(relInv).normalize()
      /** Local axis to rotate about for turning (yaw). */
      entry.axisY = new Vector3(0, 1, 0).applyQuaternion(relInv).normalize()
    }

    rig.restInverse = collectRestInverses(root)
    rig.boneNodes = {}
    root.traverse((node) => {
      if (node.isBone) rig.boneNodes[node.name] = node
    })

    rig.hatBone = skeleton.bones.find((b) => b.name === HAT_BONE) || null
    rig.backBone = skeleton.bones.find((b) => b.name === BACK_BONE) || null

    const neckIndex = skeleton.bones.findIndex((b) => b.name === NECK_OFFSET_BONE)
    if (neckIndex >= 0) {
      // elements[13] is the Y translation of the inverted bind matrix.
      rig.neckOffsetBindY = skeleton.boneInverses[neckIndex].clone().invert().elements[13]
    }
  }

  return rig
}

/**
 * Bloxity textures are authored unflipped and pixel-art filtered.
 *
 * They are also sRGB images. A plain TextureLoader leaves them tagged as linear, which
 * makes three skip the sRGB decode and the avatar renders pale and washed out.
 */
export function configureAvatarTexture(texture) {
  if (!texture) return texture
  texture.colorSpace = SRGBColorSpace
  texture.flipY = false
  texture.magFilter = NearestFilter
  texture.minFilter = NearestFilter
  texture.needsUpdate = true
  return texture
}

/**
 * Applies the skin texture to every skinned mesh of the base body.
 * The base body ships with an empty texture, so this always runs - with skin "0"
 * standing in when nothing is equipped.
 */
export function applySkin(rig, texture) {
  if (!texture) return
  for (const mesh of rig.skinnedMeshes) {
    if (!mesh.material) continue
    mesh.material.map = texture
    mesh.material.needsUpdate = true
  }
}

/**
 * Swaps a body part's geometry onto its base skinned mesh.
 *
 * A part GLB carries its own skeleton whose bone *order* may differ from the base
 * rig's. Its `skinIndex` attribute therefore has to be remapped by bone name, or the
 * limb deforms against the wrong bones.
 *
 * @param {object} rig from `collectRig`
 * @param {string} slot key of PART_SLOTS
 * @param {import('three').Object3D|null} partScene loaded GLB scene, or null to reset
 */
export function applyPart(rig, slot, partScene) {
  const targetMesh = rig.partMeshes[slot]
  if (!targetMesh) return

  // Unequipped / failed download: restore the part baked into player.glb.
  if (!partScene) {
    const original = rig.originalGeometries[slot]
    if (original && targetMesh.geometry !== original) targetMesh.geometry = original
    return
  }

  let skinnedSource = null
  let plainSource = null
  partScene.traverse((node) => {
    if (node.isSkinnedMesh && !skinnedSource) skinnedSource = node
    else if (node.isMesh && !plainSource) plainSource = node
  })

  if (!skinnedSource) {
    // Some parts ship as plain meshes; use them as-is.
    if (plainSource) targetMesh.geometry = plainSource.geometry
    return
  }

  const baseSkeleton = rig.skeleton
  if (!baseSkeleton || !skinnedSource.skeleton) {
    targetMesh.geometry = skinnedSource.geometry
    return
  }

  const geometry = skinnedSource.geometry.clone()

  const baseIndexByName = new Map()
  baseSkeleton.bones.forEach((bone, i) => baseIndexByName.set(bone.name, i))

  const remap = new Map()
  skinnedSource.skeleton.bones.forEach((bone, i) => {
    const baseIndex = baseIndexByName.get(bone.name)
    if (baseIndex !== undefined) remap.set(i, baseIndex)
  })

  const skinIndex = geometry.getAttribute('skinIndex')
  if (skinIndex) {
    const array = skinIndex.array
    for (let i = 0; i < array.length; i += 1) {
      const mapped = remap.get(array[i])
      if (mapped !== undefined) array[i] = mapped
    }
    skinIndex.needsUpdate = true
  }

  targetMesh.geometry = geometry
}

/**
 * Each bone's rest transform in model space, inverted:
 * inverse(inverse(model.matrixWorld) * bone.matrixWorld). Captured right after the
 * model loads, before any animation or proportions. Used to place accessories
 * (skeleton.boneInverses can't be: the leaf bones' inverse binds in player.glb are
 * 90 degrees off their rest pose).
 */
export function collectRestInverses(root) {
  root.updateMatrixWorld(true)
  const modelInverse = root.matrixWorld.clone().invert()
  const out = {}
  root.traverse((node) => {
    if (node.isBone) out[node.name] = modelInverse.clone().multiply(node.matrixWorld).invert()
  })
  return out
}

/** Where head / back items sit in player.glb model space (for custom characters). */
const MODEL_PLACEMENT = { head: [0, 5.6, 0], back: [0, 4.2, 0] }

const _t = new Matrix4()
const _s = new Matrix4()

/**
 * Attaches a worn item (see ITEM_SLOTS) to the rig.
 *
 * Regular avatar: head items on Neck1 at (0, 0.8, 0); back items at Spine2's
 * origin; neck/chest/waist under their bone at restInverse * translate(origin).
 * Hands and shoes are a pair (the right one mirrored across x) that follow the
 * bone's position and rotation but not its scale: they come back as followers for
 * updateFollowers() to move every frame.
 *
 * Custom character (`character` from the SDK): head and torso items use
 * Legion.SDK.avatar.characterAccessoryMatrix (passed in as `accessoryMatrix`),
 * falling back to the character rig's anchor scale; hands and shoes keep their
 * player.glb placement (`baseRest`), scaled by the anchor.
 *
 * @returns {{ objects: import('three').Object3D[], followers: object[] }}
 */
export function attachItem(rig, slot, object, { character = null, accessoryMatrix = null, baseRest = null } = {}) {
  const out = { objects: [], followers: [] }
  if (!object) return out

  object.traverse((child) => {
    if (child.isMesh) child.castShadow = true
  })

  const anchorScale = (bone) => {
    const a = character?.rig?.anchors?.[bone]
    if (Array.isArray(a)) return new Matrix4().makeScale(a[0], a[1], a[2])
    const k = Number.isFinite(a) ? a : 1
    return new Matrix4().makeScale(k, k, k)
  }

  if (slot.kind === 'pair') {
    const [left, right] = slot.bones
    const rest = character ? baseRest : rig.restInverse
    const holder = rig.root.parent
    if (!rest?.[left] || !rest?.[right] || !holder) return out
    const mirror = object.clone(true)
    for (const [obj, bone, mirrored] of [
      [object, left, false],
      [mirror, right, true],
    ]) {
      const node = rig.boneNodes[bone]
      if (!node) continue
      const local = new Matrix4().copy(rest[bone])
      if (mirrored) local.multiply(_s.makeScale(-1, 1, 1))
      local.multiply(_t.makeTranslation(...slot.origin))
      if (character) local.premultiply(anchorScale(bone))
      obj.matrixAutoUpdate = false
      holder.add(obj)
      out.objects.push(obj)
      out.followers.push({ object: obj, bone: node, local })
    }
    return out
  }

  const boneName = slot.bone
  const bone = rig.boneNodes[boneName]
  if (!bone) return out

  if (character) {
    const origin = slot.kind === 'body' ? slot.origin : MODEL_PLACEMENT[slot.kind]
    const placement = new Matrix4().makeTranslation(...origin)
    let local
    if (accessoryMatrix) {
      local = new Matrix4().fromArray(accessoryMatrix).multiply(placement)
    } else {
      const standard =
        slot.kind === 'body' && rig.restInverse[boneName]
          ? new Matrix4().copy(rig.restInverse[boneName]).multiply(placement)
          : new Matrix4().makeTranslation(0, slot.kind === 'head' ? 0.8 : 0, 0)
      local = anchorScale(boneName).multiply(standard)
    }
    object.matrixAutoUpdate = false
    object.matrix.copy(local)
  } else if (slot.kind === 'body') {
    const rest = rig.restInverse[boneName]
    if (!rest) return out
    object.matrixAutoUpdate = false
    object.matrix.copy(rest).multiply(_t.makeTranslation(...slot.origin))
  } else {
    object.scale.setScalar(1)
    object.position.set(0, slot.kind === 'head' ? 0.8 : 0, 0)
  }

  bone.add(object)
  out.objects.push(object)
  return out
}

const _holderInverse = new Matrix4()
const _rel = new Matrix4()
const _pos = new Vector3()
const _quat = new Quaternion()
const _scale = new Vector3()
const _unit = new Vector3(1, 1, 1)

/**
 * Moves hand/shoe items onto their bones for this frame: the bone's position and
 * rotation relative to the avatar's holder group, scale 1, times the item's local
 * matrix. Call after the frame's pose is set.
 */
export function updateFollowers(rig, followers) {
  if (followers.length === 0) return
  const holder = rig.root.parent
  holder.updateWorldMatrix(true, false)
  _holderInverse.copy(holder.matrixWorld).invert()
  for (const f of followers) {
    f.bone.updateWorldMatrix(true, false)
    _rel.multiplyMatrices(_holderInverse, f.bone.matrixWorld)
    _rel.decompose(_pos, _quat, _scale)
    f.object.matrix.compose(_pos, _quat, _unit).multiply(f.local)
    f.object.matrixWorldNeedsUpdate = true
  }
}

/* ---- Bloxity emotes ---------------------------------------------------------- */

const DEG = Math.PI / 180
const EMOTE_BLEND_IN_S = 0.1
const _emoteEuler = new Euler()
const _emoteQuat = new Quaternion()
const _emoteTarget = new Quaternion()
const _sample = [0, 0, 0]

/** Samples one bone track ([[t, xDeg, yDeg, zDeg], ...]) into _sample, smoothstepped. */
function sampleTrack(keys, t) {
  const first = keys[0]
  const last = keys[keys.length - 1]
  let a = first
  let b = first
  let s = 0
  if (t >= last[0]) {
    a = last
    b = last
  } else if (t > first[0]) {
    for (let i = 0; i < keys.length - 1; i += 1) {
      if (t >= keys[i][0] && t <= keys[i + 1][0]) {
        a = keys[i]
        b = keys[i + 1]
        s = (t - a[0]) / Math.max(1e-6, b[0] - a[0])
        s = s * s * (3 - 2 * s)
        break
      }
    }
  }
  for (let j = 0; j < 3; j += 1) _sample[j] = a[j + 1] + (b[j + 1] - a[j + 1]) * s
  return _sample
}

/**
 * Plays a Bloxity emote clip on the rig. Values are degree deltas over each bone's
 * bind pose (euler XYZ, right-multiplied onto the bind quaternion); the pose blends
 * in over 0.1 s on top of whatever animateRig produced. Unknown bones are ignored.
 *
 * @param {{ clip: { len: number, loop: boolean, tracks: object }, start: number }} emote
 * @param {number} now seconds, on the same clock as `emote.start`
 * @returns {boolean} false once a non-looping clip has finished
 */
export function applyEmote(rig, emote, now) {
  const { clip } = emote
  let t = now - emote.start
  if (!clip.loop && t > clip.len) return false
  const weight = Math.min(1, t / EMOTE_BLEND_IN_S)
  if (clip.loop && clip.len > 0) t %= clip.len

  emote.tracks ||= Object.entries(clip.tracks)
  for (const [name, keys] of emote.tracks) {
    const entry = rig.bones[name]
    if (!entry || !Array.isArray(keys) || keys.length === 0) continue
    const v = sampleTrack(keys, t)
    _emoteQuat.setFromEuler(_emoteEuler.set(v[0] * DEG, v[1] * DEG, v[2] * DEG, 'XYZ'))
    _emoteTarget.copy(entry.origQuat).multiply(_emoteQuat)
    entry.bone.quaternion.slerp(_emoteTarget, weight)
  }
  return true
}

/**
 * Applies Bloxity body proportions.
 *
 * Must run every frame: each bone is reset to its rest transform before the
 * multipliers are re-applied, which is what makes the result idempotent and lets
 * proportion changes take effect live.
 *
 * `height`, `armLength`, `headScale` and `neckHeight` are applied exactly as the
 * Bloxity portal does, so the in-game body matches the preview. The remaining three
 * (`shoulderWidth`, `torsoScaleX`, `legOffsetX`) are not implemented in the SDK's
 * preview renderer; they are applied here in the spirit of their names and are the
 * ones to sanity-check against the portal.
 */
export function applyProportions(rig, proportions) {
  const skeleton = rig.skeleton
  if (!skeleton || !proportions) return

  const height = proportions.height ?? 1
  const armLength = proportions.armLength ?? 1
  const headScale = proportions.headScale ?? 1
  const neckHeight = proportions.neckHeight ?? 1
  const shoulderWidth = proportions.shoulderWidth ?? 1
  const torsoScaleX = proportions.torsoScaleX ?? 1
  const legOffsetX = proportions.legOffsetX ?? 1

  // Overall height is a scale on the character root, not on a bone.
  rig.root.scale.set(1, height, 1)

  for (const bone of skeleton.bones) {
    const rest = rig.bones[bone.name]
    if (!rest) continue

    const { origScale, origPos, origQuat } = rest
    bone.position.copy(origPos)
    bone.quaternion.copy(origQuat)
    bone.scale.copy(origScale)

    const name = bone.name

    if (name.startsWith('Arm')) {
      bone.scale.y = origScale.y * armLength
      // Not in the SDK preview: widen the shoulders by pushing the arm roots out.
      if (name === 'ArmL_Offset' || name === 'ArmR_Offset') {
        bone.position.x = origPos.x * shoulderWidth
      }
    } else if (name === NECK_OFFSET_BONE) {
      // Keeps the head sitting on the neck as height/headScale change, then applies
      // neckHeight against the bind-pose offset.
      bone.position.y += (height - headScale) * origPos.y
      bone.position.y += rig.neckOffsetBindY * (neckHeight - 1) * 0.8
    } else if (name === HAT_BONE) {
      // Divided by height so the head stays uniform inside the stretched root.
      bone.scale.set(
        origScale.x * headScale,
        origScale.y * (headScale / height),
        origScale.z * headScale,
      )
    } else if (name === BACK_BONE) {
      // Not in the SDK preview: torso width.
      bone.scale.x = origScale.x * torsoScaleX
    } else if (name === 'LegL_Offset' || name === 'LegR_Offset') {
      // Not in the SDK preview: leg splay, mirrored about the rig centre.
      bone.position.x = origPos.x * legOffsetX
    }
  }
}

/* ---------------------------------------------------------------------------
 * Procedural animation
 *
 * player.glb ships zero animation clips, so a walk/run/jump cycle has to be
 * driven directly on the bones. Rotations are *multiplied onto* whatever
 * applyProportions() just wrote, so this must run immediately after it in the
 * same frame - proportions reset each bone to its rest pose, which is exactly
 * the clean base a pose needs.
 * ------------------------------------------------------------------------- */

const _animQ = new Quaternion()

/** Hands-on-hips idle: upper arm out to the side, a little back, elbow folded in. */
const HIP_ARM_OUT = 0.6
const HIP_ARM_BACK = 0.3
const HIP_ELBOW = 1.5

const smoothstep = (x) => {
  const t = Math.min(Math.max(x, 0), 1)
  return t * t * (3 - 2 * t)
}

/**
 * Rotates a bone about one of its precomputed character-space axes.
 * `which` is 'axisX' (forward/back swing) or 'axisZ' (lateral sway).
 */
function rotateBone(rig, name, which, angle) {
  if (!angle) return
  const entry = rig.bones[name]
  const axis = entry?.[which]
  if (!axis) return
  entry.bone.quaternion.multiply(_animQ.setFromAxisAngle(axis, angle))
}

/** Swing a limb forward/back - the plane a walk cycle actually moves in. */
const swing = (rig, name, angle) => rotateBone(rig, name, 'axisX', angle)
/** Sway a limb out to the side. */
const sway = (rig, name, angle) => rotateBone(rig, name, 'axisZ', angle)
/** Turn a bone left/right (yaw), e.g. the head looking around. */
const turn = (rig, name, angle) => rotateBone(rig, name, 'axisY', angle)

/**
 * Poses the rig for the current motion state.
 *
 * @param {object} rig from `collectRig`
 * @param {{ time: number, speed: number, grounded: boolean, maxSpeed: number, seated?: boolean,
 *           dancing?: boolean }} motion
 *   `speed` is horizontal speed in world units/sec; `maxSpeed` is what counts as a
 *   full-amplitude run, so the cycle scales smoothly from a walk to a sprint.
 */
export function animateRig(rig, motion) {
  if (!rig?.skeleton || !motion) return

  const {
    time = 0,
    speed = 0,
    grounded = true,
    maxSpeed = 6,
    seated = false,
    dancing = false,
  } = motion
  const target = Math.min(speed / Math.max(maxSpeed, 0.001), 1)

  // Per-rig clock: the speed eases instead of snapping (remote players' speed arrives
  // in 100 ms steps) and the step phase is accumulated, so a change of pace never
  // jumps the legs to a different point in the stride.
  const dt = Math.min(Math.max(time - (rig.animTime ?? time), 0), 0.1)
  rig.animTime = time
  rig.animRatio = (rig.animRatio ?? target) + (target - (rig.animRatio ?? target)) * (1 - Math.exp(-dt * 9))
  const ratio = rig.animRatio < 0.002 ? 0 : rig.animRatio
  if (ratio === 0) rig.animPhase = 0
  else rig.animPhase = ((rig.animPhase ?? 0) + dt * (5 + ratio * 5)) % (Math.PI * 2)

  rig.root.position.y = rig.rootRestY

  // --- Victory dance: arms waving overhead, knees pumping, hips swaying --------
  if (dancing) {
    const beat = time * 8
    const c = Math.sin(beat)
    swing(rig, 'ArmL1', -2.7 + c * 0.45)
    swing(rig, 'ArmR1', -2.7 - c * 0.45)
    sway(rig, 'ArmL1', -0.35)
    sway(rig, 'ArmR1', 0.35)
    swing(rig, 'ArmL2', -0.4 - Math.max(0, c) * 0.6)
    swing(rig, 'ArmR2', -0.4 - Math.max(0, -c) * 0.6)
    // One knee lifts on each beat.
    swing(rig, 'LegL1', -Math.max(0, c) * 0.7)
    swing(rig, 'LegL2', Math.max(0, c) * 1.1)
    swing(rig, 'LegR1', -Math.max(0, -c) * 0.7)
    swing(rig, 'LegR2', Math.max(0, -c) * 1.1)
    sway(rig, 'Spine1', c * 0.18)
    rig.root.position.y = rig.rootRestY + Math.abs(c) * 0.5
    return
  }

  // --- Seated at a table: thighs forward, shins straight down, hands on the table.
  // Negative swing is forward for a limb hanging down (see rotateBone); the knee
  // undoes the thigh's rotation so the shin hangs vertically again.
  if (seated) {
    swing(rig, 'LegL1', -1.5)
    swing(rig, 'LegR1', -1.5)
    swing(rig, 'LegL2', 1.5)
    swing(rig, 'LegR2', 1.5)
    swing(rig, 'ArmL1', -0.85)
    swing(rig, 'ArmR1', -0.85)
    swing(rig, 'Spine1', Math.sin(time * 1.6) * 0.02)
    return
  }

  // --- Airborne: tuck the legs, throw the arms up ---------------------------
  if (!grounded) {
    swing(rig, 'LegL1', -0.55)
    swing(rig, 'LegL2', 0.75)
    swing(rig, 'LegR1', 0.3)
    swing(rig, 'LegR2', 0.2)
    swing(rig, 'ArmL1', -2.1)
    swing(rig, 'ArmR1', -2.1)
    swing(rig, 'Spine1', -0.1)
    return
  }

  // --- Standing: hands on hips, chest out, feet apart - a proud, confident stance.
  // Faded out (not switched off) as the walk fades in, so starting and stopping blend.
  const still = 1 - smoothstep(ratio / 0.45)
  if (still > 0) {
    const breathe = Math.sin(time * 1.8)
    // Slow weight shift from foot to foot, and an occasional glance around.
    const shift = Math.sin(time * 0.55)
    const look = Math.sin(time * 0.37) * Math.sin(time * 0.23 + 1)

    // Elbows out to the sides and a little back, forearms folded in to the hips.
    // (Positive sway takes the left arm outward, negative the right; positive swing is back.)
    sway(rig, 'ArmL1', (HIP_ARM_OUT + breathe * 0.02) * still)
    sway(rig, 'ArmR1', (-HIP_ARM_OUT - breathe * 0.02) * still)
    swing(rig, 'ArmL1', HIP_ARM_BACK * still)
    swing(rig, 'ArmR1', HIP_ARM_BACK * still)
    sway(rig, 'ArmL2', -HIP_ELBOW * still)
    sway(rig, 'ArmR2', HIP_ELBOW * still)
    // A wide, planted stance (positive sway takes the left leg outward).
    sway(rig, 'LegL1', 0.08 * still)
    sway(rig, 'LegR1', -0.08 * still)
    // Chest out and chin up (negative swing leans an upright bone back); the hips
    // follow the weight shift and the chest rises with each breath.
    sway(rig, 'Spine1', shift * 0.035 * still)
    swing(rig, 'Spine1', (-0.05 + breathe * 0.015) * still)
    swing(rig, 'Neck1', -0.05 * still)
    turn(rig, 'Neck1', look * 0.38 * still)
    sway(rig, 'Neck1', -shift * 0.03 * still)
    rig.root.position.y = rig.rootRestY + breathe * 0.02 * still
    if (ratio === 0) return
  }

  // --- Walk / run cycle -----------------------------------------------------
  // Amplitudes scale with the eased speed, so the stride grows from a stand and
  // settles back to it rather than freezing mid-step.
  const phase = rig.animPhase
  const cycle = Math.sin(phase)
  const legAmp = 0.85 * ratio
  const armAmp = 0.7 * ratio

  // Legs swing in opposition; knees fold on the backswing only.
  swing(rig, 'LegL1', cycle * legAmp)
  swing(rig, 'LegR1', -cycle * legAmp)
  swing(rig, 'LegL2', Math.max(0, -cycle) * 1.1 * ratio)
  swing(rig, 'LegR2', Math.max(0, cycle) * 1.1 * ratio)

  // Arms counter-swing against the legs.
  swing(rig, 'ArmL1', -cycle * armAmp)
  swing(rig, 'ArmR1', cycle * armAmp)
  swing(rig, 'ArmL2', Math.max(0, cycle) * 0.5 * ratio)
  swing(rig, 'ArmR2', Math.max(0, -cycle) * 0.5 * ratio)

  // Lean into the run (positive swing tips an upright bone forward), and bob once
  // per step (twice per full cycle).
  swing(rig, 'Spine1', 0.12 * ratio)
  rig.root.position.y += Math.abs(Math.cos(phase)) * 0.18 * ratio
}
