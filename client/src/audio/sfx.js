/**
 * The game's sound: synthesized in the browser with the Web Audio API, so there are
 * no audio files to download.
 *
 *   effects ─┬─────────────────────┐
 *            └─ reverb (generated) ─┤
 *   music ───── (ducked in duels) ──┴─ master (volume, ad-break mute) ─ compressor ─ out
 *
 * Browsers only allow audio after a user gesture, so the AudioContext is created on
 * the first tap / click / key press (see unlockAudioOnFirstGesture); until then
 * every call is a silent no-op. Music starts then too.
 */

import { usePlatform } from '../bloxity/platform'

/** Loudest the mix gets at volume 100. */
const MAX_GAIN = 0.9
/** Music is a background bed: this much quieter than effects at the same slider. */
const MUSIC_LEVEL = 0.42
const DUCK_LEVEL = 0.45

let ctx = null
let master = null
let sfxBus = null
let musicBus = null
let reverbIn = null
let noiseBuffer = null
let muted = false
let ducked = false

/* ---- Engine ---------------------------------------------------------------------- */

/** A short, soft room reverb: decaying stereo noise. */
function createReverb(c) {
  const seconds = 1.6
  const len = Math.floor(c.sampleRate * seconds)
  const impulse = c.createBuffer(2, len, c.sampleRate)
  for (let ch = 0; ch < 2; ch += 1) {
    const data = impulse.getChannelData(ch)
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3)
  }
  const convolver = c.createConvolver()
  convolver.buffer = impulse
  return convolver
}

function ensureContext() {
  if (ctx) return ctx
  const AudioCtx = window.AudioContext || window.webkitAudioContext
  if (!AudioCtx) return null
  ctx = new AudioCtx()

  const compressor = ctx.createDynamicsCompressor()
  compressor.threshold.value = -16
  compressor.ratio.value = 4
  compressor.connect(ctx.destination)

  master = ctx.createGain()
  master.connect(compressor)

  sfxBus = ctx.createGain()
  sfxBus.connect(master)

  const reverb = createReverb(ctx)
  const wet = ctx.createGain()
  wet.gain.value = 0.28
  reverbIn = ctx.createGain()
  reverbIn.connect(reverb).connect(wet).connect(master)

  musicBus = ctx.createGain()
  musicBus.connect(master)

  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const n = noiseBuffer.getChannelData(0)
  for (let i = 0; i < n.length; i += 1) n[i] = Math.random() * 2 - 1

  applyLevels()
  return ctx
}

/** Volume from settings (Bloxity's or the game's own); silent during ad breaks. */
function applyLevels() {
  if (!master) return
  const { masterVolume, musicVolume } = usePlatform.getState()
  const t = ctx.currentTime
  master.gain.setTargetAtTime(muted ? 0 : MAX_GAIN * masterVolume, t, 0.05)
  musicBus.gain.setTargetAtTime(MUSIC_LEVEL * musicVolume * (ducked ? DUCK_LEVEL : 1), t, 0.4)
}
usePlatform.subscribe((s, prev) => {
  if (s.masterVolume !== prev.masterVolume || s.musicVolume !== prev.musicVolume) applyLevels()
})

const ready = () => ctx && ctx.state === 'running'

/**
 * One enveloped oscillator note.
 * @param {{ type?: OscillatorType, gain?: number, attack?: number, glide?: number,
 *           filter?: number, filterEnd?: number, reverb?: number, bus?: AudioNode,
 *           vibrato?: number, detune?: number }} o
 */
function voice(freq, start, duration, o = {}) {
  const t = ctx.currentTime + start
  const osc = ctx.createOscillator()
  const amp = ctx.createGain()
  osc.type = o.type || 'sine'
  osc.frequency.setValueAtTime(freq, t)
  if (o.glide) osc.frequency.exponentialRampToValueAtTime(o.glide, t + duration * 0.9)
  if (o.detune) osc.detune.value = o.detune

  let node = osc
  if (o.filter) {
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(o.filter, t)
    if (o.filterEnd) lp.frequency.exponentialRampToValueAtTime(o.filterEnd, t + duration)
    node.connect(lp)
    node = lp
  }
  if (o.vibrato) {
    const lfo = ctx.createOscillator()
    const depth = ctx.createGain()
    lfo.frequency.value = 5.5
    depth.gain.value = o.vibrato
    lfo.connect(depth).connect(osc.frequency)
    lfo.start(t)
    lfo.stop(t + duration + 0.05)
  }

  const peak = o.gain ?? 0.3
  const attack = o.attack ?? 0.008
  amp.gain.setValueAtTime(0.0001, t)
  amp.gain.exponentialRampToValueAtTime(peak, t + attack)
  amp.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  node.connect(amp)
  amp.connect(o.bus || sfxBus)
  if (o.reverb) {
    const send = ctx.createGain()
    send.gain.value = o.reverb
    amp.connect(send).connect(reverbIn)
  }
  osc.start(t)
  osc.stop(t + duration + 0.05)
}

