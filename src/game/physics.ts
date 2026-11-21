import type { BodyKind, CelestialBodyDef, FlightRegime, Vec3d } from './types';
import { AU_UNITS, BODY_BY_ID, LY_UNITS, SYSTEM_BY_ID } from './universeData';

const TWO_PI = Math.PI * 2;

/**
 * Solve Kepler's Equation `M = E - e * sin(E)` for eccentric anomaly `E`
 * using Newton-Raphson iteration to sub-nanoradian accuracy (< 1e-10).
 */
export function solveKeplerEquation(meanAnomaly: number, eccentricity: number): number {
  const e = Math.max(0, Math.min(0.95, eccentricity));
  // Wrap mean anomaly into [-PI, PI] for rapid convergence
  let M = ((meanAnomaly + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
  if (e < 1e-7) return M;

  // High-eccentricity-safe initial guess (Danby / Markley style)
  let E = e < 0.8 ? M + e * Math.sin(M) * (1 + e * Math.cos(M)) : M >= 0 ? Math.PI : -Math.PI;
  if (e >= 0.8) {
    E = M + (M >= 0 ? 0.85 * e : -0.85 * e);
  }

  for (let i = 0; i < 10; i++) {
    const f = E - e * Math.sin(E) - M;
    const fPrime = 1 - e * Math.cos(E);
    const delta = f / Math.max(1e-9, fPrime);
    E -= delta;
    if (Math.abs(delta) < 1e-10) break;
  }
  return E;
}

/**
 * Convert orbital-plane coordinates `(xOrb, zOrb)` (focus at parent origin)
 * into 3D system space using argument of periapsis `ω`, inclination `i`, and ascending node `Ω`.
 */
function rotateOrbitalPlaneTo3D(
  xOrb: number,
  zOrb: number,
  argPeri: number,
  inclination: number,
  ascNode: number,
): Vec3d {
  const cosW = Math.cos(argPeri);
  const sinW = Math.sin(argPeri);
  const cosI = Math.cos(inclination);
  const sinI = Math.sin(inclination);
  const cosO = Math.cos(ascNode);
  const sinO = Math.sin(ascNode);

  // Rotate inside orbital plane by argument of periapsis ω
  const x1 = xOrb * cosW - zOrb * sinW;
  const z1 = xOrb * sinW + zOrb * cosW;

  // Tilt out of ecliptic by inclination i around the line of nodes
  const y2 = z1 * sinI;
  const z2 = z1 * cosI;

  // Rotate around ecliptic Y-axis by longitude of ascending node Ω
  return {
    x: x1 * cosO - z2 * sinO,
    y: y2,
    z: x1 * sinO + z2 * cosO,
  };
}

/**
 * Compute exact 3D Keplerian orbital offset from a body's parent focus at `simTime`.
 * Naturally obeys Kepler's First Law (elliptical path with parent at focus) and
 * Kepler's Second Law (accelerates rapidly through periapsis, slows at apoapsis).
 */
export function computeKeplerianOrbitOffset(
  body: CelestialBodyDef,
  simTime: number,
): Vec3d {
  const a = body.orbitRadius;
  if (a <= 0) return { x: 0, y: 0, z: 0 };

  const e = Math.max(0, Math.min(0.95, body.orbitEccentricity ?? 0));
  const meanAnomaly = body.orbitPhase + simTime * body.orbitSpeed;
  const E = solveKeplerEquation(meanAnomaly, e);

  // Elliptical position in the perifocal plane (focus at origin)
  const xOrb = a * (Math.cos(E) - e);
  const zOrb = a * Math.sqrt(1 - e * e) * Math.sin(E);

  return rotateOrbitalPlaneTo3D(
    xOrb,
    zOrb,
    body.argOfPeriapsis ?? 0,
    body.orbitInclination,
    body.ascendingNode ?? 0,
  );
}

/**
 * Sample a closed 3D Keplerian ellipse around the parent focus for rendering orbit lines
 * that match `computeKeplerianOrbitOffset` exactly.
 */
export function sampleKeplerianOrbitPath(
  body: CelestialBodyDef,
  segments = 144,
): Vec3d[] {
  const a = body.orbitRadius;
  const e = Math.max(0, Math.min(0.95, body.orbitEccentricity ?? 0));
  const b = a * Math.sqrt(1 - e * e);
  const argPeri = body.argOfPeriapsis ?? 0;
  const inc = body.orbitInclination;
  const ascNode = body.ascendingNode ?? 0;

  const pts: Vec3d[] = [];
  for (let i = 0; i <= segments; i++) {
    const E = (i / segments) * TWO_PI;
    const xOrb = a * (Math.cos(E) - e);
    const zOrb = b * Math.sin(E);
    pts.push(rotateOrbitalPlaneTo3D(xOrb, zOrb, argPeri, inc, ascNode));
  }
  return pts;
}

/**
 * Compute deterministic 64-bit world position of any celestial body
 * (star, planet, or moon orbiting a planet) along its 3D Keplerian ellipse at `simTime`.
 */
export function computeBodyWorldPosition(
  body: CelestialBodyDef,
  simTime: number,
  bodyMap: Record<string, CelestialBodyDef> = BODY_BY_ID,
): Vec3d {
  const sys = SYSTEM_BY_ID[body.systemId];
  const base: Vec3d = sys ? { ...sys.position } : { x: 0, y: 0, z: 0 };

  if (!body.parentId) {
    return base;
  }

  const parent = bodyMap[body.parentId];
  const parentPos = parent ? computeBodyWorldPosition(parent, simTime, bodyMap) : base;
  const offset = computeKeplerianOrbitOffset(body, simTime);

  return {
    x: parentPos.x + offset.x,
    y: parentPos.y + offset.y,
    z: parentPos.z + offset.z,
  };
}

/**
 * Euclidean distance in 64-bit double precision.
 */
export function distance3d(a: Vec3d, b: Vec3d): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Megaton Rainfall-inspired multi-scale auto-adaptive flight speed (units/sec).
 * Deliberately slows down dramatically near planets, stars, and black holes so colossal worlds
 * feel genuinely massive, weighty, and awe-inspiring, while smoothly accelerating into
 * interplanetary FTL and interstellar superluminal cruise out in deep space.
 */
export function computeAutoFlightSpeed(
  altitudeAboveSurface: number,
  nearestBodyRadius: number,
  distanceToNearestStar: number,
  boostActive: boolean,
  speedBiasLevel: number, // -2..+3
  nearestBodyKind: BodyKind = 'planet',
): number {
  const safeAlt = Math.max(0.05, altitudeAboveSurface);
  const safeRadius = Math.max(8, nearestBodyRadius);
  const ratio = safeAlt / safeRadius;

  // Sub-linear radius factor so huge planets/stars/black holes actually feel monumental to fly past!
  const orbitScale = Math.sqrt(safeRadius);

  let baseSpeed: number;
  if (safeAlt < 3.0) {
    // Low canyon / surface skim: calm human-scale hover
    baseSpeed = 0.42 + safeAlt * 0.42;
  } else if (ratio < 0.25) {
    // Troposphere, cloud-deck & upper atmospheric entry: deliberate, weighty descent
    const lowAltSpan = Math.max(1, safeRadius * 0.25 - 3.0);
    const t = Math.min(1, (safeAlt - 3.0) / lowAltSpan);
    const atmoTop = 1.68 + orbitScale * 0.72;
    baseSpeed = 1.68 + Math.pow(t, 1.2) * (atmoTop - 1.68);
  } else if (ratio < 2.4) {
    // Near-planet & orbital gaze: ~4-6x slower than before so you truly feel the immense horizon!
    const atmoTop = 1.68 + orbitScale * 0.72;
    const t = Math.min(1, (ratio - 0.25) / 2.15);
    baseSpeed = atmoTop + Math.pow(t, 1.45) * (orbitScale * 3.1);
  } else if (distanceToNearestStar < 82_000) {
    // Interplanetary transit across the star system
    const orbitTop = 1.68 + orbitScale * 3.82;
    const excessAlt = Math.max(0, safeAlt - safeRadius * 2.4);
    baseSpeed = Math.min(26_000, orbitTop + Math.pow(excessAlt, 1.12) * 0.56);
  } else {
    // Deep interstellar space: superluminal light-year transit
    const interstellarDist = distanceToNearestStar - 82_000;
    baseSpeed = 26_000 + Math.pow(interstellarDist, 1.12) * 1.85;
    baseSpeed = Math.min(baseSpeed, LY_UNITS * 18);
  }

  // Gravitational awe & relativistic viscosity near Sagittarius A*:
  // Approaching the colossal Event Horizon feels heavy, tense, and hypnotic (unless boosting)
  if (nearestBodyKind === 'black-hole' && ratio < 12.0) {
    const t = Math.max(0, Math.min(1, (ratio - 1.5) / 10.5));
    const gravDamping = 0.28 + 0.72 * (t * t * (3 - 2 * t));
    baseSpeed *= gravDamping;
  }

  const biasMult = Math.pow(1.6, Math.max(-2, Math.min(3, speedBiasLevel)));
  const boostMult = boostActive
    ? distanceToNearestStar > 60_000
      ? 6.0
      : ratio < 0.35
        ? 2.2
        : 3.4
    : 1.0;

  return Math.max(0.42, Math.min(LY_UNITS * 55, baseSpeed * biasMult * boostMult));
}

/**
 * Classify the player's current spatial regime for HUD & adaptive audio.
 */
export function classifyFlightRegime(
  isLanded: boolean,
  altitudeAboveSurface: number,
  nearestBody: CelestialBodyDef,
  distanceToSystemCenter: number,
): FlightRegime {
  if (isLanded) return 'SURFACE';
  if (distanceToSystemCenter > 85_000) return 'INTERSTELLAR';
  const atmoThickness = nearestBody.atmosphere
    ? nearestBody.radius * Math.max(0.14, nearestBody.atmosphere.heightRatio * 2.2)
    : nearestBody.radius * 0.14;
  if (altitudeAboveSurface < atmoThickness) {
    return nearestBody.atmosphere && nearestBody.atmosphere.density > 0.04
      ? 'ATMOSPHERE'
      : 'ORBITAL';
  }
  const orbitalMult = nearestBody.kind === 'black-hole' ? 12.0 : 5.5;
  if (altitudeAboveSurface < nearestBody.radius * orbitalMult) {
    return 'ORBITAL';
  }
  return 'INTERPLANETARY';
}

/**
 * Deterministic 3D hash-based value noise for procedural planetary terrain.
 */
function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let n =
    Math.imul(ix, 374761393) ^
    Math.imul(iy, 668265263) ^
    Math.imul(iz, 2147483647) ^
    Math.imul(seed, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function smooth3DNoise(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);

  const c000 = hash3(ix, iy, iz, seed);
  const c100 = hash3(ix + 1, iy, iz, seed);
  const c010 = hash3(ix, iy + 1, iz, seed);
  const c110 = hash3(ix + 1, iy + 1, iz, seed);
  const c001 = hash3(ix, iy, iz + 1, seed);
  const c101 = hash3(ix + 1, iy, iz + 1, seed);
  const c011 = hash3(ix, iy + 1, iz + 1, seed);
  const c111 = hash3(ix + 1, iy + 1, iz + 1, seed);

  const x00 = c000 + (c100 - c000) * ux;
  const x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux;
  const x11 = c011 + (c111 - c011) * ux;

  const y0 = x00 + (x10 - x00) * uy;
  const y1 = x01 + (x11 - x01) * uy;

  return y0 + (y1 - y0) * uz;
}

/**
 * Deterministic procedural height offset (in local meters-equivalent scene units)
 * at normalized sphere direction `(nx, ny, nz)` for surface landing & terrain mesh generation.
 */
export function sampleProceduralTerrainHeight(
  nx: number,
  ny: number,
  nz: number,
  seed: number,
  reliefScale: number,
  craterDensity: number,
): number {
  if (reliefScale <= 0) return 0;

  // Multi-octave continental / ridge fBm
  let amp = 0.55;
  let freq = 26;
  let h = 0;
  for (let i = 0; i < 4; i++) {
    const n = smooth3DNoise(nx * freq, ny * freq, nz * freq, seed + i * 31) * 2 - 1;
    // Ridged mountain contribution on octave 1 & 2
    const ridged = i === 1 ? (1 - Math.abs(n)) * 0.65 - 0.25 : n;
    h += ridged * amp;
    freq *= 2.15;
    amp *= 0.48;
  }

  // Procedural impact craters (bowl depression + raised rim)
  if (craterDensity > 0.05) {
    const cf = 42;
    const gx = nx * cf;
    const gy = ny * cf;
    const gz = nz * cf;
    const cx = Math.floor(gx);
    const cy = Math.floor(gy);
    const cz = Math.floor(gz);
    const chance = hash3(cx, cy, cz, seed + 907);
    if (chance < craterDensity * 0.72) {
      const ox = hash3(cx, cy, cz, seed + 911) * 0.6 + 0.2;
      const oy = hash3(cx, cy, cz, seed + 919) * 0.6 + 0.2;
      const oz = hash3(cx, cy, cz, seed + 929) * 0.6 + 0.2;
      const dx = gx - (cx + ox);
      const dy = gy - (cy + oy);
      const dz = gz - (cz + oz);
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const radius = 0.22 + hash3(cx, cy, cz, seed + 937) * 0.22;
      if (d < radius * 1.35) {
        const u = d / radius;
        if (u < 1.0) {
          // Concave crater bowl
          h -= (1 - u * u) * 0.65;
        } else {
          // Subtle raised ejecta rim
          const rim = 1 - (u - 1.0) / 0.35;
          h += rim * rim * 0.22;
        }
      }
    }
  }

  return h * 0.42 * reliefScale;
}

function hash2(ix: number, iz: number, seed: number): number {
  let n =
    Math.imul(ix, 374761393) ^
    Math.imul(iz, 668265263) ^
    Math.imul(seed, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function smooth2DNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);

  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);

  const x0 = a + (b - a) * ux;
  const x1 = c + (d - c) * ux;
  return x0 + (x1 - x0) * uz;
}

/**
 * Sea/liquid level in meters for surface-biome worlds that feature oceans, methane seas, or ice lakes.
 * Returns null for dry rocky/lunar worlds.
 */
export function getPlanetarySeaLevel(body: CelestialBodyDef): number | null {
  switch (body.archetype) {
    case 'earth':
    case 'exo-temperate':
      return -1.45;
    case 'exo-ocean':
      return -0.65;
    case 'titan':
      return -1.85;
    case 'europa':
    case 'enceladus':
      return -2.1;
    default:
      return null;
  }
}

/**
 * High-detail 1:1 human-scale planetary surface topography (meters) for the dedicated
 * Surface Walking Environment. Produces sweeping mountains, eroded valleys, terraced canyons,
 * dunes, icy fissures, and impact craters while keeping the initial touchdown clearing gentle and dry.
 */
export function sampleSurfaceBiomeHeight(
  wx: number,
  wz: number,
  body: CelestialBodyDef,
): number {
  const seed = body.seed;
  const relief = Math.max(0.35, body.terrainRelief);

  // Broad sweeping valley / mountain macro relief (~140m wavelength)
  const macro = smooth2DNoise(wx * 0.0085, wz * 0.0085, seed + 13) * 2 - 1;
  // Ridged mountain ranges (~55m wavelength)
  const ridgeRaw = smooth2DNoise(wx * 0.019 + 4.3, wz * 0.019 - 2.1, seed + 47) * 2 - 1;
  const ridge = (1 - Math.abs(ridgeRaw)) * (1 - Math.abs(ridgeRaw));
  // Mid rolling hills & dunes (~22m wavelength)
  const hills = smooth2DNoise(wx * 0.045, wz * 0.045, seed + 89) * 2 - 1;
  // Crisp micro-undulation (~7m wavelength)
  const detail = smooth2DNoise(wx * 0.13, wz * 0.13, seed + 137) * 2 - 1;

  let h = 0;
  if (body.archetype === 'mars' || body.archetype === 'exo-desert' || body.archetype === 'venus') {
    // Wind-carved dunes + terraced red canyons & mesas
    const dune = Math.sin(wx * 0.095 + smooth2DNoise(wx * 0.025, wz * 0.025, seed + 211) * 4.5) * 0.85;
    const mesaBase = macro * 6.5 + ridge * 9.5;
    const terraced = Math.round(mesaBase * 0.45) / 0.45;
    h = mesaBase * 0.58 + terraced * 0.42 + dune + hills * 1.45 + detail * 0.32;
  } else if (
    body.archetype === 'europa' ||
    body.archetype === 'enceladus' ||
    body.archetype === 'triton' ||
    body.archetype === 'exo-ice'
  ) {
    // Tectonic ice ridges & sharp cryovolcanic fractures
    const crack = Math.abs(smooth2DNoise(wx * 0.032, wz * 0.032, seed + 313) * 2 - 1);
    const fissure = crack < 0.12 ? -(0.12 - crack) * 14.0 : 0;
    h = macro * 4.2 + ridge * 10.5 + hills * 1.3 + detail * 0.28 + fissure;
  } else if (body.archetype === 'earth' || body.archetype === 'exo-temperate' || body.archetype === 'exo-ocean') {
    // Sweeping coastal basins, lush plateaus, and majestic alpine peaks
    h = macro * 7.8 + ridge * 13.5 * Math.max(0.2, macro + 0.55) + hills * 2.1 + detail * 0.35 - 2.4;
  } else {
    // Lunar highlands, volcanic basalt plains, and rugged cratered regolith
    h = macro * 6.2 + ridge * 11.2 + hills * 1.85 + detail * 0.38;
  }

  // Sculpted local impact craters on cratered worlds
  if (body.craterDensity > 0.08) {
    const cellSize = 46;
    const cx = Math.floor(wx / cellSize);
    const cz = Math.floor(wz / cellSize);
    const chance = hash2(cx, cz, seed + 503);
    if (chance < body.craterDensity * 0.78) {
      const ox = (cx + 0.25 + hash2(cx, cz, seed + 509) * 0.5) * cellSize;
      const oz = (cz + 0.25 + hash2(cx, cz, seed + 521) * 0.5) * cellSize;
      const d = Math.hypot(wx - ox, wz - oz);
      const rad = 7.5 + hash2(cx, cz, seed + 541) * 13.5;
      if (d < rad * 1.38) {
        const u = d / rad;
        if (u < 1.0) {
          h -= (1 - u * u) * (rad * 0.34);
        } else {
          const rim = 1 - (u - 1.0) / 0.38;
          h += rim * rim * (rad * 0.11);
        }
      }
    }
  }

  h *= 0.65 + relief * 0.52;

  // Keep a natural, scenic coastal/meadow landing clearing around origin (0, 0) so touchdown is always
  // grounded dry above sea level with sweeping mountains/oceans/craters framing the horizon!
  const originDist = Math.hypot(wx, wz);
  const clearingBlend = Math.max(0, Math.min(1, (originDist - 7) / 22));
  const seaLevel = getPlanetarySeaLevel(body);
  const safeOriginH = seaLevel !== null ? seaLevel + 2.6 : 0.4;
  const smoothClearing = clearingBlend * clearingBlend * (3 - 2 * clearingBlend);

  return safeOriginH + (h - safeOriginH) * smoothClearing;
}

/**
 * Format velocity in physically expressive units (m/s -> km/s -> c -> ly/s).
 * Uses integer or single-decimal clean precision for tabular-nums HUD.
 */
export function formatSpeed(unitsPerSec: number): string {
  // Near surface: 1 scene unit = ~120 meters for crisp human-scale walking & atmospheric flight
  const metersPerSec = unitsPerSec * 120;
  if (metersPerSec < 950) {
    return `${Math.round(metersPerSec)} m/s`;
  }
  const kmPerSec = metersPerSec / 1000;
  if (kmPerSec < 30_000) {
    return `${Math.round(kmPerSec).toLocaleString()} km/s`;
  }
  // Map scene speeds smoothly into c (speed of light) and ly/s
  const cUnits = 1_800; // 1c threshold in scene units/sec for interplanetary/interstellar scale
  const cSpeed = unitsPerSec / cUnits;
  if (cSpeed < 500) {
    return `${cSpeed < 10 ? cSpeed.toFixed(1) : Math.round(cSpeed)} c`;
  }
  const lyPerSec = unitsPerSec / LY_UNITS;
  if (lyPerSec < 0.1) {
    return `${Math.round(cSpeed).toLocaleString()} c`;
  }
  return `${lyPerSec < 10 ? lyPerSec.toFixed(1) : Math.round(lyPerSec)} ly/s`;
}

/**
 * Format distance/altitude cleanly across cosmic scales (m -> km -> AU -> ly).
 */
export function formatDistance(units: number): string {
  const safe = Math.max(0, units);
  if (safe < 8) {
    return `${Math.round(safe * 120)} m`;
  }
  if (safe < AU_UNITS * 0.12) {
    return `${Math.round(safe * 12).toLocaleString()} km`;
  }
  if (safe < LY_UNITS * 0.08) {
    const au = safe / AU_UNITS;
    return `${au < 10 ? au.toFixed(1) : Math.round(au)} AU`;
  }
  const ly = safe / LY_UNITS;
  return `${ly < 10 ? ly.toFixed(2) : Math.round(ly)} ly`;
}

export interface WarpStepResult {
  nextPos: Vec3d;
  speed: number;
  arrived: boolean;
  etaSec: number;
}

/**
 * Smooth exponential S-curve auto-warp step from `playerPos` toward `targetPos`,
 * stopping cleanly at `arrivalOffset` above the target surface.
 */
export function computeWarpStep(
  playerPos: Vec3d,
  targetPos: Vec3d,
  arrivalRadius: number,
  dt: number,
): WarpStepResult {
  const dx = targetPos.x - playerPos.x;
  const dy = targetPos.y - playerPos.y;
  const dz = targetPos.z - playerPos.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const remaining = dist - arrivalRadius;

  if (remaining <= Math.max(1.5, arrivalRadius * 0.04)) {
    return {
      nextPos: { ...playerPos },
      speed: 0,
      arrived: true,
      etaSec: 0,
    };
  }

  // Arrive smoothly in ~1.6-2.5 seconds whether crossing 300 units (Earth->Moon) or 11M units (Sol->Alpha Centauri)!
  const fraction = 1 - Math.exp(-3.4 * dt);
  const stepDist = Math.min(remaining, Math.max(remaining * fraction, Math.min(remaining, 22 * dt)));
  const invDist = 1 / Math.max(1e-9, dist);

  const nextPos: Vec3d = {
    x: playerPos.x + dx * invDist * stepDist,
    y: playerPos.y + dy * invDist * stepDist,
    z: playerPos.z + dz * invDist * stepDist,
  };

  const speed = stepDist / Math.max(1e-4, dt);
  const etaSec = Math.max(0.1, (remaining - stepDist) / Math.max(1, speed));

  return {
    nextPos,
    speed,
    arrived: remaining - stepDist <= Math.max(1.5, arrivalRadius * 0.04),
    etaSec,
  };
}
