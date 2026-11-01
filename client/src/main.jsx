import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App.jsx'
import { assetUrls, baseBodyUrl } from './bloxity/avatarAssets'
import { loadUserSettings } from './game/userSettings'
import { installUiScale } from './ui/uiScale'
import { unlockAudioOnFirstGesture } from './audio/sfx'
import BloxityProvider from './bloxity/BloxityProvider.jsx'
import './index.css'

unlockAudioOnFirstGesture()
installUiScale()
loadUserSettings()

// The avatar base body and default skin gate the end of the loading screen; fetch
// them now, in parallel with the scene chunk. URLs come from the told environment.
for (const [href, as] of [
  [baseBodyUrl(), 'fetch'],
  [assetUrls.skinTexture('0'), 'image'],
]) {
  const link = document.createElement('link')
  link.rel = 'preload'
  link.href = href
  link.as = as
  link.crossOrigin = 'anonymous'
  document.head.appendChild(link)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BloxityProvider>
      <App />
    </BloxityProvider>
  </StrictMode>,
)
