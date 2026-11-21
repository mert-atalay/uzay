import * as THREE from 'three';

/**
 * Animated boiling photosphere star shader with 3D convective granulation,
 * limb darkening, and spectral color temperature gradient.
 */
export function createStarSurfaceMaterial(
  coreHex: string,
  midHex: string,
  limbHex: string,
  seed: number,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: seed * 0.13 },
      uColorCore: { value: new THREE.Color(coreHex) },
      uColorMid: { value: new THREE.Color(midHex) },
      uColorLimb: { value: new THREE.Color(limbHex) },
    },
    vertexShader: `
      varying vec3 vNormalDir;
      varying vec3 vObjPos;
      varying vec3 vViewDir;

      void main() {
        vObjPos = normalize(position);
        vNormalDir = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uSeed;
      uniform vec3 uColorCore;
      uniform vec3 uColorMid;
      uniform vec3 uColorLimb;

      varying vec3 vNormalDir;
      varying vec3 vObjPos;
      varying vec3 vViewDir;

      float hash(vec3 p) {
        p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      float noise(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
              mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
              mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
          f.z
        );
      }

      float fbm(vec3 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += a * noise(p);
          p = p * 2.15 + vec3(1.7, 9.2, 3.4);
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec3 p = vObjPos * 6.5 + vec3(uSeed);
        float t = uTime * 0.18;
        float n1 = fbm(p + vec3(t, -t * 0.6, t * 0.4));
        float n2 = fbm(p * 2.1 - vec3(n1 * 1.4) + vec3(-t * 0.5, t * 0.8, 0.0));
        float plasma = clamp(n1 * 0.55 + n2 * 0.65, 0.0, 1.0);

        float ndotv = clamp(dot(normalize(vNormalDir), normalize(vViewDir)), 0.0, 1.0);
        float limb = pow(ndotv, 0.55);

        vec3 col = mix(uColorLimb, uColorMid, smoothstep(0.15, 0.62, plasma));
        col = mix(col, uColorCore, smoothstep(0.56, 0.92, plasma) * limb);
        // Limb brightening corona rim
        float coronaRim = pow(1.0 - ndotv, 3.2);
        col += uColorMid * coronaRim * 0.95;

        gl_FragColor = vec4(col * 1.32, 1.0);
      }
    `,
    toneMapped: false,
  });
}

export interface RayleighAtmosphereConfig {
  planetRadius: number;
  atmoRadius: number;
  betaRayleigh: [number, number, number];
  betaMie: [number, number, number];
  mieG: number;
  scaleHeightRatio: number;
  refractiveDispersion: number;
  intensity: number;
}

/**
 * Physically-based Ray-Marched Rayleigh & Mie Atmospheric Scattering + Light Refraction Shader.
 * Uses analytical ray-sphere intersection on a BackSide atmospheric envelope so it renders
 * seamlessly both from high orbit AND while plunging through the atmosphere to the surface,
 * with Beer-Lambert sunset reddening, Henyey-Greenstein solar aureole, and horizon refraction.
 */
