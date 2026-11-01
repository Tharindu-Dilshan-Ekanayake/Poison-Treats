import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'

import { localPlayer } from '../net/liveState'
import { getSettings } from './quality'

/**
 * Distance culling for world labels: each is a separate draw call, so only the
 * ones near the player are drawn. Distances come from the active quality preset.
 *
 * Entries: { object, x, z, scale, label?, group? } — `scale` multiplies the preset's
 * labelDistance (big signs stay visible further), `label` hides an empty Label, and
 * a `group` ('tables') shows only its nearest few (preset maxTableSigns).
 */
const entries = new Set()
const CHECK_EVERY_N_FRAMES = 6
let frame = 0
const grouped = []
const byDistance = (a, b) => a.d - b.d

export function useCulled(object, x, z, { scale = 1, label = null, group = null } = {}) {
  const entry = useMemo(() => ({ object, x, z, scale, label, group, d: 0 }), [object, x, z, scale, label, group])
  useEffect(() => {
    entries.add(entry)
    return () => entries.delete(entry)
  }, [entry])
}

export function CullingSystem() {
  useFrame(() => {
    frame += 1
    if (frame % CHECK_EVERY_N_FRAMES !== 0) return
    const settings = getSettings()
    const limit = settings.labelDistance
    const p = localPlayer.position
    grouped.length = 0
    for (const e of entries) {
      e.d = Math.hypot(e.x - p.x, e.z - p.z)
      const show = e.d < limit * e.scale && !(e.label && e.label.empty)
      e.object.visible = show
      if (show && e.group) grouped.push(e)
    }
    // Only the nearest few table signs: each one is a draw call.
    if (grouped.length > settings.maxTableSigns) {
      grouped.sort(byDistance)
      for (let i = settings.maxTableSigns; i < grouped.length; i += 1) grouped[i].object.visible = false
    }
  })
  return null
}
