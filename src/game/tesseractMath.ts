export type TesseractStage = 'outside' | 'plunge' | 'tesseract';

/** Extended 22-second Event Horizon interior descent synced to the 3:30 organ climax */
export const PLUNGE_DURATION_SEC = 22.0;
export const TESSERACT_CELL_SIZE = 28;

export interface TesseractMemoryAnchorDef {
  id: string;
  title: string;
  subtitle: string;
  transmissionDetail: string;
  /** True non-repeating 5D Bulk coordinate so each anomaly exists ONLY in one hidden chamber! */
  position: { x: number; y: number; z: number };
  /** Visual particle archetype */
  archetype: 'bookshelf-earth' | 'millers-wave' | 'saturn-wormhole';
  accentColor: string;
  interactionRadius: number;
}

/**
 * 3 Rare, Localized 5D World-Particle Memory Anchors hidden at distinct coordinates inside the
 * infinite Tesseract lattice (never tiled everywhere!). Exploring the corridors reveals these
 * luminous gravitational particle echoes from across space-time.
 */
export const TESSERACT_MEMORY_ANCHORS: readonly TesseractMemoryAnchorDef[] = [
  {
    id: 'anchor-bookshelf-earth',
    title: 'EARTH · 2067 · GRAVITY DUST',
    subtitle: 'WORLD-PARTICLE ECHO I',
    transmissionDetail:
      'Binary dust stripes fall through golden bedroom sunbeams — encoding quantum singularity data into the second hand of a watch.',
    position: { x: -11, y: 1.5, z: -26 },
    archetype: 'bookshelf-earth',
    accentColor: '#ffcf78',
    interactionRadius: 15,
  },
  {
    id: 'anchor-millers-wave',
    title: "MILLER'S HORIZON · 1 HR = 7 YRS",
    subtitle: 'WORLD-PARTICLE ECHO II',
    transmissionDetail:
      'A towering tidal crest frozen in dilated time — millions of suspended ocean-light quanta shimmering along a curved worldline.',
    position: { x: 42, y: 16, z: -52 },
    archetype: 'millers-wave',
    accentColor: '#58d4ff',
    interactionRadius: 16,
  },
  {
    id: 'anchor-saturn-wormhole',
    title: 'SATURN BULK · THE WORMHOLE SPHERE',
    subtitle: 'WORLD-PARTICLE ECHO III',
    transmissionDetail:
      'Bent starlight and golden ring-dust folded around a 3D spherical gateway — the first handshake across the fifth dimension.',
    position: { x: -48, y: -18, z: 38 },
    archetype: 'saturn-wormhole',
    accentColor: '#c9a4ff',
    interactionRadius: 16,
  },
];

export interface PlungeDynamics {
  /** Normalized fall progress 0..1 */
  progress: number;
  /** Exponentially accelerating relativistic particle speed multiplier 1..48 */
  particleAccel: number;
  /** Shrinking overhead Einstein sky-ring radius factor 1..0 */
  skyRingScale: number;
  /** Opacity reveal of the 5D Tesseract lattice emerging out of the dark 0..1 */
  latticeReveal: number;
  /** Violent gravitational tidal camera tremor & vibration 0..1 */
  cameraTremor: number;
  /** True once free-fall finishes and 5D Tesseract takes over */
  transitionReady: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Pure simulation curve for the extended 22-second Event Horizon interior plunge:
 * - Phase 1 (0-22%): Horizon rupture shockwave & initial descent as the external universe collapses overhead.
 * - Phase 2 (22-62%): Relativistic free-fall acceleration up to 48x with heavy tidal tremor & streaking plasma.
 * - Phase 3 (62-82%): Overhead sky-ring pinches shut into total pitch darkness while gravitational dust bends.
 * - Phase 4 (82-100%): Spacetime fracture hushes into eerie stillness as the 5D Tesseract lattice
 *   crystallizes out of pitch darkness before snapping into full 5th-dimensional bulk space.
 */
export function computePlungeDynamics(elapsedSec: number): PlungeDynamics {
  const safeElapsed = Math.max(0, elapsedSec);
  const progress = clamp(safeElapsed / PLUNGE_DURATION_SEC, 0, 1);

  // Exponential relativistic acceleration curve from 1x up to ~48x, tapering smoothly into bulk capture
  const accelCurve = Math.pow(progress, 2.05);
  const decelIntoBulk = 1 - smoothstep(0.84, 1.0, progress) * 0.65;
  const particleAccel = 1 + accelCurve * 47.0 * decelIntoBulk;

  // Overhead universe collapses gradually into a pinpoint star-ring across the first 72% of the plunge
  const skyRingScale = Math.max(0, 1 - smoothstep(0.0, 0.72, progress));

  // 5D Tesseract structure crystallizes out of the pitch-black abyss in the final 28% of the fall
  const latticeReveal = smoothstep(0.72, 0.98, progress);

  // Strong initial Event Horizon rupture shock + violent sustained mid-plunge tidal shudder -> eerie calm at 5D capture
  const breachShock = Math.exp(-progress * 11.0) * 0.92;
  const tidalSwell =
    smoothstep(0.08, 0.54, progress) * (1 - smoothstep(0.78, 0.98, progress) * 0.92);
  const cameraTremor = clamp(Math.max(breachShock, tidalSwell), 0, 1);

  return {
    progress,
    particleAccel,
    skyRingScale,
    latticeReveal,
    cameraTremor,
    transitionReady: progress >= 1.0,
  };
}

/**
 * Wraps a coordinate smoothly into [-cellSize / 2, +cellSize / 2) for infinite
 * seamless 3D modular repetition inside the 5th-dimensional Tesseract lattice.
 */
export function wrapTesseractCoord(value: number, cellSize = TESSERACT_CELL_SIZE): number {
  const half = cellSize * 0.5;
  let mod = ((value + half) % cellSize + cellSize) % cellSize;
  mod -= half;
  return mod;
}

/**
 * Evaluates gravitational wave resonance (0..1) on a 5D Tesseract worldline string
 * at radial distance `dist` from the player's gravity pulse origin.
 */
export function computeGravityStringWave(dist: number, pulseProgress: number): number {
  if (pulseProgress <= 0 || pulseProgress >= 1) return 0;
  const waveFront = pulseProgress * 92;
  const ringDelta = Math.abs(dist - waveFront);
  const envelope = Math.exp(-(ringDelta * ringDelta) / 48) * (1 - pulseProgress);
  return clamp(envelope, 0, 1);
}

/**
 * Finds the nearest localized 5D World-Particle Memory Anchor relative to Voyager's
 * un-wrapped Bulk position so players can sense and resonate with rare hidden anomalies.
 */
export function findNearestMemoryAnchor(bulkPos: { x: number; y: number; z: number }): {
  anchor: TesseractMemoryAnchorDef;
  distance: number;
  inRange: boolean;
} {
  let best = TESSERACT_MEMORY_ANCHORS[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const anchor of TESSERACT_MEMORY_ANCHORS) {
    const dx = anchor.position.x - bulkPos.x;
    const dy = anchor.position.y - bulkPos.y;
    const dz = anchor.position.z - bulkPos.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < bestDist) {
      bestDist = d;
      best = anchor;
    }
  }
  return {
    anchor: best,
    distance: bestDist,
    inRange: bestDist <= best.interactionRadius,
  };
}

