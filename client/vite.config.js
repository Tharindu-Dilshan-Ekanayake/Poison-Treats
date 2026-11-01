import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

/**
 * Dev server only (`apply: 'serve'`, never in a production build): tells a
 * standalone page it is on a local Bloxity stack. Opt in with BLOXITY_DEV_ENV=local
 * when running the Bloxity portal/API locally; otherwise nothing is injected and the
 * SDK uses its production default.
 */
const LOCAL_ENV = {
  env: 'local',
  apiUrl: 'http://localhost:4000',
  playUrl: 'http://localhost:2567',
  portalUrl: 'http://localhost:3000',
  staticUrl: 'https://static.bloxity.io',
}
// eslint-disable-next-line no-undef -- Node globals in the Vite config
const DEV_ENV = process.env.BLOXITY_DEV_ENV
const boxityLocalEnv = {
  name: 'boxity-local-env',
  apply: 'serve',
  transformIndexHtml: () =>
    DEV_ENV === 'local'
      ? [{ tag: 'script', children: `window.BLOXITY_ENV = ${JSON.stringify(LOCAL_ENV)}`, injectTo: 'head-prepend' }]
      : [],
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), boxityLocalEnv],
  server: {
    // shared/gameData.json lives one level above the client root.
    fs: { allow: ['..'] },
    // The Colyseus game server runs separately on :3000 (`npm run dev` in server/);
    // see endpointFor() in src/net/socket.js.
  },
  build: {
    // three + R3F alone are ~1 MB minified (~280 KB gzip); anything past that is ours.
    chunkSizeWarningLimit: 1100,
    rolldownOptions: {
      output: {
        // three + R3F change far less often than game code; a separate chunk caches
        // across deploys.
        codeSplitting: {
          groups: [{ name: 'three', test: /node_modules[\\/](three|@react-three)[\\/]/ }],
        },
      },
    },
  },
})
