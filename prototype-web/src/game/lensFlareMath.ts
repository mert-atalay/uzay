export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface StarOccluderSphere {
  /** Camera-relative or world-space center matching cameraPos/starPos frame */
  x: number;
  y: number;
  z: number;
  radius: number;
}

export interface StarLensFlareInput {
  cameraPos: Vec3Like;
  cameraForward: Vec3Like;
  cameraRight: Vec3Like;
  cameraUp: Vec3Like;
  fovRad: number;
  aspect: number;
  starPos: Vec3Like;
  starRadius: number;
  occluders: readonly StarOccluderSphere[];
  /** Optional local planetary up normal when landed on a planet (for horizon sunset eclipse) */
  landedSurfaceUp?: Vec3Like | null;
  /** Atmospheric immersion 0..1 softens harsh space spikes slightly while widening aureole */
  atmosphereImmersion?: number;
}

export interface StarLensFlareState {
  visible: boolean;
  /** Screen-space NDC X (-1..1 inside viewport) */
  ndcX: number;
  /** Screen-space NDC Y (-1..1 inside viewport) */
  ndcY: number;
  /** Final optical flare intensity 0..1 */
  intensity: number;
  /** Unoccluded star disc fraction 0..1 (0 = total planetary/lunar/horizon eclipse) */
  visibility: number;
  /** Limb-grazing eclipse diamond-ring glint 0..1 */
  diamondRing: number;
  /** Camera viewing angle factor 0..1 */
  angleFactor: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Pure analytical star lens flare solver:
 * - Projects the star cleanly into screen NDC based on camera orientation, FOV, and aspect ratio.
 * - Computes smooth camera-angle reactivity (direct view, peripheral edge glow, back-hemisphere cutoff).
 * - Evaluates exact angular disc overlap against every planet, moon, and black hole between the camera
 *   and the star, producing realistic partial eclipses, total occultation, and grazing diamond-ring flashes.
 * - Evaluates local horizon sunset occultation when walking on a planetary surface.
 */
export function computeStarLensFlareState(input: StarLensFlareInput): StarLensFlareState {
  const dx = input.starPos.x - input.cameraPos.x;
  const dy = input.starPos.y - input.cameraPos.y;
  const dz = input.starPos.z - input.cameraPos.z;
  const starDist = Math.hypot(dx, dy, dz);

  if (starDist < 1e-4) {
    return {
      visible: false,
      ndcX: 0,
      ndcY: 0,
      intensity: 0,
      visibility: 0,
      diamondRing: 0,
      angleFactor: 0,
    };
  }

  const invStarDist = 1 / starDist;
  const sx = dx * invStarDist;
  const sy = dy * invStarDist;
  const sz = dz * invStarDist;

  // Transform star direction into camera basis
  const camZ = sx * input.cameraForward.x + sy * input.cameraForward.y + sz * input.cameraForward.z;
  if (camZ <= 0.12) {
    return {
      visible: false,
      ndcX: 0,
      ndcY: 0,
      intensity: 0,
      visibility: 0,
      diamondRing: 0,
      angleFactor: 0,
    };
  }

  const camX = sx * input.cameraRight.x + sy * input.cameraRight.y + sz * input.cameraRight.z;
  const camY = sx * input.cameraUp.x + sy * input.cameraUp.y + sz * input.cameraUp.z;

  const tanHalfFov = Math.tan(Math.max(0.2, input.fovRad * 0.5));
  const safeAspect = Math.max(0.3, input.aspect);
  const ndcX = camX / (camZ * tanHalfFov * safeAspect);
  const ndcY = camY / (camZ * tanHalfFov);

  // Smooth camera angle reactivity: strongest when facing star, softly extends slightly past viewport edge
  const screenRadial = Math.hypot(ndcX, ndcY);
  const viewportEdgeFade = 1 - smoothstep(0.95, 1.62, screenRadial);
  const angleFactor = smoothstep(0.28, 0.96, camZ) * viewportEdgeFade;

  if (angleFactor <= 0.002) {
    return {
      visible: false,
      ndcX,
      ndcY,
      intensity: 0,
      visibility: 0,
      diamondRing: 0,
      angleFactor: 0,
    };
  }

  // Apparent angular radius of star (floor at 0.011 rad so distant stars still eclipse smoothly)
  const alphaStar = Math.max(0.011, Math.atan2(Math.max(1, input.starRadius), starDist));

  let visibility = 1.0;
  let diamondRing = 0.0;

  // Test planetary / lunar / black-hole sphere obscuration
  for (let i = 0; i < input.occluders.length; i++) {
    const occ = input.occluders[i];
    const ox = occ.x - input.cameraPos.x;
    const oy = occ.y - input.cameraPos.y;
    const oz = occ.z - input.cameraPos.z;
    const proj = ox * sx + oy * sy + oz * sz;

    // Must lie strictly in front of camera and closer than the star
    if (proj <= 0 || proj >= starDist - input.starRadius * 0.5) {
      continue;
    }

    const occDist = Math.hypot(ox, oy, oz);
    if (occDist <= occ.radius * 1.001) {
      // Camera is inside/behind occluder silhouette
      visibility = 0;
      diamondRing = 0;
      break;
    }

    const dotDir = clamp((ox * sx + oy * sy + oz * sz) / occDist, -1, 1);
    const sep = Math.acos(dotDir);
    const alphaOcc = Math.asin(clamp(occ.radius / occDist, 0, 0.9999));

    if (sep <= alphaOcc - alphaStar) {
      // Complete planetary/lunar eclipse!
      visibility = 0;
      diamondRing = 0;
      break;
    }

    if (sep < alphaOcc + alphaStar * 1.65) {
      // Partial eclipse & grazing diamond-ring limb diffraction flash
      const occVis = smoothstep(alphaOcc - alphaStar * 0.92, alphaOcc + alphaStar * 1.08, sep);
      visibility = Math.min(visibility, occVis);

      // Diamond ring peaks right as the star's edge kisses the planet's horizon limb!
      const limbDelta = Math.abs(sep - alphaOcc) / Math.max(0.008, alphaStar * 1.25);
      const ringBurst = Math.exp(-limbDelta * limbDelta * 2.4) * smoothstep(0.04, 0.45, occVis);
      diamondRing = Math.max(diamondRing, ringBurst);
    }
  }

  // Horizon occultation when standing on a planetary surface (realistic sunrise/sunset eclipse!)
  if (input.landedSurfaceUp && visibility > 0) {
    const up = input.landedSurfaceUp;
    const upLen = Math.hypot(up.x, up.y, up.z) || 1;
    const sunElev = (sx * up.x + sy * up.y + sz * up.z) / upLen;
    const horizonVis = smoothstep(-0.045, 0.065, sunElev);
    visibility *= horizonVis;
    const sunsetEdge = Math.exp(-Math.pow((sunElev - 0.015) / 0.045, 2)) * horizonVis;
    diamondRing = Math.max(diamondRing, sunsetEdge * 0.65);
  }

  // Distance brightness curve: bright within star system, gracefully attenuates at extreme outer Oort distances
  const distScale = clamp(1.22 / Math.pow(1 + starDist / 16_000, 0.42), 0.25, 1.15);
  const atmoSoften = 1 - clamp(input.atmosphereImmersion ?? 0, 0, 1) * 0.18;

  const intensity = clamp(
    angleFactor * visibility * distScale * atmoSoften + angleFactor * diamondRing * 0.45,
    0,
    1.25,
  );

  return {
    visible: intensity > 0.004,
    ndcX,
    ndcY,
    intensity,
    visibility,
    diamondRing: clamp(diamondRing, 0, 1),
    angleFactor,
  };
}
