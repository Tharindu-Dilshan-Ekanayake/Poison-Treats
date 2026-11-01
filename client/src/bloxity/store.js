import { create } from 'zustand'

/**
 * Raw Bloxity state, kept in zustand rather than only in React context so that
 * non-React code — most importantly the `useFrame` loop in the game — can read it
 * without subscribing to a re-render (`useBloxityStore.getState()`).
 *
 * `BloxityProvider` is the only writer. Everything else reads.
 */
export const DEFAULT_PROPORTIONS = Object.freeze({
  height: 1.0,
  shoulderWidth: 1.0,
  armLength: 1.0,
  legOffsetX: 1.0,
  torsoScaleX: 1.0,
  neckHeight: 1.0,
  headScale: 1.0,
})

export const useBloxityStore = create((set) => ({
  /** @type {'idle'|'loading'|'ready'|'error'} */
  status: 'idle',
  /** @type {Error|null} */
  error: null,

  /** Logged-in user, or null when signed out. Set only from `auth.onUserChanged`. */
  user: null,
  /** Guest identity from `auth.getGuest()`; used for the HUD before login. */
  guest: null,

  /** Equipped cosmetic IDs from `avatar.getEquipped()`. */
  equipped: null,
  /** Body proportions from `avatar.getProportions()`. */
  proportions: DEFAULT_PROPORTIONS,

  setStatus: (status, error = null) => set({ status, error }),
  setUser: (user) => set({ user }),
  setGuest: (guest) => set({ guest }),
  setEquipped: (equipped) => set({ equipped }),
  setProportions: (proportions) =>
    set({ proportions: { ...DEFAULT_PROPORTIONS, ...(proportions || {}) } }),
}))

/** Non-reactive snapshot, safe to call inside `useFrame`. */
export const getBloxityState = () => useBloxityStore.getState()