/** A bell / chime: FM synthesis, bright attack that mellows as it rings. */
function bell(freq, start, duration, gain = 0.2, bus = sfxBus, reverb = 0.6) {
  const t = ctx.currentTime + start
  const carrier = ctx.createOscillator()
  const mod = ctx.createOscillator()
  const modGain = ctx.createGain()
  const amp = ctx.createGain()
  carrier.frequency.value = freq
  mod.frequency.value = freq * 3.5
  modGain.gain.setValueAtTime(freq * 2.2, t)
  modGain.gain.exponentialRampToValueAtTime(freq * 0.05, t + duration)
  mod.connect(modGain).connect(carrier.frequency)
  amp.gain.setValueAtTime(0.0001, t)
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.006)
  amp.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  carrier.connect(amp).connect(bus)
  if (reverb) {
    const send = ctx.createGain()
    send.gain.value = reverb
    amp.connect(send).connect(reverbIn)
  }
  carrier.start(t)
  mod.start(t)
  carrier.stop(t + duration + 0.05)
  mod.stop(t + duration + 0.05)
}

/** Filtered noise: whooshes, clicks, drums, shakers, sparkle. */
function noise(start, duration, o = {}) {
  const t = ctx.currentTime + start
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer
  src.loop = true
  const filter = ctx.createBiquadFilter()
  filter.type = o.filter || 'bandpass'
  filter.frequency.setValueAtTime(o.freq || 2000, t)
  if (o.freqEnd) filter.frequency.exponentialRampToValueAtTime(o.freqEnd, t + duration)
  filter.Q.value = o.q ?? 1
  const amp = ctx.createGain()
  const peak = o.gain ?? 0.2
  amp.gain.setValueAtTime(0.0001, t)
  amp.gain.exponentialRampToValueAtTime(peak, t + (o.attack ?? 0.004))
  amp.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  src.connect(filter).connect(amp).connect(o.bus || sfxBus)
  if (o.reverb) {
    const send = ctx.createGain()
    send.gain.value = o.reverb
    amp.connect(send).connect(reverbIn)
  }
  src.start(t, Math.random() * 0.5)
  src.stop(t + duration + 0.05)
}

/** A soft drum hit: a pitched thump plus a little noise. */
function thump(start, freq, gain) {
  voice(freq, start, 0.18, { gain, glide: freq * 0.55 })
  noise(start, 0.06, { freq: 900, q: 0.7, gain: gain * 0.35 })
}

const NOTE = (semitonesFromA4) => 440 * Math.pow(2, semitonesFromA4 / 12)
const C4 = NOTE(-9)
const E4 = NOTE(-5)
const G4 = NOTE(-2)
const C5 = NOTE(3)
const E5 = NOTE(7)
const G5 = NOTE(10)
const A5 = NOTE(12)
const B5 = NOTE(14)
const C6 = NOTE(15)
const E6 = NOTE(19)
const G6 = NOTE(22)
const C7 = NOTE(27)

/* ---- Sound effects ------------------------------------------------------------------ */

const play = (fn) => () => {
  if (ready()) fn()
}

