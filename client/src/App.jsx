import { lazy, Suspense, useCallback, useEffect, useState } from 'react'

import { platform, setAdScreen, usePlatform } from './bloxity/platform'
import { useGame } from './net/gameStore'
import { renderStats } from './net/liveState'
import { useConnection } from './net/useConnection'
import HUD from './ui/HUD'
import InteractPrompt from './ui/InteractPrompt'
import LoadingScreen from './ui/LoadingScreen'
import MatchUI from './ui/MatchUI'
import Toasts from './ui/Toasts'
import { useTouch } from './ui/touch'
import TouchControls from './ui/TouchControls'

// The 3D scene (three, R3F, the world) is its own chunk so the loading screen paints
// first; the menus aren't needed until the player opens one.
const GameScene = lazy(() => import('./game/GameScene'))
const Modals = lazy(() => import('./ui/Modals'))

/** Bloxity's "Show FPS" setting. */
function FpsReadout() {
  const [fps, setFps] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setFps(renderStats.fps), 500)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="pointer-events-none absolute bottom-2 left-1/2 z-50 -translate-x-1/2 rounded bg-black/50 px-2 py-0.5 font-mono text-xs text-white">
      {fps} FPS
    </div>
  )
}

/** The only menus that show ads: Shop (which also holds the Starter Pack), Items and Quests. */
const AD_PANELS = new Set(['shop', 'items', 'quests'])

/**
 * Ads appear only while one of AD_PANELS is open. Bloxity places screen banners for
 * whichever screen type we announce, so announcing nothing at any other time (lobby,
 * duels, results, other menus) means no banners there.
 */
function useAdScreens() {
  const modal = useGame((s) => s.modal)
  useEffect(() => {
    setAdScreen(AD_PANELS.has(modal) ? 'panel' : null)
  }, [modal])
}

/** Esc closes an open menu; otherwise, inside Bloxity, it opens Bloxity's menu. */
function useEscapeMenu() {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || useGame.getState().modal) return
      if (usePlatform.getState().embedded) platform.showMenu()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/**
 * After the scene is drawn, the longest the loading screen waits for the server. A
 * hosted server that was asleep can take much longer to wake; past this the lobby
 * opens anyway, with a "connecting" notice on top, instead of a frozen loading screen.
 */
const CONNECT_WAIT_MAX_MS = 1500

/**
 * True once the lobby can be shown: the scene is drawn and the server is connected, or
 * the short wait for it ran out. Once open it stays open (a later reconnect shows a
 * notice, never the loading screen again). Other players' avatars are not waited for:
 * they appear as they finish loading.
 */
function useLobbyReady(sceneReady) {
  const online = useGame((s) => s.status === 'online')
  const [opened, setOpened] = useState(false)

  useEffect(() => {
    if (opened || !sceneReady) return undefined
    const id = setTimeout(() => setOpened(true), online ? 0 : CONNECT_WAIT_MAX_MS)
    return () => clearTimeout(id)
  }, [opened, sceneReady, online])

  return opened
}

function App() {
  useConnection()
  useAdScreens()
  useEscapeMenu()
  const [sceneReady, setSceneReady] = useState(false)
  const ready = useLobbyReady(sceneReady)
  const modal = useGame((s) => s.modal)
  const showFps = usePlatform((s) => s.showFps)
  const touch = useTouch((s) => s.touch)
  const onReady = useCallback(() => setSceneReady(true), [])

  return (
    <div className="relative h-dvh w-screen select-none overflow-hidden bg-[#86c8fb] font-game">
      <Suspense fallback={null}>
        <GameScene onReady={onReady} />
      </Suspense>

      <HUD />
      <MatchUI />
      <InteractPrompt />
      <Toasts />
      {touch && <TouchControls />}
      {showFps && <FpsReadout />}
      {modal && (
        <Suspense fallback={null}>
          <Modals />
        </Suspense>
      )}
      {!ready && <LoadingScreen />}
    </div>
  )
}

export default App
