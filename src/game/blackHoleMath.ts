export interface BlackHoleRelativityState {
  /** Schwarzschild gravitational time dilation factor sqrt(1 - Rs/r), 0..1 */
  timeDilation: number;
  /** Inward gravitational pull acceleration in scene units/s^2 */
  tidalPullAccel: number;
  /** Psychological/audio dread intensity 0..1 as player nears photon sphere & horizon */
  dreadIntensity: number;
  /** True when inside the critical photon-sphere danger zone (< 3.3 Rs) */
  horizonWarning: boolean;
  /** True when inside the irreversible gravitational capture threshold (<= 1.42 Rs): escape velocity -> c, no turning back! */
  pointOfNoReturn: boolean;
  /** True when breaching the event horizon boundary (<= 1.12 Rs) */
  crossedHorizon: boolean;
}

/**
 * Compute real general-relativistic gravitational time dilation, tidal pull,
 * point-of-no-return horizon capture, and photon-sphere proximity telemetry around a black hole.
 */
export function computeBlackHoleRelativity(
  distanceFromCenter: number,
  schwarzschildRadius: number,
): BlackHoleRelativityState {
  const rs = Math.max(1, schwarzschildRadius);
  const rRatio = distanceFromCenter / rs;

  if (rRatio >= 22) {
    return {
      timeDilation: 1.0,
      tidalPullAccel: 0,
      dreadIntensity: 0,
      horizonWarning: false,
      pointOfNoReturn: false,
      crossedHorizon: false,
    };
  }

  // Exact Schwarzschild gravitational time dilation: dTau / dt = sqrt(1 - Rs / r)
  const clampedRatio = Math.max(1.015, rRatio);
  const timeDilation = Math.sqrt(Math.max(0.01, 1 - 1 / clampedRatio));

  // Smooth inverse-square relativistic tidal pull outside 1.42 Rs, surging steeply inside the capture horizon
  const pullNorm = 1 / Math.pow(Math.max(1.05, rRatio - 0.35), 2.25);
  const captureSurge = rRatio <= 1.42 ? 2.4 : 1.0;
  const tidalPullAccel = rRatio < 12 ? Math.min(920, pullNorm * 1_650 * captureSurge) : 0;

  // Dread audio & camera tremor intensify steeply inside 12 Rs -> 1.4 Rs
  const dreadIntensity = Math.max(0, Math.min(1, 1 - (rRatio - 1.35) / 10.6));

  return {
    timeDilation,
    tidalPullAccel,
    dreadIntensity,
    horizonWarning: rRatio <= 3.3,
    pointOfNoReturn: rRatio <= 1.42,
    crossedHorizon: rRatio <= 1.12,
  };
}

/**
 * Approximate Schwarzschild gravitational light-bending deflection angle (radians)
 * for a photon with impact parameter b > b_crit = (3*sqrt(3)/2) * Rs.
 * Combines Einstein's weak-field 2*Rs/b law with logarithmic strong-field divergence near the photon sphere.
 */
export function computeDeflectionAngleRad(
  impactParameter: number,
  schwarzschildRadius: number,
): number {
  const rs = Math.max(1, schwarzschildRadius);
  const bCrit = 2.598076211 * rs;
  if (impactParameter <= bCrit) {
    return Number.POSITIVE_INFINITY; // Captured by the Event Horizon
  }
  const weakField = (2 * rs) / impactParameter;
  const strongBoost = Math.max(0, -Math.log(Math.min(1, (impactParameter - bCrit) / (2.2 * rs)))) * 0.65;
  return weakField + strongBoost;
}