export const sfx = {
  /** Ad breaks: mute everything until the break ends. */
  setMuted: (value) => {
    muted = value
    applyLevels()
  },
  /** Music steps back while you are at a table, so the duel sounds stay clear. */
  setDucked: (value) => {
    if (ducked === value) return
    ducked = value
    applyLevels()
  },

  /** UI tap: a soft, short tick. */
  click: play(() => {
    voice(1500, 0, 0.05, { gain: 0.12, glide: 1100 })
    noise(0, 0.025, { freq: 4000, q: 2, gain: 0.05 })
  }),
  /** Not allowed / not enough cash: a soft low "uh-uh". */
  error: play(() => {
    voice(220, 0, 0.12, { type: 'square', filter: 900, gain: 0.08 })
    voice(185, 0.13, 0.18, { type: 'square', filter: 800, gain: 0.08 })
  }),
  /** Cash coming in: the classic two-note coin. */
  coin: play(() => {
    bell(B5, 0, 0.12, 0.16, sfxBus, 0.3)
    bell(E6, 0.07, 0.55, 0.18, sfxBus, 0.5)
    noise(0.07, 0.25, { filter: 'highpass', freq: 7000, gain: 0.03 })
  }),
  /** Bought something: a register "ka-ching" plus a sparkle. */
  buy: play(() => {
    noise(0, 0.05, { freq: 3000, q: 4, gain: 0.12 })
    bell(G5, 0.04, 0.3, 0.14)
    bell(C6, 0.1, 0.35, 0.14)
    bell(E6, 0.16, 0.7, 0.16)
    noise(0.16, 0.5, { filter: 'highpass', freq: 8000, gain: 0.035, reverb: 0.4 })
  }),
  /** Reward claimed / gift opened: a rising sparkle arpeggio. */
  reward: play(() => {
    ;[C6, E6, G6, C7].forEach((f, i) => bell(f, i * 0.07, 0.6, 0.14))
    noise(0, 0.5, { filter: 'highpass', freq: 6000, freqEnd: 10000, gain: 0.04, reverb: 0.5 })
  }),
  /** Countdown second: a wood block. */
  tick: play(() => {
    voice(880, 0, 0.09, { gain: 0.22, glide: 820 })
    noise(0, 0.03, { freq: 2200, q: 3, gain: 0.1 })
  }),
  /** Duel starts: a bright chord with a whoosh. */
  go: play(() => {
    noise(0, 0.35, { freq: 600, freqEnd: 3000, q: 0.8, gain: 0.08 })
    ;[C5, E5, G5, C6].forEach((f) => bell(f, 0.02, 0.9, 0.09))
  }),
  /** Your turn: a friendly two-note chime. */
  turn: play(() => {
    bell(G5, 0, 0.4, 0.15)
    bell(C6, 0.12, 0.7, 0.16)
  }),
  /** Waiting for the answer: a short, building drum roll. */
  drum: play(() => {
    const hits = 9
    for (let i = 0; i < hits; i += 1) {
      const t = (i / hits) * 0.95 * (1 - i * 0.025)
      thump(t, 150 + i * 6, 0.05 + i * 0.012)
    }
  }),
  /** Answer: HIGHER, a rising "whoop" and an upward chime. */
  higher: play(() => {
    voice(330, 0, 0.28, { type: 'triangle', glide: 880, gain: 0.16, filter: 2500 })
    bell(C6, 0.2, 0.4, 0.14)
    bell(G6, 0.3, 0.7, 0.15)
  }),
  /** Answer: LOWER, a falling "whoop" and a downward chime. */
  lower: play(() => {
    voice(880, 0, 0.28, { type: 'triangle', glide: 300, gain: 0.16, filter: 2500 })
    bell(G5, 0.2, 0.4, 0.14)
    bell(C5, 0.3, 0.7, 0.15)
  }),
  /** Won the duel: a fanfare, a big chord and a cymbal shimmer. */
  win: play(() => {
    ;[C5, E5, G5].forEach((f, i) => voice(f, i * 0.11, 0.18, { type: 'square', filter: 2200, gain: 0.09 }))
    for (const f of [C5, E5, G5, C6]) {
      voice(f, 0.34, 1.3, { type: 'sawtooth', filter: 2600, filterEnd: 900, gain: 0.05, reverb: 0.4 })
      bell(f * 2, 0.34, 1.2, 0.07)
    }
    thump(0.34, 110, 0.25)
    noise(0.34, 1.4, { filter: 'highpass', freq: 6000, gain: 0.06, reverb: 0.6 })
  }),
  /** Lost the duel: the sad trombone, "wah wah wah wahhh". */
  lose: play(() => {
    const notes = [NOTE(-2), NOTE(-3), NOTE(-4), NOTE(-5)]
    notes.forEach((f, i) => {
      const last = i === notes.length - 1
      voice(f, i * 0.42, last ? 1.3 : 0.4, {
        type: 'sawtooth',
        filter: 1300,
        filterEnd: last ? 500 : 900,
        gain: 0.11,
        attack: 0.04,
        vibrato: last ? 6 : 0,
        reverb: 0.25,
      })
    })
  }),
  /** Jump: a little "boing". */
  jump: play(() => {
    voice(260, 0, 0.18, { type: 'triangle', glide: 620, gain: 0.08 })
  }),
  /** A speech bubble / emote: a bubbly pop. */
  pop: play(() => {
    voice(500, 0, 0.09, { glide: 1300, gain: 0.1 })
  }),
}