export function createAtmosphereMaterial(
  config: RayleighAtmosphereConfig,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPlanetCenter: { value: new THREE.Vector3(0, 0, 0) },
      uPlanetRadius: { value: config.planetRadius },
      uAtmoRadius: { value: config.atmoRadius },
      uSunDir: { value: new THREE.Vector3(1, 0.2, 0.3).normalize() },
      uSunColor: { value: new THREE.Color('#fff4dc') },
      uBetaR: { value: new THREE.Vector3(...config.betaRayleigh) },
      uBetaM: { value: new THREE.Vector3(...config.betaMie) },
      uMieG: { value: config.mieG },
      uScaleHeightRatio: { value: config.scaleHeightRatio },
      uRefractionDispersion: { value: config.refractiveDispersion },
      uIntensity: { value: config.intensity },
      uImmersion: { value: 0.0 },
      uEntryGlow: { value: 0.0 },
      uTime: { value: 0.0 },
    },
    vertexShader: `
      varying vec3 vWorldPos;

      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uPlanetCenter;
      uniform float uPlanetRadius;
      uniform float uAtmoRadius;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uBetaR;
      uniform vec3 uBetaM;
      uniform float uMieG;
      uniform float uScaleHeightRatio;
      uniform float uRefractionDispersion;
      uniform float uIntensity;
      uniform float uImmersion;
      uniform float uEntryGlow;
      uniform float uTime;

      varying vec3 vWorldPos;

      // Analytical ray-sphere intersection returning (tNear, tFar); misses return (1e9, -1e9)
      vec2 intersectSphere(vec3 ro, vec3 rd, vec3 center, float radius) {
        vec3 oc = ro - center;
        float b = dot(oc, rd);
        float c = dot(oc, oc) - radius * radius;
        float h = b * b - c;
        if (h < 0.0) return vec2(1e9, -1e9);
        float s = sqrt(h);
        return vec2(-b - s, -b + s);
      }

      void main() {
        vec3 ro = cameraPosition;
        vec3 rd = normalize(vWorldPos - ro);
        vec3 sunDir = normalize(uSunDir);

        vec2 atmoHit = intersectSphere(ro, rd, uPlanetCenter, uAtmoRadius);
        if (atmoHit.y < 0.0 || atmoHit.x > atmoHit.y) {
          discard;
        }

        // Start right at camera when flying inside the atmosphere!
        float tStart = max(atmoHit.x, 0.0);
        float tEnd = atmoHit.y;

        // Clip optical path against solid planetary surface so aerial perspective stays crisp
        vec2 planetHit = intersectSphere(ro, rd, uPlanetCenter, uPlanetRadius * 0.996);
        bool hitGround = planetHit.x > 0.0 && planetHit.x < tEnd;
        if (hitGround) {
          tEnd = planetHit.x;
        }

        float pathLen = max(0.0, tEnd - tStart);
        if (pathLen <= 0.0001) {
          discard;
        }

        float shellThick = max(0.001, uAtmoRadius - uPlanetRadius);
        float H_R = shellThick * uScaleHeightRatio;
        float H_M = shellThick * (uScaleHeightRatio * 0.48);

        // Chromatic atmospheric refraction bends low grazing sunlight slightly around the limb
        float mu = dot(rd, sunDir);
        float phaseR = 0.0596831 * (1.0 + mu * mu);
        float g = uMieG;
        float g2 = g * g;
        float denom = max(0.05, 1.0 + g2 - 2.0 * g * mu);
        float phaseM = 0.1193662 * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(denom, 1.5));

        const int STEPS = 6;
        float stepLen = pathLen / float(STEPS);
        float normStep = stepLen / shellThick;

        vec3 accumR = vec3(0.0);
        vec3 accumM = vec3(0.0);
        float optDepthR = 0.0;
        float optDepthM = 0.0;

        for (int i = 0; i < STEPS; i++) {
          float t = tStart + (float(i) + 0.5) * stepLen;
          vec3 samplePos = ro + rd * t;
          vec3 rel = samplePos - uPlanetCenter;
          float r = length(rel);
          float h = max(0.0, r - uPlanetRadius);
          vec3 up = rel / max(0.0001, r);

          float densR = exp(-h / H_R);
          float densM = exp(-h / H_M);
          optDepthR += densR * normStep;
          optDepthM += densM * normStep;

          // Refracted solar zenith cosine: Snell's-law limb bending lifts twilight light ~7-11 deg over the horizon
          float rawSunCos = dot(up, sunDir);
          float refractedSunCos = rawSunCos + uRefractionDispersion * 0.18 * densR;

          // Smooth optical depth toward the star (Chapman grazing approximation: thin overhead, steep near twilight)
          float sunGrazing = pow(clamp(1.0 - max(0.0, refractedSunCos), 0.0, 1.0), 3.4);
          float sunPath = mix(0.35, 11.5, sunGrazing);
          float sunVisibility = smoothstep(-0.18, 0.14, refractedSunCos);

          // Wavelength-dependent Beer-Lambert extinction:
          // Keep sunlit optical depth below 1.0 so short-wavelength blue dominates the daytime limb,
          // while grazing twilight paths extinguish blue first so warm golden-orange light refracts at dusk!
          vec3 tauR = uBetaR * (optDepthR * 0.14 + densR * sunPath * 0.34);
          vec3 tauM = vec3(0.22) * (optDepthM * 0.25 + densM * sunPath * 0.26);
          vec3 transmittance = exp(-(tauR + tauM)) * sunVisibility;

          accumR += densR * transmittance * normStep;
          accumM += densM * transmittance * normStep;
        }

        vec3 scatteredR = accumR * uBetaR * phaseR * 12.5;
        vec3 scatteredM = accumM * uBetaM * phaseM * 2.8;
        vec3 color = (scatteredR + scatteredM) * uSunColor * uIntensity;

        // Aerial perspective balance: keep surface continents crisp directly below while curving into
        // luminous blue Rayleigh haze toward the planetary limb
        float aerialScale = 1.0;
        if (hitGround) {
          vec3 groundPos = ro + rd * tEnd;
          vec3 groundNormal = normalize(groundPos - uPlanetCenter);
          float viewCos = max(0.0, dot(groundNormal, -rd));
          aerialScale = mix(1.05, 0.26, pow(viewCos, 0.8));
          color *= aerialScale;
        }

        // Chromatic dispersion & refracted twilight/entry prism band along the atmospheric horizon
        vec3 centerUp = normalize(ro - uPlanetCenter);
        float horizonAlign = exp(-pow(dot(rd, centerUp) * 3.0, 2.0));
        float limbFactor = hitGround ? (1.0 - aerialScale * 0.35) : 1.0;
        float entryRefraction = (uImmersion * 0.65 + uEntryGlow * 1.15) * horizonAlign;
        if (entryRefraction > 0.005) {
          float shimmer = 0.86 + 0.14 * sin(uTime * 8.5 + dot(rd, sunDir) * 18.0);
          vec3 prismWarm = vec3(1.0, 0.46, 0.14);
          vec3 prismCool = vec3(0.2, 0.66, 1.0);
          vec3 refractBand = mix(prismCool, prismWarm, clamp(smoothstep(-0.2, 0.55, mu) + uEntryGlow * 0.6, 0.0, 1.0));
          color += refractBand * entryRefraction * uRefractionDispersion * 0.9 * shimmer * limbFactor;
        }

        // Soft outer silhouette feathering so the atmosphere edge dissolves cleanly into vacuum
        float closestApproach = length((ro - uPlanetCenter) - rd * dot(ro - uPlanetCenter, rd));
        float outerFeather = hitGround
          ? 1.0
          : smoothstep(uAtmoRadius, uPlanetRadius + shellThick * 0.14, closestApproach);

        // Preserve chromatic saturation with gentle shoulder compression (avoids washing blue into grey-white)
        float maxChan = max(color.r, max(color.g, color.b));
        if (maxChan > 0.0001) {
          float compressed = 1.0 - exp(-maxChan * 1.18);
          color *= compressed / maxChan;
        }
        float lum = max(color.r, max(color.g, color.b));
        // Smooth handoff as skyDome's Rayleigh sky vault takes over inside the lower atmosphere (prevents double-scatter wash)
        float handoff = 1.0 - smoothstep(0.36, 0.88, uImmersion);
        float alpha = clamp(lum * (0.96 + uImmersion * 0.12) * outerFeather * handoff, 0.0, 0.94);
        if (alpha < 0.002) discard;

        gl_FragColor = vec4(color * handoff, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
}

/**
 * Custom Milky Way & Deep-Space Nebula Backdrop with Dynamic Rayleigh Zenith-to-Horizon Sky Vault.
 * Seamlessly transitions from pitch-black Milky Way vacuum into physically refracted planetary sky
 * aligned with the local gravity normal and star elevation as the player enters an atmosphere.
 */
export function createMilkyWayBackdropMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSkyTint: { value: new THREE.Color('#02040a') },
      uAtmoBlend: { value: 0.0 },
      uSurfaceUp: { value: new THREE.Vector3(0, 1, 0) },
      uSunDir: { value: new THREE.Vector3(1, 0.2, 0.3).normalize() },
      uSunColor: { value: new THREE.Color('#fff4dc') },
      uBetaR: { value: new THREE.Vector3(0.22, 0.54, 1.0) },
      uBetaM: { value: new THREE.Vector3(0.95, 0.88, 0.76) },
      uEntryGlow: { value: 0.0 },
      uTime: { value: 0.0 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uSkyTint;
      uniform float uAtmoBlend;
      uniform vec3 uSurfaceUp;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uBetaR;
      uniform vec3 uBetaM;
      uniform float uEntryGlow;
      uniform float uTime;
      varying vec3 vDir;

      float hash(vec3 p) {
        p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.23));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      float noise(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
              mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
              mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
          f.z
        );
      }

      float fbm(vec3 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += a * noise(p);
          p = p * 2.08 + vec3(1.7, -3.1, 2.4);
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec3 d = normalize(vDir);

        // Authentic deep-space astronomical contrast: stark ink-black vacuum
        vec3 deepVoid = vec3(0.0012, 0.0019, 0.0048);

        // Realistic Milky Way Galactic Plane (~60 deg tilt relative to ecliptic)
        vec3 galNormal = normalize(vec3(0.45, 0.82, -0.35));
        float planeDist = abs(dot(d, galNormal));
        float bandWide = exp(-planeDist * 4.4);
        float bandCore = exp(-planeDist * 11.5);

        float cloudA = fbm(d * 4.2);
        float cloudB = fbm(d * 8.6 + vec3(cloudA * 1.45, -cloudA * 1.1, 2.3));
        float greatRift = smoothstep(0.36, 0.72, fbm(d * 7.8 + vec3(3.1, -1.7, 5.2)));
        float fineDust = smoothstep(0.44, 0.78, fbm(d * 16.5 + vec3(cloudA * 2.0)));

        // Galactic bulge toward Sagittarius direction
        float coreGlow = pow(max(0.0, dot(d, normalize(vec3(-0.65, -0.22, -0.72)))), 4.2);
        vec3 mwOuterArm = vec3(0.085, 0.13, 0.24);
        vec3 mwBulgeWarm = vec3(0.36, 0.25, 0.16);
        vec3 mwSilver = vec3(0.22, 0.26, 0.34);

        vec3 mwCol = mix(mwOuterArm, mwSilver, cloudB * 0.65);
        mwCol = mix(mwCol, mwBulgeWarm, clamp(coreGlow * 0.92 + cloudA * 0.25, 0.0, 1.0));

        float dustAbsorption = (1.0 - greatRift * 0.74 * bandCore) * (1.0 - fineDust * 0.38 * bandWide);
        vec3 spaceCol = deepVoid + mwCol * bandWide * (0.22 + cloudA * 0.58 + cloudB * 0.42) * dustAbsorption;
        spaceCol += vec3(0.26, 0.17, 0.11) * coreGlow * bandCore * (1.0 - greatRift * 0.65) * 0.58;

        // Subtle distant unresolved Milky Way star-dust shimmer along the galactic plane
        float starDust = pow(noise(d * 46.0), 4.5) * bandCore * (1.0 - greatRift * 0.75);
        spaceCol += vec3(0.38, 0.42, 0.52) * starDust * 0.42;

        // === REALISTIC DISTANT DEEP-SPACE NEBULAE (natural astrophotography color & dynamic range) ===
        // 1. Distant H-Alpha Emission Complex (Orion / Carina-like dusty ruby-rose ionized hydrogen + dark Bok veins)
        vec3 hAlphaDir = normalize(vec3(0.58, -0.24, -0.78));
        float hAlphaAng = max(0.0, dot(d, hAlphaDir));
        float hAlphaMask = smoothstep(0.72, 0.96, hAlphaAng);
        if (hAlphaMask > 0.002) {
          float w1 = fbm(d * 7.5 + vec3(2.4, 8.1, -3.5));
          float w2 = fbm(d * 14.5 + vec3(w1 * 2.1, -w1 * 1.6, 4.2));
          float wisps = smoothstep(0.24, 0.82, w1 * 0.55 + w2 * 0.55);
          float darkPillars = smoothstep(0.5, 0.82, fbm(d * 19.0 + vec3(9.1, -2.2, 1.4)));
          vec3 rubyH = vec3(0.46, 0.12, 0.18);
          vec3 warmFront = vec3(0.62, 0.30, 0.19);
          vec3 coreBlue = vec3(0.28, 0.42, 0.66);
          vec3 nebCol = mix(rubyH, warmFront, smoothstep(0.46, 0.84, w2));
          nebCol = mix(nebCol, coreBlue, smoothstep(0.91, 0.99, hAlphaAng) * w1 * 0.7);
          spaceCol += nebCol * hAlphaMask * wisps * (1.0 - darkPillars * 0.64) * 0.76;
        }

        // 2. Distant Reflection Nebula Complex (Pleiades / Iris-like gossamer cobalt-sapphire dust)
        vec3 reflDir = normalize(vec3(-0.48, 0.46, 0.74));
        float reflAng = max(0.0, dot(d, reflDir));
        float reflMask = smoothstep(0.76, 0.97, reflAng);
        if (reflMask > 0.002) {
          float rw1 = fbm(d * 9.0 + vec3(-6.2, 3.8, 5.1));
          float rw2 = fbm(d * 18.0 + vec3(rw1 * 1.8));
          float tendrils = smoothstep(0.28, 0.82, rw1 * 0.5 + rw2 * 0.55);
          vec3 cobalt = vec3(0.15, 0.32, 0.58);
          vec3 silverBlue = vec3(0.36, 0.52, 0.76);
          spaceCol += mix(cobalt, silverBlue, smoothstep(0.52, 0.86, rw2)) * reflMask * tendrils * 0.66;
        }

        // 3. Faint Distant Supernova Remnant Veil ([O III] teal-oxygen & delicate crimson shock arcs)
        vec3 veilDir = normalize(vec3(0.76, 0.44, 0.48));
        float veilAng = max(0.0, dot(d, veilDir));
        float veilMask = smoothstep(0.81, 0.965, veilAng);
        if (veilMask > 0.002) {
          float vw = fbm(d * 13.0 + vec3(14.2, -5.4, 2.1));
          float shockFilament = exp(-pow((vw - 0.54) * 9.5, 2.0));
          vec3 oiii = vec3(0.13, 0.42, 0.48);
          vec3 hShock = vec3(0.48, 0.17, 0.19);
          vec3 vCol = mix(oiii, hShock, smoothstep(0.45, 0.65, fbm(d * 10.0 + vec3(1.2))));
          spaceCol += vCol * veilMask * shockFilament * 0.62;
        }

        // 4. Distant Magellanic-Style Dwarf Satellite Galaxy off the Galactic Plane for deep-field scale
        vec3 lmcDir = normalize(vec3(-0.22, -0.78, 0.58));
        float lmcAng = max(0.0, dot(d, lmcDir));
        float lmcMask = smoothstep(0.95, 0.995, lmcAng);
        if (lmcMask > 0.002) {
          float lmcCloud = fbm(d * 22.0 + vec3(4.2, -8.1, 3.0));
          spaceCol += vec3(0.28, 0.33, 0.44) * lmcMask * (0.4 + lmcCloud * 0.85) * 0.52;
        }

        if (uAtmoBlend > 0.005) {
          vec3 up = normalize(uSurfaceUp);
          vec3 sunDir = normalize(uSunDir);
          float viewElev = dot(d, up);
          float sunElev = dot(up, sunDir);
          float mu = dot(d, sunDir);

          // Optical airmass grows sharply toward the horizon (creates luminous horizon band & sunset refraction)
          float horizonMask = exp(-max(0.0, viewElev) * 4.0);
          float opticalAir = 1.0 / (max(0.08, viewElev) + 0.18);
          float dayFactor = smoothstep(-0.24, 0.30, sunElev);
          float twilight = exp(-pow((sunElev + 0.03) * 3.1, 2.0));

          // Physically derived zenith-to-horizon Rayleigh sky + sunset wavelength refraction
          vec3 zenithDay = mix(uBetaR * 0.92, vec3(0.18, 0.50, 0.98), 0.48) * (0.14 + 1.48 * dayFactor);
          vec3 zenithCol = zenithDay * uSunColor;
          vec3 horizonBase = mix(uSkyTint, uBetaR * 1.24 + uBetaM * 0.46, 0.58) * (0.22 + 1.28 * dayFactor);
          vec3 sunsetRefract = vec3(1.0, 0.44, 0.14) * (0.35 + 0.65 * max(0.0, mu)) * twilight;

          // Mie solar aureole halo refracting around the star
          float mieHalo = pow(max(0.0, mu), 10.0) * 0.55 + pow(max(0.0, mu), 44.0) * 0.95;
          vec3 skyCol = mix(zenithCol, horizonBase, clamp(horizonMask * 0.92 + (opticalAir - 0.8) * 0.12, 0.0, 1.0));
          skyCol += sunsetRefract * (0.4 + 0.65 * horizonMask);
          skyCol += uBetaM * uSunColor * mieHalo * (0.25 + 0.75 * dayFactor);

          // Subtle high-altitude stratospheric cirrus wisps lit by the sun
          if (viewElev > 0.02) {
            vec3 refA = abs(up.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
            vec3 tX = normalize(cross(refA, up));
            vec3 tZ = normalize(cross(up, tX));
            vec2 skyPlane = vec2(dot(d, tX), dot(d, tZ)) / (viewElev + 0.22);
            float cirrus = fbm(vec3(skyPlane * 0.55 + vec2(uTime * 0.004, -uTime * 0.002), 1.4));
            float cirrusBand = smoothstep(0.56, 0.82, cirrus) * smoothstep(0.02, 0.22, viewElev) * (1.0 - smoothstep(0.55, 0.95, viewElev) * 0.35);
            vec3 cirrusCol = mix(vec3(0.95, 0.97, 1.0), vec3(1.0, 0.64, 0.36), twilight * 0.85) * (0.28 + 0.95 * dayFactor);
            skyCol = mix(skyCol, cirrusCol, cirrusBand * 0.38 * uAtmoBlend);
          }

          // High-speed atmospheric entry ionized refraction glow along horizon
          skyCol += vec3(1.0, 0.5, 0.2) * uEntryGlow * horizonMask * 0.65;

          // Below horizon softly deepens into ground-scatter shadow
          float aboveHorizon = smoothstep(-0.18, 0.05, viewElev);
          skyCol *= (0.32 + 0.68 * aboveHorizon);
          float maxSky = max(skyCol.r, max(skyCol.g, skyCol.b));
          if (maxSky > 0.0001) {
            float compSky = 1.0 - exp(-maxSky * 1.42);
            skyCol *= compSky / maxSky;
          }

          float skyVis = clamp(uAtmoBlend * (0.26 + 0.96 * dayFactor + twilight * 0.45), 0.0, 1.0);
          vec3 finalCol = mix(spaceCol, skyCol, skyVis);
          gl_FragColor = vec4(finalCol, 1.0);
        } else {
          gl_FragColor = vec4(spaceCol, 1.0);
        }
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });
}

/**
 * Expanding holographic discovery scan wave emitted from the Voyager.
 */
export function createScanWaveMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uProgress: { value: 1.0 },
      uColor: { value: new THREE.Color('#66d9ff') },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float uProgress;
      uniform vec3 uColor;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.6);
        float fade = (1.0 - uProgress) * (1.0 - uProgress);
        gl_FragColor = vec4(uColor, fresnel * fade * 0.85);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/**
 * Physically-Based General Relativistic Black Hole Shader (Schwarzschild / Kerr Geodesic Ray-Marcher).
 * Integrates the exact general relativistic null geodesic equation (d²x/dλ² = -1.5 * Rs * L² * x / r⁵)
 * per pixel to produce:
 * - Absolute pitch-black Event Horizon (r <= Rs) with theoretical 2.598*Rs apparent shadow
 * - Razor-sharp luminous Photon Sphere ring (r ≈ 1.5 Rs) & n=1 secondary sub-ring
 * - Warped 3D Relativistic Accretion Disk (primary + upper & lower gravitationally lensed arches)
 * - Relativistic Doppler beaming (blazing blue-white/gold approaching, deep ember-crimson receding) & gravitational redshift
 * - Real gravitational lensing of the Milky Way & dense background starfield into curved Einstein rings
 */
export function createBlackHoleMaterial(
  schwarzschildRadius: number,
  outerRadius: number,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uBlackHoleCenter: { value: new THREE.Vector3(0, 0, 0) },
      uSchwarzschildRadius: { value: schwarzschildRadius },
      uOuterRadius: { value: outerRadius },
      uDiskNormal: { value: new THREE.Vector3(0.22, 0.97, 0.08).normalize() },
      uTime: { value: 0.0 },
      uHawkingProximity: { value: 0.0 },
      uHawkingIntensity: { value: 0.45 },
      uHawkingColorPrimary: { value: new THREE.Color('#6b5ce7') },
      uHawkingColorSecondary: { value: new THREE.Color('#c084fc') },
    },
    vertexShader: `
      varying vec3 vWorldPos;

      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uBlackHoleCenter;
      uniform float uSchwarzschildRadius;
      uniform float uOuterRadius;
      uniform vec3 uDiskNormal;
      uniform float uTime;
      uniform float uHawkingProximity;
      uniform float uHawkingIntensity;
      uniform vec3 uHawkingColorPrimary;
      uniform vec3 uHawkingColorSecondary;

      varying vec3 vWorldPos;

      float hash31(vec3 p) {
        p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.23));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float noise3(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash31(i + vec3(0,0,0)), hash31(i + vec3(1,0,0)), f.x),
              mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
              mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y),
          f.z
        );
      }

      float fbm3(vec3 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += a * noise3(p);
          p = p * 2.07 + vec3(1.7, 5.2, -3.1);
          a *= 0.5;
        }
        return v;
      }

      // Evaluate seamless Milky Way + Galactic Core + multi-layer crisp starfield along a gravitationally bent ray
      vec3 sampleLensedCosmos(vec3 d, float deflection) {
        vec3 galNormal = normalize(vec3(0.45, 0.82, -0.35));
        float planeDist = abs(dot(d, galNormal));
        float band = exp(-planeDist * 6.0);

        float cloud = fbm3(d * 4.5);
        float dustRift = smoothstep(0.36, 0.72, fbm3(d * 9.8 + vec3(3.1)));
        float coreGlow = pow(max(0.0, dot(d, normalize(vec3(-0.65, -0.22, -0.72)))), 3.6);

        vec3 deepVoid = vec3(0.008, 0.013, 0.026);
        vec3 mwCold = vec3(0.12, 0.19, 0.34);
        vec3 mwWarm = vec3(0.42, 0.29, 0.19);

        // Gravitational lensing flux magnification amplifies warped Milky Way clouds along Einstein arcs
        float einsteinMag = 1.0 + clamp(deflection * 0.95, 0.0, 1.85);
        vec3 mw = mix(mwCold, mwWarm, coreGlow * 0.75 + cloud * 0.35);
        vec3 col = deepVoid + mw * band * (0.3 + cloud * 0.9) * (1.0 - dustRift * 0.6) * (0.85 + 0.35 * einsteinMag);
        col += vec3(0.32, 0.2, 0.13) * coreGlow * band * 0.55;

        // Subtle emission nebula matching the outer skyDome
        float neb = smoothstep(0.64, 0.9, fbm3(d * 6.0 + vec3(11.4, -4.2, 2.7)));
        col += vec3(0.1, 0.16, 0.3) * neb * band * 0.65;

        // Crisp procedural background starfield (stretches into vivid curved Einstein arcs near the photon ring!)
        vec3 starGrid1 = d * 165.0;
        vec3 cell1 = floor(starGrid1);
        vec3 f1 = fract(starGrid1) - 0.5;
        float r1 = hash31(cell1);
        if (r1 > 0.935) {
          vec3 jitter = vec3(hash31(cell1 + 7.1), hash31(cell1 + 19.3), hash31(cell1 + 31.7)) - 0.5;
          float dist = length(f1 - jitter * 0.62);
          float s = smoothstep(0.21, 0.02, dist);
          float mag = pow((r1 - 0.935) / 0.065, 1.45);
          vec3 starHue = mix(vec3(0.7, 0.86, 1.0), vec3(1.0, 0.86, 0.64), hash31(cell1 + 53.0));
          // Gravitational lensing flux magnification boosts brightness along the Einstein ring!
          float lensBoost = 1.0 + pow(clamp(deflection, 0.0, 2.5), 1.25) * 2.1;
          col += starHue * s * (0.42 + mag * 1.95) * lensBoost;
        }

        // Second finer layer of dense galactic core stars
        vec3 starGrid2 = d * 310.0;
        vec3 cell2 = floor(starGrid2);
        vec3 f2 = fract(starGrid2) - 0.5;
        float r2 = hash31(cell2 + 91.0);
        if (r2 > 0.948) {
          float dist2 = length(f2);
          float s2 = smoothstep(0.24, 0.03, dist2);
          float mag2 = (r2 - 0.948) / 0.052;
          float lensBoost2 = 1.0 + clamp(deflection * 1.35, 0.0, 2.2);
          col += vec3(0.88, 0.92, 1.0) * s2 * mag2 * (0.48 + band * 0.82) * lensBoost2;
        }

        return col;
      }

      // Relativistic blackbody plasma palette with explicit blue-shift (approaching) & red-shift (receding) spectral tilt
      vec3 accretionBlackbody(float temp, float dopplerShift) {
        float t = clamp(temp, 0.0, 2.8);
        vec3 c0 = vec3(0.06, 0.008, 0.002); // Dark magnetized dust abyss
        vec3 c1 = vec3(0.78, 0.11, 0.015);  // Deep Doppler-redshifted ruby ember
        vec3 c2 = vec3(1.0, 0.44, 0.07);    // Molten solar amber-orange
        vec3 c3 = vec3(1.0, 0.86, 0.52);    // Incandescent white-gold plasma
        vec3 c4 = vec3(0.82, 0.94, 1.0);    // Relativistic blue-shifted white-blue core

        vec3 col = mix(c0, c1, smoothstep(0.0, 0.38, t));
        col = mix(col, c2, smoothstep(0.34, 0.84, t));
        col = mix(col, c3, smoothstep(0.78, 1.48, t));
        col = mix(col, c4, smoothstep(1.42, 2.35, t));

        // Explicit relativistic frequency shift: approaching plasma tints electric blue-white, receding tints deep crimson
        float blueTilt = smoothstep(1.08, 1.72, dopplerShift);
        float redTilt = smoothstep(0.95, 0.48, dopplerShift);
        col = mix(col, col * vec3(0.86, 0.96, 1.24) + vec3(0.05, 0.11, 0.22) * t * 0.25, blueTilt * 0.65);
        col = mix(col, col * vec3(1.25, 0.58, 0.26), redTilt * 0.72);
        return col;
      }

      // Sample ultra-detailed volumetric Kerr-sheared turbulent accretion disk & magnetic corona plasma
      vec4 sampleAccretionDisk(
        vec3 hitPos,
        vec3 rayVel,
        vec3 diskUp,
        vec3 diskRight,
        vec3 diskFwd,
        float heightNorm
      ) {
        float r = length(hitPos);
        const float R_INNER = 1.88;
        const float R_OUTER = 9.4;
        if (r < R_INNER || r > R_OUTER) {
          return vec4(0.0);
        }

        float u = (r - R_INNER) / (R_OUTER - R_INNER); // 0 at ISCO -> 1 at outer halo edge
        float innerEdge = smoothstep(R_INNER, R_INNER + 0.30, r);
        float outerEdge = 1.0 - smoothstep(R_OUTER - 2.9, R_OUTER, r);
        float radialProfile = innerEdge * outerEdge * pow(max(0.03, 1.0 - u), 1.14);

        // Vertical falloff for volumetric disk atmosphere (crisp dense midplane + glowing turbulent corona)
        float vertFalloff = exp(-heightNorm * heightNorm * 2.8);

        // Polar coordinates in the tilted disk plane
        float x = dot(hitPos, diskRight);
        float z = dot(hitPos, diskFwd);
        float phi = atan(z, x);

        // True Keplerian orbital angular velocity: omega(r) ~ r^(-3/2) creates dramatic differential shear!
        float omega = 1.82 / pow(r, 1.44);
        float logR = log(max(1.01, r));

        // 3 differentially sheared logarithmic spiral octaves with magnetic domain warping
        float swirl1 = phi + 6.8 / sqrt(r) - uTime * omega * 1.18;
        float swirl2 = phi * 2.0 + 12.6 / sqrt(r) - uTime * omega * 1.82;
        float swirl3 = phi * 3.0 - 9.2 * logR - uTime * omega * 0.92;

        vec3 nCoord1 = vec3(cos(swirl1) * 2.2, sin(swirl1) * 2.2, r * 2.05 - uTime * 0.20);
        float f1 = fbm3(nCoord1);

        // Domain-warped turbulent MRI (magnetorotational instability) plasma ribbons
        vec3 nCoord2 = vec3(
          cos(swirl2 + f1 * 2.4) * 3.4,
          sin(swirl2 + f1 * 2.4) * 3.4,
          r * 4.3 + f1 * 1.75 - uTime * 0.35
        );
        float f2 = fbm3(nCoord2);

        // Fine razor-sharp sheared hot streaks racing inward
        vec3 nCoord3 = vec3(cos(swirl3) * 4.8, sin(swirl3) * 4.8, r * 7.2 - uTime * 0.48);
        float f3 = noise3(nCoord3);

        // Concentric sheared plasma filaments + glowing magnetic arcs
        float shearBands = 0.5 + 0.5 * sin(r * 14.5 + f1 * 7.2 - uTime * 0.58);
        float microThreads = 0.55 + 0.45 * sin(r * 28.0 + f2 * 8.0 - swirl1 * 2.0);
        float filaments =
          smoothstep(0.12, 0.86, f1 * 0.50 + f2 * 0.35 + f3 * 0.15) *
          (0.42 + 0.58 * shearBands) *
          (0.70 + 0.48 * microThreads);

        // Dark absorbing magnetized dust veins in mid/outer disk for colossal depth & chiaroscuro contrast
        float dustRifts = mix(0.14, 1.0, smoothstep(0.20, 0.72, f2 * 0.68 + f1 * 0.32 + (1.0 - u) * 0.34));
        float density = radialProfile * vertFalloff * (0.24 + 1.82 * filaments) * dustRifts;

        // Intense glowing ISCO (Innermost Stable Circular Orbit) plasma ring + hot plunging streamers
        float iscoFlare = exp(-pow((r - 2.22) * 3.3, 2.0)) * (0.95 + 0.72 * f2) * vertFalloff;
        density += iscoFlare * 1.12;

        // Soft glowing outer plasma halo skirt (amplifies colossal scale with zero hard edges)
        float softGlowSkirt = innerEdge * (1.0 - smoothstep(4.6, R_OUTER, r)) * 0.28 * (0.62 + 0.58 * f1) * vertFalloff;

        // Relativistic Kerr Doppler beaming & gravitational redshift
        vec3 gasTangent = normalize(cross(diskUp, hitPos));
        float beta = clamp(sqrt(0.54 / max(1.10, r)), 0.0, 0.64);
        float betaProj = dot(gasTangent, -rayVel) * beta;
        float gamma = inversesqrt(max(0.12, 1.0 - beta * beta));
        float doppler = 1.0 / max(0.18, gamma * (1.0 - betaProj));
        float gravRedshift = sqrt(max(0.07, 1.0 - 1.0 / max(1.03, r)));
        float totalShift = doppler * gravRedshift;

        // Temperature & flux: approaching limb blazes blinding white-blue-gold; receding limb broods deep molten crimson
        float baseTemp =
          (1.88 * pow(max(0.09, 1.0 - u), 0.74) + iscoFlare * 0.96) *
          (0.60 + 0.72 * filaments);
        float observedTemp = baseTemp * pow(clamp(totalShift, 0.36, 2.05), 1.32);
        float beamingFlux = pow(clamp(totalShift, 0.34, 2.18), 3.25);

        vec3 plasmaCol =
          accretionBlackbody(observedTemp, totalShift) *
          (density + softGlowSkirt) *
          beamingFlux *
          2.85;
        float opacity = clamp((density + softGlowSkirt * 0.62) * (0.84 + 0.26 * iscoFlare), 0.0, 0.97);

        return vec4(plasmaCol, opacity);
      }

      // Lightweight 3D volumetric coronal plasma halo (zero fbm3 loops — runs blazingly fast!)
      vec4 sampleDiskCorona(vec3 hitPos, vec3 rayVel, vec3 diskUp, float heightNorm) {
        float r = length(hitPos);
        if (r < 1.85 || r > 9.0) return vec4(0.0);
        float u = (r - 1.85) / 7.15;
        float env = smoothstep(1.85, 2.35, r) * (1.0 - smoothstep(5.4, 9.0, r)) * pow(max(0.05, 1.0 - u), 1.35);
        float vert = exp(-heightNorm * heightNorm * 2.4);
        float swirl = atan(hitPos.z, hitPos.x) + 5.2 / sqrt(r) - uTime * (1.2 / pow(r, 1.35));
        float wisp = 0.45 + 0.55 * noise3(vec3(cos(swirl) * 2.4, sin(swirl) * 2.4, r * 1.9 - uTime * 0.25));

        vec3 gasTan = normalize(cross(diskUp, hitPos));
        float beta = clamp(sqrt(0.50 / max(1.12, r)), 0.0, 0.60);
        float doppler = 1.0 / max(0.22, inversesqrt(max(0.15, 1.0 - beta * beta)) * (1.0 - dot(gasTan, -rayVel) * beta));
        float shift = doppler * sqrt(max(0.08, 1.0 - 1.0 / max(1.04, r)));
        float temp = (1.35 * (1.0 - u * 0.72)) * pow(clamp(shift, 0.42, 1.95), 1.2);
        vec3 col = accretionBlackbody(temp, shift) * env * vert * wisp * pow(clamp(shift, 0.4, 2.0), 2.5) * 1.45;
        return vec4(col, clamp(env * vert * wisp * 0.42, 0.0, 0.65));
      }

      void main() {
        float rs = max(0.001, uSchwarzschildRadius);
        float rOuter = max(4.0, uOuterRadius / rs);

        vec3 p0 = (cameraPosition - uBlackHoleCenter) / rs;
        vec3 rd = normalize(vWorldPos - cameraPosition);

        // Intersect ray with outer gravitational lensing domain
        float bDot = dot(p0, rd);
        float cTerm = dot(p0, p0) - rOuter * rOuter;
        float disc = bDot * bDot - cTerm;
        if (disc < 0.0) {
          discard;
        }
        float sqrtDisc = sqrt(disc);
        float tNear = -bDot - sqrtDisc;
        float tFar = -bDot + sqrtDisc;
        if (tFar < 0.0) {
          discard;
        }

        float tStart = max(tNear, 0.0);
        vec3 pos = p0 + rd * tStart;
        vec3 vel = rd;

        // Orthonormal basis for the tilted relativistic accretion disk
        vec3 diskUp = normalize(uDiskNormal);
        vec3 refAxis = abs(diskUp.y) < 0.92 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 diskRight = normalize(cross(refAxis, diskUp));
        vec3 diskFwd = normalize(cross(diskUp, diskRight));

        // Conserved photon angular momentum squared h² = |x × d|²
        vec3 hVec = cross(pos, vel);
        float h2 = dot(hVec, hVec);
        float closestImpact = sqrt(h2);

        vec3 accumColor = vec3(0.0);
        float transmittance = 1.0;
        bool captured = false;
        float minR = length(pos);
        float diskCrossings = 0.0;
        float totalAngleTurn = 0.0;

        // 68 adaptive symplectic steps integrating Kerr-inspired null geodesic:
        // Schwarzschild radial gravity (-1.5 * h² * x / r⁵) + subtle Kerr Lense-Thirring frame-dragging spin!
        const int MAX_STEPS = 68;
        for (int i = 0; i < MAX_STEPS; i++) {
          float r = length(pos);
          minR = min(minR, r);

          // Swallowed by the Event Horizon (r <= Rs): absolute pitch-black abyss!
          if (r <= 1.02) {
            captured = true;
            break;
          }

          // Escaped lensing domain after passing closest approach
          if (r > rOuter * 1.03 && dot(pos, vel) > 0.0) {
            break;
          }

          // Tighter adaptive step size near the photon sphere (1.5 Rs) to resolve n=1 & n=2 photon sub-rings cleanly
          float stepDt = clamp(r * 0.112, 0.036, 0.68);

          vec3 prevPos = pos;
          vec3 prevVel = vel;
          float yPrev = dot(prevPos, diskUp);

          float invR = 1.0 / r;
          float invR3 = invR * invR * invR;
          float invR5 = invR3 * invR * invR;
          // Kerr frame-dragging swirl shifts the shadow & photon ring subtly toward the prograde limb
          vec3 frameDrag = cross(diskUp, pos) * (0.22 * invR3 * invR);
          vec3 accel = -1.5 * h2 * pos * invR5 + frameDrag;

          // Symplectic velocity-position integration
          vec3 midVel = normalize(vel + accel * (0.5 * stepDt));
          pos = prevPos + midVel * stepDt;

          float rNext = length(pos);
          float invRn = 1.0 / max(0.5, rNext);
          float invRn3 = invRn * invRn * invRn;
          float invRn5 = invRn3 * invRn * invRn;
          vec3 frameDragNext = cross(diskUp, pos) * (0.22 * invRn3 * invRn);
          vec3 accelNext = -1.5 * h2 * pos * invRn5 + frameDragNext;
          vel = normalize(vel + 0.5 * (accel + accelNext) * stepDt);

          totalAngleTurn += length(vel - prevVel);

          float yCurr = dot(pos, diskUp);

          // Fast analytic upper/lower coronal envelope crossings (+0.26 / -0.26 Rs) for monumental 3D disk thickness
          float coronaH = 0.24;
          if ((yPrev - coronaH) * (yCurr - coronaH) <= 0.0 && transmittance > 0.04) {
            float fc = clamp(abs(yPrev - coronaH) / max(1e-5, abs(yPrev - yCurr)), 0.0, 1.0);
            vec4 cSample = sampleDiskCorona(mix(prevPos, pos, fc), vel, diskUp, 0.58);
            accumColor += cSample.rgb * 0.45 * transmittance;
            transmittance *= (1.0 - cSample.a * 0.36);
          }
          if ((yPrev + coronaH) * (yCurr + coronaH) <= 0.0 && transmittance > 0.04) {
            float fc = clamp(abs(yPrev + coronaH) / max(1e-5, abs(yPrev - yCurr)), 0.0, 1.0);
            vec4 cSample = sampleDiskCorona(mix(prevPos, pos, fc), vel, diskUp, 0.58);
            accumColor += cSample.rgb * 0.45 * transmittance;
            transmittance *= (1.0 - cSample.a * 0.36);
          }

          // Exact analytic equatorial accretion disk crossing (primary + lensed upper/lower Gargantua arches + n=1/n=2 wraps!)
          if (yPrev * yCurr <= 0.0) {
            float frac = clamp(abs(yPrev) / max(1e-5, abs(yPrev) + abs(yCurr)), 0.0, 1.0);
            vec3 hitPos = mix(prevPos, pos, frac);
            vec4 diskSample = sampleAccretionDisk(hitPos, vel, diskUp, diskRight, diskFwd, 0.0);
            if (diskSample.a > 0.001) {
              // Secondary gravitational-lensed arches glow intensely over & under the Event Horizon shadow
              float wrapBoost = diskCrossings > 0.5 ? 1.38 : 1.0;
              accumColor += diskSample.rgb * wrapBoost * transmittance;
              transmittance *= (1.0 - diskSample.a * 0.86);
              diskCrossings += 1.0;
              if (transmittance < 0.012) {
                transmittance = 0.012;
              }
            }
          }
        }

        // Compute background cosmos:
        // - If captured by the Event Horizon: ABSOLUTE #000000 PITCH-BLACK VOID (zero interior artifacts!)
        // - If escaped: knife-edge n=1/n=2 Photon Sphere rings + Einstein-ring gravitational lensing bloom + Hawking seam
        vec3 bgColor = vec3(0.0);
        if (!captured) {
          vec3 bentDir = normalize(vel);
          float deflection = acos(clamp(dot(rd, bentDir), -1.0, 1.0));
          bgColor = sampleLensedCosmos(bentDir, deflection);

          // Razor-sharp n=1 primary + n=2 inner relativistic photon sub-ring hugging the shadow boundary
          float photonRazor = exp(-max(0.0, minR - 1.49) * 34.0);
          float photonTight = exp(-max(0.0, minR - 1.50) * 16.0);
          float photonBloom = exp(-max(0.0, minR - 1.50) * 2.8);
          float multiOrbitBoost = smoothstep(2.2, 4.6, totalAngleTurn) * 0.85;

          vec3 ringTangent = normalize(cross(diskUp, normalize(pos)));
          float ringDot = clamp(dot(ringTangent, -rd), -0.9, 1.0);
          float ringBeam = 0.62 + 0.78 * max(-0.45, ringDot);
          vec3 razorHue = mix(vec3(1.0, 0.86, 0.58), vec3(0.90, 0.97, 1.0), smoothstep(0.05, 0.8, ringDot));
          vec3 tightHue = mix(vec3(1.0, 0.68, 0.28), vec3(0.88, 0.95, 1.0), smoothstep(0.15, 0.85, ringDot));
          vec3 bloomHue = mix(vec3(0.95, 0.26, 0.05), vec3(1.0, 0.66, 0.26), smoothstep(-0.5, 0.65, ringDot));

          vec3 photonCol =
            razorHue * (photonRazor * 3.1 + multiOrbitBoost * photonTight * 1.4) * ringBeam +
            tightHue * photonTight * 2.15 * ringBeam +
            bloomHue * photonBloom * 0.58 * ringBeam;

          // Luminous Einstein-ring starlight refraction arc wrapping the gravitational well
          float einsteinArc = exp(-pow((minR - 1.88) * 1.5, 2.0)) * clamp(deflection * 0.48, 0.0, 1.0);

          // Subtle haunting relativistic polar magnetic corona wisps above/below the spin poles
          float polarAlign = pow(abs(dot(normalize(pos), diskUp)), 5.0);
          float polarGlow = polarAlign * exp(-max(0.0, minR - 1.65) * 1.15) * (0.28 + 0.22 * noise3(pos * 1.8 + vec3(0.0, uTime * 0.35, 0.0)));
          vec3 polarCol = vec3(0.32, 0.56, 0.95) * polarGlow * 0.36;

          // Hawking Radiation: delicate quantum vacuum fluctuation seam & escaping pair-creation sparks hugging the event horizon rim
          vec3 rimDir = normalize(pos);
          float hFlow = uTime * (1.25 + uHawkingProximity * 2.2);
          float qFieldA = noise3(rimDir * 13.0 - rimDir * hFlow * 0.45 + vec3(0.0, hFlow * 0.2, 0.0));
          float qFieldB = noise3(rimDir * 28.0 + vec3(hFlow * 0.38, -hFlow * 0.3, hFlow * 0.24));
          float qSpark = pow(clamp(qFieldA * 0.6 + qFieldB * 0.6, 0.0, 1.0), 3.4);
          float hawkingSeam = exp(-max(0.0, minR - 1.50) * 14.0);
          float hawkingCorona = exp(-max(0.0, minR - 1.50) * 3.8);
          vec3 hawkingHue = mix(uHawkingColorPrimary, uHawkingColorSecondary, smoothstep(0.24, 0.84, qFieldB));
          vec3 hawkingVeil =
            hawkingHue *
            (hawkingSeam * (0.36 + qSpark * 1.55) + hawkingCorona * (0.048 + qSpark * 0.42)) *
            uHawkingIntensity *
            (0.75 + uHawkingProximity * 0.72);

          accumColor += (photonCol + vec3(0.76, 0.88, 1.0) * einsteinArc * 0.34 + polarCol + hawkingVeil) * transmittance;

          // Deepen void contrast right outside the photon sphere for stark, colossal abyssal depth
          float abyssContrast = smoothstep(1.5, 3.2, minR);
          bgColor *= mix(0.20, 1.0, abyssContrast);
        }

        vec3 rawFinal = accumColor + bgColor * transmittance;

        // Filmic ACES-inspired tone compression preserving pure #000000 Event Horizon & blazing high-intensity plasma
        vec3 mapped = (rawFinal * (2.51 * rawFinal + 0.03)) / (rawFinal * (2.43 * rawFinal + 0.59) + 0.14);
        mapped = clamp(mapped, 0.0, 1.0);

        // Seamless outer lensing blend so there is ZERO visible bounding sphere edge in space!
        float distCam = length(p0);
        float facingBlackHole = distCam < rOuter * 0.99
          ? smoothstep(-0.35, 0.3, dot(normalize(-p0), rd))
          : 1.0;
        float radialLensMask = smoothstep(rOuter * 0.96, rOuter * 0.54, closestImpact) * facingBlackHole;
        float emissionLum = max(accumColor.r, max(accumColor.g, accumColor.b));
        float diskAlpha = clamp(1.0 - transmittance + emissionLum * 1.45, 0.0, 1.0);

        float alpha = captured ? 1.0 : clamp(max(radialLensMask, diskAlpha), 0.0, 1.0);
        if (alpha < 0.004) {
          discard;
        }

        gl_FragColor = vec4(mapped, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
    toneMapped: false,
  });
}

