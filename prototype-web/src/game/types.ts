export type GamePhase = 'title' | 'playing' | 'paused';

export type CameraMode = 'third-person' | 'first-person';

export type FlightRegime =
  | 'SURFACE'
  | 'ATMOSPHERE'
  | 'ORBITAL'
  | 'INTERPLANETARY'
  | 'INTERSTELLAR'
  | 'SINGULARITY'
  | 'TESSERACT';

export type BodyKind = 'star' | 'planet' | 'moon' | 'dwarf' | 'black-hole';

export type SurfaceArchetype =
  | 'star-g'
  | 'star-k'
  | 'star-m'
  | 'star-a'
  | 'star-wd'
  | 'star-supergiant'
  | 'black-hole'
  | 'mercury'
  | 'venus'
  | 'earth'
  | 'moon'
  | 'mars'
  | 'asteroid'
  | 'jupiter'
  | 'io'
  | 'europa'
  | 'ganymede'
  | 'callisto'
  | 'saturn'
  | 'titan'
  | 'enceladus'
  | 'uranus'
  | 'neptune'
  | 'triton'
  | 'pluto'
  | 'exo-temperate'
  | 'exo-ocean'
  | 'exo-ice'
  | 'exo-lava'
  | 'exo-desert';

export interface Vec3d {
  x: number;
  y: number;
  z: number;
}

export interface AtmosphereDef {
  color: string;
  horizonColor: string;
  density: number; // 0 = vacuum, 1 = Earth, 2.5 = Venus/Titan
  heightRatio: number; // fraction of radius
  soundProfile: 'vacuum' | 'earth' | 'mars' | 'dense' | 'ice';
}

export interface RingDef {
  innerRatio: number;
  outerRatio: number;
  colorInner: string;
  colorOuter: string;
  opacity: number;
  tiltDeg?: number;
}

export interface CelestialBodyDef {
  id: string;
  name: string;
  systemId: string;
  kind: BodyKind;
  archetype: SurfaceArchetype;
  parentId: string | null; // null if primary star of system
  /** Scene radius in local units (1 unit = 100 meters near surface, visual scale balanced for space flight) */
  radius: number;
  /** Real astronomical radius in km for HUD accuracy */
  realRadiusKm: number;
  /** Orbital semi-major axis distance from parent in scene units */
  orbitRadius: number;
  /** Mean motion (average orbital angular speed in rad/s) */
  orbitSpeed: number;
  /** Initial mean anomaly M0 in radians */
  orbitPhase: number;
  /** Orbital inclination i in radians */
  orbitInclination: number;
  /** Keplerian orbital eccentricity e (0 = circular, < 0.95 = highly elliptical) */
  orbitEccentricity?: number;
  /** Argument of periapsis omega in radians */
  argOfPeriapsis?: number;
  /** Longitude of ascending node Omega in radians */
  ascendingNode?: number;
  /** Axial tilt in degrees */
  axialTiltDeg: number;
  /** Axial spin speed in rad/s */
  rotationSpeed: number;
  /** Surface gravity in Earth g (1.0 = 9.81 m/s^2) */
  gravityG: number;
  /** Whether the player can land and walk on the surface */
  landable: boolean;
  /** Procedural terrain relief scale (fraction of local scale) */
  terrainRelief: number;
  /** Crater density 0..1 */
  craterDensity: number;
  /** Deterministic procedural seed */
  seed: number;
  /** Primary surface palette colors (for terrain patch & markers) */
  palette: [string, string, string];
  /** Optional atmosphere */
  atmosphere?: AtmosphereDef;
  /** Optional planetary rings */
  rings?: RingDef;
  /** Star luminosity/color if kind === 'star' */
  starColor?: string;
  spectralType?: string;
  /** Concise scientific facts for Star Map & Discovery Scan */
  summary: string;
  realDistanceLabel: string;
}

export interface StarSystemDef {
  id: string;
  name: string;
  spectralSummary: string;
  /** Real distance from Sol in light years */
  distanceLy: number;
  /** 3D position in Universe Units (1 LY = LY_UNITS) */
  position: Vec3d;
  /** Dominant visual star hue for deep-space beacon */
  beaconColor: string;
  /** Visual apparent magnitude brightness multiplier */
  beaconBrightness: number;
  description: string;
}

export interface ScreenMarker {
  id: string;
  name: string;
  subtitle: string;
  kind: 'system' | BodyKind;
  x: number; // 0..1 normalized viewport
  y: number; // 0..1 normalized viewport
  distanceLabel: string;
  color: string;
  isTarget: boolean;
}

export interface TelemetrySnapshot {
  phase: GamePhase;
  cameraMode: CameraMode;
  regime: FlightRegime;
  currentSystemId: string;
  currentSystemName: string;
  nearestBodyId: string;
  nearestBodyName: string;
  nearestBodyKind: BodyKind;
  nearestBodyLandable: boolean;
  nearestBodyGravityG: number;
  altitudeLabel: string;
  altitudeRawUnits: number;
  speedLabel: string;
  speedNormalized: number; // 0..1 bar fill
  speedBiasLevel: number; // -2..+3
  isLanded: boolean;
  canLandNow: boolean;
  isBoosting: boolean;
  isWarping: boolean;
  warpTargetName: string | null;
  warpEtaSec: number;
  atmosphereDensity: number;
  timeDilationFactor: number;
  orbitTimeScale: number;
  blackHoleProximity: number;
  horizonWarning: boolean;
  pointOfNoReturn: boolean;
  horizonIndicator: {
    visible: boolean;
    mode: 'none' | 'atmosphere' | 'event-horizon' | 'point-of-no-return';
    severity: 'nominal' | 'caution' | 'critical' | 'irreversible';
    proximity: number;
    colorHex: string;
    label: string;
    metricText: string;
    pulseUrgent: boolean;
  };
  tesseractStage: 'outside' | 'plunge' | 'tesseract';
  tesseractAnchorsDecoded: number;
  tesseractAnchorsTotal: number;
  nearestAnchorName: string | null;
  nearestAnchorDistM: number | null;
  nearestAnchorInRange: boolean;
  discoveredIds: string[];
  landedIds: string[];
  totalDiscoverable: number;
  distanceTraveledLy: number;
  scanMessage: { title: string; detail: string; id: number } | null;
  muted: boolean;
  pointerLocked: boolean;
  gamepadConnected: boolean;
  gamepadName: string | null;
  markers: ScreenMarker[];
}
