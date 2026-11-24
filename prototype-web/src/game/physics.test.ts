import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAtmosphericEntryState,
  getEntryPlasmaPalette,
  getPlanetRayleighParams,
} from './atmosphereMath';
import {
  AMBIENT_LOOP_END_SEC,
  AMBIENT_LOOP_START_SEC,
  INTERSTELLAR_THEME_URL,
  PEAK_CUE_END_SEC,
  PEAK_CUE_START_SEC,
  computeTrackLoopEnvelope,
  shouldUsePeakCue,
} from './audio';
import {
  computeBlackHoleRelativity,
  computeDeflectionAngleRad,
  computeHawkingRadiationProfile,
} from './blackHoleMath';
import { applyRadialDeadzone, processGamepadState } from './gamepad';
import {
  computeHorizonProximityIndicator,
  interpolateHorizonColor,
} from './horizonIndicatorMath';
import { computeStarLensFlareState } from './lensFlareMath';
import {
  classifyFlightRegime,
  computeAutoFlightSpeed,
  computeBodyWorldPosition,
  computeKeplerianOrbitOffset,
  computeWarpStep,
  distance3d,
  formatDistance,
  formatSpeed,
  getPlanetarySeaLevel,
  sampleKeplerianOrbitPath,
  sampleProceduralTerrainHeight,
  sampleSurfaceBiomeHeight,
  solveKeplerEquation,
} from './physics';
import {
  PLUNGE_DURATION_SEC,
  TESSERACT_CELL_SIZE,
  TESSERACT_MEMORY_ANCHORS,
  computeGravityStringWave,
  computePlungeDynamics,
  findNearestMemoryAnchor,
  wrapTesseractCoord,
} from './tesseractMath';
import { BODY_BY_ID, LY_UNITS, STAR_SYSTEMS, SYSTEM_BY_ID } from './universeData';

test('Solar System and Alpha Centauri catalog contains all major worlds and moons', () => {
  const required = [
    'sun',
    'mercury',
    'venus',
    'earth',
    'moon',
    'mars',
    'phobos',
    'jupiter',
    'io',
    'europa',
    'ganymede',
    'callisto',
    'saturn',
    'titan',
    'enceladus',
    'uranus',
    'neptune',
    'triton',
    'pluto',
    'charon',
    'alpha-cen-a',
    'alpha-cen-b',
    'proxima',
    'proxima-b',
    'sirius-a',
    'trappist-1e',
  ];
  for (const id of required) {
    assert.ok(BODY_BY_ID[id], `Expected body ${id} in catalog`);
  }
  assert.ok(STAR_SYSTEMS.length >= 8, 'Expected at least 8 star systems');
  const alphaCenDist = distance3d(SYSTEM_BY_ID['sol'].position, SYSTEM_BY_ID['alpha-centauri'].position);
  assert.ok(
    Math.abs(alphaCenDist / LY_UNITS - 4.37) < 0.05,
    `Alpha Centauri should sit at 4.37 ly, got ${alphaCenDist / LY_UNITS}`,
  );
});

test('Keplerian orbital hierarchy positions Moon relative to Earth and Alpha Centauri B relative to A within elliptical bounds', () => {
  const moon = BODY_BY_ID['moon'];
  const earthPos = computeBodyWorldPosition(BODY_BY_ID['earth'], 0);
  const moonPos = computeBodyWorldPosition(moon, 0);
  const earthMoonDist = distance3d(earthPos, moonPos);
  const moonEcc = moon.orbitEccentricity ?? 0;
  const moonExpected = computeKeplerianOrbitOffset(moon, 0);
  const moonExpectedDist = Math.hypot(moonExpected.x, moonExpected.y, moonExpected.z);
  assert.ok(
    earthMoonDist >= moon.orbitRadius * (1 - moonEcc) - 1e-3 &&
      earthMoonDist <= moon.orbitRadius * (1 + moonEcc) + 1e-3,
    `Moon Keplerian distance ${earthMoonDist} outside [a(1-e), a(1+e)]`,
  );
  assert.ok(Math.abs(earthMoonDist - moonExpectedDist) < 1e-6);

  const cenBDef = BODY_BY_ID['alpha-cen-b'];
  const cenA = computeBodyWorldPosition(BODY_BY_ID['alpha-cen-a'], 10);
  const cenB = computeBodyWorldPosition(cenBDef, 10);
  const abDist = distance3d(cenA, cenB);
  const abEcc = cenBDef.orbitEccentricity ?? 0;
  assert.ok(
    abDist >= cenBDef.orbitRadius * (1 - abEcc) - 1e-3 &&
      abDist <= cenBDef.orbitRadius * (1 + abEcc) + 1e-3,
    `Alpha Centauri A-B elliptical distance ${abDist} outside bounds`,
  );
});

