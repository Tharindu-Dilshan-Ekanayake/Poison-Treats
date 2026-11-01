import { usePlatform } from '../bloxity/platform'
import { useQuality } from './quality'

/**
 * The game's own settings panel (shown when played outside Bloxity; inside it,
 * Bloxity's menu drives the same values through platform.js). Choices are saved in
 * this browser and applied on start-up.
 *
 * Values live where the game already reads them: volume, camera speed and the FPS
 * readout in usePlatform, the graphics preset in useQuality.
 */
const KEY = 'gmn-settings'

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') || {}
  } catch {
    return {}
  }
}

function save(patch) {
  localStorage.setItem(KEY, JSON.stringify({ ...read(), ...patch }))
}

export const GRAPHICS = ['low', 'medium', 'high']

/** Applies the saved settings. Called once at start-up. */
export function loadUserSettings() {
  const s = read()
  const platform = {}
  if (Number.isFinite(s.volume)) platform.masterVolume = Math.min(1, Math.max(0, s.volume))
  if (Number.isFinite(s.music)) platform.musicVolume = Math.min(1, Math.max(0, s.music))
  if (Number.isFinite(s.cameraSpeed)) platform.cameraSensitivity = Math.min(3, Math.max(0.2, s.cameraSpeed))
  if (typeof s.showFps === 'boolean') platform.showFps = s.showFps
  usePlatform.setState(platform)
  if (GRAPHICS.includes(s.graphics)) useQuality.setState({ preset: s.graphics })
}

export const setVolume = (volume) => {
  usePlatform.setState({ masterVolume: volume })
  save({ volume })
}

export const setMusicVolume = (music) => {
  usePlatform.setState({ musicVolume: music })
  save({ music })
}

export const setCameraSpeed = (cameraSpeed) => {
  usePlatform.setState({ cameraSensitivity: cameraSpeed })
  save({ cameraSpeed })
}

export const setShowFps = (showFps) => {
  usePlatform.setState({ showFps })
  save({ showFps })
}

export const setGraphics = (graphics) => {
  useQuality.setState({ preset: graphics })
  save({ graphics })
}
