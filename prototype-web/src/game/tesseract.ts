import * as THREE from 'three';
import {
  TESSERACT_CELL_SIZE,
  TESSERACT_MEMORY_ANCHORS,
  type PlungeDynamics,
  type TesseractStage,
  wrapTesseractCoord,
} from './tesseractMath';

export interface TesseractUpdateParams {
  stage: TesseractStage;
  plunge: PlungeDynamics;
  /** 3D position inside the infinite 5D bulk (floats freely in all axes) */
  bulkPos: THREE.Vector3;
  /** Current gravity pulse expansion 0..1 (1 = idle) */
  pulseProgress: number;
  /** Set of localized 5D World-Particle Memory Anchor IDs decoded by the player */
  decodedAnchorIds: ReadonlySet<string>;
  time: number;
  pixelRatio: number;
}

export interface TesseractRealm {
  group: THREE.Group;
  update: (params: TesseractUpdateParams) => void;
  hide: () => void;
  dispose: () => void;
}

const GRID_HALF = 2; // 5x5x5 = 125 infinite modular bulk cells around player
const CELL = TESSERACT_CELL_SIZE; // 28 units per 5D hypercube bay
const PLUNGE_PARTICLE_COUNT = 1_800;
const DUST_MOTE_COUNT = 760;

function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Builds the dedicated, lazy-initialized Interstellar Black Hole Interior Plunge
 * and Infinite 5th-Dimensional Tesseract Environment.
 *
 * Completely invisible (`group.visible = false`) and zero-cost whenever the player
 * is outside the black hole.
 */
