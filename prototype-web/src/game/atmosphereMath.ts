import type { CelestialBodyDef } from './types';

export interface AtmosphereScatteringParams {
  /** Wavelength-dependent Rayleigh scattering coefficients (R, G, B) */
  betaRayleigh: [number, number, number];
  /** Aerosol Mie forward-scattering color coefficients (R, G, B) */
  betaMie: [number, number, number];
  /** Henyey-Greenstein Mie phase asymmetry g (-1..1, typically 0.72..0.82) */
  mieG: number;
  /** Normalized Rayleigh scale height as fraction of atmosphere shell thickness */
  scaleHeightRatio: number;
  /** Optical refractive bending & chromatic limb dispersion strength (0..1) */
  refractiveDispersion: number;
  /** Overall scattering radiance intensity */
  intensity: number;
}

export interface AtmosphericEntryState {
  /** 0 in space -> 1 at planetary surface */
  immersion: number;
  /** 0 in space -> peaks during atmospheric entry / horizon grazing */
  refractionShift: number;
  /** 0 at rest -> rises when descending rapidly through upper/mid atmosphere */
  entryGlow: number;
  /** 0 in vacuum -> peaks during Max-Q hypersonic atmospheric buffeting & turbulence */
  buffeting: number;
  /** 0 in vacuum/night -> 1 in bright daytime atmosphere (dims faint background stars) */
  starAttenuation: number;
}

export interface EntryPlasmaPalette {
  noseHot: string;
  shockCore: string;
  wakeIon: string;
}

/**
 * Derive physically grounded Rayleigh (lambda^-4) & Mie scattering coefficients
 * from each world's atmospheric composition and archetype.
 */
export function getPlanetRayleighParams(body: CelestialBodyDef): AtmosphereScatteringParams {
  const density = body.atmosphere?.density ?? 0;
  if (!body.atmosphere || density <= 0.01) {
    return {
      betaRayleigh: [0.18, 0.42, 0.85],
      betaMie: [0.35, 0.45, 0.6],
      mieG: 0.72,
      scaleHeightRatio: 0.25,
      refractiveDispersion: 0.0,
      intensity: 0.0,
    };
  }

  switch (body.archetype) {
    case 'earth':
    case 'exo-ocean':
    case 'exo-temperate':
      // Classic N2/O2 Rayleigh scattering: deep short-wavelength blue scatter + warm golden-red sunset transmittance
      return {
        betaRayleigh: [0.16, 0.46, 1.0],
        betaMie: [1.0, 0.86, 0.68],
        mieG: 0.79,
        scaleHeightRatio: 0.27,
        refractiveDispersion: 0.52,
        intensity: 1.38 * Math.min(1.5, 0.65 + density * 0.45),
      };

    case 'mars':
    case 'exo-desert':
      // Iron-oxide suspended dust: warm butterscotch Rayleigh scatter with cool blue forward Mie twilight
      return {
        betaRayleigh: [0.96, 0.44, 0.2],
        betaMie: [0.42, 0.65, 0.98],
        mieG: 0.74,
        scaleHeightRatio: 0.34,
        refractiveDispersion: 0.38,
        intensity: 1.18 * Math.min(1.4, 0.55 + density * 0.7),
      };

    case 'venus':
    case 'titan':
      // Super-dense sulfuric acid / nitrogen-methane smog with heavy forward refraction
      return {
        betaRayleigh: [0.98, 0.62, 0.2],
        betaMie: [1.0, 0.76, 0.38],
        mieG: 0.68,
        scaleHeightRatio: 0.42,
        refractiveDispersion: 0.64,
        intensity: 1.48,
      };

    case 'neptune':
    case 'uranus':
      // Methane-rich deep azure / aquamarine scattering
      return {
        betaRayleigh: [0.14, 0.54, 1.0],
        betaMie: [0.58, 0.86, 1.0],
        mieG: 0.76,
        scaleHeightRatio: 0.3,
        refractiveDispersion: 0.4,
        intensity: 1.35,
      };

    case 'jupiter':
    case 'saturn':
      // Ammonia-hydrogen upper haze bands
      return {
        betaRayleigh: [0.88, 0.66, 0.38],
        betaMie: [0.98, 0.86, 0.64],
        mieG: 0.74,
        scaleHeightRatio: 0.32,
        refractiveDispersion: 0.36,
        intensity: 1.2,
      };

    case 'exo-lava':
      // Volcanic sulfur-ash glow
      return {
        betaRayleigh: [1.0, 0.34, 0.14],
        betaMie: [1.0, 0.56, 0.28],
        mieG: 0.72,
        scaleHeightRatio: 0.32,
        refractiveDispersion: 0.44,
        intensity: 1.22,
      };

    default:
      // Cryogenic nitrogen / water-vapor exospheres (Pluto, Triton, Europa, Enceladus, Exo-Ice)
      return {
        betaRayleigh: [0.24, 0.6, 1.0],
        betaMie: [0.74, 0.9, 1.0],
        mieG: 0.76,
        scaleHeightRatio: 0.26,
        refractiveDispersion: 0.28,
        intensity: Math.min(1.2, 0.45 + density * 0.8),
      };
  }
}