/**
 * Deterministic procedural BufferGeometry for GPU-animated Hawking radiation quantum particles
 * emerging around a black hole event horizon. Stores unit-sphere directions so floating-origin
 * scale transforms work seamlessly at any distance.
 */
export function createHawkingRadiationGeometry(
  schwarzschildRadius: number,
  count = 960,
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const params = new Float32Array(count * 4); // (phase, speed, radialReach, energyTier)
  const tangents = new Float32Array(count * 3);

  // Deterministic golden-angle Fibonacci sphere + seeded jitter for uniform 360-deg horizon coverage
  let seed = 133791;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const yBase = 1 - 2 * t;
    const rBase = Math.sqrt(Math.max(0, 1 - yBase * yBase));
    const theta = goldenAngle * i + (nextRand() - 0.5) * 0.35;
    const x = Math.cos(theta) * rBase;
    const z = Math.sin(theta) * rBase;
    const y = yBase;

    const i3 = i * 3;
    positions[i3] = x;
    positions[i3 + 1] = y;
    positions[i3 + 2] = z;

    // Orthogonal tangent axis for subtle Kerr frame-dragging swirl as particles escape
    const tx = -z;
    const ty = (nextRand() - 0.5) * 0.55;
    const tz = x;
    const tLen = Math.hypot(tx, ty, tz) || 1;
    tangents[i3] = tx / tLen;
    tangents[i3 + 1] = ty / tLen;
    tangents[i3 + 2] = tz / tLen;

    const i4 = i * 4;
    params[i4] = nextRand(); // lifecycle phase 0..1
    params[i4 + 1] = 0.65 + nextRand() * 0.95; // escape speed multiplier
    params[i4 + 2] = 0.55 + nextRand() * 1.45; // radial escape reach multiplier
    params[i4 + 3] = Math.pow(nextRand(), 1.35); // quantum energy tier (rarer ultra-high-energy gamma sparks)
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aParams', new THREE.BufferAttribute(params, 4));
  geo.setAttribute('aTangent', new THREE.BufferAttribute(tangents, 3));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), schwarzschildRadius * 7.5);
  return geo;
}

