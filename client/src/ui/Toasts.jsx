import { useGame } from '../net/gameStore'
import { retryConnection } from '../net/api'

/** Short server messages (purchases, errors, rewards) and the connection state. */
export function Toasts() {
  const toasts = useGame((s) => s.toasts)
  const status = useGame((s) => s.status)
  return (
    <div className="pointer-events-none absolute left-1/2 top-[20%] z-60 flex -translate-x-1/2 flex-col items-center gap-1.5">
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
        status !== 'online' && (
          <div className="ui-panel px-4 py-1.5 text-base font-bold text-[#ffd23d]">
            {status === 'connecting' ? 'Connecting to server…' : 'Reconnecting…'}
          </div>
        )
      )}
      {toasts.map((t) => (
        <div key={t.id} className="ui-panel pop-in px-4 py-1.5 text-center text-base font-bold text-white">
          {t.text}
        </div>
      ))}
    </div>
  )
}

export default Toasts
