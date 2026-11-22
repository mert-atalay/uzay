/**
 * Converts the AI Studio prototype's universe catalogue into true-scale SI data
 * for the Godot game (data/universe.json).
 *
 * Run from the repo root:  bun tools/export_universe.ts
 *
 * The prototype stored orbits in compressed "scene units". Here every body gets
 * real values: radius and semi-major axis in metres, mass in kg, mean motion
 * from Kepler's third law, and the star systems at their real distances.
 */
import { CELESTIAL_BODIES, STAR_SYSTEMS, LY_UNITS } from '../prototype-web/src/game/universeData';

const G = 6.6743e-11;
const AU = 149_597_870_700;
const LY = 9_460_730_472_580_800;
const C = 299_792_458;
const M_SUN = 1.98892e30;
const G0 = 9.80665;

// Stellar masses in solar masses (published values; the prototype had none).
const STAR_MASS_SOLAR: Record<string, number> = {
  sun: 1.0,
  'alpha-cen-a': 1.079,
  'alpha-cen-b': 0.909,
  proxima: 0.122,
  'barnard-star': 0.162,
  'sirius-a': 2.063,
  'sirius-b': 1.018,
  'eps-eri': 0.82,
  'tau-ceti-star': 0.783,
  'vega-star': 2.135,
  'trappist-1-star': 0.0898,
  'betelgeuse-star': 16.5,
  'sgr-a-star': 4.297e6,
  'sgr-s2': 13.6,
};

// Corrections where the prototype's label was wrong or compressed.
const ORBIT_OVERRIDES: Record<string, { aAU?: number; e?: number }> = {
  proxima: { aAU: 8700, e: 0.5 }, // Proxima orbits Alpha Cen AB at ~8,700 AU (Kervella et al. 2017)
  'sgr-s2': { aAU: 1031, e: 0.8847 }, // S2 around Sgr A* (GRAVITY Collaboration 2018)
};

// Sidereal rotation periods in hours (negative = retrograde). Moons not listed are tidally locked.
const ROTATION_HOURS: Record<string, number> = {
  sun: 609.12,
  mercury: 1407.6,
  venus: -5832.5,
  earth: 23.9345,
  mars: 24.6229,
  jupiter: 9.925,
  saturn: 10.656,
  uranus: -17.24,
  neptune: 16.11,
  pluto: -153.29,
};

function parseSemiMajorAxisMetres(label: string): number | null {
  const m = label.replace(/,/g, '').match(/([\d.]+)\s*(AU|km|ly)\b/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === 'au') return v * AU;
  if (unit === 'km') return v * 1000;
  return null; // "ly from Sol" is a distance to Earth, not an orbit
}

const byId = Object.fromEntries(CELESTIAL_BODIES.map((b) => [b.id, b]));

function massKg(id: string): number {
  const b = byId[id];
  if (STAR_MASS_SOLAR[id] !== undefined) return STAR_MASS_SOLAR[id] * M_SUN;
  const r = b.realRadiusKm * 1000;
  return (b.gravityG * G0 * r * r) / G;
}

const bodies = CELESTIAL_BODIES.map((b) => {
  const mass = massKg(b.id);
  let radius = b.realRadiusKm * 1000;
  if (b.kind === 'black-hole') radius = (2 * G * mass) / (C * C); // Schwarzschild radius

  let a = 0;
  let e = b.orbitEccentricity ?? 0;
  let n = 0;
  if (b.parentId) {
    const ov = ORBIT_OVERRIDES[b.id] ?? {};
    const parent = byId[b.parentId];
    a =
      (ov.aAU ? ov.aAU * AU : null) ??
      parseSemiMajorAxisMetres(b.realDistanceLabel) ??
      // Fictional moons with no label: keep the prototype's orbit/parent-radius ratio.
      (b.orbitRadius / parent.radius) * parent.realRadiusKm * 1000;
    if (ov.e !== undefined) e = ov.e;
    const mu = G * (massKg(b.parentId) + mass);
    n = Math.sqrt(mu / (a * a * a)) * Math.sign(b.orbitSpeed || 1);
  }

  // Moons, and planets hugging their star (< 0.1 AU, e.g. TRAPPIST-1, Proxima b), are tidally locked.
  const tidallyLocked =
    ROTATION_HOURS[b.id] === undefined && (b.kind === 'moon' || (b.kind === 'planet' && a > 0 && a < 0.1 * AU));
  const rotationHours = ROTATION_HOURS[b.id] ?? (tidallyLocked && n ? (2 * Math.PI) / Math.abs(n) / 3600 : 24);

  return {
    id: b.id,
    name: b.name,
    system: b.systemId,
    parent: b.parentId,
    kind: b.kind,
    archetype: b.archetype,
    radius_m: radius,
    mass_kg: mass,
    surface_gravity_g: b.kind === 'black-hole' ? null : b.gravityG,
    orbit: b.parentId
      ? {
          semi_major_axis_m: a,
          eccentricity: e,
          inclination_rad: b.orbitInclination,
          arg_periapsis_rad: b.argOfPeriapsis ?? 0,
          ascending_node_rad: b.ascendingNode ?? 0,
          mean_anomaly_epoch_rad: b.orbitPhase,
          mean_motion_rad_s: n,
        }
      : null,
    axial_tilt_deg: b.axialTiltDeg,
    rotation_period_h: rotationHours,
    tidally_locked: tidallyLocked,
    landable: b.landable,
    seed: b.seed,
    palette: b.palette,
    star_color: b.starColor ?? null,
    spectral_type: b.spectralType ?? null,
    atmosphere: b.atmosphere ?? null,
    rings: b.rings ?? null,
    summary: b.summary,
  };
});

const systems = STAR_SYSTEMS.map((s) => {
  const len = Math.hypot(s.position.x, s.position.y, s.position.z);
  const dir = len > 0 ? { x: s.position.x / len, y: s.position.y / len, z: s.position.z / len } : { x: 0, y: 0, z: 0 };
  return {
    id: s.id,
    name: s.name,
    distance_ly: s.distanceLy,
    direction: dir, // unit vector from Sol, Godot axes (Y up)
    beacon_color: s.beaconColor,
    beacon_brightness: s.beaconBrightness,
    spectral_summary: s.spectralSummary,
    description: s.description,
  };
});

const out = {
  generated_from: 'prototype-web/src/game/universeData.ts via tools/export_universe.ts',
  units: { length: 'm', mass: 'kg', angle: 'rad', time: 's' },
  constants: { G, AU, LY, C },
  systems,
  bodies,
};

await Bun.write('data/universe.json', JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${systems.length} systems and ${bodies.length} bodies to data/universe.json`);
void LY_UNITS;