/**
 * GPU-Animated Hawking Radiation Particle Emission Shader.
 * Simulates high-energy virtual particle-antiparticle pair separation right outside the black hole's
 * gravitationally lensed Event Horizon silhouette (~2.598 Rs). Particles emerge organically along the
 * horizon boundary, curve subtly under Kerr frame-dragging, and shift spectral color & emission flux
 * dynamically based on camera proximity (deep violet-indigo far -> electric cyan mid -> Cherenkov
 * ultraviolet-white up close), while keeping the Event Horizon shadow interior 100% pure black.
 */
export function createHawkingRadiationMaterial(
  schwarzschildRadius: number,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uBlackHoleCenter: { value: new THREE.Vector3(0, 0, 0) },
      uSchwarzschildRadius: { value: schwarzschildRadius },
      uDiskNormal: { value: new THREE.Vector3(0.22, 0.97, 0.08).normalize() },
      uTime: { value: 0.0 },
      uPixelRatio: { value: 1.0 },
      uHawkingProximity: { value: 0.0 },
      uHawkingIntensity: { value: 0.45 },
      uEmissionSpeed: { value: 0.85 },
      uHawkingColorPrimary: { value: new THREE.Color('#6b5ce7') },
      uHawkingColorSecondary: { value: new THREE.Color('#c084fc') },
    },
    vertexShader: `
      attribute vec4 aParams;
      attribute vec3 aTangent;

      uniform vec3 uBlackHoleCenter;
      uniform float uSchwarzschildRadius;
      uniform vec3 uDiskNormal;
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uHawkingProximity;
      uniform float uHawkingIntensity;
      uniform float uEmissionSpeed;

      varying float vLife;
      varying float vEnergy;
      varying float vAlpha;
      varying float vTwinkle;

      void main() {
        float rs = max(0.001, uSchwarzschildRadius);
        float phase = aParams.x;
        float speedMult = aParams.y;
        float reachMult = aParams.z;
        float energyTier = aParams.w;

        // Continuous repeating quantum emission lifecycle 0 -> 1
        float life = fract(phase + uTime * 0.14 * speedMult * uEmissionSpeed);
        float easeOut = 1.0 - pow(1.0 - life, 2.25);

        // Spawn right along the true apparent lensed Event Horizon silhouette (~3.86 Rs) and radiate outward
        vec3 baseDir = normalize(position);
        vec3 spinSwirl = normalize(cross(normalize(uDiskNormal), baseDir) + aTangent * 0.35);

        // Subtle Kerr frame-dragging curl + high-frequency quantum jitter near birth
        float swirlAngle = life * (0.22 + 0.2 * energyTier) + sin(uTime * 1.5 + phase * 37.0) * 0.03;
        vec3 emitDir = normalize(baseDir + spinSwirl * swirlAngle);

        float rRs = 3.88 + easeOut * (1.05 + reachMult * (1.15 + uHawkingProximity * 0.75));
        vec3 localOffset = emitDir * (rRs * rs);
        vec3 worldPos = uBlackHoleCenter + localOffset;

        // Exact perspective sightline impact parameter relative to the Event Horizon shadow (~3.82 Rs):
        // Guarantees 0 particles ever drift inside the #000000 Event Horizon void at ANY camera distance!
        vec3 camToCenter = uBlackHoleCenter - cameraPosition;
        float camDist = length(camToCenter);
        float camDistRs = max(4.05, camDist / rs);
        vec3 viewFwd = camToCenter / max(0.001, camDist);
        float depthAlongView = dot(localOffset, viewFwd);

        vec3 camToParticle = worldPos - cameraPosition;
        vec3 rayDirP = normalize(camToParticle);
        float rayImpactRs = length(cross(camToCenter, rayDirP)) / rs;

        // Apparent shadow boundary of our geodesic ray-marcher is ~3.82 Rs
        const float SHADOW_RIM_RS = 3.86;
        float shadowVisibility = 1.0;

        if (rayImpactRs < SHADOW_RIM_RS) {
          if (depthAlongView > 0.0) {
            // Far hemisphere behind the black hole: cleanly occluded by the Event Horizon shadow
            shadowVisibility = 0.0;
          } else {
            // Front hemisphere quantum: gravitationally lensed onto the exact tangent horizon limb!
            vec3 perpVec = localOffset - viewFwd * depthAlongView;
            float perpLen = length(perpVec);
            vec3 radialOut = perpLen > 0.001 ? (perpVec / perpLen) : normalize(cross(viewFwd, vec3(0.0, 1.0, 0.0)));

            // Exact perspective trigonometry so tangent-plane placement achieves targetImpactRs identically at all distances
            float targetImpactRs = SHADOW_RIM_RS + 0.06 + easeOut * (0.95 + reachMult * 0.85);
            float sinLimb = clamp(targetImpactRs / camDistRs, 0.0, 0.94);
            float tangentPlaneRs = targetImpactRs / sqrt(max(0.1, 1.0 - sinLimb * sinLimb));

            localOffset = radialOut * (tangentPlaneRs * rs);
            worldPos = uBlackHoleCenter + localOffset;
          }
        }

        // Airtight final perspective shadow guard: strictly zero interior particles inside the black void
        vec3 finalRayDir = normalize(worldPos - cameraPosition);
        float finalImpactRs = length(cross(camToCenter, finalRayDir)) / rs;
        shadowVisibility *= smoothstep(3.80, 3.96, finalImpactRs);

        vec4 mvPos = viewMatrix * vec4(worldPos, 1.0);
        gl_Position = projectionMatrix * mvPos;

        // Smooth virtual-pair emergence and dissipation envelope
        float fadeIn = smoothstep(0.0, 0.14, life);
        float fadeOut = 1.0 - smoothstep(0.42, 1.0, life);
        float twinkle = 0.65 + 0.35 * sin(uTime * (6.0 + energyTier * 8.5) + phase * 91.7);

        // Fade softly if camera is extremely far (> 22 Rs) so distant stars stay clean
        float distFade = 1.0 - smoothstep(20.0, 34.0, camDistRs);

        vLife = life;
        vEnergy = clamp(energyTier * 0.74 + (1.0 - life) * 0.36 + uHawkingProximity * 0.24, 0.0, 1.0);
        vTwinkle = twinkle;
        vAlpha = fadeIn * fadeOut * shadowVisibility * distFade * (0.58 + energyTier * 0.62) * uHawkingIntensity;

        // Perspective-scaled subtle pinpoint size (crisp high-energy sparks, never huge blobs)
        float basePx = mix(3.4, 8.6, energyTier) * (0.9 + uHawkingProximity * 0.45) * (1.0 - life * 0.35);
        float persp = clamp((rs * 9.0) / max(1.0, -mvPos.z), 0.55, 2.2);
        gl_PointSize = clamp(basePx * persp * uPixelRatio, 2.4, 17.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uHawkingColorPrimary;
      uniform vec3 uHawkingColorSecondary;
      uniform float uHawkingProximity;

      varying float vLife;
      varying float vEnergy;
      varying float vAlpha;
      varying float vTwinkle;

      void main() {
        if (vAlpha <= 0.004) {
          discard;
        }

        vec2 p = gl_PointCoord - 0.5;
        float d2 = dot(p, p);
        if (d2 > 0.25) {
          discard;
        }

        // Sharp incandescent quantum core + soft optical corona
        float core = exp(-d2 * 40.0);
        float halo = exp(-d2 * 9.5) * 0.62;

        // Delicate high-energy Cherenkov cross-diffraction glint for top-tier quanta
        float glintMask = smoothstep(0.5, 0.9, vEnergy);
        float crossSpike = (exp(-abs(p.x) * 24.0) * exp(-abs(p.y) * 7.0) + exp(-abs(p.y) * 24.0) * exp(-abs(p.x) * 7.0)) * 0.36 * glintMask;

        float shape = (core + halo + crossSpike) * vTwinkle;

        // Spectral shift driven by camera proximity + hot core birth flash
        vec3 baseCol = mix(uHawkingColorPrimary, uHawkingColorSecondary, smoothstep(0.16, 0.86, vEnergy));
        vec3 hotCore = mix(baseCol, vec3(0.95, 0.99, 1.0), core * (0.35 + uHawkingProximity * 0.5));

        // Slight gravitational redshift cooling as the particle escapes farther from the horizon
        vec3 col = mix(hotCore, baseCol * 0.9, vLife * 0.42);
        float finalAlpha = clamp(shape * vAlpha, 0.0, 0.96);
        if (finalAlpha < 0.004) {
          discard;
        }

        gl_FragColor = vec4(col * shape * vAlpha * 2.05, finalAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

/**
 * High-dynamic-range multi-magnitude deep-space starfield shader with realistic Airy-disc pinpoint cores,
 * spectral O/B/A/F/G/K/M star tints, and subtle atmospheric scintillation when viewed through planetary air.
 */
export function createDeepStarfieldMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0.95 },
      uPixelRatio: { value: 1.0 },
      uTime: { value: 0.0 },
      uTwinkleAmount: { value: 0.0 },
    },
    vertexShader: `
      attribute float aSize;
      attribute float aPhase;

      uniform float uPixelRatio;
      uniform float uTime;
      uniform float uTwinkleAmount;

      varying vec3 vColor;
      varying float vTwinkle;
      varying float vBright;

      void main() {
        vColor = color;
        vBright = clamp((aSize - 1.2) / 3.2, 0.0, 1.0);
        float scint = 1.0 - uTwinkleAmount * 0.28 + uTwinkleAmount * 0.28 * sin(uTime * (3.2 + aPhase * 5.0) + aPhase * 62.83);
        vTwinkle = scint;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(aSize * uPixelRatio, 1.15, 6.5);
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vTwinkle;
      varying float vBright;

      void main() {
        if (uOpacity <= 0.005) discard;
        vec2 p = gl_PointCoord - 0.5;
        float d2 = dot(p, p);
        if (d2 > 0.25) discard;

        // Crisp astronomical pinpoint core + soft optical Airy halo for 1st/2nd magnitude giants
        float core = exp(-d2 * 36.0);
        float halo = exp(-d2 * 10.5) * (0.28 + vBright * 0.42);
        float crossGlint = (exp(-abs(p.x) * 26.0) * exp(-abs(p.y) * 8.0) + exp(-abs(p.y) * 26.0) * exp(-abs(p.x) * 8.0)) * 0.22 * vBright;
        float shape = (core + halo + crossGlint) * vTwinkle;
        vec3 col = mix(vColor, vec3(1.0), core * 0.45);
        gl_FragColor = vec4(col * shape, clamp(shape * uOpacity, 0.0, 1.0));
      }
    `,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

/**
 * Multi-layer hypersonic ionized atmospheric re-entry bow-shock plasma & turbulent wake shader.
 * Adapts spectral ionization colors to each planet's atmospheric chemistry (N2/O2, CO2, CH4).
 */
export function createEntryShockMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uIntensity: { value: 0.0 },
      uTime: { value: 0.0 },
      uColorHot: { value: new THREE.Color('#fff6e0') },
      uColorPlasma: { value: new THREE.Color('#ff6c1e') },
      uColorIon: { value: new THREE.Color('#c852ff') },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uIntensity;
      varying vec2 vUv;
      varying vec3 vNormalDir;
      varying vec3 vViewDir;

      void main() {
        vUv = uv;
        // Subtle high-frequency hypersonic bow-shock membrane flutter
        vec3 displaced = position;
        float flutter = sin(uv.x * 24.0 + uTime * 34.0) * sin(uv.y * 14.0 - uTime * 28.0);
        displaced += normal * flutter * 0.045 * uIntensity * (1.0 - uv.y);

        vNormalDir = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
        vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float uIntensity;
      uniform float uTime;
      uniform vec3 uColorHot;
      uniform vec3 uColorPlasma;
      uniform vec3 uColorIon;

      varying vec2 vUv;
      varying vec3 vNormalDir;
      varying vec3 vViewDir;

      void main() {
        if (uIntensity <= 0.01) discard;
        // Domain-warped Kelvin-Helmholtz plasma shock ribbons streaming aft from the stagnation nose
        float warp = sin(vUv.x * 18.0 + uTime * 19.0) * 0.35 + cos(vUv.y * 22.0 - uTime * 31.0) * 0.25;
        float streakA = 0.5 + 0.5 * sin(vUv.x * 42.0 + warp * 4.5 + uTime * 22.0);
        float streakB = 0.5 + 0.5 * sin(vUv.x * 86.0 - warp * 6.0 - uTime * 32.0);
        float shockRipple = 0.72 + 0.28 * sin(vUv.y * 28.0 - uTime * 42.0 + streakA * 3.0);

        // vUv.y = 1 at nose tip -> 0 at trailing skirt
        float noseZone = smoothstep(0.45, 0.98, vUv.y);
        float skirtFade = smoothstep(0.0, 0.38, vUv.y) * (1.0 - smoothstep(0.95, 1.0, vUv.y) * 0.08);
        float wakeZone = smoothstep(0.60, 0.08, vUv.y);
        float fresnel = pow(1.0 - abs(dot(normalize(vNormalDir), normalize(vViewDir))), 1.85);

        // Fierce fiery rim plasma bow-shock — crisp blazing edge & nose, semi-clear center so Voyager silhouette reads cleanly!
        float streakEnergy = pow(clamp(streakA * 0.58 + streakB * 0.42, 0.0, 1.0), 1.35);
        float plasmaBody =
          (0.18 + 0.88 * streakEnergy) *
          shockRipple *
          skirtFade *
          (0.18 + 1.15 * fresnel + noseZone * 0.92);

        // Three-stage thermal re-entry spectrum: incandescent white-gold nose -> solar orange shock -> fiery ember wake
        vec3 col = mix(uColorIon, uColorPlasma, smoothstep(0.08, 0.54, vUv.y));
        col = mix(col, uColorHot, clamp(noseZone * 0.95 + streakB * 0.32 * (1.0 - wakeZone), 0.0, 1.0));
        col += uColorPlasma * fresnel * 0.45;

        float alpha = clamp(plasmaBody * uIntensity * 0.94, 0.0, 0.92);
        if (alpha < 0.005) discard;
        gl_FragColor = vec4(col * (1.35 + noseZone * 1.15), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

/**
 * Animated reflective planetary ocean / methane sea / glacial lake shader
 * for the dedicated Planetary Surface Walking Environment.
 */
export function createPlanetaryWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
      uSunDir: { value: new THREE.Vector3(0.6, 0.5, 0.4).normalize() },
      uSunColor: { value: new THREE.Color('#fff4dc') },
      uSkyColor: { value: new THREE.Color('#4a8fd6') },
      uDeepColor: { value: new THREE.Color('#072342') },
      uShallowColor: { value: new THREE.Color('#145a78') },
      uFogColor: { value: new THREE.Color('#5a92cf') },
      uFogDensity: { value: 0.0045 },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      varying vec3 vLocalPos;
      varying float vCamDist;

      void main() {
        vLocalPos = position;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vec4 mvPos = viewMatrix * worldPos;
        vCamDist = -mvPos.z;
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uSkyColor;
      uniform vec3 uDeepColor;
      uniform vec3 uShallowColor;
      uniform vec3 uFogColor;
      uniform float uFogDensity;

      varying vec3 vWorldPos;
      varying vec3 vLocalPos;
      varying float vCamDist;

      void main() {
        vec2 p = vLocalPos.xz;
        float t = uTime * 1.15;

        // Multi-directional capillary wind wave normals
        float w1 = sin(p.x * 0.42 + p.y * 0.28 + t * 1.4) * 0.5 + cos(p.x * 0.19 - p.y * 0.51 + t * 0.9) * 0.5;
        float w2 = sin(p.x * 1.35 - p.y * 1.12 - t * 2.1) * 0.5 + cos(p.x * 1.82 + p.y * 1.48 + t * 1.7) * 0.5;
        vec3 n = normalize(vec3(w1 * 0.055 + w2 * 0.025, 1.0, (w1 - w2) * 0.048));

        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        vec3 sunDir = normalize(uSunDir);

        // Schlick Fresnel sky reflection
        float ndotv = clamp(dot(n, viewDir), 0.0, 1.0);
        float fresnel = 0.04 + 0.92 * pow(1.0 - ndotv, 4.2);

        float dayLit = clamp(sunDir.y * 2.4 + 0.35, 0.14, 1.0);
        vec3 waterBase = mix(uDeepColor, uShallowColor, clamp(0.35 + w1 * 0.25, 0.0, 1.0)) * dayLit;
        vec3 skyRefl = uSkyColor * (0.45 + 0.65 * dayLit);
        vec3 col = mix(waterBase, skyRefl, fresnel);

        // Crisp sun specular glitter path across wind-rippled water
        vec3 halfVec = normalize(sunDir + viewDir);
        float specTight = pow(max(0.0, dot(n, halfVec)), 190.0) * 1.85;
        float specBroad = pow(max(0.0, dot(n, halfVec)), 28.0) * 0.28;
        col += uSunColor * (specTight + specBroad) * smoothstep(-0.04, 0.14, sunDir.y);

        // Exponential aerial perspective horizon fog matching the planetary sky
        float fogFactor = 1.0 - exp(-pow(vCamDist * uFogDensity, 2.0));
        col = mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0));

        // Gentle circular edge fade far at horizon
        float radial = length(p);
        float edgeAlpha = 1.0 - smoothstep(145.0, 185.0, radial);
        gl_FragColor = vec4(col, 0.92 * edgeAlpha);
      }
    `,
    transparent: true,
    depthWrite: true,
  });
}

