import { useEffect, useState } from 'react'

export const money = (n) => `$${Math.floor(n).toLocaleString('en-US')}`

/** "HH:MM:SS" above an hour, else "MM:SS". */
export function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const pad = (n) => String(n).padStart(2, '0')
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${pad(h)}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`
}

/** Re-renders on an interval; for countdown displays only. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