test('Kepler solver satisfies M = E - e*sin(E), obeys Kepler 2nd Law (faster at periapsis), and samples closed ellipses', () => {
  // Verify sub-nanoradian accuracy across circular, Earth, Mercury, and highly eccentric Star S2 orbits
  for (const e of [0, 0.0167, 0.2056, 0.5179, 0.7, 0.884]) {
    for (const M of [-2.4, -0.7, 0, 0.85, 2.6]) {
      const E = solveKeplerEquation(M, e);
      const residual = Math.abs(E - e * Math.sin(E) - M);
      assert.ok(residual < 1e-8, `Kepler residual ${residual} too large for e=${e}, M=${M}`);
    }
  }

  // Kepler's Second Law: Star S2 around Sagittarius A* moves dramatically faster at periapsis than apoapsis
  const s2 = BODY_BY_ID['sgr-s2'];
  const eS2 = s2.orbitEccentricity ?? 0;
  assert.ok(eS2 >= 0.65, `Star S2 should have high eccentricity, got ${eS2}`);
  const tPeri = -s2.orbitPhase / s2.orbitSpeed; // Mean anomaly M = 0 (periapsis)
  const tApo = (Math.PI - s2.orbitPhase) / s2.orbitSpeed; // Mean anomaly M = PI (apoapsis)
  const dt = 0.5;
  const pPeri0 = computeKeplerianOrbitOffset(s2, tPeri);
  const pPeri1 = computeKeplerianOrbitOffset(s2, tPeri + dt);
  const pApo0 = computeKeplerianOrbitOffset(s2, tApo);
  const pApo1 = computeKeplerianOrbitOffset(s2, tApo + dt);
  const vPeri = distance3d(pPeri0, pPeri1) / dt;
  const vApo = distance3d(pApo0, pApo1) / dt;
  assert.ok(vPeri > vApo * 4, `Kepler 2nd law: periapsis speed (${vPeri}) must far exceed apoapsis speed (${vApo})`);

  // Periapsis distance must remain safely outside Sagittarius A* shadow radius
  const rPeri = Math.hypot(pPeri0.x, pPeri0.y, pPeri0.z);
  assert.ok(rPeri > BODY_BY_ID['sgr-a-star'].radius * 3.5, `Star S2 periapsis ${rPeri} too close to Event Horizon`);

  // Sampled ellipse closes cleanly and matches periapsis/apoapsis distances
  const path = sampleKeplerianOrbitPath(s2, 96);
  assert.equal(path.length, 97);
  assert.ok(distance3d(path[0], path[path.length - 1]) < 1e-4, 'Keplerian ellipse path must close');
});

test('auto flight speed scales monotonically from surface skim to interstellar superluminal warp', () => {
  const surfaceSkim = computeAutoFlightSpeed(1.5, 68, 3_400, false, 0);
  const orbitSpeed = computeAutoFlightSpeed(80, 68, 3_400, false, 0);
  const interplanetary = computeAutoFlightSpeed(5_000, 68, 12_000, false, 0);
  const interstellar = computeAutoFlightSpeed(200_000, 68, 1_500_000, false, 0);
  const interstellarBoost = computeAutoFlightSpeed(200_000, 68, 1_500_000, true, 0);

  assert.ok(surfaceSkim < orbitSpeed, 'Orbit speed must exceed surface skim');
  assert.ok(orbitSpeed < interplanetary, 'Interplanetary speed must exceed orbit speed');
  assert.ok(interplanetary < interstellar, 'Interstellar speed must exceed interplanetary speed');
  assert.ok(interstellarBoost > interstellar * 3, 'Boost must dramatically amplify interstellar speed');
});

test('flight regime classification handles surface, atmosphere, orbit, interplanetary, interstellar', () => {
  const earth = BODY_BY_ID['earth'];
  const moon = BODY_BY_ID['moon'];
  assert.equal(classifyFlightRegime(true, 0, earth, 3400), 'SURFACE');
  assert.equal(classifyFlightRegime(false, 2, earth, 3400), 'ATMOSPHERE');
  assert.equal(classifyFlightRegime(false, 2, moon, 3400), 'ORBITAL'); // Vacuum moon
  assert.equal(classifyFlightRegime(false, 120, earth, 3400), 'ORBITAL');
  assert.equal(classifyFlightRegime(false, 1200, earth, 5000), 'INTERPLANETARY');
  assert.equal(classifyFlightRegime(false, 90000, earth, 90000), 'INTERSTELLAR');
});

