/**
 * The only place Bloxity URLs come from.
 *
 * The platform tells the game which environment it is in (prod, stage or local):
 * through window.BLOXITY_ENV on pages it serves, or the portal handshake when
 * embedded. The SDK reads both; before it has loaded, window.BLOXITY_ENV is read
 * here directly. Production is the fallback only when nothing was told. The game
 * never works the environment out from its own hostname, a build flag or a URL.
 */
const PROD = {
  env: 'prod',
  apiUrl: 'https://api.bloxity.io',
  playUrl: 'https://play.bloxity.io',
  portalUrl: 'https://bloxity.io',
  staticUrl: 'https://static.bloxity.io',
}

/** @returns {{ env: 'prod'|'stage'|'local', apiUrl: string, playUrl: string, portalUrl: string, staticUrl: string }} */
export function boxityEnv() {
  if (typeof window === 'undefined') return PROD
  const sdk = window.Legion?.SDK
  if (sdk?.environment) return sdk.environment()
  const told = window.BLOXITY_ENV
  return told && told.apiUrl ? told : PROD
}

/** Base of the avatar asset CDN. */
export const avatarCdn = () => `${boxityEnv().staticUrl}/avatars`
