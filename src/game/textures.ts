import * as THREE from 'three';
import type { CelestialBodyDef, RingDef } from './types';

function hash2(x: number, y: number, seed: number): number {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function noise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);

  const h = (a: number, b: number, c: number) => {
    let n =
      Math.imul(a, 374761393) ^
      Math.imul(b, 668265263) ^
      Math.imul(c, 2147483647) ^
      Math.imul(seed, 1274126177);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };

  const c000 = h(ix, iy, iz);
  const c100 = h(ix + 1, iy, iz);
  const c010 = h(ix, iy + 1, iz);
  const c110 = h(ix + 1, iy + 1, iz);
  const c001 = h(ix, iy, iz + 1);
  const c101 = h(ix + 1, iy, iz + 1);
  const c011 = h(ix, iy + 1, iz + 1);
  const c111 = h(ix + 1, iy + 1, iz + 1);

  const x00 = c000 + (c100 - c000) * ux;
  const x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux;
  const x11 = c011 + (c111 - c011) * ux;

  return x00 + (x10 - x00) * uy + (x01 + (x11 - x01) * uy - (x00 + (x10 - x00) * uy)) * uz;
}

function fbm3(x: number, y: number, z: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise3(x * freq, y * freq, z * freq, seed + i * 53) * amp;
    norm += amp;
    freq *= 2.08;
    amp *= 0.5;
  }
  return sum / norm;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  const c = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * c),
    Math.round(a[1] + (b[1] - a[1]) * c),
    Math.round(a[2] + (b[2] - a[2]) * c),
  ];
}

export interface PlanetTextureBundle {
  albedo: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
  clouds?: THREE.CanvasTexture;
  nightLights?: THREE.CanvasTexture;
}

const textureCache = new Map<string, PlanetTextureBundle>();

/**
 * Generate seamless spherical procedural equirectangular textures for any planet or moon.
 * Uses 3D spherical direction sampling so there are zero longitudinal seams or pole pinching artifacts!
 */
