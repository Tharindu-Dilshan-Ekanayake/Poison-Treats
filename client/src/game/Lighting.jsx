import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { Vector3 } from 'three'

import { localPlayer } from '../net/liveState'
import { useSettings } from './quality'
import { LIGHTS } from './sceneStyle'

const SUN_DIRECTION = new Vector3(...LIGHTS.sunDirection).normalize()
/** How far back along SUN_DIRECTION the light sits from the point it shadows. */
const SUN_DISTANCE = 60
/** Half-size of the square area around the player that receives shadows. */
const SHADOW_EXTENT = 22

/**
 * Bright, even daylight: a white hemisphere fill and a warm sun.
 *
 * The sun's shadow box follows the player, so shadows exist wherever they walk. On
 * the LOW preset the sun casts no shadow at all (blob shadows stand in).
 */
export function Lighting() {
  const sunRef = useRef(null)
  const scene = useThree((s) => s.scene)
  const gl = useThree((s) => s.gl)
  const { shadows, shadowMapSize } = useSettings()

  useLayoutEffect(() => {
    const sun = sunRef.current
    if (!sun) return undefined

    const shadowCamera = sun.shadow.camera
    shadowCamera.left = -SHADOW_EXTENT
    shadowCamera.right = SHADOW_EXTENT
    shadowCamera.top = SHADOW_EXTENT
    shadowCamera.bottom = -SHADOW_EXTENT
    shadowCamera.near = 1
    shadowCamera.far = SUN_DISTANCE * 2
    shadowCamera.updateProjectionMatrix()

    // The target has to be in the scene for its matrix to update as it moves.
    scene.add(sun.target)
    return () => {
      scene.remove(sun.target)
    }
  }, [scene])

  // A preset change toggles shadow mapping; every material's shader depends on it.
  useEffect(() => {
    const sun = sunRef.current
    if (!sun) return
    gl.shadowMap.enabled = shadows
    sun.castShadow = shadows
    if (shadows && sun.shadow.mapSize.x !== shadowMapSize) {
      sun.shadow.mapSize.set(shadowMapSize, shadowMapSize)
      sun.shadow.map?.dispose()
      sun.shadow.map = null
    }
    scene.traverse((o) => {
      if (!o.material) return
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true
    })
  }, [gl, scene, shadows, shadowMapSize])

  useFrame(() => {
    const sun = sunRef.current
    if (!sun) return
    const p = localPlayer.position
    sun.target.position.set(p.x, 0, p.z)
    sun.position.copy(sun.target.position).addScaledVector(SUN_DIRECTION, SUN_DISTANCE)
  })

  return (
    <>
      <hemisphereLight args={[LIGHTS.hemiSky, LIGHTS.hemiGround, LIGHTS.hemiIntensity]} />
      <directionalLight
        ref={sunRef}
        color={LIGHTS.sunColor}
        intensity={LIGHTS.sunIntensity}
        position={SUN_DIRECTION.clone().multiplyScalar(SUN_DISTANCE).toArray()}
        shadow-radius={LIGHTS.shadowSoftness}
        shadow-intensity={LIGHTS.shadowIntensity}
        shadow-bias={-0.0005}
        shadow-normalBias={0.03}
      />
    </>
  )
}

export default Lighting
