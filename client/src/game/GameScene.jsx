import { PerformanceMonitor } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { NearestFilter } from 'three'

import { useBloxity } from '../bloxity/BloxityContext'
import { usePlatform } from '../bloxity/platform'
import { renderStats } from '../net/liveState'
import { CullingSystem } from './culling'
import Effects from './Effects'
import FollowCamera from './FollowCamera'
import Halos from './Halos'
import Lighting from './Lighting'
import Player from './Player'
import { useQuality, useSettings } from './quality'
import RemotePlayers from './RemotePlayers'
import { FOG, SKY } from './sceneStyle'
import Sky from './Sky'
import World from './World'

/** How long to wait for the browser to restore a lost WebGL context before rebuilding. */
const CONTEXT_RESTORE_TIMEOUT_MS = 4000

/**
 * Fires `onFirstFrame` after the renderer has actually drawn once.
 * `loadingEnd()` should mean "the player can see the game", not "React mounted".
 */
function FirstFrameSignal({ onFirstFrame }) {
  const fired = useRef(false)
  useFrame(() => {
    if (fired.current) return
    fired.current = true
    onFirstFrame()
  })
  return null
}

/** Approximate GPU bytes for every texture the scene references (mips add a third). */
function measureTextures(scene) {
  const seen = new Set()
  let bytes = 0
  scene.traverse((o) => {
    const materials = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []
    for (const m of materials) {
      const t = m.map
      if (!t?.image || seen.has(t)) continue
      seen.add(t)
      const mips = t.generateMipmaps && t.minFilter !== NearestFilter ? 4 / 3 : 1
      bytes += t.image.width * t.image.height * 4 * mips
    }
  })
  return { count: seen.size, bytes }
}

/**
 * Copies renderer counters into liveState for the perf readout and automated checks,
 * and exposes `window.__textureMemory()` for on-demand texture budget checks.
 */
function RenderStats() {
  const scene = useThree((s) => s.scene)
  const frames = useRef({ count: 0, since: 0 })
  useEffect(() => {
    window.__textureMemory = () => measureTextures(scene)
    return () => delete window.__textureMemory
  }, [scene])
  useFrame(({ gl }) => {
    // Read before this frame renders: these are the previous frame's totals.
    renderStats.calls = gl.info.render.calls
    renderStats.triangles = gl.info.render.triangles
    renderStats.textures = gl.info.memory.textures
    renderStats.geometries = gl.info.memory.geometries
    const f = frames.current
    f.count += 1
    const now = performance.now()
    if (!f.since) f.since = now
    if (now - f.since >= 1000) {
      renderStats.fps = Math.round((f.count * 1000) / (now - f.since))
      f.count = 0
      f.since = now
    }
  })
  return null
}

/** Horizontal field of view kept on portrait screens, in degrees. */
const PORTRAIT_HFOV = 56
const LANDSCAPE_VFOV = 60
const MAX_VFOV = 88

/**
 * On a portrait screen a fixed vertical FOV leaves a very narrow view sideways;
 * widen it so roughly the same width of the world stays in frame.
 */
function ResponsiveFov() {
  const camera = useThree((s) => s.camera)
  const aspect = useThree((s) => s.size.width / s.size.height)
  useEffect(() => {
    const fov =
      aspect >= 1
        ? LANDSCAPE_VFOV
        : Math.min(MAX_VFOV, (2 * Math.atan(Math.tan((PORTRAIT_HFOV * Math.PI) / 360) / aspect) * 180) / Math.PI)
    camera.fov = fov
    camera.updateProjectionMatrix()
  }, [camera, aspect])
  return null
}

/**
 * Compiles every material in the scene, including hidden objects, using the
 * browser's parallel shader compilation where available, then calls `onDone`.
 * Waits two frames first so freshly mounted objects are in the scene.
 */
function ShaderWarmup({ onDone }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    let cancelled = false
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        const compiled = gl.compileAsync ? gl.compileAsync(scene, camera) : Promise.resolve()
        compiled
          .catch(() => {})
          .then(() => {
            if (!cancelled) onDone()
          })
      })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [gl, scene, camera, onDone])
  return null
}

