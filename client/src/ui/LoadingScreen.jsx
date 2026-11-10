import { useProgress } from '@react-three/drei'

import { retryConnection } from '../net/api'
import { useGame } from '../net/gameStore'

/**
 * Covers the screen until the scene has drawn and, normally, the game server is
 * connected (see useLobbyReady in App.jsx: it waits at most a moment for the server).
 * `useProgress` tracks three's loaders (avatar GLBs and textures); the line under the
 * bar says which step we're on, and offers a retry if the server can't be reached.
 */
export function LoadingScreen() {
  const { progress } = useProgress()
  const status = useGame((s) => s.status)
  const waking = useGame((s) => s.serverWaking)
  return (
    <div className="absolute inset-0 z-[70] flex flex-col items-center justify-center gap-5 bg-gradient-to-b from-[#2a8af5] to-[#86c8fb] px-6">
      <h1 className="stroke-text text-center text-[3.6rem] font-bold leading-none text-white">
        Poison Treats <span className="inline-block">🍬</span>
      </h1>
      <p className="stroke-thin text-center text-xl font-bold text-white">You and your opponent each poison a treat! 🧪</p>
      <div className="h-5 w-[min(80vw,26rem)] overflow-hidden rounded-full border-4 border-black bg-black/30">
        <div className="h-full bg-[#ffe23d] transition-[width] duration-200" style={{ width: `${Math.max(8, progress)}%` }} />
      </div>
      {status === 'failed' ? (
        <div className="flex flex-col items-center gap-3">
          <p className="stroke-thin text-center text-lg font-bold text-white">😕 Couldn&apos;t reach the game server</p>
          <button
            type="button"
            onClick={retryConnection}
            className="btn-3d press pointer-events-auto bg-gradient-to-b from-[#5dff5d] to-[#22c522] px-6 py-2 text-xl font-bold text-white"
          >
            <span className="stroke-text">TRY AGAIN</span>
          </button>
        </div>
      ) : (
        <p className="stroke-thin text-center text-lg font-bold text-white/90">
          {status === 'online'
            ? 'Getting the lobby ready…'
            : waking
              ? 'Waking up the game server… (a few seconds for the first player)'
              : 'Connecting to the game server…'}
        </p>
      )}
      <p className="stroke-thin text-center text-base font-bold text-white/70">☠️ Bite the poisoned one and you LOSE!</p>
    </div>
  )
}

export default LoadingScreen