test('procedural terrain height is deterministic and bounded', () => {
  const h1 = sampleProceduralTerrainHeight(0.3, 0.7, 0.64, 204, 1.3, 0.96);
  const h2 = sampleProceduralTerrainHeight(0.3, 0.7, 0.64, 204, 1.3, 0.96);
  assert.equal(h1, h2, 'Terrain height must be strictly deterministic');
  assert.ok(Math.abs(h1) < 5, `Terrain relief should stay well-bounded, got ${h1}`);
});

test('warp step converges smoothly from Sol to Alpha Centauri without overshoot', () => {
  const start = computeBodyWorldPosition(BODY_BY_ID['earth'], 0);
  const target = computeBodyWorldPosition(BODY_BY_ID['proxima-b'], 0);
  const arrivalR = BODY_BY_ID['proxima-b'].radius * 3.0;

  let pos = { ...start };
  let arrived = false;
  for (let i = 0; i < 400; i++) {
    const step = computeWarpStep(pos, target, arrivalR, 0.05);
    pos = step.nextPos;
    if (step.arrived) {
      arrived = true;
      break;
    }
  }
  assert.equal(arrived, true, 'Warp should arrive cleanly within simulation window');
  const finalDist = distance3d(pos, target);
  assert.ok(
    finalDist >= arrivalR * 0.9 && finalDist <= arrivalR * 1.15,
    `Final warp distance ${finalDist} should match arrival radius ${arrivalR}`,
  );
});

test('speed and distance formatters produce clean astronomical strings', () => {
  assert.match(formatSpeed(2), /m\/s$/);
  assert.match(formatSpeed(50), /km\/s$/);
  assert.match(formatSpeed(400_000), /c$/);
  assert.match(formatSpeed(LY_UNITS * 2.5), /ly\/s$/);

  assert.match(formatDistance(2), /m$/);
  assert.match(formatDistance(50), /km$/);
  assert.match(formatDistance(6_800), /AU$/);
  assert.match(formatDistance(LY_UNITS * 4.37), /ly$/);
});

test('Rayleigh scattering parameters reflect planetary atmospheric composition', () => {
  const earth = getPlanetRayleighParams(BODY_BY_ID['earth']);
  const mars = getPlanetRayleighParams(BODY_BY_ID['mars']);
  const titan = getPlanetRayleighParams(BODY_BY_ID['titan']);
  const moon = getPlanetRayleighParams(BODY_BY_ID['moon']);

  // Earth scatters blue much more strongly than red (lambda^-4)
  assert.ok(earth.betaRayleigh[2] > earth.betaRayleigh[0] * 3, 'Earth Rayleigh blue must dominate red');
  // Mars dust-rich atmosphere scatters warm red-amber more strongly than blue
  assert.ok(mars.betaRayleigh[0] > mars.betaRayleigh[2] * 2, 'Mars dust scatter red must dominate blue');
  // Titan dense haze has high refractive dispersion & intensity
  assert.ok(titan.refractiveDispersion > earth.refractiveDispersion);
  // Vacuum Moon has zero Rayleigh scattering intensity
  assert.equal(moon.intensity, 0);
});