export function generatePlanetTextures(
  body: CelestialBodyDef,
  maxAnisotropy: number,
): PlanetTextureBundle {
  const cached = textureCache.get(body.id);
  if (cached) return cached;

  const isEarth = body.id === 'earth';
  const isMajor =
    isEarth ||
    body.id === 'jupiter' ||
    body.id === 'saturn' ||
    body.id === 'mars' ||
    body.id === 'moon';
  const width = isEarth ? 1536 : isMajor ? 768 : 384;
  const height = isEarth ? 768 : isMajor ? 384 : 192;

  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = width;
  albedoCanvas.height = height;
  const albedoCtx = albedoCanvas.getContext('2d')!;
  const albedoImg = albedoCtx.createImageData(width, height);

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = width;
  bumpCanvas.height = height;
  const bumpCtx = bumpCanvas.getContext('2d')!;
  const bumpImg = bumpCtx.createImageData(width, height);

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = width;
  roughCanvas.height = height;
  const roughCtx = roughCanvas.getContext('2d')!;
  const roughImg = roughCtx.createImageData(width, height);

  let nightCanvas: HTMLCanvasElement | undefined;
  let nightImg: ImageData | undefined;
  let nightCtx: CanvasRenderingContext2D | undefined;
  if (body.archetype === 'earth') {
    nightCanvas = document.createElement('canvas');
    nightCanvas.width = width;
    nightCanvas.height = height;
    nightCtx = nightCanvas.getContext('2d')!;
    nightImg = nightCtx.createImageData(width, height);
  }

  const c0 = hexToRgb(body.palette[0]);
  const c1 = hexToRgb(body.palette[1]);
  const c2 = hexToRgb(body.palette[2]);

  // Pre-generate deterministic crater list for cratered worlds
  const craters: Array<{ x: number; y: number; z: number; r: number; depth: number }> = [];
  if (body.craterDensity > 0.15) {
    const count = Math.round(body.craterDensity * 48);
    for (let i = 0; i < count; i++) {
      const u = hash2(i, 1, body.seed) * 2 - 1;
      const theta = hash2(i, 2, body.seed) * Math.PI * 2;
      const sq = Math.sqrt(Math.max(0, 1 - u * u));
      craters.push({
        x: sq * Math.cos(theta),
        y: u,
        z: sq * Math.sin(theta),
        r: 0.06 + Math.pow(hash2(i, 3, body.seed), 2.1) * 0.28,
        depth: 0.4 + hash2(i, 4, body.seed) * 0.6,
      });
    }
  }

  for (let py = 0; py < height; py++) {
    const v = (py + 0.5) / height;
    const phi = v * Math.PI; // 0 (north pole) .. PI (south pole)
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const latAbs = Math.abs(cosPhi);

    for (let px = 0; px < width; px++) {
      const u = (px + 0.5) / width;
      const theta = u * Math.PI * 2;
      const nx = sinPhi * Math.cos(theta);
      const ny = cosPhi;
      const nz = sinPhi * Math.sin(theta);

      const idx = (py * width + px) * 4;
      let rgb: [number, number, number] = [128, 128, 128];
      let bumpVal = 128;
      let roughVal = 210;

      const arch = body.archetype;

      if (arch === 'earth' || arch === 'exo-ocean' || arch === 'exo-temperate') {
        // Domain-warped multi-octave continental shelf for authentic fractal coastlines & island chains
        const warpX = fbm3(nx * 2.1 + 3.1, ny * 2.1, nz * 2.1, body.seed + 11, 3) - 0.5;
        const warpZ = fbm3(nx * 2.1, ny * 2.1 + 4.7, nz * 2.1, body.seed + 23, 3) - 0.5;
        const cont = fbm3(
          (nx + warpX * 0.36) * 2.35,
          (ny + warpX * 0.14) * 2.35,
          (nz + warpZ * 0.36) * 2.35,
          body.seed,
          5,
        );
        const detail = fbm3(nx * 11.0, ny * 11.0, nz * 11.0, body.seed + 77, 3);
        const ridgeRaw = Math.abs(fbm3(nx * 6.5, ny * 6.5, nz * 6.5, body.seed + 131, 3) - 0.5) * 2;
        const ridge = Math.pow(Math.max(0, 1 - ridgeRaw), 2.4);
        const seaLevel = arch === 'exo-ocean' ? 0.56 : 0.495;

        if (latAbs > 0.86 - detail * 0.065) {
          // Polar ice sheets with subtle blue-white glacial crevices
          rgb = mixRgb([214, 228, 240], [238, 244, 250], detail);
          bumpVal = 160;
          roughVal = 140;
        } else {
          // Compute ocean color and land color with smooth anti-aliased coastline transition (zero jagged pixel steps!)
          const depthT = Math.max(0, Math.min(1, cont / seaLevel));
          const deepOcean: [number, number, number] =
            arch === 'exo-ocean' ? [4, 18, 42] : [4, 14, 36];
          const midOcean: [number, number, number] =
            arch === 'exo-ocean' ? [9, 42, 76] : [8, 30, 68];
          const shallowOcean: [number, number, number] =
            arch === 'exo-ocean' ? [22, 98, 128] : [16, 68, 110];
          const baseWater = mixRgb(deepOcean, midOcean, Math.pow(depthT, 1.5));
          const oceanRgb = mixRgb(
            baseWater,
            shallowOcean,
            Math.pow(Math.max(0, (depthT - 0.72) / 0.28), 1.8),
          );

          const coastBlend = Math.max(0, Math.min(1, (cont - (seaLevel - 0.011)) / 0.022));
          if (coastBlend <= 0.001) {
            rgb = oceanRgb;
            bumpVal = 96;
            roughVal = 48; // Crisp natural solar ocean specular without plastic glare
          } else {
            // Realistic satellite-imagery muted biomes (boreal olive, steppe, Sahara ochre, cordillera granite)
            const elev = Math.max(0, (cont - seaLevel) / (1 - seaLevel));
            const dry = fbm3(nx * 3.6 + 4, ny * 3.6, nz * 3.6, body.seed + 19, 4);
            const aridBelt = Math.exp(-Math.pow((latAbs - 0.36) * 5.2, 2));
            const aridity = Math.max(0, Math.min(1, (dry - 0.36) * 2.1 + aridBelt * 0.42));

            const lushForest: [number, number, number] =
              arch === 'earth' ? [26, 52, 32] : mixRgb(c0, [28, 54, 40], 0.55);
            const steppe: [number, number, number] =
              arch === 'earth' ? [72, 82, 50] : mixRgb(c0, c2, 0.45);
            const desert: [number, number, number] =
              arch === 'earth' ? [148, 122, 88] : c2;
            const mountain: [number, number, number] = [92, 85, 79];
            const snow: [number, number, number] = [226, 232, 238];

            let land =
              aridity < 0.45
                ? mixRgb(lushForest, steppe, aridity / 0.45)
                : mixRgb(steppe, desert, (aridity - 0.45) / 0.55);
            const mtnFactor = Math.min(1, Math.max(0, (elev - 0.38) * 1.9 + ridge * 0.48 * elev));
            if (mtnFactor > 0.05) land = mixRgb(land, mountain, mtnFactor);
            if (elev + ridge * 0.22 > 0.74) {
              land = mixRgb(land, snow, Math.min(1, (elev + ridge * 0.22 - 0.74) * 3.8));
            }
            const micro = (detail - 0.5) * 18;
            const landRgb: [number, number, number] = [
              Math.max(0, Math.min(255, Math.round(land[0] + micro))),
              Math.max(0, Math.min(255, Math.round(land[1] + micro))),
              Math.max(0, Math.min(255, Math.round(land[2] + micro))),
            ];
            rgb = mixRgb(oceanRgb, landRgb, coastBlend);
            const landBump = Math.min(255, Math.round(132 + elev * 95 + ridge * 48 + (detail - 0.5) * 26));
            bumpVal = Math.round(96 + (landBump - 96) * coastBlend);
            roughVal = Math.round(48 + (232 - 48) * coastBlend);

            // Photorealistic coastal & inland city-light networks (visible strictly on night hemisphere via shader!)
            if (nightImg && coastBlend > 0.55 && elev < 0.48 && latAbs < 0.74) {
              const coastBoost = elev < 0.14 ? 0.16 : 0.0;
              const cluster = fbm3(nx * 14, ny * 14, nz * 14, body.seed + 303, 3);
              const web = fbm3(nx * 36, ny * 36, nz * 36, body.seed + 619, 2);
              const rawGlow =
                Math.max(0, (cluster + coastBoost - 0.54) * 2.8) * Math.max(0, (web - 0.44) * 2.6);
              const glow = Math.min(1, Math.pow(rawGlow, 1.1) * 2.7);
              nightImg.data[idx] = Math.min(255, Math.round(255 * glow));
              nightImg.data[idx + 1] = Math.min(255, Math.round(196 * glow));
              nightImg.data[idx + 2] = Math.min(255, Math.round(108 * glow));
              nightImg.data[idx + 3] = 255;
            }
          }
        }
      } else if (arch === 'jupiter' || arch === 'saturn' || arch === 'uranus' || arch === 'neptune') {
        const warp = fbm3(nx * 3.2, ny * 5.2, nz * 3.2, body.seed, 4);
        const fine = fbm3(nx * 10, ny * 18, nz * 10, body.seed + 41, 3);
        const bandFreq = arch === 'jupiter' ? 14 : arch === 'saturn' ? 11 : 6;
        const band = Math.sin((ny * bandFreq + warp * 1.45) * Math.PI);
        const t = band * 0.5 + 0.5;
        rgb = mixRgb(c1, c0, t);
        rgb = mixRgb(rgb, c2, Math.max(0, Math.min(1, (fine - 0.35) * 1.5)));

        // Jupiter's Great Red Spot vortex
        if (arch === 'jupiter') {
          const spotLat = ny + 0.34;
          const spotLon = Math.atan2(nz, nx) - 0.85;
          const dLon = ((spotLon + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          const spotD = Math.sqrt((dLon / 0.28) ** 2 + (spotLat / 0.13) ** 2);
          if (spotD < 1.15) {
            const swirl = Math.max(0, 1 - spotD / 1.15);
            const spotColor: [number, number, number] = [196, 78, 48];
            rgb = mixRgb(rgb, spotColor, swirl * swirl * 0.92);
          }
        }

        // Neptune high-altitude white methane cirrus streaks
        if (arch === 'neptune' && fine > 0.67 && Math.abs(ny) < 0.65) {
          rgb = mixRgb(rgb, [206, 228, 255], (fine - 0.67) * 2.4);
        }

        bumpVal = Math.round(128 + (warp - 0.5) * 22);
        roughVal = 175;
      } else if (arch === 'venus' || arch === 'titan') {
        const swirl = fbm3(nx * 3.5 + ny * 1.4, ny * 6.0, nz * 3.5, body.seed, 5);
        const streak = Math.sin(ny * 10 + swirl * 4.0) * 0.5 + 0.5;
        rgb = mixRgb(c1, c0, swirl);
        rgb = mixRgb(rgb, c2, streak * 0.45);
        bumpVal = Math.round(128 + (swirl - 0.5) * 35);
        roughVal = 165;
      } else if (arch === 'mars') {
        const n1 = fbm3(nx * 2.8, ny * 2.8, nz * 2.8, body.seed, 5);
        const n2 = fbm3(nx * 9.5, ny * 9.5, nz * 9.5, body.seed + 29, 3);
        rgb = mixRgb(c1, c0, n1);
        rgb = mixRgb(rgb, c2, Math.max(0, (n2 - 0.45) * 1.8));
        // Valles Marineris equatorial canyon scar
        const canyon = Math.exp(-Math.pow((ny + 0.12) * 14, 2)) * Math.exp(-Math.pow((theta - 2.1) * 2.4, 2));
        rgb = mixRgb(rgb, [82, 34, 20], canyon * 0.78);
        // Polar CO2 ice caps
        if (latAbs > 0.88 - n2 * 0.05) {
          rgb = [238, 232, 226];
        }
        bumpVal = Math.round(110 + n1 * 90 + n2 * 40 - canyon * 70);
        roughVal = 235;
      } else if (arch === 'europa' || arch === 'enceladus' || arch === 'exo-ice') {
        const ice = fbm3(nx * 3.5, ny * 3.5, nz * 3.5, body.seed, 4);
        // Sharp intersecting tectonic cracks / lineae
        const crack1 = Math.abs(fbm3(nx * 7.2, ny * 7.2, nz * 7.2, body.seed + 13, 3) - 0.5);
        const crack2 = Math.abs(fbm3(nx * 11.5 + 2, ny * 11.5, nz * 11.5, body.seed + 59, 3) - 0.5);
        const lineae = Math.max(0, 1 - Math.min(crack1, crack2) * 28);
        rgb = mixRgb(c0, c2, ice);
        rgb = mixRgb(rgb, c1, lineae * (arch === 'europa' ? 0.85 : 0.45));
        bumpVal = Math.round(140 + ice * 50 - lineae * 75);
        roughVal = Math.round(88 + lineae * 95);
      } else if (arch === 'io' || arch === 'exo-lava') {
        const base = fbm3(nx * 3.8, ny * 3.8, nz * 3.8, body.seed, 5);
        const caldera = fbm3(nx * 12, ny * 12, nz * 12, body.seed + 83, 3);
        rgb = mixRgb(c0, c2, base);
        if (caldera > 0.66) {
          rgb = mixRgb(rgb, c1, (caldera - 0.66) * 3.2);
        }
        if (arch === 'exo-lava' && caldera > 0.74) {
          rgb = [255, 118, 42];
        }
        bumpVal = Math.round(115 + base * 95 + (caldera > 0.66 ? -55 : 15));
        roughVal = 215;
      } else if (arch === 'pluto' || arch === 'triton') {
        const n1 = fbm3(nx * 3.0, ny * 3.0, nz * 3.0, body.seed, 4);
        const n2 = fbm3(nx * 8.0, ny * 8.0, nz * 8.0, body.seed + 17, 3);
        rgb = mixRgb(c1, c0, n1);
        rgb = mixRgb(rgb, c2, n2 * 0.55);
        // Tombaugh Regio bright heart-shaped nitrogen glacier on Pluto
        if (arch === 'pluto') {
          const heartD = Math.sqrt(Math.pow((theta - 2.4) * 1.6, 2) + Math.pow((ny - 0.1) * 2.2, 2));
          if (heartD < 0.72) {
            rgb = mixRgb(rgb, [242, 232, 222], Math.pow(1 - heartD / 0.72, 1.4));
          }
        }
        bumpVal = Math.round(120 + n1 * 80);
        roughVal = 185;
      } else {
        // Moon, Mercury, Ganymede, Callisto, Asteroids, Exo-Desert
        const mare = fbm3(nx * 2.2, ny * 2.2, nz * 2.2, body.seed, 4);
        const regolith = fbm3(nx * 10, ny * 10, nz * 10, body.seed + 61, 3);
        let hVal = mare * 0.72 + regolith * 0.28;

        for (let i = 0; i < craters.length; i++) {
          const cr = craters[i];
          const dx = nx - cr.x;
          const dy = ny - cr.y;
          const dz = nz - cr.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < cr.r * 1.25) {
            const cu = d / cr.r;
            if (cu < 1.0) {
              hVal -= (1 - cu * cu) * 0.28 * cr.depth;
            } else {
              const rim = 1 - (cu - 1.0) / 0.25;
              hVal += rim * rim * 0.14 * cr.depth;
            }
          }
        }

        hVal = Math.max(0, Math.min(1, hVal));
        rgb = hVal < 0.46 ? mixRgb(c1, c0, hVal / 0.46) : mixRgb(c0, c2, (hVal - 0.46) / 0.54);
        bumpVal = Math.round(hVal * 255);
        roughVal = 238;
      }

      albedoImg.data[idx] = rgb[0];
      albedoImg.data[idx + 1] = rgb[1];
      albedoImg.data[idx + 2] = rgb[2];
      albedoImg.data[idx + 3] = 255;

      bumpImg.data[idx] = bumpVal;
      bumpImg.data[idx + 1] = bumpVal;
      bumpImg.data[idx + 2] = bumpVal;
      bumpImg.data[idx + 3] = 255;

      roughImg.data[idx] = roughVal;
      roughImg.data[idx + 1] = roughVal;
      roughImg.data[idx + 2] = roughVal;
      roughImg.data[idx + 3] = 255;
    }
  }

  albedoCtx.putImageData(albedoImg, 0, 0);
  bumpCtx.putImageData(bumpImg, 0, 0);
  roughCtx.putImageData(roughImg, 0, 0);

  const albedo = new THREE.CanvasTexture(albedoCanvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = THREE.RepeatWrapping;
  albedo.wrapT = THREE.ClampToEdgeWrapping;
  albedo.anisotropy = maxAnisotropy;

  const bump = new THREE.CanvasTexture(bumpCanvas);
  bump.wrapS = THREE.RepeatWrapping;
  bump.wrapT = THREE.ClampToEdgeWrapping;
  bump.anisotropy = maxAnisotropy;

  const roughness = new THREE.CanvasTexture(roughCanvas);
  roughness.wrapS = THREE.RepeatWrapping;
  roughness.wrapT = THREE.ClampToEdgeWrapping;
  roughness.anisotropy = maxAnisotropy;

  let clouds: THREE.CanvasTexture | undefined;
  if (
    body.archetype === 'earth' ||
    body.archetype === 'exo-ocean' ||
    body.archetype === 'exo-temperate'
  ) {
    clouds = generateCloudTexture(body.seed + 555, maxAnisotropy);
  }

  let nightLights: THREE.CanvasTexture | undefined;
  if (nightCanvas && nightCtx && nightImg) {
    nightCtx.putImageData(nightImg, 0, 0);
    nightLights = new THREE.CanvasTexture(nightCanvas);
    nightLights.colorSpace = THREE.SRGBColorSpace;
    nightLights.wrapS = THREE.RepeatWrapping;
    nightLights.wrapT = THREE.ClampToEdgeWrapping;
    nightLights.anisotropy = maxAnisotropy;
  }

  const bundle: PlanetTextureBundle = { albedo, bump, roughness, clouds, nightLights };
  textureCache.set(body.id, bundle);
  return bundle;
}

function generateCloudTexture(seed: number, maxAnisotropy: number): THREE.CanvasTexture {
  const width = 1024;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(width, height);

  for (let py = 0; py < height; py++) {
    const phi = ((py + 0.5) / height) * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    for (let px = 0; px < width; px++) {
      const theta = ((px + 0.5) / width) * Math.PI * 2;
      const nx = sinPhi * Math.cos(theta);
      const ny = cosPhi;
      const nz = sinPhi * Math.sin(theta);
      // Coriolis-sheared jet stream & cyclonic frontal bands
      const coriolis = fbm3(nx * 2.8, ny * 3.8, nz * 2.8, seed + 7, 3) - 0.5;
      const shear = ny * 1.35 + coriolis * 1.8;
      const swirl = fbm3(
        nx * 3.2 + Math.sin(shear) * 0.45,
        ny * 5.2,
        nz * 3.2 + Math.cos(shear) * 0.45,
        seed,
        4,
      );
      const wisps = fbm3(nx * 10.5 + coriolis * 1.4, ny * 12.5, nz * 10.5, seed + 19, 3);
      const raw = swirl * 0.66 + wisps * 0.38;
      const density = Math.max(0, Math.min(1, (raw - 0.505) * 3.45));
      const idx = (py * width + px) * 4;
      img.data[idx] = 242;
      img.data[idx + 1] = 247;
      img.data[idx + 2] = 252;
      img.data[idx + 3] = Math.round(Math.pow(density, 0.85) * 240);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/**
 * Generate radial multi-band planetary ring texture (Saturn Cassini Division, Encke Gap, icy ringlets).
 */
export function generateRingTexture(ring: RingDef, seed: number, maxAnisotropy: number): THREE.CanvasTexture {
  const width = 512;
  const height = 8;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(width, height);

  const cIn = hexToRgb(ring.colorInner);
  const cOut = hexToRgb(ring.colorOuter);

  for (let x = 0; x < width; x++) {
    const t = x / (width - 1); // 0 = inner edge, 1 = outer edge
    const band1 = Math.sin(t * 72 + seed) * 0.5 + 0.5;
    const band2 = Math.sin(t * 210 + seed * 3) * 0.5 + 0.5;
    let alpha = (0.35 + band1 * 0.4 + band2 * 0.25) * ring.opacity;

    // Fade edges softly
    alpha *= Math.min(1, t * 14) * Math.min(1, (1 - t) * 14);
    // Authentic Cassini Division gap around 0.62..0.69
    if (t > 0.61 && t < 0.685) {
      alpha *= 0.08;
    }
    // Encke Gap near 0.87
    if (t > 0.865 && t < 0.882) {
      alpha *= 0.14;
    }
    // Translucent inner C-ring
    if (t < 0.22) {
      alpha *= 0.45 + (t / 0.22) * 0.55;
    }

    const rgb = mixRgb(cIn, cOut, t * 0.7 + band1 * 0.3);
    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * 4;
      img.data[idx] = rgb[0];
      img.data[idx + 1] = rgb[1];
      img.data[idx + 2] = rgb[2];
      img.data[idx + 3] = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

let glowSpriteCache: THREE.CanvasTexture | null = null;

/**
 * Procedural soft radial star/corona flare sprite (zero external PNG dependencies).
 */
export function getStarGlowTexture(): THREE.CanvasTexture {
  if (glowSpriteCache) return glowSpriteCache;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const half = size / 2;

  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.14, 'rgba(255, 252, 240, 0.88)');
  grad.addColorStop(0.38, 'rgba(255, 240, 210, 0.32)');
  grad.addColorStop(0.7, 'rgba(255, 220, 180, 0.08)');
  grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Subtle diffraction cross spikes for realistic optical astronomy feel
  ctx.save();
  ctx.translate(half, half);
  const spikeGrad = ctx.createLinearGradient(-half, 0, half, 0);
  spikeGrad.addColorStop(0, 'rgba(255,255,255,0)');
  spikeGrad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  spikeGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = spikeGrad;
  ctx.fillRect(-half, -1, size, 2);
  ctx.rotate(Math.PI / 2);
  ctx.fillRect(-half, -1, size, 2);
  ctx.restore();

  glowSpriteCache = new THREE.CanvasTexture(canvas);
  glowSpriteCache.colorSpace = THREE.SRGBColorSpace;
  return glowSpriteCache;
}

let rockBumpCache: THREE.CanvasTexture | null = null;

/**
 * Tileable procedural micro-relief bump map for close-up planetary/lunar terrain & boulders.
 */
export function getSurfaceDetailBumpTexture(maxAnisotropy: number): THREE.CanvasTexture {
  if (rockBumpCache) return rockBumpCache;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, heightOrSize(size));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Seamless toroidal sampling so tiling has zero edges
      const ax = (x / size) * Math.PI * 2;
      const ay = (y / size) * Math.PI * 2;
      const n = fbm3(
        Math.cos(ax) * 2.4 + Math.sin(ay) * 0.7,
        Math.sin(ax) * 2.4,
        Math.cos(ay) * 2.4,
        777,
        4,
      );
      const grit = hash2(x, y, 888) * 0.14;
      const v = Math.round(Math.max(0, Math.min(1, n * 0.86 + grit)) * 255);
      const idx = (y * size + x) * 4;
      img.data[idx] = v;
      img.data[idx + 1] = v;
      img.data[idx + 2] = v;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  rockBumpCache = new THREE.CanvasTexture(canvas);
  rockBumpCache.wrapS = THREE.RepeatWrapping;
  rockBumpCache.wrapT = THREE.RepeatWrapping;
  rockBumpCache.repeat.set(16, 16);
  rockBumpCache.anisotropy = maxAnisotropy;
  return rockBumpCache;
}

function heightOrSize(s: number): number {
  return s;
}
