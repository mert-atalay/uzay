import * as THREE from 'three';
import {
  getPlanetarySeaLevel,
  sampleProceduralTerrainHeight,
  sampleSurfaceBiomeHeight,
} from './physics';
import { createCloudCanopyMaterial, createPlanetaryWaterMaterial } from './shaders';
import { getSurfaceDetailBumpTexture } from './textures';
import type { CelestialBodyDef } from './types';

const ORBIT_PATCH_GRID = 44;
const BIOME_GRID = 76;
const BIOME_SPAN = 360; // 360m x 360m sweeping planetary horizon

const BOULDER_COUNT = 160;
const LANDMARK_COUNT = 72;
const PEBBLE_COUNT = 140;
const DUST_COUNT = 260;

export interface SurfaceUpdateParams {
  body: CelestialBodyDef;
  surfaceNormal: THREE.Vector3;
  bodyLocalOffset: THREE.Vector3;
  altitude: number;
  isLanded: boolean;
  walkX: number;
  walkZ: number;
  playerAltOffset: number;
  sunDirWorld: THREE.Vector3;
  sunColorHex: string;
  skyColorHex: string;
  fogColorHex: string;
  fogDensity: number;
  time: number;
  maxAnisotropy: number;
}

export interface LocalSurfacePatch {
  group: THREE.Group;
  updateForBody: (params: SurfaceUpdateParams) => void;
  hide: () => void;
  dispose: () => void;
}

