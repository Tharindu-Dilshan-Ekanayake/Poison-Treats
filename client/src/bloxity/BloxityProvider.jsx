import { useCallback, useEffect, useMemo, useRef } from 'react'

import { BloxityContext } from './BloxityContext'
import { GAME_SLUG, initPlatform, platform, usePlatform } from './platform'
import { getSDK, safeCall, toUnsubscribe } from './sdk'
import { DEFAULT_PROPORTIONS, useBloxityStore } from './store'

/** Slots the SDK's equipped payload carries beyond the skin. */
const PART_ID_KEYS = [
  'hatId',
  'backId',
  'headId',
  'armLId',
  'armRId',
  'legLId',
  'legRId',
  'torsoId',
]

/**
 * True for the blanked-out `{ skinId: '-1' }` payload the SDK emits while it resets
 * state during a login/logout, as opposed to a genuinely bare avatar.
 */
function isResetSentinel(equipped) {
  if (!equipped) return false
  if (String(equipped.skinId) !== '-1') return false
  return PART_ID_KEYS.every((key) => equipped[key] === undefined)
}

/**
 * Owns the whole Bloxity session lifecycle: waits for the SDK script, initialises it
 * once, and subscribes to the auth/avatar change streams. Those subscriptions are the
 * single source of truth — nothing here polls `getUser()`.
 *
 * @param {{ gameSlug?: string, children: React.ReactNode }} props
 */
export function BloxityProvider({ gameSlug, children }) {
  // The slug lives in shared/gameData.json (VITE_GAME_SLUG overrides it).
  const slug = gameSlug || GAME_SLUG
  const embedded = usePlatform((s) => s.embedded)

  const status = useBloxityStore((s) => s.status)
  const error = useBloxityStore((s) => s.error)
  const user = useBloxityStore((s) => s.user)
  const guest = useBloxityStore((s) => s.guest)
  const equipped = useBloxityStore((s) => s.equipped)
  const proportions = useBloxityStore((s) => s.proportions)

  const sdkRef = useRef(null)

  useEffect(() => {
    const store = useBloxityStore.getState()
    const unsubscribers = []
    let cancelled = false

    store.setStatus('loading')

    initPlatform(slug)
      .then((sdk) => {
        if (cancelled) return
        sdkRef.current = sdk

        const readEquipped = () =>
          safeCall(sdk.avatar.getEquipped?.bind(sdk.avatar)) || null

        // Auth. Fires immediately with the current user (or null), then on every
        // login/logout.
        unsubscribers.push(
          toUnsubscribe(
            sdk.auth.onUserChanged((nextUser) => {
              useBloxityStore.getState().setUser(nextUser || null)
              // The guest identity is what the HUD falls back to when signed out.
              useBloxityStore
                .getState()
                .setGuest(safeCall(sdk.auth.getGuest?.bind(sdk.auth)) || null)

              // Re-read the equipped set on every login/logout. `getEquipped()`
              // derives from the user object, so this is the authoritative value
              // for whoever just signed in — see the note on the reset sentinel
              // below for why we cannot wait for onAvatarChanged here.
              useBloxityStore.getState().setEquipped(readEquipped())
              useBloxityStore
                .getState()
                .setProportions(safeCall(sdk.avatar.getProportions?.bind(sdk.avatar)))
            }),
          ),
        )

        // Avatar cosmetics + body proportions. These drive a live rebuild of the
        // player model, so a change made in the Bloxity portal shows up without a
        // page reload.
        unsubscribers.push(
          toUnsubscribe(
            sdk.avatar.onAvatarChanged((nextEquipped) => {
              // The SDK notifies this callback with its *customizer* state, and its
              // own internal onUserChanged handler blanks that to {skinId:'-1'} on
              // every login/logout before re-fetching the real data (which it then
              // does NOT re-notify). Taking that sentinel at face value would reset
              // the character to the default body the instant you sign in, so fall
              // back to the user-derived getEquipped() when we see it.
              const store = useBloxityStore.getState()
              const next =
                isResetSentinel(nextEquipped) && store.user
                  ? readEquipped()
                  : nextEquipped || null
              store.setEquipped(next)
            }),
          ),
        )
        unsubscribers.push(
          toUnsubscribe(
            sdk.avatar.onProportionsChanged((nextProportions) => {
              useBloxityStore.getState().setProportions(nextProportions)
            }),
          ),
        )

        // Seed anything the subscriptions didn't fire synchronously.
        const s = useBloxityStore.getState()
        if (!s.guest) s.setGuest(safeCall(sdk.auth.getGuest?.bind(sdk.auth)) || null)
        if (!s.equipped) {
          s.setEquipped(safeCall(sdk.avatar.getEquipped?.bind(sdk.avatar)) || null)
        }

        useBloxityStore.getState().setStatus('ready')
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[bloxity] init failed:', err)
        useBloxityStore.getState().setStatus('error', err)
      })

    return () => {
      cancelled = true
      unsubscribers.forEach((fn) => safeCall(fn))
    }
  }, [slug])

  // Inside Bloxity the toolbar handles accounts: the game never shows its own
  // Log in / Log out there, and never calls these.
  const login = useCallback(() => {
    const sdk = sdkRef.current || getSDK()
    if (!sdk) {
      console.warn('[bloxity] login() called before the SDK was ready')
      return
    }
    // Login state arrives via onUserChanged — deliberately nothing to await here.
    safeCall(sdk.auth.showAuthPopup?.bind(sdk.auth))
  }, [])

  const logout = useCallback(() => {
    const sdk = sdkRef.current || getSDK()
    if (!sdk) return
    safeCall(sdk.auth.logout?.bind(sdk.auth))
  }, [])

  // Loading-screen + room helpers, exposed so gameplay code doesn't reach for
  // `window.Legion` directly.
  const game = useMemo(
    () => ({
      loadingStep: platform.loadingStep,
      loadingEnd: platform.loadingEnd,
      gameplayStart: platform.gameplayStart,
      updateRoom: platform.updateRoom,
    }),
    [],
  )

  const value = useMemo(
    () => ({
      status,
      error,
      isReady: status === 'ready',
      user,
      guest,
      isLoggedIn: Boolean(user),
      /** Always something displayable, per the getUser() || getGuest() pattern. */
      identity: user || guest,
      login,
      logout,
      /** Show Log in / Log out only when this is false. */
      embedded,
      avatar: equipped,
      proportions: proportions || DEFAULT_PROPORTIONS,
      game,
      gameSlug: slug,
    }),
    [status, error, user, guest, equipped, proportions, login, logout, embedded, game, slug],
  )

  return <BloxityContext.Provider value={value}>{children}</BloxityContext.Provider>
}

export default BloxityProvider