/** Keeps camera far plane and fog in step with the preset's view distance. */
function ViewDistance({ distance }) {
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    camera.far = distance + 100
    camera.updateProjectionMatrix()
    if (scene.fog) {
      scene.fog.near = distance * FOG.nearFraction
      scene.fog.far = distance
    }
  }, [camera, scene, distance])
  return null
}

export function GameScene({ onReady }) {
  const { game } = useBloxity()
  // Bloxity ad break: stop simulating and rendering until it ends.
  const paused = usePlatform((s) => s.paused)
  const settings = useSettings()
  const drop = useQuality((s) => s.drop)

  const [avatarReady, setAvatarReady] = useState(false)
  const loadingEnded = useRef(false)
  const [contextLost, setContextLost] = useState(false)
  // Scenery the player can't reach in their first seconds (shops, leaderboards,
  // clouds) mounts just after the game is playable, hidden, compiles its shaders in
  // the background, and only then appears: no loading delay and no stutter.
  const [extras, setExtras] = useState('off')
  const extrasReady = useCallback(() => setExtras('on'), [])
  const [canvasKey, setCanvasKey] = useState(0)

  const handleAvatarReady = useCallback(() => setAvatarReady(true), [])

  const endLoading = useCallback(() => {
    if (loadingEnded.current || !avatarReady) return
    loadingEnded.current = true
    game.loadingEnd()
    game.gameplayStart()
    onReady?.()
    const reveal = () => setExtras('warming')
    if (window.requestIdleCallback) window.requestIdleCallback(reveal, { timeout: 1000 })
    else setTimeout(reveal, 100)
  }, [avatarReady, game, onReady])

  // The first frame usually renders before the avatar finishes downloading, so the
  // frame callback alone isn't enough — close the loading screen here too.
  useEffect(endLoading, [endLoading])

  useEffect(() => {
    game.loadingStep('Preparing scene…')
  }, [game])

  // If the browser doesn't hand the context back, remount the canvas from scratch.
  useEffect(() => {
    if (!contextLost) return undefined
    const id = setTimeout(() => {
      setContextLost(false)
      setCanvasKey((k) => k + 1)
    }, CONTEXT_RESTORE_TIMEOUT_MS)
    return () => clearTimeout(id)
  }, [contextLost])

  const onCreated = useCallback(({ gl }) => {
    gl.setClearColor(SKY.horizon)
    // Checking every program's link status blocks on the GPU driver per shader;
    // without it, programs compile in parallel. Errors still surface in dev.
    gl.debug.checkShaderErrors = import.meta.env.DEV
    const canvas = gl.domElement
    canvas.addEventListener('webglcontextlost', (e) => {
      // preventDefault tells the browser we intend to restore the context.
      e.preventDefault()
      setContextLost(true)
    })
    canvas.addEventListener('webglcontextrestored', () => setContextLost(false))
  }, [])

  return (
    <>
      <Canvas
        frameloop={paused ? 'never' : 'always'}
        key={canvasKey}
        // PCF, not R3F's default "soft": three r18x removed PCFSoftShadowMap.
        shadows={settings.shadows ? 'percentage' : false}
        dpr={settings.dpr}
        // No tone mapping: keeps the lime grass and blue sky saturated.
        flat
        // Antialiasing is fixed when the WebGL context is created; every preset uses it.
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ position: [0, 6, 36], fov: 60, far: settings.viewDistance + 100 }}
        onCreated={onCreated}
      >
        <PerformanceMonitor onDecline={drop} bounds={() => [45, 1000]} flipflops={4} />
        <fog attach="fog" args={[FOG.color, settings.viewDistance * FOG.nearFraction, settings.viewDistance]} />
        <ViewDistance distance={settings.viewDistance} />
        <ResponsiveFov />
        <Sky clouds={extras} />
        <Lighting />

        <Suspense fallback={null}>
          <World extras={extras} />
          <Player onAvatarReady={handleAvatarReady} />
          <RemotePlayers />
        </Suspense>
        <Halos />

        {settings.particles && <Effects />}
        <FollowCamera />
        <CullingSystem />
        {extras === 'warming' && <ShaderWarmup onDone={extrasReady} />}
        <RenderStats />
        <FirstFrameSignal onFirstFrame={endLoading} />
      </Canvas>

      {contextLost && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-black/60">
          <p className="font-game stroke-text text-3xl text-white">Recovering graphics…</p>
        </div>
      )}
    </>
  )
}

export default GameScene
