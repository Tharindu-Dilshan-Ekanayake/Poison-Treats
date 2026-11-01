/**
 * Bloxity platform settings for this server. Bloxity hosting injects these on every
 * deploy; the prod values are only a fallback for when nothing was told (e.g. a
 * local `npm run dev`). Every Bloxity URL the server uses is built from here.
 */
const env = process.env

const boxity = {
  env: env.BLOXITY_ENV || 'prod',
  apiUrl: (env.BLOXITY_API_URL || 'https://api.bloxity.io').replace(/\/$/, ''),
  matchmakerUrl: (env.BLOXITY_MATCHMAKER_URL || 'https://play.bloxity.io').replace(/\/$/, ''),
  portalUrl: (env.BLOXITY_PORTAL_URL || 'https://bloxity.io').replace(/\/$/, ''),
  staticUrl: (env.BLOXITY_STATIC_URL || 'https://static.bloxity.io').replace(/\/$/, ''),

  /** Set on Bloxity hosting only. */
  gameId: env.BLOXITY_GAME_ID || '',
  channel: env.BLOXITY_CHANNEL || '',
  reportToken: env.BLOXITY_REPORT_TOKEN || '',
  matchmakerReportUrl: env.MATCHMAKER_REPORT_URL || '',
  podName: env.POD_NAME || env.HOSTNAME || '',
  mongoUri: env.MONGODB_URI || '',
  /** The game site's origin, for CORS (injected by hosting). */
  clientOrigin: env.CLIENT_ORIGIN || '',
  /** Shared secret Bloxity sends in x-legion-webhook-secret, when configured. */
  webhookSecret: env.BLOXITY_WEBHOOK_SECRET || '',
}

module.exports = { boxity }