/**
 * Derive realistic ionized re-entry plasma emission spectra from atmospheric chemistry:
 * N2/O2 (Earth) -> white-gold nose, orange shock, magenta-violet nitrogen wake;
 * CO2 (Mars) -> crimson-orange shock; CH4/H2SO4 (Titan/Venus) -> golden-cyan ionization.
 */
export function getEntryPlasmaPalette(body: CelestialBodyDef): EntryPlasmaPalette {
  switch (body.archetype) {
    case 'mars':
    case 'exo-desert':
    case 'exo-lava':
      return { noseHot: '#fff1cc', shockCore: '#ff4b18', wakeIon: '#ff2a38' };
    case 'titan':
    case 'venus':
      return { noseHot: '#fff6d4', shockCore: '#ff9624', wakeIon: '#58d4ff' };
    case 'europa':
    case 'enceladus':
    case 'triton':
    case 'exo-ice':
    case 'pluto':
      return { noseHot: '#f0fbff', shockCore: '#74d2ff', wakeIon: '#a88cff' };
    default:
      // Earth / temperate N2-O2 atmospheric re-entry spectrum (blazing white-gold -> solar orange -> fiery ember wake)
      return { noseHot: '#fff8e6', shockCore: '#ff6e14', wakeIon: '#e83816' };
  }
}

/**
 * Compute real-time atmospheric immersion, refractive light bending, entry airglow,
 * and aerodynamic Max-Q buffeting as the player descends from vacuum toward a planet's surface.
 */
export function computeAtmosphericEntryState(
  body: CelestialBodyDef,
  altitude: number,
  speedUnitsPerSec: number,
  sunElevationCos: number, // dot(surfaceUp, sunDir), -1..1
): AtmosphericEntryState {
  const atmo = body.atmosphere;
  if (!atmo || atmo.density <= 0.03) {
    return {
      immersion: 0,
      refractionShift: 0,
      entryGlow: 0,
      buffeting: 0,
      starAttenuation: 0,
    };
  }

  // Outer optical envelope extends through the thermosphere/mesosphere so refraction ramps smoothly on descent
  const opticalTop = body.radius * Math.max(0.36, atmo.heightRatio * 4.4);
  if (altitude >= opticalTop) {
    return {
      immersion: 0,
      refractionShift: 0,
      entryGlow: 0,
      buffeting: 0,
      starAttenuation: 0,
    };
  }

  const normalizedDepth = Math.max(0, Math.min(1, 1 - altitude / opticalTop));
  // Exponential pressure buildup as altitude drops
  const immersion = Math.min(1, Math.pow(normalizedDepth, 1.32) * Math.min(1.18, 0.58 + atmo.density * 0.55));

  // Refractive horizon bending peaks in the mid/lower stratosphere and during terminator twilight
  const twilightFactor = Math.exp(-Math.pow((sunElevationCos + 0.08) * 2.6, 2));
  const refractionShift = Math.min(
    1,
    immersion * (0.48 + twilightFactor * 0.65) * Math.min(1.3, 0.5 + atmo.density * 0.5),
  );

  // Realistic broad mesosphere-to-stratosphere Max-Q thermal compression heating envelope
  const entryBand = Math.pow(Math.max(0, Math.sin(normalizedDepth * Math.PI)), 0.72);
  const speedFactor = Math.max(0, Math.min(1, (speedUnitsPerSec - 4.0) / 28));
  const entryGlow = Math.min(1, entryBand * speedFactor * Math.min(1.35, 0.25 + atmo.density * 0.95));

  // Aerodynamic turbulence & airframe vibration builds with dynamic pressure q ~ density * v^2
  const aeroSpeed = Math.max(0, Math.min(1, (speedUnitsPerSec - 2.2) / 24));
  const buffeting = Math.min(
    1,
    Math.pow(normalizedDepth, 0.75) * (1 - Math.pow(normalizedDepth, 4.0) * 0.65) * aeroSpeed * Math.min(1.35, atmo.density),
  );

  // Bright daylight Rayleigh sky naturally masks stars completely; night hemisphere reveals them cleanly
  const daylight = Math.max(0, Math.min(1, (sunElevationCos + 0.18) / 0.58));
  const starAttenuation = Math.min(1.0, immersion * daylight * Math.min(1.08, atmo.density * 1.04));

  return {
    immersion,
    refractionShift,
    entryGlow,
    buffeting,
    starAttenuation,
  };
}
