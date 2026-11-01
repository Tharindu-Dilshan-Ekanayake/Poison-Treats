import { create } from 'zustand'

import { usePlatform } from '../bloxity/platform'

/**
 * Graphics presets. Every visual feature reads one of these values before it
 * renders anything; LOW is the floor for low-end phones.
 *
 * maxFullAvatars - remote players drawn as full skinned avatars (6+ draw calls
 *                  each); the rest become one instanced low-poly crowd.
 */
export const PRESETS = {
  low: {
    dpr: 1,
    shadows: false,
    shadowMapSize: 0,
    particles: false,
    maxFullAvatars: 3,
    /** Name tags drawn at once (nearest players), and table signs (nearest tables). */
    maxNames: 4,
    maxTableSigns: 4,
    nameDistance: 18,
    labelDistance: 22,
    viewDistance: 140,
    clouds: 12,
    anisotropy: 4,
    blur: false,
  },
  medium: {
    dpr: [1, 1.5],
    shadows: true,
    shadowMapSize: 1024,
    particles: true,
    maxFullAvatars: 6,
    maxNames: 10,
    maxTableSigns: 6,
    nameDistance: 28,
    labelDistance: 30,
    viewDistance: 260,
    clouds: 12,
    anisotropy: 4,
    blur: false,
  },
  high: {
    dpr: [1, 2],
    shadows: true,
    shadowMapSize: 2048,
    particles: true,
    maxFullAvatars: 10,
    maxNames: 16,
    maxTableSigns: 10,
    nameDistance: 40,
    labelDistance: 38,
    viewDistance: 420,
    clouds: 18,
    anisotropy: 8,
    blur: true,
  },
}

const ORDER = ['low', 'medium', 'high']

/** Bloxity's graphics_quality setting ('Low' | 'Medium' | 'High' | 'Ultra'). */
const PLATFORM_PRESET = { Low: 'low', Medium: 'medium', High: 'high', Ultra: 'high' }

/**
 * Everyone starts on LOW. Bloxity's graphics_quality setting reports a value
 * straight away (its default is "High" for everyone), so only a change the player
 * makes in the Bloxity menu during the session moves the preset.
 */
export const useQuality = create((set, get) => ({
  preset: 'low',

  /** Called by <PerformanceMonitor> when FPS stays under 45. */
  drop: () => {
    const i = ORDER.indexOf(get().preset)
    if (i > 0) set({ preset: ORDER[i - 1] })
  },
}))

let platformSettingSeen = false
usePlatform.subscribe((s, prev) => {
  if (s.graphics === prev.graphics) return
  // The first value is the stored/default one, not a choice made now.
  if (!platformSettingSeen) {
    platformSettingSeen = true
    return
  }
  const preset = PLATFORM_PRESET[s.graphics]
  if (preset) useQuality.setState({ preset })
})

export const useSettings = () => PRESETS[useQuality((s) => s.preset)]
/** Non-reactive read for useFrame loops. */
export const getSettings = () => PRESETS[useQuality.getState().preset]
