import { useLayoutEffect, useRef } from 'react'

import { writeInstances } from './instancing'

/**
 * A static instanced mesh: one draw call for every item in `items`.
 * @param {{ geometry: import('three').BufferGeometry, material: import('three').Material,
 *           items: import('./instancing').InstanceDef[], castShadow?: boolean,
 *           receiveShadow?: boolean }} props
 */
export function Instanced({ geometry, material, items, castShadow = false, receiveShadow = false }) {
  const ref = useRef(null)
  useLayoutEffect(() => writeInstances(ref.current, items), [items])
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, items.length]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    />
  )
}

export default Instanced
