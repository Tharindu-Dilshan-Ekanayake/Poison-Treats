/**
 * Lazy front for the network client. The Colyseus SDK (~170 KB minified) isn't
 * needed to draw the first frame, so it loads in its own chunk, in parallel with
 * the 3D scene, instead of delaying the main bundle.
 *
 * Calls made before it arrives are applied in order once it does; `send` can only
 * matter once connected, by which point the module is loaded.
 */
let socket = null
let loading = null

const load = () =>
  (loading ||= import('./socket').then((m) => {
    socket = m
    return m
  }))

export function connect(joinOptions) {
  load().then((m) => m.connect(joinOptions))
}

export function disconnect() {
  load().then((m) => m.disconnect())
}

export function send(msg) {
  socket?.send(msg)
}

export function retryConnection() {
  socket?.retryConnection()
}