/**
 * Overhead drifting volumetric-style procedural cloud canopy for walking on atmospheric worlds
 * (Earth, Venus, Titan, Mars dust clouds, temperate exoplanets).
 */
export function createCloudCanopyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
      uSunDir: { value: new THREE.Vector3(0.6, 0.5, 0.4).normalize() },
      uSunColor: { value: new THREE.Color('#fff4dc') },
      uCloudColor: { value: new THREE.Color('#eef5ff') },
      uShadowColor: { value: new THREE.Color('#5a7598') },
      uCoverage: { value: 0.48 },
      uOpacity: { value: 0.82 },
    },
    vertexShader: `
      varying vec3 vLocalPos;
      void main() {
        vLocalPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uCloudColor;
      uniform vec3 uShadowColor;
      uniform float uCoverage;
      uniform float uOpacity;

      varying vec3 vLocalPos;

      float hash21(vec2 p) {
        p = fract(p * vec2(127.1, 311.7));
        p += dot(p, p + 34.23);
        return fract(p.x * p.y);
      }

      float noise2(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
          mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }

      float fbm2(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += a * noise2(p);
          p = p * 2.08 + vec2(3.7, -2.4);
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec2 p = vLocalPos.xz;
        float dist = length(p);
        float horizonFade = 1.0 - smoothstep(130.0, 290.0, dist);
        if (horizonFade <= 0.005) discard;

        vec2 wind = vec2(uTime * 0.012, uTime * 0.006);
        float c1 = fbm2(p * 0.012 + wind);
        float c2 = fbm2(p * 0.028 - wind * 1.4 + vec2(c1 * 1.4));
        float density = smoothstep(1.0 - uCoverage, 1.0 - uCoverage + 0.34, c1 * 0.62 + c2 * 0.45);
        if (density < 0.01) discard;

        // Sun forward-scattering silver lining + warm twilight tinting
        vec3 sunDir = normalize(uSunDir);
        float dayLit = smoothstep(-0.18, 0.35, sunDir.y);
        float twilight = exp(-pow((sunDir.y + 0.02) * 3.8, 2.0));
        vec3 litCol = mix(uCloudColor, vec3(1.0, 0.62, 0.34), twilight * 0.78) * (0.18 + 0.92 * dayLit);
        vec3 darkCol = uShadowColor * (0.15 + 0.85 * dayLit);
        vec3 col = mix(darkCol, litCol, smoothstep(0.15, 0.82, c2));

        // Silver-lining highlight toward sun direction
        vec3 dirToCloud = normalize(vLocalPos);
        float sunAlign = pow(max(0.0, dot(dirToCloud, sunDir)), 7.0);
        col += uSunColor * sunAlign * 0.48 * (1.0 - density * 0.45) * dayLit;

        gl_FragColor = vec4(col, clamp(density * horizonFade * uOpacity, 0.0, 0.88));
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Photorealistic Night-Side Planetary City Lights Shader (Earth).
 * Renders crisp golden urban filaments strictly on the dark night hemisphere (`dot(N, sunDir) < 0.08`)
 * so city lights vanish cleanly in daylight and sparkle across the pitch-black night side!
 */
export function createNightLightsMaterial(nightTex: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uNightMap: { value: nightTex },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uIntensity: { value: 1.35 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      void main() {
        vUv = uv;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uNightMap;
      uniform vec3 uSunDir;
      uniform float uIntensity;
      varying vec2 vUv;
      varying vec3 vWorldNormal;

      void main() {
        vec3 n = normalize(vWorldNormal);
        float ndotl = dot(n, normalize(uSunDir));
        // Fade city lights cleanly strictly inside the pitch-black night hemisphere
        float nightMask = smoothstep(-0.02, -0.24, ndotl);
        if (nightMask < 0.005) discard;

        vec3 lights = texture2D(uNightMap, vUv).rgb;
        float strength = max(lights.r, max(lights.g, lights.b));
        if (strength < 0.02) discard;

        vec3 col = lights * vec3(1.12, 0.88, 0.52) * (uIntensity * 1.28) * nightMask;
        gl_FragColor = vec4(col, clamp(strength * nightMask, 0.0, 1.0));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/**
 * 3D Volumetric Cloud-Deck Penetration Veil rendered around Voyager while punching through
 * a planet's stratospheric/tropospheric cloud layer during atmospheric descent or ascent,
 * seamlessly bridging orbital curvature flight and the 1:1 human-scale planetary biome!
 */
export function createCloudDeckVeilMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
      uDensity: { value: 0.0 },
      uCloudColor: { value: new THREE.Color('#dce8f8') },
      uSunColor: { value: new THREE.Color('#fff2dc') },
      uSunDir: { value: new THREE.Vector3(0.7, 0.5, 0.3).normalize() },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uDensity;
      uniform vec3 uCloudColor;
      uniform vec3 uSunColor;
      uniform vec3 uSunDir;
      varying vec3 vDir;

      float hash31(vec3 p) {
        p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.23));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      float noise3(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x),
              mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
              mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y),
          f.z
        );
      }

      void main() {
        if (uDensity <= 0.005) discard;
        vec3 d = normalize(vDir);
        vec3 drift = vec3(uTime * 0.38, -uTime * 0.62, uTime * 0.24);
        float n1 = noise3(d * 3.8 + drift);
        float n2 = noise3(d * 8.2 - drift * 1.4 + vec3(n1 * 1.3));
        float wisp = smoothstep(0.18, 0.88, n1 * 0.6 + n2 * 0.48);

        float sunAlign = pow(max(0.0, dot(d, normalize(uSunDir))), 4.0);
        vec3 col = mix(uCloudColor * 0.68, uCloudColor * 1.05, n2);
        col += uSunColor * sunAlign * 0.42;

        float alpha = clamp(uDensity * (0.42 + wisp * 0.58), 0.0, 0.86);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
  });
}