export function createTesseractRealm(): TesseractRealm {
  const group = new THREE.Group();
  group.visible = false;

  // =========================================================================
  // Dedicated Atmospheric Lighting Rig (strictly disabled while outside the Black Hole!)
  // =========================================================================
  const tesseractAmbient = new THREE.HemisphereLight('#b57c42', '#0a0709', 0);
  tesseractAmbient.visible = false;
  group.add(tesseractAmbient);

  const warmKeyLight = new THREE.DirectionalLight('#ffbe73', 0);
  warmKeyLight.position.set(22, 48, 18);
  warmKeyLight.visible = false;
  group.add(warmKeyLight);

  const coolAbyssRim = new THREE.DirectionalLight('#4a7bb5', 0);
  coolAbyssRim.position.set(-34, -26, -24);
  coolAbyssRim.visible = false;
  group.add(coolAbyssRim);

  const playerLantern = new THREE.PointLight('#ffba66', 0, 62, 1.5);
  playerLantern.position.set(0, 2.5, 0);
  playerLantern.visible = false;
  group.add(playerLantern);

  // =========================================================================
  // STAGE 1: EVENT HORIZON FREE-FALL PLUNGE (3D Accelerating Velocity Streaks + Shrinking Sky Ring)
  // =========================================================================
  const plungeGroup = new THREE.Group();
  group.add(plungeGroup);

  const randPlunge = seededRand(90713);
  const streakVertCount = PLUNGE_PARTICLE_COUNT * 2;
  const pPos = new Float32Array(streakVertCount * 3);
  const pMeta = new Float32Array(streakVertCount * 3); // x: speedScale, y: streakLenScale, z: hueMix
  const pEnd = new Float32Array(streakVertCount); // 0 = leading head, 1 = trailing tail
  for (let i = 0; i < PLUNGE_PARTICLE_COUNT; i++) {
    const theta = randPlunge() * Math.PI * 2;
    // Cylinder tunnel shell around the falling player (hollow core r>=2.6 so streaks frame the camera cleanly)
    const radial = 2.6 + Math.pow(randPlunge(), 0.75) * 56;
    const x = Math.cos(theta) * radial;
    const y = (randPlunge() - 0.5) * 210;
    const z = Math.sin(theta) * radial;
    const speedScale = 0.65 + randPlunge() * 1.45;
    const lenScale = 0.6 + Math.pow(randPlunge(), 1.4) * 1.65;
    const hueMix = randPlunge();

    for (let v = 0; v < 2; v++) {
      const vi = i * 2 + v;
      pPos[vi * 3] = x;
      pPos[vi * 3 + 1] = y;
      pPos[vi * 3 + 2] = z;
      pMeta[vi * 3] = speedScale;
      pMeta[vi * 3 + 1] = lenScale;
      pMeta[vi * 3 + 2] = hueMix;
      pEnd[vi] = v;
    }
  }

  const plungeGeo = new THREE.BufferGeometry();
  plungeGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  plungeGeo.setAttribute('aMeta', new THREE.BufferAttribute(pMeta, 3));
  plungeGeo.setAttribute('aEnd', new THREE.BufferAttribute(pEnd, 1));

  const plungeMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFallOffset: { value: 0 },
      uAccel: { value: 1 },
      uOpacity: { value: 1 },
      uPixelRatio: { value: 1 },
    },
    vertexShader: `
      attribute vec3 aMeta;
      attribute float aEnd;
      uniform float uFallOffset;
      uniform float uAccel;

      varying float vHue;
      varying float vAlpha;
      varying float vEnd;

      void main() {
        vec3 p = position;
        // Rush 3D relativistic streaks violently UPWARD past the falling Voyager, wrapping seamlessly across 210m height
        float span = 210.0;
        float baseY = mod(p.y + uFallOffset * aMeta.x + span * 0.5, span) - span * 0.5;

        // Stretch each 3D streak dramatically from 2.8m up to 34m as relativistic acceleration climbs to 42x!
        float stretchNorm = clamp((uAccel - 1.0) / 24.0, 0.0, 1.0);
        float streakLen = mix(2.8, 34.0, stretchNorm) * aMeta.y;
        p.y = baseY + aEnd * streakLen;

        // Relativistic inward gravitational lensing convergence as speed intensifies
        float pinch = 1.0 - clamp((uAccel - 1.0) / 56.0, 0.0, 0.38);
        p.xz *= pinch;

        vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
        float dist = max(1.5, -mvPos.z);

        vHue = aMeta.z;
        vEnd = aEnd;
        float verticalFade = 1.0 - smoothstep(74.0, 102.0, abs(baseY));
        vAlpha = verticalFade * clamp(38.0 / dist, 0.22, 1.0);

        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      varying float vHue;
      varying float vAlpha;
      varying float vEnd;

      void main() {
        // Hot luminous leading head fading smoothly into a razor-sharp relativistic tail
        float headFade = mix(1.0, 0.08, vEnd);
        float alpha = headFade * vAlpha * uOpacity * 0.92;
        if (alpha < 0.01) discard;

        vec3 colCyan = vec3(0.56, 0.86, 1.0);
        vec3 colGold = vec3(1.0, 0.72, 0.32);
        vec3 colWhite = vec3(1.0, 0.97, 0.92);
        vec3 tint = mix(colCyan, colGold, smoothstep(0.28, 0.84, vHue));
        vec3 col = mix(tint, colWhite, (1.0 - vEnd) * 0.75);
        gl_FragColor = vec4(col * (1.15 + (1.0 - vEnd) * 0.85), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });

  const plungePoints = new THREE.LineSegments(plungeGeo, plungeMat);
  plungePoints.frustumCulled = false;
  plungeGroup.add(plungePoints);

  // Collapsing Einstein Sky Aperture (the outside universe shrinking into a delicate golden-blue ring far above)
  const skyRingGeo = new THREE.PlaneGeometry(42, 42);
  const skyRingMat = new THREE.ShaderMaterial({
    uniforms: {
      uScale: { value: 1.0 },
      uTime: { value: 0.0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uScale;
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float r = length(vUv);
        float targetR = max(0.03, uScale * 0.56);
        float thinRing = exp(-pow((r - targetR) / (0.018 + targetR * 0.045), 2.0));
        float outerAura = exp(-pow((r - targetR * 1.08) / (0.065 + targetR * 0.09), 2.0)) * 0.28;
        float shimmer = 0.84 + 0.16 * sin(atan(vUv.y, vUv.x) * 9.0 + uTime * 4.5);
        vec3 amberEdge = vec3(0.95, 0.58, 0.22);
        vec3 blueShift = vec3(0.48, 0.78, 1.0);
        vec3 col = mix(amberEdge, blueShift, smoothstep(targetR * 0.85, targetR * 1.18, r));
        col += vec3(1.0, 0.92, 0.78) * thinRing * 0.45;
        float alpha = (thinRing * 0.82 * shimmer + outerAura) * smoothstep(0.0, 0.12, uScale);
        if (alpha < 0.008) discard;
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.88));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const skyRingMesh = new THREE.Mesh(skyRingGeo, skyRingMat);
  skyRingMesh.position.set(-14, 28, -68);
  skyRingMesh.lookAt(0, 0, 0);
  skyRingMesh.frustumCulled = false;
  plungeGroup.add(skyRingMesh);

  // =========================================================================
  // STAGE 2: INFINITE 5TH-DIMENSIONAL TESSERACT ARCHITECTURE
  // =========================================================================
  const bulkGroup = new THREE.Group();
  group.add(bulkGroup);

  const cellDim = GRID_HALF * 2 + 1; // 5
  const totalCells = cellDim * cellDim * cellDim; // 125

  // 2A. Primary Structural Worldline Beams (3 orthogonal dark bronze-obsidian struts per cell = 375 instances)
  const beamGeo = new THREE.BoxGeometry(1, 1, 1);
  const beamMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#2a1d13'),
    emissive: new THREE.Color('#3c220c'),
    emissiveIntensity: 0.42,
    roughness: 0.42,
    metalness: 0.72,
    transparent: true,
    opacity: 1.0,
  });
  const beamInstances = new THREE.InstancedMesh(beamGeo, beamMat, totalCells * 3);
  beamInstances.frustumCulled = false;
  bulkGroup.add(beamInstances);

  // 2B. Extruded Temporal Bookshelf Slats / Time-Slice Planes (4 slatted rib racks per cell = 500 instances)
  const slatGeo = new THREE.BoxGeometry(1, 1, 1);
  const slatMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#6b4728'),
    emissive: new THREE.Color('#9c5c1f'),
    emissiveIntensity: 0.36,
    roughness: 0.55,
    metalness: 0.48,
    transparent: true,
    opacity: 0.95,
  });
  const slatInstances = new THREE.InstancedMesh(slatGeo, slatMat, totalCells * 4);
  slatInstances.frustumCulled = false;
  bulkGroup.add(slatInstances);

  // 2C. Luminous Dusty Amber "Memory Windows" / Slatted Temporal Light Shafts (2 crossed planes per cell = 250 instances)
  const windowGeo = new THREE.PlaneGeometry(CELL * 0.42, CELL * 0.68);
  const windowMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uReveal: { value: 1 },
      uPulseRadius: { value: -10 },
      uPulseStrength: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying float vCamDist;

      void main() {
        vUv = uv;
        vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vec4 mvPos = viewMatrix * worldPos;
        vCamDist = length(mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uReveal;
      uniform float uPulseRadius;
      uniform float uPulseStrength;

      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying float vCamDist;

      float hash21(vec2 p) {
        p = fract(p * vec2(234.34, 435.345));
        p += dot(p, p + 34.23);
        return fract(p.x * p.y);
      }

      void main() {
        // Horizontal slatted temporal bookshelf bars & vertical worldline striations
        float shelfBand = smoothstep(0.14, 0.24, abs(fract(vUv.y * 11.0) - 0.5));
        float bookSlice = 0.55 + 0.45 * sin(vUv.x * 46.0 + floor(vUv.y * 11.0) * 3.7);
        float verticalBars = smoothstep(0.08, 0.20, abs(fract(vUv.x * 7.0) - 0.5));

        // Soft warm rectangular window vignette so planes never show hard polygon edges
        float edgeX = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x);
        float edgeY = smoothstep(0.0, 0.14, vUv.y) * smoothstep(1.0, 0.86, vUv.y);
        float frameMask = edgeX * edgeY;

        // Warm dusty volumetric light shaft diagonal glow
        float shaft = 0.65 + 0.35 * sin((vUv.x * 1.4 - vUv.y * 0.9) * 5.0 + uTime * 0.28);
        float flicker = 0.92 + 0.08 * sin(uTime * 1.6 + vWorldPos.x * 0.17 + vWorldPos.z * 0.19);

        // Gravity pulse ripple brightening nearby temporal windows!
        float pDist = length(vWorldPos);
        float pulseWave = exp(-pow((pDist - uPulseRadius) / 9.0, 2.0)) * uPulseStrength;

        // Distance depth attenuation so far lattice fades cleanly into obsidian sepia abyss
        float depthFade = exp(-vCamDist * 0.022) * smoothstep(2.6, 8.5, vCamDist);

        float pattern = frameMask * (0.24 + 0.76 * shelfBand * bookSlice) * (0.36 + 0.64 * verticalBars);
        vec3 warmAmber = vec3(1.0, 0.68, 0.28);
        vec3 deepOchre = vec3(0.46, 0.23, 0.07);
        vec3 pulseGold = vec3(1.0, 0.94, 0.76);

        vec3 col = mix(deepOchre, warmAmber, clamp(shaft * bookSlice, 0.0, 1.0));
        col = mix(col, pulseGold, pulseWave * 0.8);
        col *= (1.05 + pulseWave * 1.55) * flicker;

        float alpha = pattern * depthFade * uReveal * (0.44 + pulseWave * 0.38);
        if (alpha < 0.008) discard;
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.82));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const windowInstances = new THREE.InstancedMesh(windowGeo, windowMat, totalCells * 2);
  windowInstances.frustumCulled = false;
  bulkGroup.add(windowInstances);

  // 2D. Luminous Interactive Gravity Strings (taut golden & pale-cyan 5D chords running infinitely up/down)
  const stringCount = totalCells * 2;
  const stringGeo = new THREE.CylinderGeometry(0.068, 0.068, CELL * 1.05, 6, 14, true);
  const stringMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uReveal: { value: 1 },
      uPulseRadius: { value: -10 },
      uPulseStrength: { value: 0 },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uPulseRadius;
      uniform float uPulseStrength;

      varying float vCamDist;
      varying float vWave;
      varying float vSeed;

      void main() {
        vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
        float pDist = length(worldPos.xyz);
        float wave = exp(-pow((pDist - uPulseRadius) / 7.5, 2.0)) * uPulseStrength;
        vWave = wave;
        vSeed = fract(sin(dot(worldPos.xz, vec2(12.9898, 78.233))) * 43758.5453);

        // Physically pluck/vibrate the 5D gravity string laterally as the gravitational pulse passes!
        float vib = sin(worldPos.y * 0.85 - uTime * 18.0 + vSeed * 6.283) * (0.04 + wave * 0.45);
        vec3 displaced = position;
        displaced.x += vib;
        displaced.z += cos(worldPos.y * 0.65 + uTime * 14.0) * (0.02 + wave * 0.25);

        vec4 mvPos = viewMatrix * modelMatrix * instanceMatrix * vec4(displaced, 1.0);
        vCamDist = length(mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uReveal;

      varying float vCamDist;
      varying float vWave;
      varying float vSeed;

      void main() {
        float depthFade = exp(-vCamDist * 0.022) * smoothstep(1.2, 4.5, vCamDist);
        float shimmer = 0.72 + 0.28 * sin(uTime * 2.4 + vSeed * 19.0);
        vec3 goldChord = vec3(1.0, 0.84, 0.48);
        vec3 quantumCyan = vec3(0.60, 0.86, 1.0);
        vec3 baseCol = mix(goldChord, quantumCyan, step(0.72, vSeed) * 0.55);
        vec3 col = mix(baseCol, vec3(1.0, 0.98, 0.92), 0.25 + vWave * 0.75);
        float alpha = depthFade * uReveal * (0.68 * shimmer + vWave * 0.55);
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(col * (1.35 + vWave * 1.9), clamp(alpha, 0.0, 0.98));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const stringInstances = new THREE.InstancedMesh(stringGeo, stringMat, stringCount);
  stringInstances.frustumCulled = false;
  bulkGroup.add(stringInstances);

  // 2E. Drifting Dusty Golden Light Motes inside the 5D Bulk
  const randMote = seededRand(41209);
  const mPos = new Float32Array(DUST_MOTE_COUNT * 3);
  const mSeed = new Float32Array(DUST_MOTE_COUNT * 2);
  for (let i = 0; i < DUST_MOTE_COUNT; i++) {
    mPos[i * 3] = (randMote() - 0.5) * 90;
    mPos[i * 3 + 1] = (randMote() - 0.5) * 90;
    mPos[i * 3 + 2] = (randMote() - 0.5) * 90;
    mSeed[i * 2] = 0.5 + randMote() * 1.4;
    mSeed[i * 2 + 1] = randMote() * Math.PI * 2;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
  moteGeo.setAttribute('aSeed', new THREE.BufferAttribute(mSeed, 2));

  const moteMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBulkMod: { value: new THREE.Vector3() },
      uReveal: { value: 1 },
      uPixelRatio: { value: 1 },
    },
    vertexShader: `
      attribute vec2 aSeed;
      uniform float uTime;
      uniform vec3 uBulkMod;
      uniform float uPixelRatio;

      varying float vAlpha;

      void main() {
        float span = 90.0;
        vec3 p = position - uBulkMod;
        p.y += sin(uTime * 0.25 * aSeed.x + aSeed.y) * 1.4;
        p.x += cos(uTime * 0.19 * aSeed.x + aSeed.y) * 1.1;
        p = mod(p + span * 0.5, span) - span * 0.5;

        vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
        float dist = max(1.5, -mvPos.z);
        vAlpha = exp(-dist * 0.032) * smoothstep(1.8, 6.0, dist);
        gl_PointSize = clamp((aSeed.x * 24.0 / dist) * uPixelRatio, 1.5, 9.0);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform float uReveal;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
        float glow = exp(-d * d * 4.0);
        float a = glow * vAlpha * uReveal * 0.62;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vec3(1.0, 0.80, 0.48), a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const motePoints = new THREE.Points(moteGeo, moteMat);
  motePoints.frustumCulled = false;
  bulkGroup.add(motePoints);

  // =========================================================================
  // 2F. RARE LOCALIZED WORLD-PARTICLE MEMORY ANCHORS (Non-repeating Bulk Coordinates!)
  //     These shimmering 3D particle portals exist ONLY at 3 specific hidden coordinates
  //     inside the infinite 5D Bulk — never tiled everywhere!
  // =========================================================================
  const anchorsGroup = new THREE.Group();
  group.add(anchorsGroup);

  interface AnchorVisual {
    id: string;
    anchorRoot: THREE.Group;
    points: THREE.Points;
    geo: THREE.BufferGeometry;
    mat: THREE.ShaderMaterial;
    haloMesh: THREE.Mesh;
    haloGeo: THREE.BufferGeometry;
    haloMat: THREE.MeshBasicMaterial;
    basePos: THREE.Vector3;
  }

  const anchorVisuals: AnchorVisual[] = [];
  const randAnchor = seededRand(206711);

  for (const def of TESSERACT_MEMORY_ANCHORS) {
    const anchorRoot = new THREE.Group();
    anchorRoot.position.set(def.position.x, def.position.y, def.position.z);

    const pCount = 1150;
    const positions = new Float32Array(pCount * 3);
    const colors = new Float32Array(pCount * 3);
    const phases = new Float32Array(pCount);
    const sizes = new Float32Array(pCount);
    const roles = new Float32Array(pCount); // 0 = core sculpture, 1 = falling binary dust lines / rings

    for (let i = 0; i < pCount; i++) {
      phases[i] = randAnchor() * Math.PI * 2;
      if (def.archetype === 'bookshelf-earth') {
        if (i < 680) {
          // Miniature spinning Earth made of luminous oceanic sapphire + golden-emerald continental quanta
          const u = randAnchor() * 2 - 1;
          const phi = randAnchor() * Math.PI * 2;
          const sinT = Math.sqrt(Math.max(0, 1 - u * u));
          const rad = 3.1 + (randAnchor() - 0.5) * 0.24;
          const px = sinT * Math.cos(phi) * rad;
          const py = u * rad;
          const pz = sinT * Math.sin(phi) * rad;
          positions[i * 3] = px;
          positions[i * 3 + 1] = py;
          positions[i * 3 + 2] = pz;

          const contWave =
            Math.sin(phi * 2.4 + u * 2.1) * Math.cos(u * 3.8 - phi * 1.3) +
            0.45 * Math.sin(phi * 5.2 - u * 4.5);
          if (contWave > 0.22) {
            // Warm golden-emerald sunlit continents & city sparks
            colors[i * 3] = 0.98;
            colors[i * 3 + 1] = 0.78 + randAnchor() * 0.18;
            colors[i * 3 + 2] = 0.36;
          } else {
            // Deep bioluminescent atmospheric azure ocean
            colors[i * 3] = 0.22;
            colors[i * 3 + 1] = 0.66 + randAnchor() * 0.22;
            colors[i * 3 + 2] = 1.0;
          }
          sizes[i] = 1.35 + randAnchor() * 1.45;
          roles[i] = 0;
        } else {
          // Interstellar-style vertical binary gravity dust stripes falling through slatted golden sunbeams!
          const stripeIdx = i % 9;
          const stripeX = (stripeIdx - 4) * 1.15 + (randAnchor() - 0.5) * 0.14;
          const stripeZ = (stripeIdx % 3 - 1) * 1.9 + (randAnchor() - 0.5) * 0.35;
          const stripeY = (randAnchor() - 0.5) * 14.5;
          positions[i * 3] = stripeX;
          positions[i * 3 + 1] = stripeY;
          positions[i * 3 + 2] = stripeZ;
          colors[i * 3] = 1.0;
          colors[i * 3 + 1] = 0.82;
          colors[i * 3 + 2] = 0.44;
          sizes[i] = 1.1 + randAnchor() * 1.8;
          roles[i] = 1;
        }
      } else if (def.archetype === 'millers-wave') {
        if (i < 820) {
          // Towering curling tidal wave crest frozen in dilated time
          const t = randAnchor(); // 0..1 across crest curve
          const spanZ = (randAnchor() - 0.5) * 10.5;
          const curlAngle = t * Math.PI * 1.15;
          const px = -Math.cos(curlAngle) * (2.6 + t * 2.2) + (randAnchor() - 0.5) * 0.45;
          const py = Math.sin(curlAngle) * 5.2 - 1.4 + (randAnchor() - 0.5) * 0.35;
          const pz = spanZ + Math.sin(t * 4.0) * 0.8;
          positions[i * 3] = px;
          positions[i * 3 + 1] = py;
          positions[i * 3 + 2] = pz;
          const crestFoam = t > 0.72 ? 1.0 : 0.0;
          colors[i * 3] = 0.18 + crestFoam * 0.74;
          colors[i * 3 + 1] = 0.72 + crestFoam * 0.25;
          colors[i * 3 + 2] = 1.0;
          sizes[i] = 1.2 + randAnchor() * 1.65;
          roles[i] = 0;
        } else {
          // Golden relativistic ticking clock-halo hovering above the frozen wave
          const ang = (i / 330) * Math.PI * 2;
          const r = 5.4 + (randAnchor() - 0.5) * 0.22;
          positions[i * 3] = Math.cos(ang) * r;
          positions[i * 3 + 1] = 4.6 + (randAnchor() - 0.5) * 0.18;
          positions[i * 3 + 2] = Math.sin(ang) * r;
          colors[i * 3] = 1.0;
          colors[i * 3 + 1] = 0.78;
          colors[i * 3 + 2] = 0.38;
          sizes[i] = 1.3 + randAnchor() * 1.2;
          roles[i] = 1;
        }
      } else {
        // Saturn Wormhole Sphere: shimmering spherical lensing crystal + golden ring-dust plane
        if (i < 660) {
          const u = randAnchor() * 2 - 1;
          const phi = randAnchor() * Math.PI * 2;
          const sinT = Math.sqrt(Math.max(0, 1 - u * u));
          const rad = 3.55 + (randAnchor() - 0.5) * 0.2;
          positions[i * 3] = sinT * Math.cos(phi) * rad;
          positions[i * 3 + 1] = u * rad;
          positions[i * 3 + 2] = sinT * Math.sin(phi) * rad;
          const swirl = 0.5 + 0.5 * Math.sin(phi * 3.0 + u * 5.0);
          colors[i * 3] = 0.62 + swirl * 0.35;
          colors[i * 3 + 1] = 0.58 + swirl * 0.28;
          colors[i * 3 + 2] = 1.0;
          sizes[i] = 1.3 + randAnchor() * 1.5;
          roles[i] = 0;
        } else {
          const ang = randAnchor() * Math.PI * 2;
          const ringR = 5.0 + randAnchor() * 3.8;
          const tilt = 0.42;
          const rx = Math.cos(ang) * ringR;
          const rz = Math.sin(ang) * ringR;
          positions[i * 3] = rx;
          positions[i * 3 + 1] = rz * Math.sin(tilt) + (randAnchor() - 0.5) * 0.18;
          positions[i * 3 + 2] = rz * Math.cos(tilt);
          colors[i * 3] = 1.0;
          colors[i * 3 + 1] = 0.82;
          colors[i * 3 + 2] = 0.52;
          sizes[i] = 1.15 + randAnchor() * 1.45;
          roles[i] = 1;
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aRole', new THREE.BufferAttribute(roles, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uReveal: { value: 0 },
        uDecoded: { value: 0 },
        uPulseBurst: { value: 0 },
        uPixelRatio: { value: 1 },
      },
      vertexShader: `
        attribute vec3 aColor;
        attribute float aPhase;
        attribute float aSize;
        attribute float aRole;
        uniform float uTime;
        uniform float uDecoded;
        uniform float uPulseBurst;
        uniform float uPixelRatio;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec3 p = position;
          if (aRole < 0.5) {
            // Gentle slow orbital precession of the core world-particle hologram
            float ang = uTime * 0.22;
            float ca = cos(ang);
            float sa = sin(ang);
            p.xz = mat2(ca, -sa, sa, ca) * p.xz;
            p += normalize(p + vec3(0.0001)) * (sin(uTime * 1.6 + aPhase) * 0.12 + uPulseBurst * 0.95);
          } else {
            // Falling / drifting gravitational dust lines & rings
            p.y += sin(uTime * 0.9 + aPhase) * 0.45;
            p.x += cos(uTime * 0.6 + aPhase) * 0.18;
          }

          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float dist = max(2.0, -mv.z);
          float twinkle = 0.65 + 0.35 * sin(uTime * 2.6 + aPhase);
          vColor = mix(aColor, vec3(1.0, 0.94, 0.72), uPulseBurst * 0.65 + uDecoded * 0.18);
          vAlpha = twinkle * (0.78 + uDecoded * 0.22 + uPulseBurst * 0.5);
          gl_PointSize = clamp(aSize * (138.0 / dist) * uPixelRatio * (1.0 + uPulseBurst * 0.45), 1.8, 16.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform float uReveal;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c) * 2.0;
          if (d > 1.0) discard;
          float core = exp(-d * d * 4.5);
          float halo = exp(-d * d * 1.6) * 0.45;
          float a = (core + halo) * vAlpha * uReveal;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor * (1.0 + core * 0.75), a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    anchorRoot.add(points);

    // Delicate orbital resonance ring framing the unique chamber bay
    const haloGeo = new THREE.RingGeometry(4.4, 4.62, 48);
    const haloMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(def.accentColor),
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const haloMesh = new THREE.Mesh(haloGeo, haloMat);
    haloMesh.rotation.x = Math.PI * 0.42;
    anchorRoot.add(haloMesh);

    anchorsGroup.add(anchorRoot);
    anchorVisuals.push({
      id: def.id,
      anchorRoot,
      points,
      geo,
      mat,
      haloMesh,
      haloGeo,
      haloMat,
      basePos: new THREE.Vector3(def.position.x, def.position.y, def.position.z),
    });
  }

  // Subtle golden Resonance Compass Arc pointing toward the nearest undiscovered Memory Anchor during [F] pulse
  const compassPointsArr = new Float32Array(2 * 3);
  const compassGeo = new THREE.BufferGeometry();
  compassGeo.setAttribute('position', new THREE.BufferAttribute(compassPointsArr, 3));
  const compassMat = new THREE.LineBasicMaterial({
    color: 0xffd27d,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const compassLine = new THREE.Line(compassGeo, compassMat);
  compassLine.frustumCulled = false;
  group.add(compassLine);

  // Pre-populate static relative instanced transforms once inside `bulkGroup`
  // (we translate `bulkGroup` modulo `CELL` each frame — zero per-frame matrix rebuilds!)
  const mat4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  const color = new THREE.Color();

  let bIdx = 0;
  let sIdx = 0;
  let wIdx = 0;
  let strIdx = 0;

  for (let gx = -GRID_HALF; gx <= GRID_HALF; gx++) {
    for (let gy = -GRID_HALF; gy <= GRID_HALF; gy++) {
      for (let gz = -GRID_HALF; gz <= GRID_HALF; gz++) {
        const cx = gx * CELL;
        const cy = gy * CELL;
        const cz = gz * CELL;

        // Deterministic per-cell micro variation (preserved cleanly modulo grid)
        const cellHash = Math.abs(Math.sin(gx * 12.7 + gy * 31.1 + gz * 74.3) * 43758.5453) % 1;

        // 1. Orthogonal Worldline Beams along X, Y, Z forming dramatic open corridors (offset by +CELL/2 so origin is an open chamber!)
        const ox = cx + CELL * 0.5;
        const oy = cy + CELL * 0.5;
        const oz = cz + CELL * 0.5;

        // Vertical monolith pillar
        quat.identity();
        mat4.compose(pos.set(ox, cy, oz), quat, scale.set(1.35, CELL, 1.35));
        beamInstances.setMatrixAt(bIdx, mat4);
        color.setRGB(0.22 + cellHash * 0.14, 0.14 + cellHash * 0.08, 0.08 + cellHash * 0.05);
        beamInstances.setColorAt(bIdx, color);
        bIdx++;

        // Horizontal X timeline girder
        mat4.compose(pos.set(cx, oy, oz), quat, scale.set(CELL, 0.85, 0.95));
        beamInstances.setMatrixAt(bIdx, mat4);
        beamInstances.setColorAt(bIdx, color);
        bIdx++;

        // Horizontal Z timeline girder
        mat4.compose(pos.set(ox, oy, cz), quat, scale.set(0.95, 0.85, CELL));
        beamInstances.setMatrixAt(bIdx, mat4);
        beamInstances.setColorAt(bIdx, color);
        bIdx++;

        // 2. Continuous Edge-to-Edge 5D Timeline Rails & Architectural Bookshelf Mullions (zero disconnected floating slabs!)
        const railColorShade = 0.74 + cellHash * 0.26;
        color.setRGB(0.54 * railColorShade, 0.34 * railColorShade, 0.16 * railColorShade);

        // Twin vertical timeline channel mullions flanking the main monolith pillar
        mat4.compose(pos.set(ox - 1.55, cy, oz - 0.55), quat, scale.set(0.26, CELL, 0.44));
        slatInstances.setMatrixAt(sIdx, mat4);
        slatInstances.setColorAt(sIdx, color);
        sIdx++;

        mat4.compose(pos.set(ox - 0.55, cy, oz - 1.55), quat, scale.set(0.44, CELL, 0.26));
        slatInstances.setMatrixAt(sIdx, mat4);
        slatInstances.setColorAt(sIdx, color);
        sIdx++;

        // Continuous horizontal recessed amber bookshelf ledges running edge-to-edge along X and Z
        mat4.compose(pos.set(cx, oy - 1.45, oz - 0.95), quat, scale.set(CELL, 0.24, 0.68));
        slatInstances.setMatrixAt(sIdx, mat4);
        slatInstances.setColorAt(sIdx, color);
        sIdx++;

        mat4.compose(pos.set(ox - 0.95, oy - 1.45, cz), quat, scale.set(0.68, 0.24, CELL));
        slatInstances.setMatrixAt(sIdx, mat4);
        slatInstances.setColorAt(sIdx, color);
        sIdx++;

        // 3. Warm Slatted Amber Memory Windows on alternating corridor bays
        euler.set(0, 0, 0);
        quat.setFromEuler(euler);
        mat4.compose(pos.set(cx + 0.8, cy, oz - 1.8), quat, scale.set(1, 1, 1));
        windowInstances.setMatrixAt(wIdx++, mat4);

        euler.set(0, Math.PI * 0.5, 0);
        quat.setFromEuler(euler);
        mat4.compose(pos.set(ox - 1.8, cy, cz - 0.8), quat, scale.set(1, 1, 1));
        windowInstances.setMatrixAt(wIdx++, mat4);

        // 4. Vertical Interactive Spacetime Gravity Strings suspended inside the corridors
        quat.identity();
        mat4.compose(
          pos.set(cx + 4.8, cy, cz + 5.6),
          quat,
          scale.set(1, 1, 1),
        );
        stringInstances.setMatrixAt(strIdx++, mat4);

        mat4.compose(
          pos.set(cx - 6.2, cy, cz - 4.4),
          quat,
          scale.set(1, 1, 1),
        );
        stringInstances.setMatrixAt(strIdx++, mat4);
      }
    }
  }

  beamInstances.instanceMatrix.needsUpdate = true;
  if (beamInstances.instanceColor) beamInstances.instanceColor.needsUpdate = true;
  slatInstances.instanceMatrix.needsUpdate = true;
  if (slatInstances.instanceColor) slatInstances.instanceColor.needsUpdate = true;
  windowInstances.instanceMatrix.needsUpdate = true;
  stringInstances.instanceMatrix.needsUpdate = true;

  let accumulatedFall = 0;
  let lastTime = -1;

  const update: TesseractRealm['update'] = ({
    stage,
    plunge,
    bulkPos,
    pulseProgress,
    decodedAnchorIds,
    time,
    pixelRatio,
  }) => {
    if (stage === 'outside') {
      group.visible = false;
      lastTime = -1;
      accumulatedFall = 0;
      return;
    }

    group.visible = true;
    const dt = lastTime < 0 ? 0.016 : Math.min(0.05, Math.max(0.001, time - lastTime));
    lastTime = time;

    const isPlunge = stage === 'plunge';
    plungeGroup.visible = isPlunge;

    if (isPlunge) {
      // Integrate accelerating vertical rush of relativistic Event Horizon streaks across the 22s descent
      accumulatedFall += (16 + plunge.particleAccel * 14.5) * dt;
      plungeMat.uniforms.uTime.value = time;
      plungeMat.uniforms.uFallOffset.value = accumulatedFall;
      plungeMat.uniforms.uAccel.value = plunge.particleAccel;
      plungeMat.uniforms.uOpacity.value = 1.0 - Math.max(0, (plunge.progress - 0.88) / 0.12);
      plungeMat.uniforms.uPixelRatio.value = pixelRatio;

      skyRingMesh.visible = plunge.skyRingScale > 0.01;
      skyRingMat.uniforms.uScale.value = plunge.skyRingScale;
      skyRingMat.uniforms.uTime.value = time;
    }

    const reveal = isPlunge ? plunge.latticeReveal : 1.0;
    bulkGroup.visible = reveal > 0.01;
    anchorsGroup.visible = !isPlunge && reveal > 0.2;

    if (bulkGroup.visible) {
      // Seamless infinite 3D lattice wrapping modulo CELL around the floating Voyager!
      const wrapX = wrapTesseractCoord(bulkPos.x, CELL);
      const wrapY = wrapTesseractCoord(bulkPos.y, CELL);
      const wrapZ = wrapTesseractCoord(bulkPos.z, CELL);
      bulkGroup.position.set(-wrapX, -wrapY, -wrapZ);

      const pulseActive = pulseProgress > 0 && pulseProgress < 1;
      const pulseRadius = pulseActive ? pulseProgress * 96 : -50;
      const pulseStrength = pulseActive ? Math.sin(pulseProgress * Math.PI) : 0;

      beamMat.opacity = reveal;
      slatMat.opacity = reveal * 0.94;
      beamMat.emissiveIntensity = (0.38 + pulseStrength * 0.45) * reveal;
      slatMat.emissiveIntensity = (0.34 + pulseStrength * 0.4) * reveal;

      windowMat.uniforms.uTime.value = time;
      windowMat.uniforms.uReveal.value = reveal;
      windowMat.uniforms.uPulseRadius.value = pulseRadius;
      windowMat.uniforms.uPulseStrength.value = pulseStrength;

      stringMat.uniforms.uTime.value = time;
      stringMat.uniforms.uReveal.value = reveal;
      stringMat.uniforms.uPulseRadius.value = pulseRadius;
      stringMat.uniforms.uPulseStrength.value = pulseStrength;

      moteMat.uniforms.uTime.value = time;
      moteMat.uniforms.uBulkMod.value.set(bulkPos.x, bulkPos.y, bulkPos.z);
      moteMat.uniforms.uReveal.value = reveal;
      moteMat.uniforms.uPixelRatio.value = pixelRatio;

      // Update rare non-repeating localized World-Particle Memory Anchors in true Bulk space
      if (anchorsGroup.visible) {
        anchorsGroup.position.set(-bulkPos.x, -bulkPos.y, -bulkPos.z);
        let nearestUndecoded: AnchorVisual | null = null;
        let nearestUndecodedDist = Number.POSITIVE_INFINITY;

        for (const av of anchorVisuals) {
          const dist = av.basePos.distanceTo(bulkPos);
          const isDecoded = decodedAnchorIds.has(av.id);
          if (!isDecoded && dist < nearestUndecodedDist) {
            nearestUndecodedDist = dist;
            nearestUndecoded = av;
          }
          // Only materialize when within 95m so they feel genuinely rare and localized in the vast Bulk!
          const distFade = Math.max(0, Math.min(1, 1 - (dist - 42) / 56));
          av.anchorRoot.visible = distFade > 0.01;
          if (av.anchorRoot.visible) {
            const localPulse = pulseActive && dist < 24 ? pulseStrength : 0;
            av.mat.uniforms.uTime.value = time;
            av.mat.uniforms.uReveal.value = reveal * distFade;
            av.mat.uniforms.uDecoded.value = isDecoded ? 1.0 : 0.0;
            av.mat.uniforms.uPulseBurst.value = localPulse;
            av.mat.uniforms.uPixelRatio.value = pixelRatio;

            av.haloMesh.rotation.z = time * (isDecoded ? 0.45 : 0.16);
            av.haloMat.opacity = (isDecoded ? 0.56 : 0.22 + localPulse * 0.45) * distFade;
          }
        }

        // Brief golden filament whisper toward the nearest undiscovered Memory Anchor when pulsing [F]
        if (pulseActive && nearestUndecoded && nearestUndecodedDist > 6) {
          const dirX = (nearestUndecoded.basePos.x - bulkPos.x) / nearestUndecodedDist;
          const dirY = (nearestUndecoded.basePos.y - bulkPos.y) / nearestUndecodedDist;
          const dirZ = (nearestUndecoded.basePos.z - bulkPos.z) / nearestUndecodedDist;
          const arr = compassGeo.attributes.position.array as Float32Array;
          arr[0] = dirX * 2.4;
          arr[1] = dirY * 2.4;
          arr[2] = dirZ * 2.4;
          const tip = Math.min(nearestUndecodedDist - 2.0, 26.0);
          arr[3] = dirX * tip;
          arr[4] = dirY * tip;
          arr[5] = dirZ * tip;
          compassGeo.attributes.position.needsUpdate = true;
          compassMat.opacity = pulseStrength * 0.72;
          compassLine.visible = true;
        } else {
          compassLine.visible = false;
        }
      } else {
        compassLine.visible = false;
      }

      // Subtle breathing tungsten light pulse
      playerLantern.visible = true;
      warmKeyLight.visible = true;
      coolAbyssRim.visible = true;
      tesseractAmbient.visible = true;
      playerLantern.intensity = (2.8 + Math.sin(time * 1.2) * 0.45 + pulseStrength * 2.5) * reveal;
      warmKeyLight.intensity = 2.25 * reveal;
      coolAbyssRim.intensity = 0.85 * reveal;
      tesseractAmbient.intensity = 0.62 * reveal;
    } else {
      compassLine.visible = false;
      playerLantern.visible = true;
      warmKeyLight.visible = true;
      coolAbyssRim.visible = true;
      tesseractAmbient.visible = true;
      playerLantern.intensity = 0.85;
      warmKeyLight.intensity = 0.35;
      coolAbyssRim.intensity = 0.18;
      tesseractAmbient.intensity = 0.25;
    }
  };

  const hide = () => {
    group.visible = false;
    playerLantern.visible = false;
    warmKeyLight.visible = false;
    coolAbyssRim.visible = false;
    tesseractAmbient.visible = false;
    playerLantern.intensity = 0;
    warmKeyLight.intensity = 0;
    coolAbyssRim.intensity = 0;
    tesseractAmbient.intensity = 0;
    lastTime = -1;
  };

  const dispose = () => {
    plungeGeo.dispose();
    plungeMat.dispose();
    skyRingGeo.dispose();
    skyRingMat.dispose();
    beamGeo.dispose();
    beamMat.dispose();
    slatGeo.dispose();
    slatMat.dispose();
    windowGeo.dispose();
    windowMat.dispose();
    stringGeo.dispose();
    stringMat.dispose();
    moteGeo.dispose();
    moteMat.dispose();
    for (const av of anchorVisuals) {
      av.geo.dispose();
      av.mat.dispose();
      av.haloGeo.dispose();
      av.haloMat.dispose();
    }
    compassGeo.dispose();
    compassMat.dispose();
  };

  return { group, update, hide, dispose };
}
