import { useEffect, useMemo } from 'react'

/**
 * useMemo for GPU resources: builds once per `deps`, and disposes on unmount or
 * rebuild. Accepts a single disposable or an object/array of them.
 *
 * Disposing only frees GPU memory; if StrictMode re-runs the effect, three simply
 * re-uploads the resource on its next use.
 */
export function useDisposable(factory, deps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/use-memo
  const value = useMemo(factory, deps)
  useEffect(
    () => () => {
      const items = value?.dispose ? [value] : Object.values(value || {})
      for (const item of items) item?.dispose?.()
    },
    [value],
  )
  return value
}