function hash1(i: number, seed: number): number {
  let n = Math.imul(i + 17, 374761393) ^ Math.imul(seed, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

/**
 * Generates a seamless 512x512 neutral micro-albedo detail map (rock grain, soil mottling,
 * grassy turf fibers, subtle pebble speckles) that multiplies with biome vertexColors.
 */
function createTerrainMicroAlbedoTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const data = img.data;

  // Periodic multi-octave sine + hash mottling so tile boundaries are 100% seamless
  const twoPi = Math.PI * 2;
  for (let y = 0; y < size; y++) {
    const ny = (y / size) * twoPi;
    for (let x = 0; x < size; x++) {
      const nx = (x / size) * twoPi;
      const macro =
        Math.sin(nx * 2 + Math.cos(ny * 2)) * 0.25 +
        Math.cos(ny * 3 - Math.sin(nx * 3)) * 0.25 +
        Math.sin(nx * 5 + ny * 5) * 0.2;
      const mid =
        Math.sin(nx * 11 + Math.sin(ny * 7)) * 0.16 +
        Math.cos(ny * 13 + nx * 9) * 0.14;
      const grain = hash1(x * 73856093 ^ y * 19349663, 409) * 0.24 - 0.12;
      const speckle = hash1(x * 131 + y * 977, 733) > 0.965 ? -0.14 : 0;

      // Range ~0.74 .. 1.05 so biomes stay vibrant while gaining crisp natural ground texture
      const val = Math.max(0.68, Math.min(1.0, 0.87 + macro * 0.14 + mid * 0.12 + grain + speckle));
      const idx = (y * size + x) * 4;
      data[idx] = Math.round(val * 255);
      data[idx + 1] = Math.round(val * 253);
      data[idx + 2] = Math.round(val * 248);
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/**
 * Smooth-shaded organic weathered rock/boulder geometry (indexed sphere with continuous 3D strata).
 */
function createSculptedBoulderGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(0.56, 18, 14);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const strata = Math.sin(y * 9.5 + x * 4.0) * 0.09 + Math.cos(z * 6.8 - x * 5.2) * 0.11;
    const lobe = 0.84 + 0.2 * Math.sin(x * 4.4 + z * 4.9) + strata;
    const squashY = y < 0 ? y * 0.45 : y * 0.96;
    pos.setXYZ(i, x * lobe * 1.22, squashY * lobe, z * lobe * 0.94);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Sculpted tall craggy spire / monolith geometry (used for mesas, volcanic vents, ice pillars).
 */
function createSpireGeometry(): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(0.85, 3.8, 7, 4);
  geo.translate(0, 1.7, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const twist = y * 0.28;
    const cs = Math.cos(twist);
    const sn = Math.sin(twist);
    const rx = x * cs - z * sn;
    const rz = x * sn + z * cs;
    const crag = 0.8 + 0.34 * Math.sin(y * 2.4 + Math.atan2(rz, rx) * 3.0);
    pos.setXYZ(i, rx * crag, y, rz * crag);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Sculpted multi-tier conifer / alpine tree silhouette for Earth & temperate exoplanets.
 * Pivoted cleanly at trunk base (y = 0).
 */
function createConiferCanopyGeometry(): THREE.BufferGeometry {
  const profile = [
    new THREE.Vector2(0.01, 0.85),
    new THREE.Vector2(1.42, 0.95),
    new THREE.Vector2(0.62, 2.05),
    new THREE.Vector2(1.18, 2.15),
    new THREE.Vector2(0.46, 3.25),
    new THREE.Vector2(0.84, 3.35),
    new THREE.Vector2(0.28, 4.45),
    new THREE.Vector2(0.01, 5.25),
  ];
  const geo = new THREE.LatheGeometry(profile, 8);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = 0.88 + 0.22 * Math.sin(x * 4.7 + z * 5.3 + y * 2.1);
    pos.setXYZ(i, x * n, y, z * n);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Dual-mode Planetary Surface System:
 * 1. Orbital / Low-Altitude Curved Patch: seamless high-detail terrain skin during atmospheric approach.
 * 2. Dedicated Grounded Planetary Biome World: vast 360m true-scale horizon terrain, animated reflective
 *    oceans/methane seas, 370+ grounded biome formations (boulders, spires/crystals/alpine trees, scree),
 *    drifting atmospheric dust/snow/mist particles, and overhead volumetric cloud canopy.
 */
export function createLocalSurfacePatch(maxAnisotropy: number): LocalSurfacePatch {
  const group = new THREE.Group();
  group.visible = false;

  const bumpMap = getSurfaceDetailBumpTexture(maxAnisotropy);
  const microAlbedoMap = createTerrainMicroAlbedoTexture(maxAnisotropy);

  // =========================================================================
  // 1. LOW-ALTITUDE CURVED ORBITAL APPROACH PATCH
  // =========================================================================
  const orbitGroup = new THREE.Group();
  group.add(orbitGroup);

  const oVertCount = (ORBIT_PATCH_GRID + 1) * (ORBIT_PATCH_GRID + 1);
  const oPositions = new Float32Array(oVertCount * 3);
  const oColors = new Float32Array(oVertCount * 3);
  const oUvs = new Float32Array(oVertCount * 2);
  const oIndices: number[] = [];

  for (let iz = 0; iz <= ORBIT_PATCH_GRID; iz++) {
    for (let ix = 0; ix <= ORBIT_PATCH_GRID; ix++) {
      const idx = iz * (ORBIT_PATCH_GRID + 1) + ix;
      oUvs[idx * 2] = (ix / ORBIT_PATCH_GRID) * 6;
      oUvs[idx * 2 + 1] = (iz / ORBIT_PATCH_GRID) * 6;
    }
  }
  for (let iz = 0; iz < ORBIT_PATCH_GRID; iz++) {
    for (let ix = 0; ix < ORBIT_PATCH_GRID; ix++) {
      const a = iz * (ORBIT_PATCH_GRID + 1) + ix;
      const b = a + 1;
      const c = a + (ORBIT_PATCH_GRID + 1);
      const d = c + 1;
      oIndices.push(a, c, b, b, c, d);
    }
  }

  const orbitTerrainGeo = new THREE.BufferGeometry();
  orbitTerrainGeo.setAttribute('position', new THREE.BufferAttribute(oPositions, 3));
  orbitTerrainGeo.setAttribute('color', new THREE.BufferAttribute(oColors, 3));
  orbitTerrainGeo.setAttribute('uv', new THREE.BufferAttribute(oUvs, 2));
  orbitTerrainGeo.setIndex(oIndices);

  const orbitTerrainMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: microAlbedoMap,
    vertexColors: true,
    roughness: 0.88,
    metalness: 0.04,
    bumpMap,
    bumpScale: 0.22,
  });
  const orbitTerrainMesh = new THREE.Mesh(orbitTerrainGeo, orbitTerrainMat);
  orbitTerrainMesh.frustumCulled = false;
  orbitGroup.add(orbitTerrainMesh);

  // =========================================================================
  // 2. DEDICATED TRUE-SCALE PLANETARY BIOME WALKING ENVIRONMENT
  // =========================================================================
  const biomeGroup = new THREE.Group();
  biomeGroup.visible = false;
  group.add(biomeGroup);

  const bVertCount = (BIOME_GRID + 1) * (BIOME_GRID + 1);
  const bPositions = new Float32Array(bVertCount * 3);
  const bColors = new Float32Array(bVertCount * 3);
  const bUvs = new Float32Array(bVertCount * 2);
  const bIndices: number[] = [];

  for (let iz = 0; iz <= BIOME_GRID; iz++) {
    for (let ix = 0; ix <= BIOME_GRID; ix++) {
      const idx = iz * (BIOME_GRID + 1) + ix;
      bUvs[idx * 2] = (ix / BIOME_GRID) * 28;
      bUvs[idx * 2 + 1] = (iz / BIOME_GRID) * 28;
    }
  }
  for (let iz = 0; iz < BIOME_GRID; iz++) {
    for (let ix = 0; ix < BIOME_GRID; ix++) {
      const a = iz * (BIOME_GRID + 1) + ix;
      const b = a + 1;
      const c = a + (BIOME_GRID + 1);
      const d = c + 1;
      bIndices.push(a, c, b, b, c, d);
    }
  }

  const biomeTerrainGeo = new THREE.BufferGeometry();
  biomeTerrainGeo.setAttribute('position', new THREE.BufferAttribute(bPositions, 3));
  biomeTerrainGeo.setAttribute('color', new THREE.BufferAttribute(bColors, 3));
  biomeTerrainGeo.setAttribute('uv', new THREE.BufferAttribute(bUvs, 2));
  biomeTerrainGeo.setIndex(bIndices);

  const biomeTerrainMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: microAlbedoMap,
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.02,
    envMapIntensity: 0.06,
    bumpMap,
    bumpScale: 0.48,
  });
  const biomeTerrainMesh = new THREE.Mesh(biomeTerrainGeo, biomeTerrainMat);
  biomeTerrainMesh.receiveShadow = true;
  biomeTerrainMesh.frustumCulled = false;
  biomeGroup.add(biomeTerrainMesh);

  // Reflective animated ocean / liquid methane / frozen lake surface
  const waterGeo = new THREE.PlaneGeometry(BIOME_SPAN * 1.02, BIOME_SPAN * 1.02, 24, 24);
  waterGeo.rotateX(-Math.PI / 2);
  // Apply matching gentle planetary horizon curvature to water edges
  const wPos = waterGeo.attributes.position;
  for (let i = 0; i < wPos.count; i++) {
    const wx = wPos.getX(i);
    const wz = wPos.getZ(i);
    const d2 = wx * wx + wz * wz;
    wPos.setY(i, -d2 / 3200);
  }
  const waterMat = createPlanetaryWaterMaterial();
  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.frustumCulled = false;
  waterMesh.visible = false;
  biomeGroup.add(waterMesh);

  // Instanced Biome Props: Boulders, Tall Spires, Conifer Trees (canopy + trunk), and Foreground Scree Pebbles
  const boulderGeo = createSculptedBoulderGeometry();
  const boulderMat = new THREE.MeshStandardMaterial({
    color: 0x9aa0a6,
    map: microAlbedoMap,
    roughness: 0.92,
    metalness: 0.04,
    envMapIntensity: 0.06,
    bumpMap,
    bumpScale: 0.28,
  });
  const bouldersMesh = new THREE.InstancedMesh(boulderGeo, boulderMat, BOULDER_COUNT);
  bouldersMesh.frustumCulled = false;
  biomeGroup.add(bouldersMesh);

  const spireGeo = createSpireGeometry();
  const spireMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: microAlbedoMap,
    roughness: 0.84,
    metalness: 0.06,
    envMapIntensity: 0.06,
    bumpMap,
    bumpScale: 0.22,
  });
  const spiresMesh = new THREE.InstancedMesh(spireGeo, spireMat, LANDMARK_COUNT);
  spiresMesh.frustumCulled = false;
  biomeGroup.add(spiresMesh);

  const treeCanopyGeo = createConiferCanopyGeometry();
  const treeCanopyMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.05,
  });
  const treeCanopiesMesh = new THREE.InstancedMesh(treeCanopyGeo, treeCanopyMat, LANDMARK_COUNT);
  treeCanopiesMesh.frustumCulled = false;
  biomeGroup.add(treeCanopiesMesh);

  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 1.3, 6);
  trunkGeo.translate(0, 0.62, 0);
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x3b2c20,
    roughness: 0.95,
    metalness: 0.0,
    envMapIntensity: 0.05,
  });
  const treeTrunksMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, LANDMARK_COUNT);
  treeTrunksMesh.frustumCulled = false;
  biomeGroup.add(treeTrunksMesh);

  const pebbleGeo = new THREE.DodecahedronGeometry(0.18, 0);
  const pebbleMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0.05,
  });
  const pebblesMesh = new THREE.InstancedMesh(pebbleGeo, pebbleMat, PEBBLE_COUNT);
  pebblesMesh.frustumCulled = false;
  biomeGroup.add(pebblesMesh);

  // Overhead Volumetric Procedural Cloud Canopy Dome for atmospheric worlds
  const cloudGeo = new THREE.PlaneGeometry(580, 580, 28, 28);
  cloudGeo.rotateX(Math.PI / 2);
  const cPos = cloudGeo.attributes.position;
  for (let i = 0; i < cPos.count; i++) {
    const cx = cPos.getX(i);
    const cz = cPos.getZ(i);
    const r2 = cx * cx + cz * cz;
    // Curve cloud deck gently down toward the planetary horizon
    cPos.setY(i, 62 - r2 / 1450);
  }
  const cloudMat = createCloudCanopyMaterial();
  const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
  cloudMesh.frustumCulled = false;
  cloudMesh.visible = false;
  biomeGroup.add(cloudMesh);

  // Drifting Atmospheric Surface Dust / Snow / Sunlit Mist Particles
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(DUST_COUNT * 3);
  const dustPhases = new Float32Array(DUST_COUNT * 3);
  for (let i = 0; i < DUST_COUNT; i++) {
    const ang = hash1(i * 3 + 1, 881) * Math.PI * 2;
    const rad = 2 + Math.sqrt(hash1(i * 3 + 2, 881)) * 42;
    dustPos[i * 3] = Math.cos(ang) * rad;
    dustPos[i * 3 + 1] = 0.4 + hash1(i * 3 + 3, 881) * 14;
    dustPos[i * 3 + 2] = Math.sin(ang) * rad;
    dustPhases[i * 3] = hash1(i * 7 + 1, 919);
    dustPhases[i * 3 + 1] = 0.5 + hash1(i * 7 + 2, 919);
    dustPhases[i * 3 + 2] = hash1(i * 7 + 3, 919);
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  dustGeo.setAttribute('aPhase', new THREE.BufferAttribute(dustPhases, 3));

  const dustMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color('#dceaff') },
      uOpacity: { value: 0.45 },
      uWindSpeed: { value: 1.8 },
    },
    vertexShader: `
      attribute vec3 aPhase;
      uniform float uTime;
      uniform float uWindSpeed;
      varying float vAlpha;

      void main() {
        vec3 p = position;
        float t = uTime * uWindSpeed * aPhase.y;
        p.x = mod(p.x + t + 45.0, 90.0) - 45.0;
        p.z = mod(p.z + t * 0.45 + 45.0, 90.0) - 45.0;
        p.y += sin(uTime * 1.4 + aPhase.x * 31.0) * 0.65;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = length(mv.xyz);
        vAlpha = smoothstep(42.0, 12.0, dist) * smoothstep(1.2, 4.5, dist) * (0.45 + 0.55 * aPhase.z);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp((18.0 + aPhase.z * 22.0) / max(1.0, -mv.z), 1.6, 5.2);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d2 = dot(c, c);
        if (d2 > 0.25) discard;
        float soft = exp(-d2 * 14.0);
        gl_FragColor = vec4(uColor, soft * vAlpha * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const dustPoints = new THREE.Points(dustGeo, dustMat);
  dustPoints.frustumCulled = false;
  biomeGroup.add(dustPoints);

  // Scratch math helpers (zero per-frame GC allocations)
  const _up = new THREE.Vector3();
  const _tangent = new THREE.Vector3();
  const _bitangent = new THREE.Vector3();
  const _worldDir = new THREE.Vector3();
  const _refAxis = new THREE.Vector3();
  const _cLow = new THREE.Color();
  const _cMid = new THREE.Color();
  const _cHigh = new THREE.Color();
  const _cCliff = new THREE.Color();
  const _cSnow = new THREE.Color();
  const _cBeach = new THREE.Color();
  const _cTmp = new THREE.Color();
  const _mat4 = new THREE.Matrix4();
  const _pos = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _rotQ = new THREE.Quaternion();
  const _scale = new THREE.Vector3();
  const _euler = new THREE.Euler();
  const _localSun = new THREE.Vector3();
  const _invQuat = new THREE.Quaternion();

  let lastOrbitBodyId = '';
  const lastOrbitAnchor = new THREE.Vector3(0, 1, 0);

  let lastBiomeBodyId = '';
  let lastBiomeCenterX = Number.NaN;
  let lastBiomeCenterZ = Number.NaN;

  const rebuildBiomeChunk = (body: CelestialBodyDef, centerX: number, centerZ: number) => {
    lastBiomeBodyId = body.id;
    lastBiomeCenterX = centerX;
    lastBiomeCenterZ = centerZ;

    const isEarthLike =
      body.archetype === 'earth' ||
      body.archetype === 'exo-temperate' ||
      body.archetype === 'exo-ocean';
    const isIcy =
      body.archetype === 'europa' ||
      body.archetype === 'enceladus' ||
      body.archetype === 'exo-ice' ||
      body.archetype === 'triton';
    const isVolcanic = body.archetype === 'io' || body.archetype === 'exo-lava';
    const isMarsLike =
      body.archetype === 'mars' || body.archetype === 'exo-desert' || body.archetype === 'venus';
    const seaLevel = getPlanetarySeaLevel(body);

    // Rich biome terrain palette
    if (isEarthLike) {
      _cLow.set('#315836'); // Lush valley forest floor
      _cMid.set('#4c7642'); // Highland meadow
      _cHigh.set('#7a7770'); // Alpine granite
      _cCliff.set('#4a4946'); // Exposed cliff bedrock
      _cBeach.set('#b8a582'); // Coastal sand/pebble shore
      _cSnow.set('#e8eef5'); // High mountain snow cap
    } else if (isMarsLike) {
      _cLow.set(body.palette[1]);
      _cMid.set(body.palette[0]);
      _cHigh.set(body.palette[2]);
      _cCliff.set('#5a2d1d');
      _cBeach.set(body.palette[1]);
      _cSnow.set('#d9a882');
    } else if (isIcy) {
      _cLow.set('#6e93b3');
      _cMid.set(body.palette[0]);
      _cHigh.set(body.palette[2]);
      _cCliff.set('#496b8c');
      _cBeach.set('#8db4d4');
      _cSnow.set('#eef7ff');
    } else if (isVolcanic) {
      _cLow.set('#262220');
      _cMid.set(body.palette[1]);
      _cHigh.set(body.palette[0]);
      _cCliff.set('#1a1615');
      _cBeach.set('#8f3812');
      _cSnow.set(body.palette[2]);
    } else {
      _cLow.set(body.palette[1]);
      _cMid.set(body.palette[0]);
      _cHigh.set(body.palette[2]);
      _cCliff.set(body.palette[1]).multiplyScalar(0.72);
      _cBeach.set(body.palette[1]);
      _cSnow.set(body.palette[2]);
    }

    const posAttr = biomeTerrainGeo.attributes.position as THREE.BufferAttribute;
    const colAttr = biomeTerrainGeo.attributes.color as THREE.BufferAttribute;
    const halfSpan = BIOME_SPAN * 0.5;
    const step = BIOME_SPAN / BIOME_GRID;

    for (let iz = 0; iz <= BIOME_GRID; iz++) {
      const lz = (iz / BIOME_GRID - 0.5) * BIOME_SPAN;
      const wz = centerZ + lz;
      for (let ix = 0; ix <= BIOME_GRID; ix++) {
        const lx = (ix / BIOME_GRID - 0.5) * BIOME_SPAN;
        const wx = centerX + lx;

        const h = sampleSurfaceBiomeHeight(wx, wz, body);
        // Estimate local slope cleanly for bedrock cliff shading
        const hx = sampleSurfaceBiomeHeight(wx + step * 0.5, wz, body);
        const hz = sampleSurfaceBiomeHeight(wx, wz + step * 0.5, body);
        const slope = Math.hypot(hx - h, hz - h) / (step * 0.5);

        // Gentle realistic planetary horizon drop-off so distant ridges dissolve seamlessly into sky fog
        const r2 = lx * lx + lz * lz;
        const horizonDrop = -r2 / 3200;

        const idx = iz * (BIOME_GRID + 1) + ix;
        posAttr.setXYZ(idx, lx, h + horizonDrop, lz);

        // Multi-zone elevation & slope biome shading
        if (seaLevel !== null && h < seaLevel + 0.65) {
          const shoreT = Math.max(0, Math.min(1, (h - (seaLevel - 1.2)) / 1.85));
          _cTmp.copy(_cBeach).multiplyScalar(0.55 + 0.45 * shoreT);
        } else {
          const normH = Math.max(0, Math.min(1, (h + 4.5) / 18.0));
          if (normH < 0.52) {
            _cTmp.copy(_cLow).lerp(_cMid, normH / 0.52);
          } else {
            _cTmp.copy(_cMid).lerp(_cHigh, (normH - 0.52) / 0.48);
          }
          // Steep cliffs expose stratified dark bedrock
          const cliffBlend = Math.max(0, Math.min(1, (slope - 0.34) * 2.2));
          _cTmp.lerp(_cCliff, cliffBlend * 0.78);
          // High peaks collect frost / bright mineral regolith
          if (normH > 0.78 && slope < 0.55) {
            _cTmp.lerp(_cSnow, ((normH - 0.78) / 0.22) * 0.82);
          }
        }

        // Subtle macro color mottling so ground never looks flat
        const mottle = 0.92 + 0.16 * hash1(ix * 131 + iz * 977, body.seed);
        colAttr.setXYZ(idx, _cTmp.r * mottle, _cTmp.g * mottle, _cTmp.b * mottle);
      }
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    biomeTerrainGeo.computeVertexNormals();

    biomeTerrainMat.roughness = isIcy ? 0.36 : isEarthLike ? 0.84 : 0.9;
    boulderMat.roughness = isIcy ? 0.3 : 0.85;
    spireMat.roughness = isIcy ? 0.18 : 0.76;
    spireMat.metalness = isIcy ? 0.18 : isVolcanic ? 0.22 : 0.08;

    // Configure water / sea plane
    if (seaLevel !== null) {
      waterMesh.visible = true;
      waterMesh.position.y = seaLevel;
      if (body.archetype === 'titan') {
        waterMat.uniforms.uDeepColor.value.set('#2c1d0c');
        waterMat.uniforms.uShallowColor.value.set('#5e411d');
      } else if (isIcy) {
        waterMat.uniforms.uDeepColor.value.set('#143554');
        waterMat.uniforms.uShallowColor.value.set('#3d7ba3');
      } else {
        waterMat.uniforms.uDeepColor.value.set('#072240');
        waterMat.uniforms.uShallowColor.value.set('#145a7a');
      }
    } else {
      waterMesh.visible = false;
    }

    // Configure cloud canopy for atmospheric worlds
    const hasClouds =
      Boolean(body.atmosphere && body.atmosphere.density > 0.14) &&
      (isEarthLike || body.archetype === 'venus' || body.archetype === 'titan' || body.archetype === 'mars');
    cloudMesh.visible = hasClouds;
    if (hasClouds) {
      if (body.archetype === 'venus' || body.archetype === 'titan') {
        cloudMat.uniforms.uCloudColor.value.set('#e8c07a');
        cloudMat.uniforms.uShadowColor.value.set('#7d5426');
        cloudMat.uniforms.uCoverage.value = 0.72;
        cloudMat.uniforms.uOpacity.value = 0.78;
      } else if (body.archetype === 'mars') {
        cloudMat.uniforms.uCloudColor.value.set('#d89c78');
        cloudMat.uniforms.uShadowColor.value.set('#6e422e');
        cloudMat.uniforms.uCoverage.value = 0.32;
        cloudMat.uniforms.uOpacity.value = 0.42;
      } else {
        cloudMat.uniforms.uCloudColor.value.set('#f2f7ff');
        cloudMat.uniforms.uShadowColor.value.set('#647f9e');
        cloudMat.uniforms.uCoverage.value = 0.48;
        cloudMat.uniforms.uOpacity.value = 0.76;
      }
    }

    // Configure drifting surface dust/mist/snow particles
    if (isMarsLike) {
      dustMat.uniforms.uColor.value.set('#e0936a');
      dustMat.uniforms.uOpacity.value = 0.52;
      dustMat.uniforms.uWindSpeed.value = 2.6;
    } else if (isIcy) {
      dustMat.uniforms.uColor.value.set('#d8f0ff');
      dustMat.uniforms.uOpacity.value = 0.55;
      dustMat.uniforms.uWindSpeed.value = 1.4;
    } else if (body.archetype === 'titan') {
      dustMat.uniforms.uColor.value.set('#e6b667');
      dustMat.uniforms.uOpacity.value = 0.52;
      dustMat.uniforms.uWindSpeed.value = 1.6;
    } else if (isVolcanic) {
      dustMat.uniforms.uColor.value.set('#ff8f47');
      dustMat.uniforms.uOpacity.value = 0.62;
      dustMat.uniforms.uWindSpeed.value = 2.2;
    } else if (isEarthLike) {
      dustMat.uniforms.uColor.value.set('#e8f4ff');
      dustMat.uniforms.uOpacity.value = 0.34;
      dustMat.uniforms.uWindSpeed.value = 1.25;
    } else {
      dustMat.uniforms.uColor.value.set('#b8c4d4');
      dustMat.uniforms.uOpacity.value = 0.16;
      dustMat.uniforms.uWindSpeed.value = 0.55;
    }

    // === SCATTER 160 GROUNDED ROCKS & BOULDERS ===
    const propRadius = halfSpan * 0.72;
    for (let i = 0; i < BOULDER_COUNT; i++) {
      const ang = hash1(i * 5 + 1, body.seed + 11) * Math.PI * 2;
      const dist = 5.5 + Math.pow(hash1(i * 5 + 2, body.seed + 11), 0.72) * propRadius;
      const lx = Math.cos(ang) * dist;
      const lz = Math.sin(ang) * dist;
      const wx = centerX + lx;
      const wz = centerZ + lz;
      const h = sampleSurfaceBiomeHeight(wx, wz, body);

      // Skip boulders deeply submerged under oceans
      if (seaLevel !== null && h < seaLevel - 0.35) {
        _scale.set(0, 0, 0);
        _mat4.compose(_pos.set(0, -100, 0), _quat.identity(), _scale);
        bouldersMesh.setMatrixAt(i, _mat4);
        continue;
      }

      const horizonDrop = -(lx * lx + lz * lz) / 3200;
      const sBase = 0.42 + Math.pow(hash1(i * 5 + 3, body.seed + 11), 2.1) * 2.4;
      const sy = sBase * (0.55 + hash1(i * 5 + 4, body.seed + 11) * 0.65);
      _scale.set(sBase, sy, sBase * (0.78 + hash1(i * 5 + 5, body.seed + 11) * 0.44));
      // Seat boulder firmly into terrain so it never floats
      _pos.set(lx, h + horizonDrop + sy * 0.18, lz);
      _euler.set(
        (hash1(i * 7 + 1, body.seed) - 0.5) * 0.35,
        hash1(i * 7 + 2, body.seed) * Math.PI * 2,
        (hash1(i * 7 + 3, body.seed) - 0.5) * 0.35,
      );
      _quat.setFromEuler(_euler);
      _mat4.compose(_pos, _quat, _scale);
      bouldersMesh.setMatrixAt(i, _mat4);

      const tint = hash1(i * 11, body.seed);
      _cTmp.copy(_cCliff).lerp(_cHigh, 0.25 + tint * 0.65);
      bouldersMesh.setColorAt(i, _cTmp);
    }
    bouldersMesh.instanceMatrix.needsUpdate = true;
    if (bouldersMesh.instanceColor) bouldersMesh.instanceColor.needsUpdate = true;

    // === SCATTER 72 BIOME LANDMARKS (Alpine Trees on Earth-likes, Ice Spires / Basalt Monoliths elsewhere) ===
    treeCanopiesMesh.visible = isEarthLike;
    treeTrunksMesh.visible = isEarthLike;
    spiresMesh.visible = !isEarthLike;

    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const ang = hash1(i * 9 + 1, body.seed + 71) * Math.PI * 2;
      const dist = 10 + Math.pow(hash1(i * 9 + 2, body.seed + 71), 0.78) * (propRadius * 0.92);
      const lx = Math.cos(ang) * dist;
      const lz = Math.sin(ang) * dist;
      const wx = centerX + lx;
      const wz = centerZ + lz;
      const h = sampleSurfaceBiomeHeight(wx, wz, body);
      const horizonDrop = -(lx * lx + lz * lz) / 3200;

      if (isEarthLike) {
        // Place trees only on dry habitable valleys & slopes below the alpine snowline
        const hx = sampleSurfaceBiomeHeight(wx + 2.0, wz, body);
        const hz = sampleSurfaceBiomeHeight(wx, wz + 2.0, body);
        const slope = Math.hypot(hx - h, hz - h) / 2.0;
        if ((seaLevel !== null && h < seaLevel + 0.55) || h > 9.5 || slope > 0.55) {
          _scale.set(0, 0, 0);
          _mat4.compose(_pos.set(0, -100, 0), _quat.identity(), _scale);
          treeCanopiesMesh.setMatrixAt(i, _mat4);
          treeTrunksMesh.setMatrixAt(i, _mat4);
          continue;
        }

        const tScale = 0.8 + hash1(i * 9 + 3, body.seed + 71) * 0.95;
        _pos.set(lx, h + horizonDrop - 0.12, lz);
        _euler.set(
          (hash1(i * 9 + 4, body.seed) - 0.5) * 0.08,
          hash1(i * 9 + 5, body.seed) * Math.PI * 2,
          (hash1(i * 9 + 6, body.seed) - 0.5) * 0.08,
        );
        _quat.setFromEuler(_euler);
        _scale.set(tScale, tScale * (0.9 + hash1(i * 9 + 7, body.seed) * 0.35), tScale);
        _mat4.compose(_pos, _quat, _scale);
        treeCanopiesMesh.setMatrixAt(i, _mat4);
        treeTrunksMesh.setMatrixAt(i, _mat4);

        const greenVar = hash1(i * 13, body.seed);
        _cTmp.set('#1f4528').lerp(_cMid, 0.22 + greenVar * 0.45);
        treeCanopiesMesh.setColorAt(i, _cTmp);
      } else {
        if (seaLevel !== null && h < seaLevel - 0.25) {
          _scale.set(0, 0, 0);
          _mat4.compose(_pos.set(0, -100, 0), _quat.identity(), _scale);
          spiresMesh.setMatrixAt(i, _mat4);
          continue;
        }
        const sW = 0.65 + hash1(i * 9 + 3, body.seed + 71) * 1.65;
        const sH = isIcy ? sW * 1.45 : sW * (0.95 + hash1(i * 9 + 4, body.seed) * 0.85);
        _pos.set(lx, h + horizonDrop - 0.25, lz);
        _euler.set(
          (hash1(i * 9 + 5, body.seed) - 0.5) * 0.24,
          hash1(i * 9 + 6, body.seed) * Math.PI * 2,
          (hash1(i * 9 + 7, body.seed) - 0.5) * 0.24,
        );
        _quat.setFromEuler(_euler);
        _scale.set(sW, sH, sW * (0.8 + hash1(i * 9 + 8, body.seed) * 0.4));
        _mat4.compose(_pos, _quat, _scale);
        spiresMesh.setMatrixAt(i, _mat4);

        const tint = hash1(i * 17, body.seed);
        if (isIcy) {
          _cTmp.set('#a8d8f5').lerp(_cSnow, tint * 0.85);
        } else if (isVolcanic) {
          _cTmp.set('#2b2421').lerp(_cBeach, tint * 0.35);
        } else {
          _cTmp.copy(_cCliff).lerp(_cHigh, 0.2 + tint * 0.65);
        }
        spiresMesh.setColorAt(i, _cTmp);
      }
    }
    if (isEarthLike) {
      treeCanopiesMesh.instanceMatrix.needsUpdate = true;
      treeTrunksMesh.instanceMatrix.needsUpdate = true;
      if (treeCanopiesMesh.instanceColor) treeCanopiesMesh.instanceColor.needsUpdate = true;
    } else {
      spiresMesh.instanceMatrix.needsUpdate = true;
      if (spiresMesh.instanceColor) spiresMesh.instanceColor.needsUpdate = true;
    }

    // === SCATTER 140 FOREGROUND SCREE PEBBLES & COBBLES ===
    for (let i = 0; i < PEBBLE_COUNT; i++) {
      const ang = hash1(i * 7 + 1, body.seed + 301) * Math.PI * 2;
      const dist = 1.6 + Math.sqrt(hash1(i * 7 + 2, body.seed + 301)) * 46;
      const lx = Math.cos(ang) * dist;
      const lz = Math.sin(ang) * dist;
      const wx = centerX + lx;
      const wz = centerZ + lz;
      const h = sampleSurfaceBiomeHeight(wx, wz, body);

      if (seaLevel !== null && h < seaLevel - 0.1) {
        _scale.set(0, 0, 0);
        _mat4.compose(_pos.set(0, -100, 0), _quat.identity(), _scale);
        pebblesMesh.setMatrixAt(i, _mat4);
        continue;
      }

      const horizonDrop = -(lx * lx + lz * lz) / 3200;
      const pS = 0.55 + hash1(i * 7 + 3, body.seed + 301) * 1.45;
      _pos.set(lx, h + horizonDrop + pS * 0.04, lz);
      _euler.set(
        hash1(i * 7 + 4, body.seed) * Math.PI,
        hash1(i * 7 + 5, body.seed) * Math.PI * 2,
        hash1(i * 7 + 6, body.seed) * Math.PI,
      );
      _quat.setFromEuler(_euler);
      _scale.set(pS * 1.2, pS * 0.55, pS);
      _mat4.compose(_pos, _quat, _scale);
      pebblesMesh.setMatrixAt(i, _mat4);

      _cTmp.copy(_cCliff).lerp(_cHigh, hash1(i * 19, body.seed) * 0.7);
      pebblesMesh.setColorAt(i, _cTmp);
    }
    pebblesMesh.instanceMatrix.needsUpdate = true;
    if (pebblesMesh.instanceColor) pebblesMesh.instanceColor.needsUpdate = true;
  };

  const updateForBody: LocalSurfacePatch['updateForBody'] = ({
    body,
    surfaceNormal,
    bodyLocalOffset,
    altitude,
    isLanded,
    walkX,
    walkZ,
    playerAltOffset,
    sunDirWorld,
    sunColorHex,
    skyColorHex,
    fogColorHex,
    fogDensity,
    time,
  }) => {
    if (!body.landable) {
      group.visible = false;
      return;
    }

    // === MODE A: DEDICATED 1:1 HUMAN-SCALE PLANETARY BIOME (active when landed OR descending beneath cloud deck!) ===
    const inLowBiome = isLanded || altitude < 7.5;
    if (inLowBiome) {
      group.visible = true;
      group.position.set(0, 0, 0);
      orbitGroup.visible = false;
      biomeGroup.visible = true;

      // Re-anchor vast biome chunk only when switching planets or walking > 55m from chunk center
      const movedDist = Number.isNaN(lastBiomeCenterX)
        ? Infinity
        : Math.hypot(walkX - lastBiomeCenterX, walkZ - lastBiomeCenterZ);
      if (body.id !== lastBiomeBodyId || movedDist > 55) {
        rebuildBiomeChunk(body, walkX, walkZ);
      }

      // Align entire planetary surface biome cleanly to local gravity up vector
      _up.copy(surfaceNormal).normalize();
      _quat.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, _up);
      biomeGroup.quaternion.copy(_quat);

      // Position biome so the terrain height under (walkX, walkZ) sits seamlessly beneath Voyager!
      // When flying beneath the clouds before touchdown, smoothly lift terrain clearance by altitude * 8.5m.
      const playerGroundH = sampleSurfaceBiomeHeight(walkX, walkZ, body);
      const flightAltMeters = isLanded ? playerAltOffset : altitude * 8.5;
      const relX = lastBiomeCenterX - walkX;
      const relZ = lastBiomeCenterZ - walkZ;
      const relY = -(playerGroundH + flightAltMeters);
      _pos.set(relX, relY, relZ).applyQuaternion(_quat);
      biomeGroup.position.copy(_pos);

      // Transform live world sun direction into local biome space for water specular & cloud backlighting
      _invQuat.copy(_quat).invert();
      _localSun.copy(sunDirWorld).applyQuaternion(_invQuat).normalize();

      if (waterMesh.visible) {
        waterMat.uniforms.uTime.value = time;
        waterMat.uniforms.uSunDir.value.copy(_localSun);
        waterMat.uniforms.uSunColor.value.set(sunColorHex);
        waterMat.uniforms.uSkyColor.value.set(skyColorHex);
        waterMat.uniforms.uFogColor.value.set(fogColorHex);
        waterMat.uniforms.uFogDensity.value = Math.max(0.0022, fogDensity);
      }
      if (cloudMesh.visible) {
        cloudMat.uniforms.uTime.value = time;
        cloudMat.uniforms.uSunDir.value.copy(_localSun);
        cloudMat.uniforms.uSunColor.value.set(sunColorHex);
      }
      dustMat.uniforms.uTime.value = time;
      return;
    }

    // === MODE B: LOW-ALTITUDE ORBITAL APPROACH (only for airless rocky/cratered moons — never pop flat patches over Earth oceans!) ===
    const hasAtmo = Boolean(body.atmosphere && body.atmosphere.density > 0.08);
    const showCutoff = hasAtmo ? 0 : Math.min(14.0, Math.max(8.0, body.radius * 0.22));
    if (altitude > showCutoff || showCutoff <= 0) {
      group.visible = false;
      return;
    }

    group.visible = true;
    biomeGroup.visible = false;
    orbitGroup.visible = true;
    group.position.copy(bodyLocalOffset);

    const angleMoved = surfaceNormal.angleTo(lastOrbitAnchor);
    if (body.id === lastOrbitBodyId && angleMoved < 0.038) {
      return;
    }

    lastOrbitBodyId = body.id;
    lastOrbitAnchor.copy(surfaceNormal);

    _up.copy(surfaceNormal).normalize();
    if (Math.abs(_up.y) < 0.9) _refAxis.set(0, 1, 0);
    else _refAxis.set(1, 0, 0);
    _tangent.crossVectors(_refAxis, _up).normalize();
    _bitangent.crossVectors(_up, _tangent).normalize();

    _cMid.set(body.palette[0]);
    _cLow.set(body.palette[1]);
    _cHigh.set(body.palette[2]);

    const patchSpan = Math.min(body.radius * 1.12, 42);
    const posAttr = orbitTerrainGeo.attributes.position as THREE.BufferAttribute;
    const colAttr = orbitTerrainGeo.attributes.color as THREE.BufferAttribute;

    for (let iz = 0; iz <= ORBIT_PATCH_GRID; iz++) {
      const fz = iz / ORBIT_PATCH_GRID;
      const edgeZ = 1 - Math.abs(fz * 2 - 1);
      const vz = (fz - 0.5) * patchSpan;

      for (let ix = 0; ix <= ORBIT_PATCH_GRID; ix++) {
        const fx = ix / ORBIT_PATCH_GRID;
        const edgeX = 1 - Math.abs(fx * 2 - 1);
        const vx = (fx - 0.5) * patchSpan;
        const edgeFade = Math.min(1, Math.min(edgeX, edgeZ) * 4.5);

        _worldDir
          .copy(_up)
          .multiplyScalar(body.radius)
          .addScaledVector(_tangent, vx)
          .addScaledVector(_bitangent, vz)
          .normalize();

        const h =
          sampleProceduralTerrainHeight(
            _worldDir.x,
            _worldDir.y,
            _worldDir.z,
            body.seed,
            body.terrainRelief,
            body.craterDensity,
          ) * edgeFade;

        const r = body.radius + h + 0.04 * edgeFade - 0.06 * (1 - edgeFade);
        const idx = iz * (ORBIT_PATCH_GRID + 1) + ix;
        posAttr.setXYZ(idx, _worldDir.x * r, _worldDir.y * r, _worldDir.z * r);

        const normH = Math.max(0, Math.min(1, (h + 0.45) / 0.9));
        if (normH < 0.5) {
          _cTmp.copy(_cLow).lerp(_cMid, normH * 2);
        } else {
          _cTmp.copy(_cMid).lerp(_cHigh, (normH - 0.5) * 2);
        }
        colAttr.setXYZ(idx, _cTmp.r, _cTmp.g, _cTmp.b);
      }
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    orbitTerrainGeo.computeVertexNormals();

    const isIcy =
      body.archetype === 'europa' ||
      body.archetype === 'enceladus' ||
      body.archetype === 'exo-ice' ||
      body.archetype === 'triton';
    orbitTerrainMat.roughness = isIcy ? 0.42 : 0.88;
    _rotQ.identity();
  };

  const hide = () => {
    group.visible = false;
  };

  const dispose = () => {
    orbitTerrainGeo.dispose();
    orbitTerrainMat.dispose();
    biomeTerrainGeo.dispose();
    biomeTerrainMat.dispose();
    waterGeo.dispose();
    waterMat.dispose();
    boulderGeo.dispose();
    boulderMat.dispose();
    spireGeo.dispose();
    spireMat.dispose();
    treeCanopyGeo.dispose();
    treeCanopyMat.dispose();
    trunkGeo.dispose();
    trunkMat.dispose();
    pebbleGeo.dispose();
    pebbleMat.dispose();
    cloudGeo.dispose();
    cloudMat.dispose();
    dustGeo.dispose();
    dustMat.dispose();
    microAlbedoMap.dispose();
  };

  return { group, updateForBody, hide, dispose };
}
