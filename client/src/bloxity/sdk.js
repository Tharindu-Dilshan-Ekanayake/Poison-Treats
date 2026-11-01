/**
 * Bloxity SDK bootstrap helpers.
 *
 * The SDK is loaded via a plain <script> tag in index.html and installs itself as
 * `window.Legion.SDK`. Because that script is not a module, there is no guarantee it
 * has finished executing by the time React first renders (cached vs. cold load,
 * `defer` semantics, slow network). Everything here exists to bridge that gap.
 */

const POLL_INTERVAL_MS = 50
const DEFAULT_TIMEOUT_MS = 15000

/** Synchronous peek — returns the SDK if it is already on `window`, else null. */
export function getSDK() {
  return (typeof window !== 'undefined' && window.Legion && window.Legion.SDK) || null
}

/**
 * Resolves with `window.Legion.SDK` once it exists.
 *
 * Listens for the SDK script's `load` event when we can find the tag (fast path, no
 * spinning) and also polls, because the script may already have fired `load` before
 * this ever runs, and because some builds attach `Legion` asynchronously after load.
 *
 * @param {{ timeoutMs?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<object>} the SDK namespace
 */
export function waitForSDK({ timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
  const existing = getSDK()
  if (existing) return Promise.resolve(existing)

  return new Promise((resolve, reject) => {
    let settled = false
    let pollId = null

    const cleanup = () => {
      if (pollId !== null) clearInterval(pollId)
      clearTimeout(timeoutId)
      scriptEl?.removeEventListener('load', check)
      signal?.removeEventListener('abort', onAbort)
    }

    const check = () => {
      if (settled) return
      const sdk = getSDK()
      if (!sdk) return
      settled = true
      cleanup()
      resolve(sdk)
    }

    const fail = (err) => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }

    const onAbort = () => fail(new Error('waitForSDK aborted'))

    const scriptEl = document.querySelector('script[src*="legion-sdk"]')
    scriptEl?.addEventListener('load', check)
    signal?.addEventListener('abort', onAbort)

    const timeoutId = setTimeout(
      () =>
        fail(
          new Error(
            `Bloxity SDK did not appear on window.Legion.SDK within ${timeoutMs}ms. ` +
              'Is the <script src="https://sdk.bloxity.io/v1/legion-sdk.min.js"> tag in index.html reachable?',
          ),
        ),
      timeoutMs,
    )

    pollId = setInterval(check, POLL_INTERVAL_MS)
    check()
  })
}

/**
 * Normalises the SDK's subscribe functions.
 *
 * `onUserChanged` / `onAvatarChanged` are documented to fire immediately with the
 * current value and again on every change. Some SDK builds return an unsubscribe
 * function, others return nothing — this always hands back something safe to call
 * from a `useEffect` cleanup.
 *
 * @param {unknown} maybeUnsubscribe whatever the SDK's `on*` call returned
 * @returns {() => void}
 */
export function toUnsubscribe(maybeUnsubscribe) {
  if (typeof maybeUnsubscribe === 'function') return maybeUnsubscribe
  if (maybeUnsubscribe && typeof maybeUnsubscribe.unsubscribe === 'function') {
    return () => maybeUnsubscribe.unsubscribe()
  }
  return () => {}
}

/** Calls `fn` if it exists, swallowing SDK-side errors so they can't kill a render. */
export function safeCall(fn, ...args) {
  if (typeof fn !== 'function') return undefined
  try {
    return fn(...args)
  } catch (err) {
    console.warn('[bloxity] SDK call failed:', err)
    return undefined
  }
}
