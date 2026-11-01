import { createContext, useContext } from 'react'

export const BloxityContext = createContext(null)

/**
 * Access the Bloxity session: `user`, `guest`, `isLoggedIn`, `login`, `logout`,
 * `avatar` (equipped IDs), `proportions`, and the `game` loading helpers.
 *
 * Must be called inside a `<BloxityProvider>`.
 */
export function useBloxity() {
  const ctx = useContext(BloxityContext)
  if (!ctx) throw new Error('useBloxity() must be used inside <BloxityProvider>')
  return ctx
}