test('atmospheric entry refraction ramps smoothly from vacuum to surface and responds to speed & twilight', () => {
  const earth = BODY_BY_ID['earth'];
  const orbitState = computeAtmosphericEntryState(earth, 80, 10, 0.5);
  const entryFast = computeAtmosphericEntryState(earth, 7, 32, 0.0); // Twilight high-speed entry
  const surfaceDay = computeAtmosphericEntryState(earth, 0, 2, 0.85);
  const surfaceNight = computeAtmosphericEntryState(earth, 0, 2, -0.8);
  const moonEntry = computeAtmosphericEntryState(BODY_BY_ID['moon'], 2, 30, 0.5);

  assert.equal(orbitState.immersion, 0);
  assert.equal(orbitState.entryGlow, 0);
  assert.ok(entryFast.immersion > 0.25 && entryFast.immersion < 1.0);
  assert.ok(entryFast.entryGlow > 0.3, 'Fast mid-atmosphere plunge should produce entry airglow');
  assert.ok(entryFast.buffeting > 0.2, 'Fast atmospheric entry should produce Max-Q aerodynamic buffeting');
  assert.ok(entryFast.refractionShift > 0.25, 'Twilight atmospheric entry should drive strong light refraction');
  assert.ok(surfaceDay.starAttenuation > 0.7, 'Bright Earth daytime sky should attenuate faint stars');
  assert.equal(surfaceNight.starAttenuation, 0, 'Earth night hemisphere should keep stars clear');
  assert.equal(moonEntry.immersion, 0, 'Vacuum Moon should remain free of atmospheric immersion');

  const earthPlasma = getEntryPlasmaPalette(earth);
  const marsPlasma = getEntryPlasmaPalette(BODY_BY_ID['mars']);
  const titanPlasma = getEntryPlasmaPalette(BODY_BY_ID['titan']);
  assert.notEqual(earthPlasma.wakeIon, marsPlasma.wakeIon, 'Earth N2/O2 wake should differ from Mars CO2 crimson wake');
  assert.notEqual(titanPlasma.wakeIon, marsPlasma.wakeIon, 'Titan CH4 wake should differ from Mars CO2 wake');
  assert.match(earthPlasma.shockCore, /^#[0-9a-f]{6}$/i);
});

test('Sagittarius A* supermassive black hole exists with companion Star S2 and landable Penrose world', () => {
  assert.ok(SYSTEM_BY_ID['sagittarius-a'], 'Expected Sagittarius A* star system');
  const bh = BODY_BY_ID['sgr-a-star'];
  assert.ok(bh, 'Expected Sagittarius A* body');
  assert.equal(bh.kind, 'black-hole');
  assert.equal(bh.landable, false);
  assert.ok(BODY_BY_ID['sgr-s2'], 'Expected companion Star S2');
  assert.ok(BODY_BY_ID['sgr-penrose']?.landable, 'Expected landable Penrose world');
});

test('general relativistic black hole physics produces accurate time dilation, tidal pull, horizon breach, and light deflection', () => {
  const rs = 620;
  const far = computeBlackHoleRelativity(rs * 30, rs);
  const orbit = computeBlackHoleRelativity(rs * 7.6, rs);
  const photonSphere = computeBlackHoleRelativity(rs * 1.8, rs);
  const horizon = computeBlackHoleRelativity(rs * 1.05, rs);

  assert.equal(far.timeDilation, 1.0);
  assert.equal(far.tidalPullAccel, 0);
  assert.equal(far.horizonWarning, false);

  // Schwarzschild time dilation slows monotonically toward the Event Horizon
  assert.ok(orbit.timeDilation < 0.96 && orbit.timeDilation > 0.88);
  assert.ok(photonSphere.timeDilation < orbit.timeDilation);
  assert.ok(photonSphere.tidalPullAccel > orbit.tidalPullAccel * 5);
  assert.equal(photonSphere.horizonWarning, true);
  assert.equal(photonSphere.crossedHorizon, false);
  assert.equal(horizon.crossedHorizon, true);

  // Einstein light deflection diverges inside critical shadow radius b_crit ≈ 2.598 Rs
  assert.equal(computeDeflectionAngleRad(rs * 2.2, rs), Number.POSITIVE_INFINITY);
  const strongBend = computeDeflectionAngleRad(rs * 2.8, rs);
  const weakBend = computeDeflectionAngleRad(rs * 10, rs);
  assert.ok(strongBend > weakBend * 3, 'Strong-field photon-sphere deflection must far exceed weak-field bend');
});

test('gamepad mapper filters stick drift deadzone, maps analog flight axes, and fires edge-triggered actions once', () => {
  // Small drift inside deadzone zeroes out cleanly
  assert.deepEqual(applyRadialDeadzone(0.05, -0.08), [0, 0]);
  // Full forward stick produces unit magnitude
  const [fx, fy] = applyRadialDeadzone(0, -1);
  assert.ok(Math.abs(fx) < 1e-6 && Math.abs(fy + 1) < 1e-6);

  const buttons = new Array(17).fill(0);
  buttons[2] = 1; // X = Land
  buttons[7] = 0.85; // RT = Boost
  buttons[15] = 1; // D-Pad Right = Black Hole shortcut

  const frame1 = processGamepadState(
    { connected: true, id: 'Xbox Wireless Controller (STANDARD GAMEPAD)', axes: [0.5, -0.8, 0.6, 0.0], buttons },
    [],
  );
  assert.equal(frame1.input.connected, true);
  assert.equal(frame1.input.name, 'Xbox Wireless Controller');
  assert.ok(frame1.input.moveForward > 0.5, 'Up on left stick should move forward');
  assert.ok(frame1.input.lookYaw > 0.25, 'Right on right stick should pan right');
  assert.equal(frame1.input.boostHeld, true);
  assert.equal(frame1.input.pressedLand, true);
  assert.equal(frame1.input.pressedBlackHoleShortcut, true);

  // Holding the same buttons on frame 2 must NOT re-trigger one-shot actions
  const frame2 = processGamepadState(
    { connected: true, id: 'Xbox Wireless Controller', axes: [0, 0, 0, 0], buttons },
    frame1.nextButtons,
  );
  assert.equal(frame2.input.pressedLand, false);
  assert.equal(frame2.input.pressedBlackHoleShortcut, false);
  assert.equal(frame2.input.boostHeld, true);
});

test('Hawking radiation shifts spectral color, blueshift factor, and emission flux with camera proximity', () => {
  const rs = 620;
  const far = computeHawkingRadiationProfile(rs * 16, rs);
  const orbit = computeHawkingRadiationProfile(rs * 9.4, rs);
  const mid = computeHawkingRadiationProfile(rs * 7.2, rs);
  const close = computeHawkingRadiationProfile(rs * 2.4, rs);

  assert.equal(far.proximity, 0);
  assert.ok(orbit.proximity > 0.25 && orbit.proximity < 0.45);
  assert.ok(mid.proximity > orbit.proximity && close.proximity > mid.proximity);
  assert.ok(close.proximity > 0.95);

  // Intensity, emission speed, and gravitational blueshift increase monotonically as camera approaches
  assert.ok(far.intensity < orbit.intensity && orbit.intensity < mid.intensity && mid.intensity < close.intensity);
  assert.ok(far.emissionSpeed < mid.emissionSpeed && mid.emissionSpeed < close.emissionSpeed);
  assert.ok(far.blueshiftFactor < orbit.blueshiftFactor && orbit.blueshiftFactor < close.blueshiftFactor);

  // Spectral color shifts from far violet-indigo (higher red than green) -> mid electric cyan -> close high-energy cyan-white
  assert.ok(far.primaryColor[0] > far.primaryColor[1], 'Far redshifted Hawking emission should be violet-indigo tinted');
  assert.ok(mid.primaryColor[1] > mid.primaryColor[0] * 2.5, 'Mid approach should shift into electric cyan');
  assert.ok(
    close.primaryColor[0] > mid.primaryColor[0] &&
      close.primaryColor[1] > mid.primaryColor[1] &&
      close.primaryColor[2] >= 0.95,
    'Close event-horizon approach should blueshift into high-energy Cherenkov cyan-white',
  );
});

test('dynamic star lens flare responds to camera angle, planetary eclipses, diamond-ring grazing, and horizon sunset', () => {
  const baseCam = {
    cameraPos: { x: 0, y: 0, z: 0 },
    cameraForward: { x: 0, y: 0, z: -1 },
    cameraRight: { x: 1, y: 0, z: 0 },
    cameraUp: { x: 0, y: 1, z: 0 },
    fovRad: Math.PI / 3,
    aspect: 16 / 9,
    starPos: { x: 0, y: 0, z: -2000 },
    starRadius: 120,
    occluders: [],
  };

  // 1. Direct unobstructed view of the star produces strong centered flare
  const clear = computeStarLensFlareState(baseCam);
  assert.equal(clear.visible, true);
  assert.equal(clear.visibility, 1);
  assert.ok(clear.intensity > 0.75, `Expected strong clear flare intensity, got ${clear.intensity}`);
  assert.ok(Math.abs(clear.ndcX) < 1e-4 && Math.abs(clear.ndcY) < 1e-4);

  // 2. Looking away from star cleanly hides flare
  const away = computeStarLensFlareState({
    ...baseCam,
    cameraForward: { x: 0, y: 0, z: 1 },
  });
  assert.equal(away.visible, false);
  assert.equal(away.intensity, 0);

  // 3. Large planet directly between camera and star completely eclipses flare
  const eclipsed = computeStarLensFlareState({
    ...baseCam,
    occluders: [{ x: 0, y: 0, z: -400, radius: 95 }],
  });
  assert.equal(eclipsed.visible, false);
  assert.equal(eclipsed.visibility, 0);

  // 4. Grazing planetary limb triggers partial eclipse & diamond-ring flash
  const grazing = computeStarLensFlareState({
    ...baseCam,
    occluders: [{ x: 66, y: 0, z: -400, radius: 66 }],
  });
  assert.equal(grazing.visible, true);
  assert.ok(grazing.visibility > 0.05 && grazing.visibility < 0.95);
  assert.ok(grazing.diamondRing > 0.25, `Expected grazing diamond-ring glint, got ${grazing.diamondRing}`);

  // 5. Standing on a planet after sunset hides the star behind the planetary horizon
  const sunsetHidden = computeStarLensFlareState({
    ...baseCam,
    starPos: { x: 0, y: -300, z: -2000 },
    landedSurfaceUp: { x: 0, y: 1, z: 0 },
  });
  assert.equal(sunsetHidden.visible, false);
  assert.equal(sunsetHidden.visibility, 0);
});

test('Megaton-Rainfall low-altitude speed brakes smoothly and planetary biome terrain creates dry landing clearing', () => {
  // Near-surface & near-black-hole flight slows dramatically to humbling scale-relative inspection speed
  const veryLowAlt = computeAutoFlightSpeed(1.2, 68, 3_400, false, 0);
  const midAtmo = computeAutoFlightSpeed(10, 68, 3_400, false, 0);
  const highOrbit = computeAutoFlightSpeed(120, 68, 3_400, false, 0);
  const bhNear = computeAutoFlightSpeed(3_600, 1_800, 5_400, false, 0, 'black-hole');
  const planetSameRatio = computeAutoFlightSpeed(3_600, 1_800, 5_400, false, 0, 'planet');
  assert.ok(veryLowAlt < 2.0, `Near-surface speed should stay gentle (<2.0), got ${veryLowAlt}`);
  assert.ok(veryLowAlt < midAtmo && midAtmo < highOrbit);
  assert.ok(bhNear < planetSameRatio * 0.6, `Black hole proximity should apply gravitational awe braking (${bhNear} vs ${planetSameRatio})`);

  const earth = BODY_BY_ID['earth'];
  const mars = BODY_BY_ID['mars'];
  const earthSea = getPlanetarySeaLevel(earth);
  assert.ok(earthSea !== null, 'Earth should have an ocean sea level');
  assert.equal(getPlanetarySeaLevel(mars), null, 'Mars should not have liquid ocean sea level');

  const earthSpawnH = sampleSurfaceBiomeHeight(0, 0, earth);
  assert.ok(
    earthSea !== null && earthSpawnH > earthSea + 0.5,
    `Earth landing clearing (${earthSpawnH}) must stay dry above sea level (${earthSea})`,
  );

  // Deterministic terrain height on Mars
  const m1 = sampleSurfaceBiomeHeight(42.5, -61.2, mars);
  const m2 = sampleSurfaceBiomeHeight(42.5, -61.2, mars);
  assert.equal(m1, m2);
  assert.ok(Math.abs(m1) < 60);
});

test('Event Horizon plunge accelerates particles monotonically and wraps 5D Tesseract coordinates seamlessly', () => {
  const start = computePlungeDynamics(0);
  const mid = computePlungeDynamics(PLUNGE_DURATION_SEC * 0.55);
  const late = computePlungeDynamics(PLUNGE_DURATION_SEC * 0.82);
  const end = computePlungeDynamics(PLUNGE_DURATION_SEC);

  assert.ok(PLUNGE_DURATION_SEC >= 10, `Extended Event Horizon plunge should last >= 10s, got ${PLUNGE_DURATION_SEC}`);
  assert.equal(start.progress, 0);
  assert.equal(start.transitionReady, false);
  assert.ok(mid.particleAccel > start.particleAccel * 3, 'Particles should accelerate strongly during plunge');
  assert.ok(late.skyRingScale < start.skyRingScale, 'Overhead sky ring should collapse during descent');
  assert.ok(late.latticeReveal > 0.25, '5D Tesseract lattice should materialize in the late plunge');
  assert.equal(end.transitionReady, true);

  // Seamless modular 3D wrapping inside [-CELL/2, +CELL/2)
  const w1 = wrapTesseractCoord(TESSERACT_CELL_SIZE * 3 + 4.25, TESSERACT_CELL_SIZE);
  const w2 = wrapTesseractCoord(-TESSERACT_CELL_SIZE * 2 + 4.25, TESSERACT_CELL_SIZE);
  assert.ok(Math.abs(w1 - 4.25) < 1e-6 && Math.abs(w2 - 4.25) < 1e-6);

  // Gravity pulse wave peaks near active wavefront and returns 0 when idle
  assert.equal(computeGravityStringWave(20, 0), 0);
  assert.equal(computeGravityStringWave(20, 1), 0);
  assert.ok(computeGravityStringWave(46, 0.5) > 0.45);
});

test('Interstellar soundtrack cues 3:30 (210s) organ climax for Event Horizon & Tesseract only', () => {
  assert.equal(
    INTERSTELLAR_THEME_URL,
    '/assets/aistudio/Interstellar_Main_Theme_-_Hans_Zimmer__1__4d6ce0c5.mp3',
  );
  assert.equal(PEAK_CUE_START_SEC, 210.0, 'Peak climax cue must start right at 3:30 (210s)');
  assert.ok(PEAK_CUE_END_SEC > PEAK_CUE_START_SEC + 20);
  assert.ok(AMBIENT_LOOP_END_SEC < PEAK_CUE_START_SEC);

  // Normal planetary / space exploration stays on the contemplative ambient stem
  assert.equal(
    shouldUsePeakCue({
      tesseractStage: 'outside',
      blackHoleProximity: 0.15,
      horizonWarning: false,
      pointOfNoReturn: false,
    }),
    false,
  );

  // Event Horizon approach, point of no return, plunge, and Tesseract trigger the 3:30+ peak stem
  assert.equal(shouldUsePeakCue({ tesseractStage: 'outside', blackHoleProximity: 0.72 }), true);
  assert.equal(shouldUsePeakCue({ tesseractStage: 'outside', horizonWarning: true }), true);
  assert.equal(shouldUsePeakCue({ tesseractStage: 'outside', pointOfNoReturn: true }), true);
  assert.equal(shouldUsePeakCue({ tesseractStage: 'plunge', blackHoleProximity: 0 }), true);
  assert.equal(shouldUsePeakCue({ tesseractStage: 'tesseract', blackHoleProximity: 0 }), true);

  // Loop boundary fade envelope smoothly reaches 1 mid-window and tapers at edges
  assert.equal(computeTrackLoopEnvelope(PEAK_CUE_START_SEC, PEAK_CUE_START_SEC, PEAK_CUE_END_SEC, 1.5), 0);
  assert.equal(computeTrackLoopEnvelope(PEAK_CUE_START_SEC + 10, PEAK_CUE_START_SEC, PEAK_CUE_END_SEC, 1.5), 1);
  assert.ok(
    computeTrackLoopEnvelope(AMBIENT_LOOP_END_SEC - 0.5, AMBIENT_LOOP_START_SEC, AMBIENT_LOOP_END_SEC, 1.5) < 0.5,
  );
});

test('Horizon Proximity Indicator shifts smoothly from blue to urgent red across atmospheres & Event Horizons', () => {
  const blueHex = interpolateHorizonColor(0.0);
  const amberHex = interpolateHorizonColor(0.45);
  const redHex = interpolateHorizonColor(1.0);
  assert.equal(blueHex, '#38bdf8');
  assert.notEqual(amberHex, blueHex);
  assert.equal(redHex, '#ff1e2e');

  // 1. Far from Earth atmosphere -> hidden
  const deepSpace = computeHorizonProximityIndicator({
    nearestBodyKind: 'planet',
    nearestBodyName: 'Earth',
    altitude: 900,
    bodyRadius: 68,
    atmosphereDensity: 1.0,
    atmosphereHeightRatio: 0.085,
    blackHoleDistance: null,
    blackHoleRadius: null,
    blackHoleProximity: 0,
    horizonWarning: false,
    pointOfNoReturn: false,
    isLanded: false,
    tesseractStage: 'outside',
  });
  assert.equal(deepSpace.visible, false);

  // 2. Outer Earth atmospheric approach -> subtle blue nominal
  const outerAtmo = computeHorizonProximityIndicator({
    nearestBodyKind: 'planet',
    nearestBodyName: 'Earth',
    altitude: 105,
    bodyRadius: 68,
    atmosphereDensity: 1.0,
    atmosphereHeightRatio: 0.085,
    blackHoleDistance: null,
    blackHoleRadius: null,
    blackHoleProximity: 0,
    horizonWarning: false,
    pointOfNoReturn: false,
    isLanded: false,
    tesseractStage: 'outside',
  });
  assert.equal(outerAtmo.visible, true);
  assert.equal(outerAtmo.mode, 'atmosphere');
  assert.equal(outerAtmo.severity, 'nominal');

  // 3. Deep Earth Max-Q atmospheric entry -> critical warm orange/red
  const deepAtmo = computeHorizonProximityIndicator({
    nearestBodyKind: 'planet',
    nearestBodyName: 'Earth',
    altitude: 6,
    bodyRadius: 68,
    atmosphereDensity: 1.0,
    atmosphereHeightRatio: 0.085,
    blackHoleDistance: null,
    blackHoleRadius: null,
    blackHoleProximity: 0,
    horizonWarning: false,
    pointOfNoReturn: false,
    isLanded: false,
    tesseractStage: 'outside',
  });
  assert.equal(deepAtmo.visible, true);
  assert.equal(deepAtmo.severity, 'critical');
  assert.equal(deepAtmo.pulseUrgent, true);

  // 4. Sagittarius A* Photon Sphere -> urgent red critical
  const photonSphere = computeHorizonProximityIndicator({
    nearestBodyKind: 'black-hole',
    nearestBodyName: 'Sagittarius A*',
    altitude: 3000,
    bodyRadius: 1800,
    atmosphereDensity: 0,
    atmosphereHeightRatio: 0,
    blackHoleDistance: 1800 * 2.5,
    blackHoleRadius: 1800,
    blackHoleProximity: 0.85,
    horizonWarning: true,
    pointOfNoReturn: false,
    isLanded: false,
    tesseractStage: 'outside',
  });
  assert.equal(photonSphere.visible, true);
  assert.equal(photonSphere.mode, 'event-horizon');
  assert.equal(photonSphere.severity, 'critical');
  assert.equal(photonSphere.pulseUrgent, true);

  // 5. Black Hole Point of No Return & Plunge -> irreversible crimson lock
  const captured = computeHorizonProximityIndicator({
    nearestBodyKind: 'black-hole',
    nearestBodyName: 'Sagittarius A*',
    altitude: 500,
    bodyRadius: 1800,
    atmosphereDensity: 0,
    atmosphereHeightRatio: 0,
    blackHoleDistance: 1800 * 1.28,
    blackHoleRadius: 1800,
    blackHoleProximity: 0.98,
    horizonWarning: true,
    pointOfNoReturn: true,
    isLanded: false,
    tesseractStage: 'outside',
  });
  assert.equal(captured.mode, 'point-of-no-return');
  assert.equal(captured.severity, 'irreversible');
  assert.equal(captured.colorHex, '#ff1e2e');

  const plungeInput = {
    nearestBodyKind: 'black-hole' as const,
    nearestBodyName: 'Sagittarius A*',
    altitude: 0,
    bodyRadius: 1800,
    atmosphereDensity: 0,
    atmosphereHeightRatio: 0,
    blackHoleDistance: 0,
    blackHoleRadius: 1800,
    blackHoleProximity: 1,
    horizonWarning: true,
    pointOfNoReturn: true,
    isLanded: false,
    tesseractStage: 'plunge' as const,
  };
  const plungeState = computeHorizonProximityIndicator(plungeInput);
  assert.equal(plungeState.mode, 'point-of-no-return');
  assert.equal(plungeState.metricText, 'r < Rs · v_esc > c');

  // 6. Inside the 5D Tesseract -> hidden
  const inTesseract = computeHorizonProximityIndicator({
    ...plungeInput,
    tesseractStage: 'tesseract',
  });
  assert.equal(inTesseract.visible, false);
});

test('Black Hole Point of No Return triggers inside 1.42 Rs and 5D World-Particle Anchors remain strictly localized', () => {
  const rs = 1800;
  const safeOrbit = computeBlackHoleRelativity(rs * 3.0, rs);
  const photonRim = computeBlackHoleRelativity(rs * 1.8, rs);
  const trapped = computeBlackHoleRelativity(rs * 1.32, rs);

  assert.equal(safeOrbit.pointOfNoReturn, false);
  assert.equal(photonRim.pointOfNoReturn, false);
  assert.equal(trapped.pointOfNoReturn, true, 'Must enforce gravitational Point of No Return inside 1.42 Rs');
  assert.ok(
    trapped.tidalPullAccel > photonRim.tidalPullAccel * 1.25,
    `Capture surge should overpower reverse thrust (${trapped.tidalPullAccel} vs ${photonRim.tidalPullAccel})`,
  );

  // Extended Event Horizon -> Tesseract plunge duration (>= 20s)
  assert.ok(PLUNGE_DURATION_SEC >= 20, `Plunge duration should be >= 20s, got ${PLUNGE_DURATION_SEC}`);

  // 3 rare localized 5D World-Particle Memory Anchors must sit at distinct, widely separated Bulk coordinates
  assert.equal(TESSERACT_MEMORY_ANCHORS.length, 3);
  for (let i = 0; i < TESSERACT_MEMORY_ANCHORS.length; i++) {
    for (let j = i + 1; j < TESSERACT_MEMORY_ANCHORS.length; j++) {
      const a = TESSERACT_MEMORY_ANCHORS[i].position;
      const b = TESSERACT_MEMORY_ANCHORS[j].position;
      const sep = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      assert.ok(sep > 45, `Memory anchors must be localized & well-separated (got ${sep})`);
    }
  }

  // Far away in Bulk space: NOT in range (not tiled everywhere)
  const farBulk = findNearestMemoryAnchor({ x: 180, y: 90, z: 180 });
  assert.equal(farBulk.inRange, false);
  assert.ok(farBulk.distance > 150);

  // Near Echo I (Earth 2067 Gravity Dust): in range & identifies the exact localized anchor
  const nearEarthEcho = findNearestMemoryAnchor({ x: -10, y: 1.5, z: -20 });
  assert.equal(nearEarthEcho.inRange, true);
  assert.equal(nearEarthEcho.anchor.id, 'anchor-bookshelf-earth');
});