/* ---- Background music ----------------------------------------------------------------
 * A relaxed loop: soft pad chords, a round bass and a little bell melody over
 * I–vi–IV–V in C, with a gentle shaker. Notes are scheduled slightly ahead on the
 * audio clock, so timing stays steady even if the page is busy. */

const BPM = 92
const BEAT = 60 / BPM
const LOOKAHEAD_S = 0.25
// Each chord: [bass root, pad notes, melody pool].
const PROGRESSION = [
  [C4 / 2, [C4, E4, G4], [C5, E5, G5, A5]], // C
  [NOTE(-12) / 2, [NOTE(-12), C4, E4], [C5, E5, A5, C6]], // Am
  [NOTE(-16) / 2, [NOTE(-16), NOTE(-12), C4], [C5, NOTE(8), A5, C6]], // F
  [NOTE(-14) / 2, [NOTE(-14), NOTE(-10), NOTE(-7)], [NOTE(5), G5, B5, NOTE(17)]], // G
]

let musicTimer = null
let nextBarTime = 0
let bar = 0

function scheduleBar(t0) {
  const [root, pad, melody] = PROGRESSION[bar % PROGRESSION.length]
  const start = t0 - ctx.currentTime
  // Pad: soft detuned triangles, slow swell.
  for (const f of pad) {
    for (const detune of [-6, 6]) {
      voice(f, start, BEAT * 4, { type: 'triangle', gain: 0.05, attack: 0.5, filter: 900, detune, bus: musicBus, reverb: 0.3 })
    }
  }
  // Bass on beats 1 and 3.
  voice(root, start, BEAT * 1.6, { gain: 0.16, attack: 0.02, filter: 400, bus: musicBus })
  voice(root, start + BEAT * 2, BEAT * 1.6, { gain: 0.12, attack: 0.02, filter: 400, bus: musicBus })
  // Melody: a few bell notes on the eighth-note grid, different every pass.
  for (let step = 0; step < 8; step += 1) {
    if (Math.random() < (step % 2 === 0 ? 0.45 : 0.2)) {
      const f = melody[Math.floor(Math.random() * melody.length)]
      bell(f, start + step * (BEAT / 2), BEAT * 1.5, 0.045, musicBus, 0.7)
    }
  }
  // Shaker on the off-beats.
  for (let step = 1; step < 8; step += 2) {
    noise(start + step * (BEAT / 2), 0.07, { filter: 'highpass', freq: 7000, gain: 0.02, bus: musicBus })
  }
  bar += 1
}

function musicTick() {
  if (!ready()) return
  while (nextBarTime < ctx.currentTime + LOOKAHEAD_S) {
    scheduleBar(nextBarTime)
    nextBarTime += BEAT * 4
  }
}

function startMusic() {
  if (musicTimer || !ctx) return
  nextBarTime = ctx.currentTime + 0.3
  musicTimer = setInterval(musicTick, 100)
}

/* ---- Unlock on first gesture ------------------------------------------------------- */

export function unlockAudioOnFirstGesture() {
  const unlock = () => {
    const c = ensureContext()
    if (!c) return
    c.resume().then(startMusic)
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
  // A hidden tab makes no sound and uses no battery.
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return
    if (document.hidden) ctx.suspend()
    else {
      ctx.resume()
      // Don't try to catch up on bars missed while hidden.
      nextBarTime = Math.max(nextBarTime, ctx.currentTime + 0.1)
    }
  })
}
