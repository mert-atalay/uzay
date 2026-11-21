import type { BodyKind } from './types';
import type { TesseractStage } from './tesseractMath';

export type HorizonIndicatorMode = 'none' | 'atmosphere' | 'event-horizon' | 'point-of-no-return';
export type HorizonSeverity = 'nominal' | 'caution' | 'critical' | 'irreversible';

export interface HorizonProximityInput {
  nearestBodyKind: BodyKind;
  nearestBodyName: string;
  altitude: number;
  bodyRadius: number;
  atmosphereDensity: number;
  atmosphereHeightRatio: number;
  blackHoleDistance: number | null;
  blackHoleRadius: number | null;
  blackHoleProximity: number; // 0..1
  horizonWarning: boolean;
  pointOfNoReturn: boolean;
  isLanded: boolean;
  tesseractStage: TesseractStage;
}

export interface HorizonProximityState {
  visible: boolean;
  mode: HorizonIndicatorMode;
  severity: HorizonSeverity;
  /** Normalized 0..1 danger / proximity fill */
  proximity: number;
  /** Dynamic CSS hex color transitioning from subtle sky blue -> amber -> urgent crimson red */
  colorHex: string;
  /** Short uppercase status label for the HUD indicator */
  label: string;
  /** Compact scientific readout (e.g. '3.4 Rs', 'r < Rs · LOCKED', '0.68 atm') */
  metricText: string;
  /** True when indicator should pulse urgently */
  pulseUrgent: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function toHexByte(n: number): string {
  return Math.round(clamp(n, 0, 255))
    .toString(16)
    .padStart(2, '0');
}

/**
 * Smoothly interpolates RGB hex color across the aerospace warning ramp:
 * 0.0 -> Subtle Celestial Blue (#38bdf8)
 * 0.45 -> Electric Cyan-Amber (#38d9f5 -> #f59e0b)
 * 0.78 -> Urgent Orange-Red (#f97316 -> #ef4444)
 * 1.0 -> Critical Singularity Crimson (#ff2432)
 */
export function interpolateHorizonColor(proximity: number): string {
  const t = clamp(proximity, 0, 1);
  let r: number;
  let g: number;
  let b: number;

  if (t < 0.42) {
    const k = t / 0.42;
    // #38bdf8 (56, 189, 248) -> #38d9c8 (56, 217, 200) -> #eab308 (234, 179, 8)
    r = lerp(56, 234, k * k);
    g = lerp(189, 179, k);
    b = lerp(248, 36, k);
  } else if (t < 0.76) {
    const k = (t - 0.42) / 0.34;
    // #eab308 (234, 179, 8) -> #f97316 (249, 115, 22) -> #ef4444 (239, 68, 68)
    r = lerp(234, 245, k);
    g = lerp(179, 72, k);
    b = lerp(36, 46, k);
  } else {
    const k = (t - 0.76) / 0.24;
    // #f5482e (245, 72, 46) -> #ff1e2e (255, 30, 46)
    r = lerp(245, 255, k);
    g = lerp(72, 30, k);
    b = lerp(46, 46, k);
  }

  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

/**
 * Computes the dynamic 'Horizon Proximity Indicator' state for the HUD.
 * Transitions smoothly from subtle blue -> amber -> urgent red as Voyager approaches
 * either a Black Hole's Event Horizon or a planet's atmospheric entry interface.
 */
export function computeHorizonProximityIndicator(
  input: HorizonProximityInput,
): HorizonProximityState {
  // Inside the 5D Tesseract, external horizons are behind us
  if (input.tesseractStage === 'tesseract') {
    return {
      visible: false,
      mode: 'none',
      severity: 'nominal',
      proximity: 0,
      colorHex: '#38bdf8',
      label: '',
      metricText: '',
      pulseUrgent: false,
    };
  }

  // Active Event Horizon free-fall plunge: maximum irreversible crimson alert
  if (input.tesseractStage === 'plunge') {
    return {
      visible: true,
      mode: 'point-of-no-return',
      severity: 'irreversible',
      proximity: 1,
      colorHex: '#ff1e2e',
      label: 'EVENT HORIZON · NO RETURN',
      metricText: 'r < Rs · v_esc > c',
      pulseUrgent: true,
    };
  }

  // 1. Black Hole Event Horizon proximity takes priority whenever within gravitational influence (< 14 Rs)
  if (
    input.blackHoleDistance !== null &&
    input.blackHoleRadius !== null &&
    input.blackHoleRadius > 0
  ) {
    const rRatio = input.blackHoleDistance / input.blackHoleRadius;
    if (rRatio < 14.5) {
      // Smooth nonlinear scale: 14.5 Rs -> 0.05, 5.0 Rs -> 0.50, 2.5 Rs -> 0.80, 1.35 Rs -> 0.96, <= 1.12 Rs -> 1.0
      const linear = clamp((14.5 - rRatio) / (14.5 - 1.12), 0, 1);
      const proximity = clamp(Math.pow(linear, 1.18), 0.04, 1);

      if (input.pointOfNoReturn || rRatio <= 1.38) {
        return {
          visible: true,
          mode: 'point-of-no-return',
          severity: 'irreversible',
          proximity: Math.max(0.95, proximity),
          colorHex: '#ff1e2e',
          label: 'HORIZON CAPTURE · NO RETURN',
          metricText: `${rRatio.toFixed(2)} Rs · LOCKED`,
          pulseUrgent: true,
        };
      }

      if (input.horizonWarning || rRatio <= 3.3) {
        return {
          visible: true,
          mode: 'event-horizon',
          severity: 'critical',
          proximity: Math.max(0.74, proximity),
          colorHex: interpolateHorizonColor(Math.max(0.76, proximity)),
          label: 'PHOTON SPHERE · DANGER',
          metricText: `${rRatio.toFixed(2)} Rs`,
          pulseUrgent: true,
        };
      }

      const severity: HorizonSeverity = proximity > 0.45 ? 'caution' : 'nominal';
      return {
        visible: true,
        mode: 'event-horizon',
        severity,
        proximity,
        colorHex: interpolateHorizonColor(proximity),
        label: proximity > 0.45 ? 'GRAVITY WELL · DEEPENING' : 'HORIZON PROXIMITY',
        metricText: `${rRatio.toFixed(1)} Rs`,
        pulseUrgent: false,
      };
    }
  }

  // 2. Planetary Atmospheric Entry Interface proximity
  if (
    !input.isLanded &&
    input.nearestBodyKind !== 'star' &&
    input.nearestBodyKind !== 'black-hole' &&
    input.atmosphereDensity > 0.04
  ) {
    // Outer approach envelope starts at ~1.6x planet radius so the player feels scale early
    const atmoTop = input.bodyRadius * Math.max(0.36, input.atmosphereHeightRatio * 4.4);
    const outerApproach = Math.max(atmoTop * 3.1, input.bodyRadius * 1.65);

    if (input.altitude < outerApproach) {
      const proximity = clamp(1 - input.altitude / outerApproach, 0.04, 1);
      const inAtmo = input.altitude < atmoTop;
      const deepEntry = input.altitude < atmoTop * 0.45;
      const localPressureAtm = inAtmo
        ? input.atmosphereDensity * Math.pow(clamp(1 - input.altitude / atmoTop, 0, 1), 1.6)
        : 0;

      const severity: HorizonSeverity = deepEntry
        ? 'critical'
        : inAtmo
          ? 'caution'
          : 'nominal';

      const label = deepEntry
        ? 'ATMO ENTRY · MAX-Q'
        : inAtmo
          ? 'UPPER ATMOSPHERE'
          : 'ATMO HORIZON';

      const metricText = inAtmo
        ? `${localPressureAtm.toFixed(2)} atm`
        : `${Math.round(proximity * 100)}%`;

      return {
        visible: true,
        mode: 'atmosphere',
        severity,
        proximity,
        colorHex: interpolateHorizonColor(proximity * 0.88),
        label,
        metricText,
        pulseUrgent: deepEntry && input.atmosphereDensity >= 0.6,
      };
    }
  }

  return {
    visible: false,
    mode: 'none',
    severity: 'nominal',
    proximity: 0,
    colorHex: '#38bdf8',
    label: '',
    metricText: '',
    pulseUrgent: false,
  };
}
