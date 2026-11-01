/**
 * The scene's whole look in one place: a bright toy-brick world with a saturated blue
 * sky, lime studded baseplate, tan checker brick walls and orange wooden fences.
 *
 * Colours are sRGB hex, exactly as you would pick them in an image editor.
 *
 * Light intensities are three.js physical units: a light of intensity PI (~3.14)
 * lights a surface facing it to its full texture colour. The hemisphere fill plus the
 * sun add up to just over that on the ground, which is what keeps the greens vivid;
 * shadowed ground only gets the fill, so shadows read as a softer, darker green.
 */

export const SKY = {
  /** Straight up. */
  top: '#2a8af5',
  /** At eye level. Fog uses the same colour so distant ground melts into the sky. */
  horizon: '#86c8fb',
  /** Lower = the deep blue reaches further down towards the horizon. */
  exponent: 0.3,
}

/** Haze at the horizon. Distances scale with the quality preset's view distance. */
export const FOG = {
  color: SKY.horizon,
  /** Fraction of the view distance where the haze starts. */
  nearFraction: 0.3,
}

export const CLOUDS = {
  /** Sunlit tops. */
  top: '#ffffff',
  /** Undersides, a cool blue-grey. */
  bottom: '#cfdff2',
  count: 18,
}

/** The sea around the island; fog at the horizon blends it into the sky. */
export const OCEAN = {
  color: '#2bbff2',
}

/** Neon lime baseplate, two shades in a checker. */
export const GROUND = {
  base: '#5cee30',
  alt: '#52de2b',
}

/** Tan checker brick for the boundary walls. */
export const WALLS = {
  base: '#c4955c',
  alt: '#a3774a',
}

export const FENCE = {
  rail: '#c8662e',
  post: '#a8501f',
}

export const LIGHTS = {
  /** Fill from above (sky) and below (bounce off the grass). */
  hemiSky: '#ffffff',
  hemiGround: '#b7c9a3',
  hemiIntensity: 2.1,

  sunColor: '#fff6e8',
  sunIntensity: 1.7,
  /**
   * Direction *towards* the sun: high and a little to the left, behind the default
   * camera, so the side of the character you look at is lit and its shadow falls
   * beside it where you can see it, not hidden behind its back.
   */
  sunDirection: [-0.35, 0.9, 0.2],
  /** 1 = shadows get no sunlight at all; lower = lighter shadows. */
  shadowIntensity: 0.8,
  /** Blur radius of shadow edges, in shadow-map texels. */
  shadowSoftness: 4,
}
