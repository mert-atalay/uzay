import * as THREE from 'three';
import type { StarLensFlareState } from './lensFlareMath';

export interface StarLensFlareOverlay {
  mesh: THREE.Mesh;
  update: (params: {
    state: StarLensFlareState;
    starColorHex: string;
    aspect: number;
    cameraRollRad: number;
    time: number;
  }) => void;
  dispose: () => void;
}

/**
 * Physically-inspired full-screen optical cinema Star Lens Flare Shader Overlay.
 * Renders crisp 6-point aperture diffraction spikes, subtle anamorphic horizontal streak,
 * chromatic multi-element optical ghost rings & hexagonal irises mirrored along the optical axis,
 * and grazing-eclipse diamond-ring flashes — reacting continuously to camera angle & obscuration.
 */
export function createStarLensFlareOverlay(): StarLensFlareOverlay {
  const geo = new THREE.PlaneGeometry(2, 2);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uStarNdc: { value: new THREE.Vector2(0, 0) },
      uStarColor: { value: new THREE.Color('#fff1d4') },
      uIntensity: { value: 0.0 },
      uVisibility: { value: 0.0 },
      uDiamondRing: { value: 0.0 },
      uAspect: { value: 16 / 9 },
      uRoll: { value: 0.0 },
      uTime: { value: 0.0 },
    },
    vertexShader: `
      varying vec2 vNdc;
      void main() {
        vNdc = position.xy;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec2 uStarNdc;
      uniform vec3 uStarColor;
      uniform float uIntensity;
      uniform float uVisibility;
      uniform float uDiamondRing;
      uniform float uAspect;
      uniform float uRoll;
      uniform float uTime;

      varying vec2 vNdc;

      // Soft hexagonal aperture bokeh shape
      float hexDist(vec2 p) {
        p = abs(p);
        return max(dot(p, normalize(vec2(1.0, 1.73205))), p.x);
      }

      // Chromatic optical lens ghost ring / aperture iris
      vec3 lensGhost(vec2 uv, vec2 center, float radius, float ringWeight, vec3 tint) {
        vec2 d = uv - center;
        float r = length(d);
        float h = hexDist(d);
        float disc = smoothstep(radius, radius * 0.52, h) * (1.0 - ringWeight * 0.65);
        float rim = exp(-pow((r - radius * 0.88) / max(0.008, radius * 0.18), 2.0)) * ringWeight;
        // Subtle RGB chromatic dispersion across ghost perimeter
        float rShift = exp(-pow((r - radius * 0.93) / max(0.008, radius * 0.16), 2.0)) * ringWeight;
        float bShift = exp(-pow((r - radius * 0.82) / max(0.008, radius * 0.16), 2.0)) * ringWeight;
        vec3 col = tint * (disc * 0.35 + rim * 0.55);
        col.r += tint.r * rShift * 0.32;
        col.b += tint.b * bShift * 0.36;
        return col;
      }

      void main() {
        if (uIntensity <= 0.003) {
          discard;
        }

        // Aspect-corrected screen coordinates
        vec2 uv = vec2(vNdc.x * uAspect, vNdc.y);
        vec2 starPos = vec2(uStarNdc.x * uAspect, uStarNdc.y);
        vec2 d = uv - starPos;
        float dist = length(d);

        // 1. Core solar aureole & soft atmospheric/optical corona bloom
        float coreGlow = exp(-dist * 10.5) * 0.62 + exp(-dist * 3.1) * 0.24;
        float wideVeil = exp(-dist * 1.15) * 0.095;

        // 2. 6-point hexagonal aperture diffraction starburst rotating with camera angle
        float ang = atan(d.y, d.x) + uRoll * 0.65;
        float spike6 = pow(abs(cos(ang * 3.0)), 32.0);
        float spike12 = pow(abs(cos(ang * 6.0 + 0.52)), 46.0) * 0.48;
        float radialFall = exp(-dist * 3.0) * (1.0 - smoothstep(0.0, 0.024, dist) * 0.18);
        float starburst = (spike6 + spike12) * radialFall * (0.68 + uDiamondRing * 1.05);

        // 3. Cinematic horizontal anamorphic optical streak
        float streakY = exp(-abs(d.y) * 52.0);
        float streakX = exp(-abs(d.x) * 1.45);
        float anamorphic = streakY * streakX * (0.42 + uDiamondRing * 0.52);
        vec3 streakTint = mix(uStarColor, vec3(0.58, 0.84, 1.0), 0.48);

        // 4. Chromatic multi-element lens ghosts projected along the optical axis through screen center
        vec2 axis = -starPos;
        vec3 ghosts = vec3(0.0);
        float edgeReact = 0.72 + 0.48 * clamp(length(uStarNdc), 0.0, 1.15);

        ghosts += lensGhost(uv, starPos + axis * 0.48, 0.068, 0.68, mix(uStarColor, vec3(0.45, 0.78, 1.0), 0.55)) * 0.36;
        ghosts += lensGhost(uv, starPos + axis * 0.85, 0.038, 0.38, mix(uStarColor, vec3(1.0, 0.78, 0.45), 0.45)) * 0.42;
        ghosts += lensGhost(uv, starPos + axis * 1.28, 0.128, 0.86, vec3(0.38, 0.76, 1.0)) * 0.30;
        ghosts += lensGhost(uv, starPos + axis * 1.62, 0.055, 0.44, vec3(0.95, 0.58, 0.74)) * 0.32;
        ghosts += lensGhost(uv, starPos + axis * 2.08, 0.18, 0.92, vec3(0.55, 0.85, 0.98)) * 0.26;

        // 5. Large rainbow-fringed optical halo ring around star when viewing close to axis
        float haloRing = exp(-pow((dist - 0.36) / 0.055, 2.0)) * 0.085;
        vec3 haloCol = vec3(
          exp(-pow((dist - 0.38) / 0.045, 2.0)),
          exp(-pow((dist - 0.36) / 0.045, 2.0)),
          exp(-pow((dist - 0.34) / 0.045, 2.0))
        ) * 0.075 * uVisibility;

        // 6. Grazing planetary eclipse Diamond-Ring coronal flash!
        float diamondFlash = exp(-dist * 14.0) * uDiamondRing * 0.95;

        // Subtle high-frequency scintillation shimmer
        float shimmer = 0.96 + 0.04 * sin(uTime * 3.8 + dist * 12.0);

        vec3 flare =
          uStarColor * (coreGlow + wideVeil + starburst + diamondFlash) +
          streakTint * anamorphic +
          ghosts * edgeReact * uVisibility +
          haloCol +
          uStarColor * haloRing;

        flare *= uIntensity * shimmer;

        // Gentle filmic shoulder so flare never clips harshly into ugly flat squares
        flare = flare / (vec3(1.0) + flare * 0.45);
        float lum = max(flare.r, max(flare.g, flare.b));
        if (lum < 0.002) {
          discard;
        }

        gl_FragColor = vec4(flare, clamp(lum, 0.0, 0.92));
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 25;
  mesh.visible = false;

  const update: StarLensFlareOverlay['update'] = ({
    state,
    starColorHex,
    aspect,
    cameraRollRad,
    time,
  }) => {
    mesh.visible = state.visible;
    if (!state.visible) return;
    mat.uniforms.uStarNdc.value.set(state.ndcX, state.ndcY);
    mat.uniforms.uStarColor.value.set(starColorHex);
    mat.uniforms.uIntensity.value = state.intensity;
    mat.uniforms.uVisibility.value = state.visibility;
    mat.uniforms.uDiamondRing.value = state.diamondRing;
    mat.uniforms.uAspect.value = aspect;
    mat.uniforms.uRoll.value = cameraRollRad;
    mat.uniforms.uTime.value = time;
  };

  const dispose = () => {
    geo.dispose();
    mat.dispose();
  };

  return { mesh, update, dispose };
}
