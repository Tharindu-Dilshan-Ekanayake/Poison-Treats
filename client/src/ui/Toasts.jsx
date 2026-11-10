import { useGame } from '../net/gameStore'
import { retryConnection } from '../net/api'
import { useNow } from './format'

/** "Still there?": any tap or key press clears it (see net/socket.js reportActivity). */
function AfkWarning() {
  const until = useGame((s) => s.afkWarnUntil)
  const now = useNow(500)
  if (!until || until < now) return null
  return (
    <div className="ui-panel pop-in px-4 py-2 text-center text-base font-bold text-[#ffd23d]">
      👋 Still there? Move or tap to stay in the game!
      <div className="text-sm text-white">Leaving the lobby in {Math.max(1, Math.ceil((until - now) / 1000))}s</div>
    </div>
  )
}

/**
 * Shown after the server removed an idle player to free their slot. A full-screen
 * layer of its own (not inside the toast column, which is only as wide as its text).
 */
function AfkRemoved() {
  return (
    <div className="pointer-events-auto fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <div className="ui-panel pop-in flex w-[min(88vw,22rem)] flex-col items-center gap-3 px-6 py-6 text-center text-white">
        <div className="text-5xl leading-none">😴</div>
        <div className="stroke-text text-3xl font-bold leading-tight">You were away</div>
        <p className="text-base font-semibold leading-snug text-white/85">
          We freed your spot so another player could join. Come back whenever you&apos;re ready!
        </p>
        <button
          type="button"
          onClick={retryConnection}
          className="btn-3d press mt-1 whitespace-nowrap bg-gradient-to-b from-[#5dff5d] to-[#22c522] px-8 py-2.5 text-2xl font-bold text-white"
        >
          <span className="stroke-text">PLAY AGAIN</span>
        </button>
      </div>
    </div>
  )
}

/** Short server messages (purchases, errors, rewards) and the connection state. */
export function Toasts() {
  const toasts = useGame((s) => s.toasts)
  const status = useGame((s) => s.status)
  const waking = useGame((s) => s.serverWaking)
  return (
    <>
      {status === 'afk' && <AfkRemoved />}
      <div className="pointer-events-none absolute left-1/2 top-[20%] z-60 flex -translate-x-1/2 flex-col items-center gap-1.5">
        <AfkWarning />
        {status === 'failed' ? (
          <div className="ui-panel pointer-events-auto flex items-center gap-3 px-4 py-2 text-base font-bold text-white">
            Couldn&apos;t reach the game server
            <button
              type="button"
              onClick={retryConnection}
              className="btn-3d press bg-gradient-to-b from-[#5dff5d] to-[#22c522] px-3 py-1 text-sm"
            >
              <span className="stroke-thin">Retry</span>
            </button>
          </div>
        ) : (
          status !== 'online' &&
          status !== 'afk' && (
            <div className="ui-panel px-4 py-1.5 text-base font-bold text-[#ffd23d]">
              {status === 'connecting'
                ? waking
                  ? 'Waking up the game server… hang tight!'
                  : 'Connecting to server…'
                : 'Reconnecting…'}
            </div>
          )
        )}
        {toasts.map((t) => (
          <div key={t.id} className="ui-panel pop-in px-4 py-1.5 text-center text-base font-bold text-white">
            {t.text}
          </div>
        ))}
      </div>
    </>
  )
}

export default Toasts
