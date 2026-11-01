import { useProgress } from '@react-three/drei'

/**
 * Covers the screen until the scene has drawn with the player's avatar in it.
 * `useProgress` tracks three's loaders (the avatar GLB and its textures).
 */
export function LoadingScreen() {
  const { progress } = useProgress()
  return (
    <div className="absolute inset-0 z-[70] flex flex-col items-center justify-center gap-5 bg-gradient-to-b from-[#2a8af5] to-[#86c8fb] px-6">
      <h1 className="stroke-text text-center text-[3.6rem] font-bold leading-none text-white">
        Guess My Number <span className="inline-block">🤔</span>
      </h1>
      <p className="stroke-thin text-center text-xl font-bold text-white">You and your opponent pick a number 1 to 100!</p>
      <div className="h-5 w-[min(80vw,26rem)] overflow-hidden rounded-full border-4 border-black bg-black/30">
        <div className="h-full bg-[#ffe23d] transition-[width] duration-200" style={{ width: `${Math.max(8, progress)}%` }} />
      </div>
      <p className="stroke-thin text-center text-lg font-bold text-white/90">💀 Guess correctly or else you LOSE!</p>
    </div>
  )
}

export default LoadingScreen