export interface HawkingRadiationProfile {
  /** Normalized camera proximity to the event horizon (0 = far orbit >= 14 Rs, 1 = close photon sphere <= 2.2 Rs) */
  proximity: number;
  /** Subtle emission brightness multiplier (scales up gracefully as camera nears the horizon) */
  intensity: number;
  /** Escaping quantum particle drift speed multiplier */
  emissionSpeed: number;
  /** Local gravitational blueshift factor (1 + z) = 1 / sqrt(1 - Rs / r) */
  blueshiftFactor: number;
  /** Primary spectral RGB (0..1): shifts from cool deep violet-indigo (far) -> electric cyan (mid) -> high-energy Cherenkov cyan-white (close) */
  primaryColor: [number, number, number];
  /** Secondary accent RGB (0..1): shifts from muted magenta-lavender (far) -> ionized azure-violet (mid) -> ultraviolet-white gamma spark (close) */
  secondaryColor: [number, number, number];
}

function lerpScalar(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRgb(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [lerpScalar(a[0], b[0], t), lerpScalar(a[1], b[1], t), lerpScalar(a[2], b[2], t)];
}

const HAWKING_FAR_PRIMARY: readonly [number, number, number] = [0.64, 0.24, 0.98]; // Redshifted deep quantum violet-indigo
const HAWKING_MID_PRIMARY: readonly [number, number, number] = [0.14, 0.82, 1.0]; // Electric sapphire-cyan
const HAWKING_CLOSE_PRIMARY: readonly [number, number, number] = [0.78, 0.98, 1.0]; // High-energy Cherenkov cyan-white

const HAWKING_FAR_SECONDARY: readonly [number, number, number] = [0.96, 0.36, 0.82]; // Delicate magenta-violet virtual pair flash
const HAWKING_MID_SECONDARY: readonly [number, number, number] = [0.42, 0.58, 1.0]; // Ionized azure-violet
const HAWKING_CLOSE_SECONDARY: readonly [number, number, number] = [0.62, 0.94, 1.0]; // Blazing ultraviolet-cyan gamma core

/**
 * Compute camera-proximity Hawking / Unruh quantum radiation parameters around a black hole.
 * Models gravitational blueshift as the observer approaches the event horizon:
 * distant observers see subtle, cooler violet-magenta quanta; closer observers experience
 * heightened emission flux shifted into electric cyan, ultraviolet, and Cherenkov white.
 */
export function computeHawkingRadiationProfile(
  cameraDistanceFromCenter: number,
  schwarzschildRadius: number,
): HawkingRadiationProfile {
  const rs = Math.max(1, schwarzschildRadius);
  const rRatio = Math.max(1.06, cameraDistanceFromCenter / rs);

  // Smooth proximity ramp from 13.5 Rs (far orbit) down to 2.5 Rs (grazing photon sphere)
  const rawProx = Math.max(0, Math.min(1, (13.5 - rRatio) / (13.5 - 2.5)));
  const proximity = Math.pow(rawProx, 1.1);

  // Exact Schwarzschild gravitational blueshift factor 1 / sqrt(1 - Rs/r)
  const blueshiftFactor = 1 / Math.sqrt(Math.max(0.06, 1 - 1 / rRatio));

  // Piecewise smooth spectral shift across far -> mid -> close regimes
  const primaryColor: [number, number, number] =
    proximity < 0.5
      ? lerpRgb(HAWKING_FAR_PRIMARY, HAWKING_MID_PRIMARY, proximity * 2)
      : lerpRgb(HAWKING_MID_PRIMARY, HAWKING_CLOSE_PRIMARY, (proximity - 0.5) * 2);

  const secondaryColor: [number, number, number] =
    proximity < 0.5
      ? lerpRgb(HAWKING_FAR_SECONDARY, HAWKING_MID_SECONDARY, proximity * 2)
      : lerpRgb(HAWKING_MID_SECONDARY, HAWKING_CLOSE_SECONDARY, (proximity - 0.5) * 2);

  // Subtle & atmospheric at orbital distance, intensifying crisply near the event horizon
  const intensity = 0.62 + proximity * 0.98;
  const emissionSpeed = 0.78 + proximity * 1.32;

  return {
    proximity,
    intensity,
    emissionSpeed,
    blueshiftFactor,
    primaryColor,
    secondaryColor,
  };
}

