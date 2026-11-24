import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  computeAtmosphericEntryState,
  getEntryPlasmaPalette,
  getPlanetRayleighParams,
} from './atmosphereMath';
import { CosmicAudioEngine } from './audio';
import {
  computeBlackHoleRelativity,
  computeHawkingRadiationProfile,
} from './blackHoleMath';
import {
  pollActiveBrowserGamepad,
  processGamepadState,
  triggerGamepadHaptics,
  type GamepadFlightInput,
} from './gamepad';
import { computeHorizonProximityIndicator } from './horizonIndicatorMath';
import { createStarLensFlareOverlay, type StarLensFlareOverlay } from './lensFlare';
import { computeStarLensFlareState, type StarOccluderSphere } from './lensFlareMath';
import {
  classifyFlightRegime,
  computeAutoFlightSpeed,
  computeBodyWorldPosition,
  computeWarpStep,
  distance3d,
  formatDistance,
  formatSpeed,
  sampleKeplerianOrbitPath,
  sampleProceduralTerrainHeight,
  sampleSurfaceBiomeHeight,
} from './physics';
import {
  createAtmosphereMaterial,
  createBlackHoleMaterial,
  createCloudDeckVeilMaterial,
  createDeepStarfieldMaterial,
  createEntryShockMaterial,
  createHawkingRadiationGeometry,
  createHawkingRadiationMaterial,
  createMilkyWayBackdropMaterial,
  createNightLightsMaterial,
  createScanWaveMaterial,
  createStarSurfaceMaterial,
} from './shaders';
import { createLocalSurfacePatch, type LocalSurfacePatch } from './surfaceTerrain';
import { createTesseractRealm, type TesseractRealm } from './tesseract';
import {
  computePlungeDynamics,
  findNearestMemoryAnchor,
  TESSERACT_MEMORY_ANCHORS,
  type TesseractStage,
} from './tesseractMath';
import {
  generatePlanetTextures,
  generateRingTexture,
  getStarGlowTexture,
} from './textures';
import type {
  CameraMode,
  CelestialBodyDef,
  FlightRegime,
  GamePhase,
  ScreenMarker,
  TelemetrySnapshot,
  Vec3d,
} from './types';
import {
  BODY_BY_ID,
  CELESTIAL_BODIES,
  LY_UNITS,
  STAR_SYSTEMS,
  SYSTEM_BY_ID,
  getBodiesInSystem,
} from './universeData';
import { createVoyagerCharacter, type VoyagerRig } from './voyager';

interface BodyRenderNode {
  def: CelestialBodyDef;
  group: THREE.Group;
  surfaceMesh: THREE.Mesh;
  nightLightsMesh?: THREE.Mesh;
  nightLightsMat?: THREE.ShaderMaterial;
  cloudMesh?: THREE.Mesh;
  atmoMesh?: THREE.Mesh;
  atmoMat?: THREE.ShaderMaterial;
  starMat?: THREE.ShaderMaterial;
  blackHoleMat?: THREE.ShaderMaterial;
  hawkingPoints?: THREE.Points;
  hawkingMat?: THREE.ShaderMaterial;
  coronaSprite?: THREE.Sprite;
  ringMesh?: THREE.Mesh;
  worldPos: Vec3d;
  prevWorldPos: Vec3d;
}

interface SystemBeaconNode {
  systemId: string;
  name: string;
  color: string;
  position: Vec3d;
  sprite: THREE.Sprite;
}

const NEAR_SPACE_LIMIT = 38_000;
const FAR_SHELL_START = 38_000;
const FAR_SHELL_SPAN = 22_000;

export interface EngineUiCallbacks {
  onStart?: () => void;
  onTogglePause?: () => void;
  onToggleStarMap?: () => void;
  onToggleDock?: () => void;
  onCloseModals?: () => void;
}

export class SpaceEngine {
  private container: HTMLElement;
  private onTelemetry: (snap: TelemetrySnapshot) => void;
  private uiCallbacks: EngineUiCallbacks;

  private isSoftwareGl: boolean;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private maxAnisotropy: number;

  private audio = new CosmicAudioEngine();
  private voyager: VoyagerRig;
  private localSurface: LocalSurfacePatch;

  // Dynamic lighting
  private starKeyLight: THREE.DirectionalLight;
  private hemiFillLight: THREE.HemisphereLight;
  private voyagerEnvMap: THREE.Texture | null = null;
  private skyDomeMat: THREE.ShaderMaterial;
  private skyDome: THREE.Mesh;
  private starfieldMat!: THREE.ShaderMaterial;
  private starfieldPoints: THREE.Points;
  private localParallaxMat!: THREE.ShaderMaterial;
  private localParallaxPoints!: THREE.Points;

  // Dynamic optical Star Lens Flare (camera-angle & planetary-obscuration reactive)
  private lensFlare: StarLensFlareOverlay;
  private readonly flareOccluders: StarOccluderSphere[] = [];

  // Atmospheric Re-entry Ionized Plasma Shock Cone, Cloud-Deck Penetration Veil & 3D Thermal Sparks
  private entryShockMat: THREE.ShaderMaterial;
  private entryShockMesh: THREE.Mesh;
  private cloudVeilMat: THREE.ShaderMaterial;
  private cloudVeilMesh: THREE.Mesh;
  private entryStreaksLines: THREE.LineSegments;
  private entryStreaksBase: Float32Array;
  private entryStreaksPos: Float32Array;
  private entryStreaksMat: THREE.LineBasicMaterial;

  // Relativistic warp streaks
  private warpStreakLines: THREE.LineSegments;
  private warpStreakBase: Float32Array;
  private warpStreakPos: Float32Array;
  private warpStreakMat: THREE.LineBasicMaterial;

  // Cosmic scan wave
  private scanWaveMesh: THREE.Mesh;
  private scanWaveMat: THREE.ShaderMaterial;
  private scanWaveProgress = 1.0;

  // Active star system entities
  private activeSystemId = 'sol';
  private systemGroup = new THREE.Group();
  private bodyNodes: BodyRenderNode[] = [];
  private orbitLinesGroup = new THREE.Group();
  private asteroidBeltMesh: THREE.InstancedMesh | null = null;
  private systemBeacons: SystemBeaconNode[] = [];

  // Simulation state (64-bit floating origin + Keplerian simulation clock)
  private phase: GamePhase = 'title';
  private cameraMode: CameraMode = 'third-person';
  private simTime = 0;
  private orbitTimeScale = 1;
  private realTime = 0;
  private playerPos: Vec3d = { x: 0, y: 0, z: 0 };
  private playerVelocity = new THREE.Vector3();
  private currentSpeed = 0;
  private speedBiasLevel = 0;
  private distanceTraveledUnits = 0;

  // Camera & Voyager orientation
  private yaw = 0;
  private pitch = 0;
  private targetYaw = 0;
  private targetPitch = 0;
  private currentFov = 60;
  private cameraShakeTrauma = 0;
  private voyagerScale = 0.23;
  private lastHapticPulseTime = 0;
  private blackHoleTimeDilation = 1.0;
  private blackHoleProximity = 0.0;
  private blackHoleHorizonWarning = false;
  private blackHolePointOfNoReturn = false;
  private blackHoleLastDist: number | null = null;
  private blackHoleLastRadius: number | null = null;

  // Dedicated Event Horizon Plunge & 5D Tesseract state (lazy-initialized on entry)
  private tesseractStage: TesseractStage = 'outside';
  private plungeElapsed = 0;
  private plungeBeatStage = 0;
  private tesseractRealm: TesseractRealm | null = null;
  private tesseractBulkPos = new THREE.Vector3();
  private tesseractBulkVel = new THREE.Vector3();
  private tesseractPulseProgress = 1.0;
  private decodedTesseractAnchors = new Set<string>();

  // Surface walking & landing state (1:1 human-meter local biome coordinates)
  private isLanded = false;
  private landedBodyId: string | null = null;
  private surfaceUp = new THREE.Vector3(0, 1, 0);
  private surfaceWalkX = 0;
  private surfaceWalkZ = 0;
  private surfaceVerticalVel = 0;
  private surfaceAltOffset = 0;
  private walkDistance = 0;
  private landingSquash = 0;
  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private autoLandingBodyId: string | null = null;

  // Auto-warp state
  private warpTargetBodyId: string | null = null;
  private warpTargetSystemId: string | null = null;
  private warpEtaSec = 0;

  // Discovery tracking
  private discoveredIds = new Set<string>(['earth']);
  private landedIds = new Set<string>();
  private scanMessage: { title: string; detail: string; id: number } | null = null;
  private scanMsgCounter = 0;
  private scanMsgTimer = 0;

  // Input hub (held vs edge-triggered)
  private keysHeld = new Set<string>();
  private isDraggingLook = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private pointerLocked = false;
  private showMarkers = true;
  private gamepadPrevButtons: boolean[] = [];
  private gamepadInput: GamepadFlightInput = processGamepadState(null, []).input;
  private wasGamepadConnected = false;

  // Loop management
  private frameId = 0;
  private lastFrameMs = 0;
  private lastTelemetryMs = 0;
  private disposed = false;

  // Pre-allocated scratch math helpers (zero GC inside render loop)
  private readonly _v1 = new THREE.Vector3();
  private readonly _v2 = new THREE.Vector3();
  private readonly _v3 = new THREE.Vector3();
  private readonly _sunDirScratch = new THREE.Vector3();
  private readonly _forward = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();
  private readonly _up = new THREE.Vector3();
  private readonly _camQuat = new THREE.Quaternion();
  private readonly _bodyQuat = new THREE.Quaternion();
  private readonly _alignQuat = new THREE.Quaternion();
  private readonly _invQuat = new THREE.Quaternion();
  private readonly _shakeQuat = new THREE.Quaternion();
  private readonly _euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly _shakeEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly _projVec = new THREE.Vector3();
  private readonly _skyTargetCol = new THREE.Color();
  private readonly _fogCol = new THREE.Color('#02040a');

  constructor(
    container: HTMLElement,
    onTelemetry: (snap: TelemetrySnapshot) => void,
    uiCallbacks: EngineUiCallbacks = {},
  ) {
    this.container = container;
    this.onTelemetry = onTelemetry;
    this.uiCallbacks = uiCallbacks;

    // Detect software WebGL (SwiftShader / llvmpipe / WARP) from GPU renderer string
    this.isSoftwareGl = (() => {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2),
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const rect = container.getBoundingClientRect();
    const w = Math.max(1, rect.width || window.innerWidth);
    const h = Math.max(1, rect.height || window.innerHeight);
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this.maxAnisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy() || 1);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#000103');

    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.12, 95_000);

    // Keep scene.environment null so planets, moons & clouds never pick up white studio-box ambient light
    // (Three.js r163+ overrides material.envMapIntensity with scene.environmentIntensity = 1.0 when scene.environment is set!).
    // Generate a scoped PMREM reflection map strictly for Voyager's metallic gold visor & titanium thrusters.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.voyagerEnvMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // Stark photorealistic directional sunlight + near-zero deep-space vacuum fill (creates pitch-black night sides!)
    this.starKeyLight = new THREE.DirectionalLight('#fff5e4', 3.55);
    this.starKeyLight.position.set(-100, 30, 80);
    if (!this.isSoftwareGl) {
      this.starKeyLight.castShadow = true;
      this.starKeyLight.shadow.mapSize.set(1024, 1024);
      this.starKeyLight.shadow.bias = -0.0005;
      this.starKeyLight.shadow.normalBias = 0.02;
      this.starKeyLight.shadow.camera.left = -28;
      this.starKeyLight.shadow.camera.right = 28;
      this.starKeyLight.shadow.camera.top = 28;
      this.starKeyLight.shadow.camera.bottom = -28;
      this.starKeyLight.shadow.camera.near = 1;
      this.starKeyLight.shadow.camera.far = 260;
    }
    this.scene.add(this.starKeyLight);

    this.hemiFillLight = new THREE.HemisphereLight('#3b5582', '#06080f', 0.045);
    this.scene.add(this.hemiFillLight);

    // 1. Milky Way, Distant Astrophotography Nebulae & Rayleigh Sky Vault
    this.skyDomeMat = createMilkyWayBackdropMaterial();
    this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(74_000, 40, 28), this.skyDomeMat);
    this.skyDome.frustumCulled = false;
    this.scene.add(this.skyDome);

    // 2. Deep-Space Multi-Magnitude Spectral Starfield (5,200 pinpoint stars + bright glints)
    this.starfieldPoints = this.createDeepStarfield(5_200);
    this.scene.add(this.starfieldPoints);

    // 2b. 3D Parallax Local Cosmic Dust & Micro-Star Shell (tangible depth motion through space)
    this.localParallaxPoints = this.createLocalParallaxField(560);
    this.scene.add(this.localParallaxPoints);

    // 3. Interstellar Known Star System 3D Parallax Beacons
    this.createInterstellarBeacons();

    // 3b. Dynamic Optical Star Lens Flare Overlay (camera-angle & planetary-obscuration reactive)
    this.lensFlare = createStarLensFlareOverlay();
    this.scene.add(this.lensFlare.mesh);

    // 3c. Ionized Atmospheric Re-Entry Bow-Shock Plasma Cone & 3D Thermal Sparks
    this.entryShockMat = createEntryShockMaterial();
    const shockGeo = new THREE.SphereGeometry(1.65, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.54);
    shockGeo.rotateX(-Math.PI * 0.5);
    shockGeo.scale(0.86, 0.86, 1.58);
    this.entryShockMesh = new THREE.Mesh(shockGeo, this.entryShockMat);
    this.entryShockMesh.visible = false;
    this.entryShockMesh.renderOrder = 8;
    this.scene.add(this.entryShockMesh);

    // 3d. Volumetric 3D Cloud-Deck Penetration Veil (bridges orbital descent smoothly into 1:1 planetary biome)
    this.cloudVeilMat = createCloudDeckVeilMaterial();
    this.cloudVeilMesh = new THREE.Mesh(new THREE.SphereGeometry(22, 20, 14), this.cloudVeilMat);
    this.cloudVeilMesh.visible = false;
    this.cloudVeilMesh.frustumCulled = false;
    this.cloudVeilMesh.renderOrder = 7;
    this.scene.add(this.cloudVeilMesh);

    const entryStreakCount = 180;
    this.entryStreaksBase = new Float32Array(entryStreakCount * 3);
    this.entryStreaksPos = new Float32Array(entryStreakCount * 6);
    for (let i = 0; i < entryStreakCount; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 0.65 + Math.pow(Math.random(), 0.72) * 14.5;
      this.entryStreaksBase[i * 3] = Math.cos(ang) * rad;
      this.entryStreaksBase[i * 3 + 1] = Math.sin(ang) * rad;
      this.entryStreaksBase[i * 3 + 2] = (Math.random() - 0.5) * 34;
    }
    const entryStreakGeo = new THREE.BufferGeometry();
    entryStreakGeo.setAttribute('position', new THREE.BufferAttribute(this.entryStreaksPos, 3));
    this.entryStreaksMat = new THREE.LineBasicMaterial({
      color: 0xffb86c,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.entryStreaksLines = new THREE.LineSegments(entryStreakGeo, this.entryStreaksMat);
    this.entryStreaksLines.frustumCulled = false;
    this.entryStreaksLines.visible = false;
    this.entryStreaksLines.renderOrder = 9;
    this.scene.add(this.entryStreaksLines);

    // 4. Relativistic Warp Streak Lines (220 pooled lines)
    const streakCount = 220;
    this.warpStreakBase = new Float32Array(streakCount * 3);
    this.warpStreakPos = new Float32Array(streakCount * 6);
    for (let i = 0; i < streakCount; i++) {
      const r = 10 + Math.random() * 58;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      this.warpStreakBase[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      this.warpStreakBase[i * 3 + 1] = r * Math.cos(phi);
      this.warpStreakBase[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const streakGeo = new THREE.BufferGeometry();
    streakGeo.setAttribute('position', new THREE.BufferAttribute(this.warpStreakPos, 3));
    this.warpStreakMat = new THREE.LineBasicMaterial({
      color: 0xa6dcff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.warpStreakLines = new THREE.LineSegments(streakGeo, this.warpStreakMat);
    this.warpStreakLines.frustumCulled = false;
    this.scene.add(this.warpStreakLines);

    // 5. Cosmic Scan Pulse Wave
    this.scanWaveMat = createScanWaveMaterial();
    this.scanWaveMesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 2),
      this.scanWaveMat,
    );
    this.scanWaveMesh.visible = false;
    this.scene.add(this.scanWaveMesh);

    // 6. Active Star System Container & Dual-Mode Local Planetary Surface System
    this.scene.add(this.systemGroup);
    this.scene.add(this.orbitLinesGroup);
    this.localSurface = createLocalSurfacePatch(this.maxAnisotropy);
    this.scene.add(this.localSurface.group);

    // 7. Composite 10-part Cosmic Voyager Character (apply scoped metallic/visor envMap only here)
    this.voyager = createVoyagerCharacter();
    if (this.voyagerEnvMap) {
      this.voyager.root.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
          obj.material.envMap = this.voyagerEnvMap;
          obj.material.envMapIntensity = obj.material.metalness > 0.5 ? 0.85 : 0.25;
          obj.material.needsUpdate = true;
        }
      });
    }
    this.scene.add(this.voyager.root);

    // Build our Solar System immediately and spawn in sunlit Earth-Moon orbital vista
    this.buildStarSystem('sol');
    this.spawnAtEarthOrbit();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.bindEvents();
    this.lastFrameMs = performance.now();
    this.emitTelemetry(true);
    this.scheduleNextFrame();
  }

  private createDeepStarfield(count: number): THREE.Points {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);

    // Realistic O/B/A/F/G/K/M Planckian blackbody star tint palette
    const palette = [
      new THREE.Color('#9ec5ff'),
      new THREE.Color('#cce0ff'),
      new THREE.Color('#f7f8ff'),
      new THREE.Color('#fff1d6'),
      new THREE.Color('#ffd39e'),
      new THREE.Color('#ffad75'),
    ];
    let seed = 4219;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let i = 0; i < count; i++) {
      // Concentrate 44% of stars gently toward the tilted galactic plane for authentic Milky Way depth
      const u = rand() * 2 - 1;
      const theta = rand() * Math.PI * 2;
      const r = 62_000 + rand() * 5_500;
      const sq = Math.sqrt(Math.max(0, 1 - u * u));
      let x = sq * Math.cos(theta);
      let y = u;
      let z = sq * Math.sin(theta);

      if (i < count * 0.44) {
        y *= 0.22;
        const len = Math.sqrt(x * x + y * y + z * z) || 1;
        x /= len;
        y /= len;
        z /= len;
        const ty = y * Math.cos(0.95) - z * Math.sin(0.95);
        const tz = y * Math.sin(0.95) + z * Math.cos(0.95);
        y = ty;
        z = tz;
      }

      positions[i * 3] = x * r;
      positions[i * 3 + 1] = y * r;
      positions[i * 3 + 2] = z * r;

      const c = palette[Math.floor(rand() * palette.length)];
      // Realistic astronomical apparent magnitude power-law distribution
      const magRoll = rand();
      const brightness =
        magRoll > 0.965
          ? 0.95 + rand() * 0.25
          : 0.24 + Math.pow(rand(), 2.2) * 0.68;
      colors[i * 3] = c.r * brightness;
      colors[i * 3 + 1] = c.g * brightness;
      colors[i * 3 + 2] = c.b * brightness;

      sizes[i] =
        magRoll > 0.985
          ? 3.8 + rand() * 2.2
          : magRoll > 0.92
            ? 2.2 + rand() * 1.4
            : 1.05 + rand() * 1.05;
      phases[i] = rand() * Math.PI * 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    this.starfieldMat = createDeepStarfieldMaterial();
    const pts = new THREE.Points(geo, this.starfieldMat);
    pts.frustumCulled = false;
    return pts;
  }

  private createLocalParallaxField(count: number): THREE.Points {
    const span = 1600;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 2);
    let seed = 88421;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (rand() - 0.5) * span;
      positions[i * 3 + 1] = (rand() - 0.5) * span;
      positions[i * 3 + 2] = (rand() - 0.5) * span;
      seeds[i * 2] = 0.7 + rand() * 1.6;
      seeds[i * 2 + 1] = rand();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 2));

    this.localParallaxMat = new THREE.ShaderMaterial({
      uniforms: {
        uPlayerMod: { value: new THREE.Vector3() },
        uOpacity: { value: 0.48 },
        uPixelRatio: { value: 1 },
      },
      vertexShader: `
        attribute vec2 aSeed;
        uniform vec3 uPlayerMod;
        uniform float uPixelRatio;
        varying float vAlpha;
        varying float vTint;
        void main() {
          float span = 1600.0;
          vec3 p = mod(position - uPlayerMod + span * 0.5, span) - span * 0.5;
          vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
          float dist = max(6.0, -mvPos.z);
          float nearFade = smoothstep(14.0, 75.0, dist);
          float farFade = 1.0 - smoothstep(460.0, 780.0, dist);
          vAlpha = nearFade * farFade;
          vTint = aSeed.y;
          gl_PointSize = clamp((aSeed.x * 165.0 / dist) * uPixelRatio, 1.0, 4.2);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform float uOpacity;
        varying float vAlpha;
        varying float vTint;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
          float core = exp(-d * d * 5.2);
          float a = core * vAlpha * uOpacity;
          if (a < 0.01) discard;
          vec3 col = mix(vec3(0.72, 0.84, 1.0), vec3(1.0, 0.88, 0.72), vTint);
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const pts = new THREE.Points(geo, this.localParallaxMat);
    pts.frustumCulled = false;
    return pts;
  }

  private createInterstellarBeacons(): void {
    const glowTex = getStarGlowTexture();
    for (const sys of STAR_SYSTEMS) {
      const mat = new THREE.SpriteMaterial({
        map: glowTex,
        color: new THREE.Color(sys.beaconColor),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.95,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.frustumCulled = false;
      this.scene.add(sprite);
      this.systemBeacons.push({
        systemId: sys.id,
        name: sys.name,
        color: sys.beaconColor,
        position: sys.position,
        sprite,
      });
    }
  }

  private clearActiveSystemMeshes(): void {
    for (const node of this.bodyNodes) {
      this.systemGroup.remove(node.group);
      node.surfaceMesh.geometry.dispose();
      if (!Array.isArray(node.surfaceMesh.material)) {
        node.surfaceMesh.material.dispose();
      }
      if (node.nightLightsMesh) {
        node.nightLightsMesh.geometry.dispose();
        node.nightLightsMat?.dispose();
      }
      if (node.cloudMesh) {
        node.cloudMesh.geometry.dispose();
        (node.cloudMesh.material as THREE.Material).dispose();
      }
      if (node.atmoMesh) {
        node.atmoMesh.geometry.dispose();
        node.atmoMat?.dispose();
      }
      if (node.ringMesh) {
        node.ringMesh.geometry.dispose();
        (node.ringMesh.material as THREE.Material).dispose();
      }
      if (node.coronaSprite) {
        (node.coronaSprite.material as THREE.Material).dispose();
      }
      if (node.hawkingPoints) {
        node.hawkingPoints.geometry.dispose();
        node.hawkingMat?.dispose();
      }
    }
    this.bodyNodes = [];

    while (this.orbitLinesGroup.children.length > 0) {
      const child = this.orbitLinesGroup.children[0] as THREE.Line;
      this.orbitLinesGroup.remove(child);
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }

    if (this.asteroidBeltMesh) {
      this.systemGroup.remove(this.asteroidBeltMesh);
      this.asteroidBeltMesh.geometry.dispose();
      (this.asteroidBeltMesh.material as THREE.Material).dispose();
      this.asteroidBeltMesh = null;
    }
  }

  private buildStarSystem(systemId: string): void {
    this.clearActiveSystemMeshes();
    this.activeSystemId = systemId;

    const bodies = getBodiesInSystem(systemId);
    const glowTex = getStarGlowTexture();

    for (const def of bodies) {
      const group = new THREE.Group();
      group.rotation.z = THREE.MathUtils.degToRad(def.axialTiltDeg);

      let surfaceMesh: THREE.Mesh;
      let nightLightsMesh: THREE.Mesh | undefined;
      let nightLightsMat: THREE.ShaderMaterial | undefined;
      let cloudMesh: THREE.Mesh | undefined;
      let atmoMesh: THREE.Mesh | undefined;
      let atmoMat: THREE.ShaderMaterial | undefined;
      let starMat: THREE.ShaderMaterial | undefined;
      let blackHoleMat: THREE.ShaderMaterial | undefined;
      let hawkingPoints: THREE.Points | undefined;
      let hawkingMat: THREE.ShaderMaterial | undefined;
      let coronaSprite: THREE.Sprite | undefined;
      let ringMesh: THREE.Mesh | undefined;

      if (def.kind === 'black-hole') {
        const outerRadius = def.radius * 11.5;
        const bhGeo = new THREE.SphereGeometry(outerRadius, 48, 36);
        blackHoleMat = createBlackHoleMaterial(def.radius, outerRadius);
        surfaceMesh = new THREE.Mesh(bhGeo, blackHoleMat);
        surfaceMesh.renderOrder = 4;
        surfaceMesh.frustumCulled = false;
        group.add(surfaceMesh);

        const hawkingGeo = createHawkingRadiationGeometry(def.radius, 1200);
        hawkingMat = createHawkingRadiationMaterial(def.radius);
        hawkingPoints = new THREE.Points(hawkingGeo, hawkingMat);
        hawkingPoints.renderOrder = 5;
        hawkingPoints.frustumCulled = false;
        group.add(hawkingPoints);
      } else if (def.kind === 'star') {
        const starGeo = new THREE.SphereGeometry(def.radius, 36, 28);
        starMat = createStarSurfaceMaterial(
          def.palette[0],
          def.palette[1],
          def.palette[2],
          def.seed,
        );
        surfaceMesh = new THREE.Mesh(starGeo, starMat);
        // Vega is famously oblate due to rapid spin
        if (def.id === 'vega-star') {
          surfaceMesh.scale.set(1.14, 0.92, 1.14);
        }
        group.add(surfaceMesh);

        const coronaMat = new THREE.SpriteMaterial({
          map: glowTex,
          color: new THREE.Color(def.starColor || def.palette[1]),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0.92,
        });
        coronaSprite = new THREE.Sprite(coronaMat);
        const coronaScale = def.radius * 5.2;
        coronaSprite.scale.set(coronaScale, coronaScale, 1);
        group.add(coronaSprite);
      } else {
        const segs = def.radius > 55 ? 48 : 32;
        const sphereGeo = new THREE.SphereGeometry(def.radius, segs, Math.round(segs * 0.75));
        // Slight asteroid potato deformation for Phobos / Deimos
        if (def.archetype === 'asteroid') {
          const pos = sphereGeo.attributes.position;
          for (let i = 0; i < pos.count; i++) {
            const vx = pos.getX(i);
            const vy = pos.getY(i);
            const vz = pos.getZ(i);
            const lumpy =
              1 +
              0.14 * Math.sin(vx * 0.35 + def.seed) * Math.cos(vy * 0.42) +
              0.08 * Math.cos(vz * 0.55);
            pos.setXYZ(i, vx * lumpy * 1.16, vy * lumpy * 0.86, vz * lumpy);
          }
          sphereGeo.computeVertexNormals();
        }

        const textures = generatePlanetTextures(def, this.maxAnisotropy);
        const mat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          map: textures.albedo,
          bumpMap: textures.bump,
          bumpScale: def.kind === 'planet' && !def.landable ? 0.15 : def.radius * 0.014,
          roughnessMap: textures.roughness,
          roughness: 1.0,
          metalness: 0.04,
          envMapIntensity: 0.0, // Zero studio-box reflection on oceans; pure directional starlight + pitch-black night sides!
        });

        surfaceMesh = new THREE.Mesh(sphereGeo, mat);
        surfaceMesh.receiveShadow = true;
        group.add(surfaceMesh);

        // Photorealistic night-hemisphere-only city lights (Earth)
        if (textures.nightLights) {
          const nightGeo = new THREE.SphereGeometry(def.radius * 1.0025, segs, Math.round(segs * 0.75));
          nightLightsMat = createNightLightsMaterial(textures.nightLights);
          nightLightsMesh = new THREE.Mesh(nightGeo, nightLightsMat);
          nightLightsMesh.renderOrder = 1;
          group.add(nightLightsMesh);
        }

        // Drifting cloud deck for Earth & habitable exoplanets (crisp sunlit whites, dark night shadows!)
        if (textures.clouds) {
          const cloudGeo = new THREE.SphereGeometry(def.radius * 1.012, segs, Math.round(segs * 0.75));
          const cloudMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: textures.clouds,
            transparent: true,
            opacity: 0.9,
            roughness: 0.92,
            metalness: 0.0,
            envMapIntensity: 0.0,
            depthWrite: false,
          });
          cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
          cloudMesh.renderOrder = 2;
          group.add(cloudMesh);
        }

        // Physically-based Ray-Marched Rayleigh & Mie Atmospheric Scattering Shell
        if (def.atmosphere && def.atmosphere.density > 0.01) {
          const atmoRadius = def.radius * (1 + Math.max(0.085, def.atmosphere.heightRatio * 1.45));
          const atmoGeo = new THREE.SphereGeometry(atmoRadius, 40, 30);
          const rayleigh = getPlanetRayleighParams(def);
          atmoMat = createAtmosphereMaterial({
            planetRadius: def.radius,
            atmoRadius,
            betaRayleigh: rayleigh.betaRayleigh,
            betaMie: rayleigh.betaMie,
            mieG: rayleigh.mieG,
            scaleHeightRatio: rayleigh.scaleHeightRatio,
            refractiveDispersion: rayleigh.refractiveDispersion,
            intensity: rayleigh.intensity,
          });
          atmoMesh = new THREE.Mesh(atmoGeo, atmoMat);
          atmoMesh.renderOrder = 3;
          atmoMesh.frustumCulled = false;
          group.add(atmoMesh);
        }

        // Planetary Ring System (Saturn, Uranus, Chiron, AEgir)
        if (def.rings) {
          const innerR = def.radius * def.rings.innerRatio;
          const outerR = def.radius * def.rings.outerRatio;
          const ringGeo = new THREE.RingGeometry(innerR, outerR, 96, 1);
          // Remap RingGeometry UVs radially (u = 0 at innerR -> 1 at outerR)
          const rPos = ringGeo.attributes.position;
          const rUv = ringGeo.attributes.uv;
          for (let i = 0; i < rPos.count; i++) {
            const x = rPos.getX(i);
            const y = rPos.getY(i);
            const dist = Math.sqrt(x * x + y * y);
            const u = (dist - innerR) / Math.max(1e-4, outerR - innerR);
            rUv.setXY(i, u, 0.5);
          }
          const ringTex = generateRingTexture(def.rings, def.seed, this.maxAnisotropy);
          const ringMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: ringTex,
            transparent: true,
            side: THREE.DoubleSide,
            roughness: 0.72,
            metalness: 0.05,
            envMapIntensity: 0.06,
            depthWrite: false,
          });
          ringMesh = new THREE.Mesh(ringGeo, ringMat);
          ringMesh.rotation.x = Math.PI / 2;
          ringMesh.renderOrder = 4;
          group.add(ringMesh);
        }
      }

      // Exact 3D Keplerian elliptical orbit path indicator around the parent star/black hole
      if (def.parentId && def.kind !== 'moon' && def.orbitRadius > 0) {
        const sampled = sampleKeplerianOrbitPath(def, 160);
        const pts = sampled.map((p) => new THREE.Vector3(p.x, p.y, p.z));
        const orbitGeo = new THREE.BufferGeometry().setFromPoints(pts);
        const isEccentricHighlight = (def.orbitEccentricity ?? 0) > 0.22;
        const orbitMat = new THREE.LineBasicMaterial({
          color: isEccentricHighlight ? 0x6ea8e5 : 0x4b6a94,
          transparent: true,
          opacity: isEccentricHighlight ? 0.28 : 0.17,
          depthWrite: false,
        });
        const orbitLine = new THREE.Line(orbitGeo, orbitMat);
        orbitLine.userData.parentId = def.parentId;
        this.orbitLinesGroup.add(orbitLine);
      }

      const initialPos = computeBodyWorldPosition(def, this.simTime);
      this.systemGroup.add(group);
      this.bodyNodes.push({
        def,
        group,
        surfaceMesh,
        nightLightsMesh,
        nightLightsMat,
        cloudMesh,
        atmoMesh,
        atmoMat,
        starMat,
        blackHoleMat,
        hawkingPoints,
        hawkingMat,
        coronaSprite,
        ringMesh,
        worldPos: initialPos,
        prevWorldPos: { ...initialPos },
      });
    }

    // Add instanced Main Asteroid Belt for Sol (and Debris Belt for Epsilon Eridani / Vega)
    if (systemId === 'sol' || systemId === 'epsilon-eridani' || systemId === 'vega') {
      const beltCount = 300;
      const innerR = systemId === 'sol' ? 13_640 : systemId === 'vega' ? 9_680 : 10_560;
      const outerR = systemId === 'sol' ? 16_720 : systemId === 'vega' ? 14_520 : 13_640;
      const rockGeo = new THREE.DodecahedronGeometry(6.5, 0);
      const rockMat = new THREE.MeshStandardMaterial({
        color: systemId === 'vega' ? 0xb4cde6 : 0x8a8178,
        roughness: 0.9,
        metalness: 0.12,
        envMapIntensity: 0.05,
      });
      const inst = new THREE.InstancedMesh(rockGeo, rockMat, beltCount);
      const mat4 = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const sc = new THREE.Vector3();
      const euler = new THREE.Euler();
      const tint = new THREE.Color();
      let s = 9187;
      const rnd = () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
      };
      for (let i = 0; i < beltCount; i++) {
        const a = rnd() * Math.PI * 2;
        const r = innerR + rnd() * (outerR - innerR);
        const y = (rnd() - 0.5) * 420;
        pos.set(Math.cos(a) * r, y, Math.sin(a) * r);
        euler.set(rnd() * 6, rnd() * 6, rnd() * 6);
        quat.setFromEuler(euler);
        const sz = 0.45 + Math.pow(rnd(), 2) * 2.2;
        sc.set(sz * (0.8 + rnd() * 0.4), sz * (0.7 + rnd() * 0.5), sz);
        mat4.compose(pos, quat, sc);
        inst.setMatrixAt(i, mat4);
        const shade = 0.72 + rnd() * 0.42;
        tint.setRGB(shade, shade * 0.96, shade * 0.92);
        inst.setColorAt(i, tint);
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.frustumCulled = false;
      this.asteroidBeltMesh = inst;
      this.systemGroup.add(inst);
    }
  }

  public spawnAtEarthOrbit(): void {
    const earth = BODY_BY_ID['earth'];
    const earthPos = computeBodyWorldPosition(earth, this.simTime);
    const sunPos = computeBodyWorldPosition(BODY_BY_ID['sun'], this.simTime);

    // Position player right across Earth's dramatic 50/50 day-night terminator so sunlit oceans/clouds
    // AND pitch-black night continents glowing with golden city lights command the screen!
    const toSun = new THREE.Vector3(
      sunPos.x - earthPos.x,
      sunPos.y - earthPos.y,
      sunPos.z - earthPos.z,
    ).normalize();
    const side = new THREE.Vector3(-toSun.z, 0.22, toSun.x).normalize();

    const offset = toSun
      .clone()
      .multiplyScalar(-earth.radius * 0.38)
      .addScaledVector(side, earth.radius * 1.76);

    this.playerPos = {
      x: earthPos.x + offset.x,
      y: earthPos.y + offset.y,
      z: earthPos.z + offset.z,
    };
    this.playerVelocity.set(0, 0, 0);
    this.isLanded = false;
    this.landedBodyId = null;
    this.surfaceWalkX = 0;
    this.surfaceWalkZ = 0;
    this.autoLandingBodyId = null;
    this.warpTargetBodyId = null;
    this.warpTargetSystemId = null;
    this.tesseractStage = 'outside';
    this.tesseractRealm?.hide();

    // Aim cleanly toward Earth slightly offset to the right third for an unforgettable vista
    const lookDir = new THREE.Vector3(
      earthPos.x - this.playerPos.x,
      earthPos.y - this.playerPos.y,
      earthPos.z - this.playerPos.z,
    ).normalize();
    this.yaw = Math.atan2(-lookDir.x, -lookDir.z) + 0.14;
    this.pitch = Math.asin(THREE.MathUtils.clamp(lookDir.y, -0.9, 0.9)) - 0.04;
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;

    if (this.activeSystemId !== 'sol') {
      this.buildStarSystem('sol');
    }
    this.emitTelemetry(true);
  }

  /**
   * Positions the Voyager in a dramatic solar-limb vista overlooking Earth's twilight
   * Rayleigh atmosphere with the Sun flaring past the horizon and deep nebulae in frame.
   */
  public spawnSolarFlareVista(): void {
    if (this.activeSystemId !== 'sol') {
      this.buildStarSystem('sol');
    }
    this.tesseractStage = 'outside';
    this.tesseractRealm?.hide();
    this.isLanded = false;
    this.landedBodyId = null;
    this.autoLandingBodyId = null;
    this.cancelWarp();

    const earth = BODY_BY_ID['earth'];
    const earthPos = computeBodyWorldPosition(earth, this.simTime);
    const sunPos = computeBodyWorldPosition(BODY_BY_ID['sun'], this.simTime);

    const earthToSun = new THREE.Vector3(
      sunPos.x - earthPos.x,
      sunPos.y - earthPos.y,
      sunPos.z - earthPos.z,
    ).normalize();
    const side = new THREE.Vector3(-earthToSun.z, 0.28, earthToSun.x).normalize();

    // Sit slightly behind Earth's horizon limb looking past the towering blue Rayleigh crescent toward the Sun!
    const offset = earthToSun
      .clone()
      .multiplyScalar(-earth.radius * 1.72)
      .addScaledVector(side, earth.radius * 1.24);

    this.playerPos = {
      x: earthPos.x + offset.x,
      y: earthPos.y + offset.y,
      z: earthPos.z + offset.z,
    };

    const toSunFromCam = new THREE.Vector3(
      sunPos.x - this.playerPos.x,
      sunPos.y - this.playerPos.y,
      sunPos.z - this.playerPos.z,
    ).normalize();
    const toEarthFromCam = new THREE.Vector3(
      earthPos.x - this.playerPos.x,
      earthPos.y - this.playerPos.y,
      earthPos.z - this.playerPos.z,
    ).normalize();
    const midLook = toSunFromCam.clone().multiplyScalar(0.54).addScaledVector(toEarthFromCam, 0.46).normalize();

    this.yaw = Math.atan2(-midLook.x, -midLook.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(midLook.y, -0.8, 0.8));
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;
    this.playerVelocity.set(0, 0, 0);
    this.currentSpeed = 0;
    this.emitTelemetry(true);
  }

  /**
   * Launches Voyager directly into a hypersonic twilight atmospheric entry dive
   * with glowing ionized plasma bow-shock, thermal sparks, Rayleigh refraction & Max-Q vibration.
   */
  public spawnAtmosphericEntryVista(bodyId = 'earth'): void {
    const def = BODY_BY_ID[bodyId] || BODY_BY_ID['earth'];
    if (this.activeSystemId !== def.systemId) {
      this.buildStarSystem(def.systemId);
    }
    this.tesseractStage = 'outside';
    this.tesseractRealm?.hide();
    this.isLanded = false;
    this.landedBodyId = null;
    this.autoLandingBodyId = null;
    this.cancelWarp();

    const bodyPos = computeBodyWorldPosition(def, this.simTime);
    const primaryStar =
      getBodiesInSystem(def.systemId).find((b) => b.kind === 'star') || BODY_BY_ID['sun'];
    const starPos = computeBodyWorldPosition(primaryStar, this.simTime);

    const toSun = new THREE.Vector3(
      starPos.x - bodyPos.x,
      starPos.y - bodyPos.y,
      starPos.z - bodyPos.z,
    ).normalize();
    const side = new THREE.Vector3(-toSun.z, 0.36, toSun.x).normalize();

    // Position on the glowing golden-blue twilight terminator inside the upper-mid atmosphere
    const radialUp = toSun.clone().multiplyScalar(0.18).addScaledVector(side, 0.98).normalize();
    const entryAlt = Math.max(8, def.radius * 0.14);
    const spawnR = def.radius + entryAlt;

    this.playerPos = {
      x: bodyPos.x + radialUp.x * spawnR,
      y: bodyPos.y + radialUp.y * spawnR,
      z: bodyPos.z + radialUp.z * spawnR,
    };

    // Sweeping atmospheric entry dive curving across Earth's sunlit-twilight Rayleigh horizon!
    const tangent = new THREE.Vector3().crossVectors(radialUp, toSun).normalize();
    const diveDir = toSun
      .clone()
      .multiplyScalar(0.32)
      .addScaledVector(tangent, 0.78)
      .addScaledVector(radialUp, -0.52)
      .normalize();

    this.yaw = Math.atan2(-diveDir.x, -diveDir.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(diveDir.y, -0.85, 0.85));
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;
    this.playerVelocity.copy(diveDir).multiplyScalar(42);
    this.currentSpeed = 42;
    this.cameraShakeTrauma = 0.52;
    this.discoveredIds.add(def.id);
    this.emitTelemetry(true);
  }

  /**
   * Instantly lands the Voyager on the sunlit scenic hemisphere of any landable planet or moon.
   */
  public landOnBodyNow(bodyId: string): void {
    const def = BODY_BY_ID[bodyId];
    if (!def || !def.landable) return;
    if (this.activeSystemId !== def.systemId) {
      this.buildStarSystem(def.systemId);
    }
    this.tesseractStage = 'outside';
    this.tesseractRealm?.hide();
    this.cancelWarp();
    this.autoLandingBodyId = null;

    const bodyPos = computeBodyWorldPosition(def, this.simTime);
    const primaryStar =
      getBodiesInSystem(def.systemId).find((b) => b.kind === 'star') || BODY_BY_ID['sun'];
    const starPos = computeBodyWorldPosition(primaryStar, this.simTime);

    const toSun = new THREE.Vector3(
      starPos.x - bodyPos.x,
      starPos.y - bodyPos.y,
      starPos.z - bodyPos.z,
    ).normalize();
    const tangent = new THREE.Vector3(-toSun.z, 0.55, toSun.x).normalize();

    // Pick a golden-hour / afternoon site (~42° sun elevation) so mountains, oceans, shadows & sky glow!
    this.surfaceUp
      .copy(toSun)
      .multiplyScalar(0.68)
      .addScaledVector(tangent, 0.73)
      .normalize();

    const exactR = def.radius + 0.12;
    this.playerPos = {
      x: bodyPos.x + this.surfaceUp.x * exactR,
      y: bodyPos.y + this.surfaceUp.y * exactR,
      z: bodyPos.z + this.surfaceUp.z * exactR,
    };

    this.isLanded = true;
    this.landedBodyId = def.id;
    this.surfaceWalkX = 0;
    this.surfaceWalkZ = 0;
    this.surfaceAltOffset = 0;
    this.surfaceVerticalVel = 0;
    this.playerVelocity.set(0, 0, 0);
    this.currentSpeed = 0;

    // Face toward the sunlit valley/horizon where the star sits cleanly in the upper-right sky
    this._alignQuat.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, this.surfaceUp);
    this._invQuat.copy(this._alignQuat).invert();
    const localSun = toSun.clone().applyQuaternion(this._invQuat);
    const sunYaw = Math.atan2(-localSun.x, -localSun.z);
    this.yaw = sunYaw - 0.28;
    this.pitch = 0.04;
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;

    this.discoveredIds.add(def.id);
    this.landedIds.add(def.id);
    this.emitTelemetry(true);
  }

  private ensureTesseractInitialized(): TesseractRealm {
    if (!this.tesseractRealm) {
      this.tesseractRealm = createTesseractRealm();
      this.scene.add(this.tesseractRealm.group);
    }
    return this.tesseractRealm;
  }

  /**
   * Plunges the Voyager past Sagittarius A*'s Event Horizon into dark accelerating-particle
   * free-fall before crystallizing into the 5th-dimensional Tesseract.
   */
  public enterBlackHolePlungeNow(): void {
    this.ensureTesseractInitialized();
    this.cancelWarp();
    this.isLanded = false;
    this.landedBodyId = null;
    this.autoLandingBodyId = null;
    this.playerVelocity.set(0, 0, 0);
    this.tesseractStage = 'plunge';
    this.plungeElapsed = 0;
    this.plungeBeatStage = 0;
    this.tesseractBulkPos.set(0, 0, 0);
    this.tesseractBulkVel.set(0, 0, 0);
    this.tesseractPulseProgress = 1.0;
    this.yaw = 0.25;
    this.pitch = 0.34; // Tilt slightly upward so the collapsing Einstein sky-ring & streaking particles tower above
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;
    this.cameraShakeTrauma = 1.0;
    this.audio.playHorizonEjection();
    triggerGamepadHaptics(850, 0.9, 1.0);
    this.scanMsgCounter++;
    this.scanMessage = {
      id: this.scanMsgCounter,
      title: 'EVENT HORIZON BREACHED · r < Rs',
      detail: 'External universe collapsing overhead into a razor-thin Einstein ring. Brace for gravitational shear...',
    };
    this.scanMsgTimer = 4.2;
    this.emitTelemetry(true);
  }

  /**
   * Places the Voyager directly inside the infinite 5th-dimensional Interstellar Tesseract.
   */
  public enterTesseractNow(): void {
    this.ensureTesseractInitialized();
    this.cancelWarp();
    this.isLanded = false;
    this.landedBodyId = null;
    this.autoLandingBodyId = null;
    this.playerVelocity.set(0, 0, 0);
    this.tesseractStage = 'tesseract';
    this.plungeElapsed = 0;
    this.blackHolePointOfNoReturn = false;
    this.tesseractBulkPos.set(0, 0, 0);
    this.tesseractBulkVel.set(0, 0, 0);
    this.tesseractPulseProgress = 0.001;
    // Frame opening vista gazing down the corridor toward the rare shimmering Earth Bookshelf Dust anchor!
    this.yaw = 0.39;
    this.pitch = 0.05;
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;
    this.currentSpeed = 0;
    this.scanMsgCounter++;
    this.scanMessage = {
      id: this.scanMsgCounter,
      title: '5TH-DIMENSIONAL TESSERACT · THE BULK',
      detail: 'Rare World-Particle Echoes hide inside specific corridors. Float toward the golden dust anomaly and press [F] to transmit.',
    };
    this.scanMsgTimer = 6.5;
    this.emitTelemetry(true);
  }

  public exitTesseractToOrbit(): void {
    this.tesseractStage = 'outside';
    this.plungeElapsed = 0;
    this.tesseractRealm?.hide();
    this.audio.playWarpEngage();
    this.cameraShakeTrauma = 0.32;
    this.spawnAtBody('sgr-a-star', 7.4);
    this.scanMsgCounter++;
    this.scanMessage = {
      id: this.scanMsgCounter,
      title: 'BULK EXIT · SAGITTARIUS A* ORBIT',
      detail: 'Returned safely across the gravitational wormhole back into 3D spacetime.',
    };
    this.scanMsgTimer = 4.8;
    this.emitTelemetry(true);
  }

  public startGame(fromUserGesture = true): void {
    if (fromUserGesture) {
      this.audio.unlock();
    }
    this.phase = 'playing';
    this.keysHeld.clear();
    this.emitTelemetry(true);
  }

  public setPaused(paused: boolean): void {
    if (this.phase === 'title') return;
    this.phase = paused ? 'paused' : 'playing';
    this.keysHeld.clear();
    if (paused && document.pointerLockElement) {
      document.exitPointerLock?.();
    }
    this.emitTelemetry(true);
  }

  public returnToTitle(): void {
    this.phase = 'title';
    this.keysHeld.clear();
    if (document.pointerLockElement) {
      document.exitPointerLock?.();
    }
    this.spawnAtEarthOrbit();
    this.emitTelemetry(true);
  }

  public toggleCameraMode(): void {
    this.cameraMode = this.cameraMode === 'third-person' ? 'first-person' : 'third-person';
    this.emitTelemetry(true);
  }

  public toggleMute(): void {
    this.audio.unlock();
    this.audio.setMuted(!this.audio.isMuted());
    this.emitTelemetry(true);
  }

  public toggleMarkers(): void {
    this.showMarkers = !this.showMarkers;
    this.emitTelemetry(true);
  }

  public adjustSpeedBias(delta: number): void {
    this.speedBiasLevel = Math.max(-2, Math.min(3, this.speedBiasLevel + delta));
    this.emitTelemetry(true);
  }

  public cycleOrbitTimeScale(): void {
    const steps = [1, 25, 250, 1500];
    const idx = steps.indexOf(this.orbitTimeScale);
    this.orbitTimeScale = steps[(idx + 1) % steps.length];
    this.scanMsgCounter++;
    this.scanMessage = {
      id: this.scanMsgCounter,
      title: `KEPLERIAN ORBITAL TIME · ${this.orbitTimeScale}×`,
      detail:
        this.orbitTimeScale === 1
          ? 'Real-time astronomical orbital motion restored.'
          : `Accelerating elliptical Keplerian orbits at ${this.orbitTimeScale}× simulation rate. Press [T] to cycle.`,
    };
    this.scanMsgTimer = 3.6;
    this.emitTelemetry(true);
  }

  /**
   * Initiate smooth real-time superluminal warp to any celestial body or star system!
   */
  public warpToBody(bodyId: string): void {
    const body = BODY_BY_ID[bodyId];
    if (!body) return;
    this.audio.unlock();

    // Realistic General Relativity: once captured inside the Event Horizon / Plunge, escape is impossible!
    if (this.blackHolePointOfNoReturn || this.tesseractStage === 'plunge') {
      this.cameraShakeTrauma = Math.max(this.cameraShakeTrauma, 0.55);
      this.scanMsgCounter++;
      this.scanMessage = {
        id: this.scanMsgCounter,
        title: 'GRAVITATIONAL CAPTURE · NO ESCAPE',
        detail: 'Escape velocity exceeds c inside the Event Horizon. All worldlines bend strictly inward toward the singularity.',
      };
      this.scanMsgTimer = 3.8;
      this.emitTelemetry(true);
      return;
    }

    this.audio.playWarpEngage();
    triggerGamepadHaptics(220, 0.45, 0.35);
    if (this.tesseractStage !== 'outside') {
      this.tesseractStage = 'outside';
      this.tesseractRealm?.hide();
    }
    this.isLanded = false;
    this.landedBodyId = null;
    this.surfaceWalkX = 0;
    this.surfaceWalkZ = 0;
    this.autoLandingBodyId = null;
    this.warpTargetBodyId = bodyId;
    this.warpTargetSystemId = body.systemId;
    this.cameraShakeTrauma = Math.min(1, this.cameraShakeTrauma + 0.35);

    // Orient camera smoothly toward destination
    const targetPos = computeBodyWorldPosition(body, this.simTime);
    const dx = targetPos.x - this.playerPos.x;
    const dy = targetPos.y - this.playerPos.y;
    const dz = targetPos.z - this.playerPos.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    this.targetYaw = Math.atan2(-dx / len, -dz / len);
    this.targetPitch = Math.asin(THREE.MathUtils.clamp(dy / len, -0.85, 0.85));
    this.emitTelemetry(true);
  }

  public warpToSystem(systemId: string): void {
    const bodies = getBodiesInSystem(systemId);
    // Prefer headline black hole or landing-friendly planet of the star system so arrival view is breathtaking
    const headline =
      bodies.find((b) => b.kind === 'black-hole') ||
      bodies.find((b) => b.id === 'proxima-b') ||
      bodies.find((b) => b.id === 'earth') ||
      bodies.find((b) => b.id === 'trappist-1e') ||
      bodies.find((b) => b.id === 'tau-ceti-e') ||
      bodies.find((b) => b.kind === 'planet') ||
      bodies[0];
    if (headline) {
      this.warpToBody(headline.id);
    }
  }

  /**
   * Instantly position the Voyager in a cinematic orbit overlooking any charted celestial body.
   */
  public spawnAtBody(bodyId: string, distanceMultiplier?: number): void {
    const def = BODY_BY_ID[bodyId];
    if (!def) return;
    if (this.activeSystemId !== def.systemId) {
      this.buildStarSystem(def.systemId);
    }
    this.tesseractStage = 'outside';
    this.tesseractRealm?.hide();

    const pos = computeBodyWorldPosition(def, this.simTime);
    const defaultMult =
      def.kind === 'black-hole' ? 7.4 : def.kind === 'star' ? 2.35 : 1.85;
    const clampedMult =
      typeof distanceMultiplier === 'number' && Number.isFinite(distanceMultiplier)
        ? THREE.MathUtils.clamp(distanceMultiplier, 1.6, 18.0)
        : defaultMult;
    const orbitDist = def.radius * clampedMult;
    const elev =
      def.kind === 'black-hole'
        ? def.radius * Math.min(1.5, clampedMult * 0.168)
        : def.radius * 0.28;

    this.playerPos = {
      x: pos.x + orbitDist * 0.88,
      y: pos.y + elev,
      z: pos.z + orbitDist * 0.48,
    };
    const dx = pos.x - this.playerPos.x;
    const dy = pos.y - this.playerPos.y;
    const dz = pos.z - this.playerPos.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    this.yaw = Math.atan2(-dx / len, -dz / len);
    this.pitch = Math.asin(THREE.MathUtils.clamp(dy / len, -0.8, 0.8));
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;
    this.playerVelocity.set(0, 0, 0);
    this.currentSpeed = 0;
    this.isLanded = false;
    this.landedBodyId = null;
    this.surfaceWalkX = 0;
    this.surfaceWalkZ = 0;
    this.autoLandingBodyId = null;
    this.cancelWarp();
    this.discoveredIds.add(def.id);
    this.emitTelemetry(true);
  }

  public cancelWarp(): void {
    this.warpTargetBodyId = null;
    this.warpTargetSystemId = null;
    this.warpEtaSec = 0;
  }

  /**
   * Trigger Cosmic Scan Pulse — or send an interactive 5D Gravitational Wave across
   * the Tesseract's worldline strings when inside the Black Hole bulk!
   */
  public triggerScanPulse(): void {
    if (this.phase !== 'playing') return;
    this.audio.unlock();

    if (this.tesseractStage === 'tesseract') {
      this.tesseractPulseProgress = 0.001;
      const nearestAnchor = findNearestMemoryAnchor(this.tesseractBulkPos);
      if (nearestAnchor.inRange) {
        const alreadyDecoded = this.decodedTesseractAnchors.has(nearestAnchor.anchor.id);
        this.decodedTesseractAnchors.add(nearestAnchor.anchor.id);
        this.audio.playAnchorDecodedChime();
        triggerGamepadHaptics(360, 0.55, 0.78);
        this.scanMsgCounter++;
        this.scanMessage = {
          id: this.scanMsgCounter,
          title: `${nearestAnchor.anchor.title} · ${alreadyDecoded ? 'RESONATING' : 'TRANSMITTED'} (${this.decodedTesseractAnchors.size}/${TESSERACT_MEMORY_ANCHORS.length})`,
          detail: nearestAnchor.anchor.transmissionDetail,
        };
        this.scanMsgTimer = 6.2;
      } else {
        this.audio.playGravityChord();
        triggerGamepadHaptics(240, 0.35, 0.55);
        this.scanMsgCounter++;
        const remaining = TESSERACT_MEMORY_ANCHORS.length - this.decodedTesseractAnchors.size;
        this.scanMessage = {
          id: this.scanMsgCounter,
          title: 'GRAVITATIONAL WAVE · 5D WORLDLINE RESONANCE',
          detail:
            remaining > 0
              ? `Golden filament pointing toward hidden World-Particle Echo (${Math.round(nearestAnchor.distance)} m away). Follow the pulse to decode.`
              : 'All 3 World-Particle Echoes harmonized across space-time. Gravitational ripples echo eternally.',
        };
        this.scanMsgTimer = 4.6;
      }
      this.emitTelemetry(true);
      return;
    }

    if (this.tesseractStage === 'plunge') return;

    this.audio.playScanPulse();
    this.scanWaveProgress = 0.0;
    this.scanWaveMesh.visible = true;

    const nearest = this.findNearestBody();
    if (nearest) {
      this.discoveredIds.add(nearest.def.id);
      this.scanMsgCounter++;
      this.scanMessage = {
        id: this.scanMsgCounter,
        title: `${nearest.def.name} · ${nearest.def.realDistanceLabel}`,
        detail: `${nearest.def.summary} Gravity: ${nearest.def.gravityG.toFixed(2)}g.`,
      };
      this.scanMsgTimer = 5.5;
      this.emitTelemetry(true);
    }
  }

  /**
   * Toggle Seamless Planetary / Lunar Landing or Liftoff (`L`), or exit the 5D Tesseract.
   */
  public toggleLandOrLiftoff(): void {
    if (this.phase !== 'playing') return;
    this.audio.unlock();

    if (this.tesseractStage === 'tesseract') {
      this.exitTesseractToOrbit();
      return;
    }
    if (this.tesseractStage === 'plunge') return;

    if (this.isLanded) {
      // Smooth heroic liftoff back into atmosphere / orbit!
      this.isLanded = false;
      const body = this.landedBodyId ? BODY_BY_ID[this.landedBodyId] : null;
      this.landedBodyId = null;
      this.surfaceWalkX = 0;
      this.surfaceWalkZ = 0;
      this.autoLandingBodyId = null;
      this.audio.playJumpThrust();
      const liftSpeed = body ? Math.max(8, body.radius * 0.22) : 12;
      this.playerVelocity.copy(this.surfaceUp).multiplyScalar(liftSpeed);
      this.landingSquash = -0.35;
      this.emitTelemetry(true);
      return;
    }

    const nearest = this.findNearestBody();
    if (!nearest || !nearest.def.landable) {
      this.scanMsgCounter++;
      this.scanMessage = {
        id: this.scanMsgCounter,
        title: nearest ? `${nearest.def.name} — No Solid Surface` : 'No Landable World Nearby',
        detail: nearest
          ? nearest.def.kind === 'black-hole'
            ? `Fly directly across ${nearest.def.name}'s Event Horizon to plunge into the 5th-dimensional Tesseract, or land on Penrose's Edge.`
            : `${nearest.def.name} is a ${nearest.def.kind === 'star' ? 'stellar plasma body' : 'gas/ice giant'}. Land on one of its rocky or icy moons instead.`
          : 'Approach a rocky planet or moon to engage landing.',
      };
      this.scanMsgTimer = 4.5;
      this.emitTelemetry(true);
      return;
    }

    // Engage automatic atmospheric descent & touchdown!
    this.cancelWarp();
    this.autoLandingBodyId = nearest.def.id;
    this.audio.playWarpEngage();
    this.emitTelemetry(true);
  }

  private findNearestBody(): { node: BodyRenderNode; def: CelestialBodyDef; distCenter: number; altitude: number } | null {
    let best: { node: BodyRenderNode; def: CelestialBodyDef; distCenter: number; altitude: number } | null = null;
    for (const node of this.bodyNodes) {
      const distCenter = distance3d(this.playerPos, node.worldPos);
      const altitude = Math.max(0, distCenter - node.def.radius);
      if (!best || altitude < best.altitude) {
        best = { node, def: node.def, distCenter, altitude };
      }
    }
    return best;
  }

  private findNearestSystem(): { id: string; dist: number } {
    let bestId = this.activeSystemId;
    let bestDist = Infinity;
    for (const sys of STAR_SYSTEMS) {
      const d = distance3d(this.playerPos, sys.position);
      if (d < bestDist) {
        bestDist = d;
        bestId = sys.id;
      }
    }
    return { id: bestId, dist: bestDist };
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    window.addEventListener('gamepadconnected', this.handleGamepadChange);
    window.addEventListener('gamepaddisconnected', this.handleGamepadChange);

    const canvas = this.renderer.domElement;
    canvas.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);
    canvas.addEventListener('wheel', this.handleWheel, { passive: true });
  }

  private handleResize = (): void => {
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, rect.width || window.innerWidth);
    const h = Math.max(1, rect.height || window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private handleBlur = (): void => {
    this.keysHeld.clear();
    this.isDraggingLook = false;
  };

  private handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.keysHeld.clear();
      this.isDraggingLook = false;
    }
  };

  private handlePointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
    this.emitTelemetry(true);
  };

  private handleGamepadChange = (): void => {
    const raw = pollActiveBrowserGamepad();
    const { input, nextButtons } = processGamepadState(raw, this.gamepadPrevButtons);
    this.gamepadInput = input;
    this.gamepadPrevButtons = nextButtons;
    this.wasGamepadConnected = input.connected;
    if (this.phase === 'playing') {
      this.scanMsgCounter++;
      this.scanMessage = {
        id: this.scanMsgCounter,
        title: input.connected ? 'Controller Connected' : 'Controller Disconnected',
        detail: input.connected
          ? `${input.name || 'Gamepad'} ready — Left Stick move, Right Stick look, RT boost, X land, Y scan.`
          : 'Switched back to keyboard & mouse flight controls.',
      };
      this.scanMsgTimer = 4.0;
    }
    this.emitTelemetry(true);
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    const code = e.code;
    if (
      code === 'Space' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight'
    ) {
      if (this.phase === 'playing') {
        e.preventDefault();
      }
    }

    if (this.phase !== 'playing') return;

    const alreadyHeld = this.keysHeld.has(code);
    this.keysHeld.add(code);

    if (!alreadyHeld) {
      if (code === 'Space' && this.isLanded) {
        this.jumpBufferTimer = 0.14;
      } else if (code === 'KeyF') {
        this.triggerScanPulse();
      } else if (code === 'KeyL') {
        this.toggleLandOrLiftoff();
      } else if (code === 'KeyV') {
        this.toggleCameraMode();
      } else if (code === 'KeyM') {
        this.toggleMute();
      } else if (code === 'KeyN') {
        this.toggleMarkers();
      } else if (code === 'KeyT') {
        this.cycleOrbitTimeScale();
      } else if (code === 'BracketRight' || code === 'Equal') {
        this.adjustSpeedBias(1);
      } else if (code === 'BracketLeft' || code === 'Minus') {
        this.adjustSpeedBias(-1);
      } else if (
        (code === 'KeyW' || code === 'KeyS' || code === 'KeyA' || code === 'KeyD') &&
        this.warpTargetBodyId
      ) {
        // Manual steering gracefully cancels auto-warp if desired
        this.cancelWarp();
      }
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    const code = e.code;
    this.keysHeld.delete(code);
    // Variable jump height cut when releasing jump early on surface
    if (code === 'Space' && this.isLanded && this.surfaceVerticalVel > 1.2) {
      this.surfaceVerticalVel *= 0.55;
    }
  };

  private handleMouseDown = (e: MouseEvent): void => {
    if (this.phase !== 'playing') return;
    this.audio.unlock();
    if (e.button === 0) {
      this.isDraggingLook = true;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    } else if (e.button === 2) {
      this.triggerScanPulse();
    }
  };

  private handleMouseMove = (e: MouseEvent): void => {
    if (this.phase !== 'playing') return;
    const sensitivity = 0.0032;
    if (this.pointerLocked) {
      this.targetYaw -= e.movementX * sensitivity;
      this.targetPitch = THREE.MathUtils.clamp(
        this.targetPitch - e.movementY * sensitivity,
        -1.42,
        1.42,
      );
    } else if (this.isDraggingLook) {
      const dx = e.clientX - this.lastPointerX;
      const dy = e.clientY - this.lastPointerY;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.targetYaw -= dx * sensitivity * 1.15;
      this.targetPitch = THREE.MathUtils.clamp(
        this.targetPitch - dy * sensitivity * 1.15,
        -1.42,
        1.42,
      );
    }
  };

  private handleMouseUp = (): void => {
    this.isDraggingLook = false;
  };

  private handleWheel = (e: WheelEvent): void => {
    if (this.phase !== 'playing') return;
    if (e.deltaY < -10) this.adjustSpeedBias(1);
    else if (e.deltaY > 10) this.adjustSpeedBias(-1);
  };

  private scheduleNextFrame(): void {
    if (this.disposed) return;
    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync?.(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private tick = (): void => {
    if (this.disposed) return;
    const nowMs = performance.now();
    const rawDt = Math.max(0.001, (nowMs - this.lastFrameMs) / 1000);
    const dt = Math.min(rawDt, 0.05); // Clamped dt for stable physics
    this.lastFrameMs = nowMs;
    this.realTime += dt;

    this.pollGamepadAndDispatch();

    if (this.phase !== 'paused') {
      this.simTime += dt * this.orbitTimeScale;
      this.stepSimulation(dt);
    }

    this.updateSceneTransforms(dt);
    this.renderer.render(this.scene, this.camera);

    if (nowMs - this.lastTelemetryMs >= 110) {
      this.lastTelemetryMs = nowMs;
      this.emitTelemetry(false);
    }

    this.scheduleNextFrame();
  };

  private pollGamepadAndDispatch(): void {
    const raw = pollActiveBrowserGamepad();
    const { input, nextButtons } = processGamepadState(raw, this.gamepadPrevButtons);
    this.gamepadInput = input;
    this.gamepadPrevButtons = nextButtons;

    if (input.connected !== this.wasGamepadConnected) {
      this.wasGamepadConnected = input.connected;
      this.emitTelemetry(true);
    }

    if (!input.connected) return;

    if (this.phase === 'title') {
      if (input.pressedStartConfirm) {
        this.uiCallbacks.onStart ? this.uiCallbacks.onStart() : this.startGame(true);
      }
      return;
    }

    if (input.pressedPause) {
      if (this.uiCallbacks.onTogglePause) {
        this.uiCallbacks.onTogglePause();
      } else {
        this.setPaused(this.phase !== 'paused');
      }
      return;
    }

    if (this.phase === 'paused') {
      if (input.pressedBack || input.pressedJump) {
        if (this.uiCallbacks.onTogglePause) {
          this.uiCallbacks.onTogglePause();
        } else {
          this.setPaused(false);
        }
      }
      return;
    }

    // Active gameplay one-shot controller bindings
    if (input.pressedStarMap) {
      this.uiCallbacks.onToggleStarMap?.();
    }
    if (input.pressedDock) {
      this.uiCallbacks.onToggleDock?.();
    }
    if (input.pressedBack) {
      this.uiCallbacks.onCloseModals?.();
      if (this.warpTargetBodyId) {
        this.cancelWarp();
        this.emitTelemetry(true);
      }
    }
    if (input.pressedLand) {
      this.toggleLandOrLiftoff();
    }
    if (input.pressedScan) {
      this.triggerScanPulse();
    }
    if (input.pressedCamera) {
      this.toggleCameraMode();
    }
    if (input.pressedMute) {
      this.toggleMute();
    }
    if (input.pressedGearUp) {
      this.adjustSpeedBias(1);
    }
    if (input.pressedGearDown) {
      this.adjustSpeedBias(-1);
    }
    if (input.pressedBlackHoleShortcut) {
      this.warpToBody(this.activeSystemId === 'sagittarius-a' ? 'earth' : 'sgr-a-star');
    }
    if (input.pressedJump && this.isLanded) {
      this.jumpBufferTimer = 0.14;
    }
  }

  private stepSimulation(dt: number): void {
    // Advance every celestial body along its exact 3D Keplerian elliptical orbit
    for (const node of this.bodyNodes) {
      node.prevWorldPos.x = node.worldPos.x;
      node.prevWorldPos.y = node.worldPos.y;
      node.prevWorldPos.z = node.worldPos.z;
      node.worldPos = computeBodyWorldPosition(node.def, this.simTime);
    }

    // Dynamic system switching if player manually flies across interstellar space toward another star!
    const nearestSys = this.findNearestSystem();
    if (nearestSys.id !== this.activeSystemId && nearestSys.dist < LY_UNITS * 0.45) {
      this.buildStarSystem(nearestSys.id);
      for (const node of this.bodyNodes) {
        node.worldPos = computeBodyWorldPosition(node.def, this.simTime);
        node.prevWorldPos.x = node.worldPos.x;
        node.prevWorldPos.y = node.worldPos.y;
        node.prevWorldPos.z = node.worldPos.z;
      }
    }

    // Orbital co-moving reference frame: keep Voyager smoothly locked to a moving planet/moon's
    // Keplerian velocity when hovering in low orbit or entering its atmosphere so worlds never drift away!
    if (
      this.phase === 'playing' &&
      !this.isLanded &&
      !this.warpTargetBodyId &&
      this.tesseractStage === 'outside'
    ) {
      const orbitAnchor = this.findNearestBody();
      if (orbitAnchor && orbitAnchor.def.parentId && orbitAnchor.altitude < orbitAnchor.def.radius * 4.5) {
        const ratio = orbitAnchor.altitude / Math.max(1, orbitAnchor.def.radius);
        const lockWeight = 1 - THREE.MathUtils.smoothstep(ratio, 2.0, 4.5);
        this.playerPos.x += (orbitAnchor.node.worldPos.x - orbitAnchor.node.prevWorldPos.x) * lockWeight;
        this.playerPos.y += (orbitAnchor.node.worldPos.y - orbitAnchor.node.prevWorldPos.y) * lockWeight;
        this.playerPos.z += (orbitAnchor.node.worldPos.z - orbitAnchor.node.prevWorldPos.z) * lockWeight;
      }
    }

    if (this.scanMsgTimer > 0) {
      this.scanMsgTimer -= dt;
      if (this.scanMsgTimer <= 0) {
        this.scanMessage = null;
      }
    }

    if (this.phase === 'title') {
      // Smooth atmospheric orbital camera tour across Earth's dramatic day-night terminator
      const earth = this.bodyNodes.find((n) => n.def.id === 'earth');
      const sun = this.bodyNodes.find((n) => n.def.id === 'sun');
      if (earth && sun) {
        const toSun = new THREE.Vector3(
          sun.worldPos.x - earth.worldPos.x,
          sun.worldPos.y - earth.worldPos.y,
          sun.worldPos.z - earth.worldPos.z,
        ).normalize();
        const side = new THREE.Vector3(-toSun.z, 0.22, toSun.x).normalize();
        const sway = Math.sin(this.realTime * 0.12) * 0.14;
        const offset = toSun
          .clone()
          .multiplyScalar(-earth.def.radius * (0.34 + sway))
          .addScaledVector(side, earth.def.radius * 1.84);
        this.playerPos.x = earth.worldPos.x + offset.x;
        this.playerPos.y = earth.worldPos.y + offset.y;
        this.playerPos.z = earth.worldPos.z + offset.z;

        const dx = earth.worldPos.x - this.playerPos.x;
        const dy = earth.worldPos.y - this.playerPos.y;
        const dz = earth.worldPos.z - this.playerPos.z;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        // Offset framing so Earth + Voyager anchor cleanly on the right two-thirds, keeping left third calm space!
        this.yaw = Math.atan2(-dx / len, -dz / len) + 0.24;
        this.pitch = Math.asin(THREE.MathUtils.clamp(dy / len, -0.8, 0.8)) - 0.03;
        this.targetYaw = this.yaw;
        this.targetPitch = this.pitch;
      }
      this.currentSpeed = 0;
      return;
    }

    // Apply smooth analog Right Stick look input from connected controller
    if (this.gamepadInput.connected && (this.gamepadInput.lookYaw !== 0 || this.gamepadInput.lookPitch !== 0)) {
      const lookSpeed = 2.45;
      this.targetYaw -= this.gamepadInput.lookYaw * lookSpeed * dt;
      this.targetPitch = THREE.MathUtils.clamp(
        this.targetPitch - this.gamepadInput.lookPitch * lookSpeed * 0.85 * dt,
        -Math.PI * 0.48,
        Math.PI * 0.48,
      );
    }

    // Smooth yaw/pitch damping
    const rotDamp = 1 - Math.exp(-14 * dt);
    this.yaw += (this.targetYaw - this.yaw) * rotDamp;
    this.pitch += (this.targetPitch - this.pitch) * rotDamp;
    this.landingSquash *= Math.exp(-9 * dt);
    this.cameraShakeTrauma = Math.max(0, this.cameraShakeTrauma - dt * 1.4);

    // 0A. EVENT HORIZON FREE-FALL PLUNGE (extended 12.5s dark relativistic free-fall -> 5D Tesseract)
    if (this.tesseractStage === 'plunge') {
      this.plungeElapsed += dt;
      const plunge = computePlungeDynamics(this.plungeElapsed);
      this.currentSpeed = 48 + plunge.particleAccel * 340;
      this.cameraShakeTrauma = Math.max(this.cameraShakeTrauma, plunge.cameraTremor * 0.88);

      // Continuous tactile haptic shudder throughout the turbulent gravitational descent
      if (plunge.cameraTremor > 0.25 && this.realTime - this.lastHapticPulseTime > 0.34) {
        this.lastHapticPulseTime = this.realTime;
        triggerGamepadHaptics(
          360,
          Math.min(1, plunge.cameraTremor * 0.82),
          Math.min(1, plunge.cameraTremor * 0.95),
        );
      }

      // Dramatic 4-phase narrative beats across the extended 22-second Event Horizon plunge
      if (this.plungeBeatStage < 1 && plunge.progress >= 0.22) {
        this.plungeBeatStage = 1;
        this.cameraShakeTrauma = Math.max(this.cameraShakeTrauma, 0.94);
        this.scanMsgCounter++;
        this.scanMessage = {
          id: this.scanMsgCounter,
          title: 'POINT OF NO RETURN · RELATIVISTIC INFALL',
          detail: 'Space and time have traded roles. Escape velocity exceeds c — falling relentlessly into the abyss...',
        };
        this.scanMsgTimer = 4.8;
        this.emitTelemetry(true);
      } else if (this.plungeBeatStage < 2 && plunge.progress >= 0.52) {
        this.plungeBeatStage = 2;
        this.cameraShakeTrauma = Math.max(this.cameraShakeTrauma, 0.98);
        this.scanMsgCounter++;
        this.scanMessage = {
          id: this.scanMsgCounter,
          title: 'EINSTEIN SKY-RING COLLAPSING · ZERO RETURN',
          detail: 'The entire outside universe has pinched to a blinding speck overhead. Quantum plasma streaking past hull...',
        };
        this.scanMsgTimer = 4.8;
        this.emitTelemetry(true);
      } else if (this.plungeBeatStage < 3 && plunge.progress >= 0.78) {
        this.plungeBeatStage = 3;
        this.audio.playGravityChord();
        this.scanMsgCounter++;
        this.scanMessage = {
          id: this.scanMsgCounter,
          title: 'SPACETIME FRACTURE · 5TH-DIMENSIONAL BULK',
          detail: 'Darkness yielding to physical time geometry. Worldline lattice crystallizing from the singularity...',
        };
        this.scanMsgTimer = 4.6;
        this.emitTelemetry(true);
      }

      if (plunge.transitionReady) {
        this.tesseractStage = 'tesseract';
        this.blackHolePointOfNoReturn = false;
        this.tesseractBulkPos.set(0, 0, 0);
        this.tesseractBulkVel.set(0, 0, 0);
        this.tesseractPulseProgress = 0.001;
        this.yaw = 0.39;
        this.pitch = 0.05;
        this.targetYaw = this.yaw;
        this.targetPitch = this.pitch;
        this.currentSpeed = 0;
        this.audio.playGravityChord();
        this.scanMsgCounter++;
        this.scanMessage = {
          id: this.scanMsgCounter,
          title: '5TH-DIMENSIONAL TESSERACT · THE BULK',
          detail: 'Rare World-Particle Echoes shimmer in hidden corridors. Float toward the golden dust anomaly and press [F] to transmit.',
        };
        this.scanMsgTimer = 6.5;
        this.emitTelemetry(true);
      }
      return;
    }

    // 0B. 5TH-DIMENSIONAL TESSERACT WEIGHTLESS 6DOF FLOATING
    if (this.tesseractStage === 'tesseract') {
      this._euler.set(this.pitch, this.yaw, 0, 'YXZ');
      this._camQuat.setFromEuler(this._euler);
      this._forward.set(0, 0, -1).applyQuaternion(this._camQuat).normalize();
      this._right.set(1, 0, 0).applyQuaternion(this._camQuat).normalize();
      this._up.set(0, 1, 0).applyQuaternion(this._camQuat).normalize();

      const keyFwd =
        (this.keysHeld.has('KeyW') || this.keysHeld.has('ArrowUp') ? 1 : 0) -
        (this.keysHeld.has('KeyS') || this.keysHeld.has('ArrowDown') ? 1 : 0);
      const keyRight =
        (this.keysHeld.has('KeyD') || this.keysHeld.has('ArrowRight') ? 1 : 0) -
        (this.keysHeld.has('KeyA') || this.keysHeld.has('ArrowLeft') ? 1 : 0);
      const keyUp =
        (this.keysHeld.has('Space') || this.keysHeld.has('KeyE') ? 1 : 0) -
        (this.keysHeld.has('KeyC') || this.keysHeld.has('KeyQ') ? 1 : 0);

      const inputFwd = THREE.MathUtils.clamp(keyFwd + this.gamepadInput.moveForward, -1, 1);
      const inputRight = THREE.MathUtils.clamp(keyRight + this.gamepadInput.moveRight, -1, 1);
      const inputUp = THREE.MathUtils.clamp(keyUp + this.gamepadInput.moveUp, -1, 1);

      const isBoost =
        this.keysHeld.has('ShiftLeft') ||
        this.keysHeld.has('ShiftRight') ||
        this.gamepadInput.boostHeld;
      const bulkMaxSpeed = isBoost ? 24.0 : 9.2;

      this._v1
        .set(0, 0, 0)
        .addScaledVector(this._forward, inputFwd)
        .addScaledVector(this._right, inputRight)
        .addScaledVector(this._up, inputUp);
      const mag = Math.min(1, this._v1.length());
      if (mag > 0.02) {
        this._v1.normalize().multiplyScalar(bulkMaxSpeed * mag);
      } else {
        this._v1.set(0, 0, 0);
      }

      const damp = 1 - Math.exp(-3.4 * dt);
      this.tesseractBulkVel.lerp(this._v1, damp);
      this.tesseractBulkPos.addScaledVector(this.tesseractBulkVel, dt);
      this.currentSpeed = this.tesseractBulkVel.length();

      if (this.tesseractPulseProgress < 1.0) {
        this.tesseractPulseProgress = Math.min(1.0, this.tesseractPulseProgress + dt * 0.42);
      }
      return;
    }

    // 1. AUTO-WARP MODE (interplanetary & interstellar to Alpha Centauri, Sirius, TRAPPIST-1, etc.)
    if (this.warpTargetBodyId) {
      const targetDef = BODY_BY_ID[this.warpTargetBodyId];
      if (targetDef) {
        const targetPos = computeBodyWorldPosition(targetDef, this.simTime);
        const arrivalR =
          targetDef.kind === 'black-hole'
            ? targetDef.radius * 7.4
            : targetDef.kind === 'star'
              ? targetDef.radius * 2.35
              : targetDef.radius * 1.85;
        const step = computeWarpStep(this.playerPos, targetPos, arrivalR, dt);

        const moved = distance3d(this.playerPos, step.nextPos);
        this.distanceTraveledUnits += moved;
        this.playerPos = step.nextPos;
        this.currentSpeed = step.speed;
        this.warpEtaSec = step.etaSec;

        // Point player smoothly along warp trajectory
        const dx = targetPos.x - this.playerPos.x;
        const dy = targetPos.y - this.playerPos.y;
        const dz = targetPos.z - this.playerPos.z;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        this.targetYaw = Math.atan2(-dx / len, -dz / len);
        this.targetPitch = Math.asin(THREE.MathUtils.clamp(dy / len, -0.8, 0.8));

        // Switch active system cleanly when entering destination neighborhood
        if (this.warpTargetSystemId && this.warpTargetSystemId !== this.activeSystemId) {
          const destSys = SYSTEM_BY_ID[this.warpTargetSystemId];
          if (destSys && distance3d(this.playerPos, destSys.position) < LY_UNITS * 0.45) {
            this.buildStarSystem(this.warpTargetSystemId);
          }
        }

        if (step.arrived) {
          this.discoveredIds.add(targetDef.id);
          this.audio.playSonicBoom(0.8);
          this.cameraShakeTrauma = 0.25;
          this.scanMsgCounter++;
          this.scanMessage = {
            id: this.scanMsgCounter,
            title: `Arrived · ${targetDef.name}`,
            detail: targetDef.landable
              ? `${targetDef.summary} Press [L] to land on surface.`
              : targetDef.kind === 'black-hole'
                ? `${targetDef.summary} Fly across the Event Horizon to plunge into the 5D Tesseract.`
                : targetDef.summary,
          };
          this.scanMsgTimer = 5.0;
          this.cancelWarp();
          this.playerVelocity.set(0, 0, 0);
          this.emitTelemetry(true);
        }
        return;
      }
    }

    // 2. AUTO-LANDING DESCENT MODE (`L` key)
    if (this.autoLandingBodyId) {
      const node = this.bodyNodes.find((n) => n.def.id === this.autoLandingBodyId);
      if (node) {
        const dx = this.playerPos.x - node.worldPos.x;
        const dy = this.playerPos.y - node.worldPos.y;
        const dz = this.playerPos.z - node.worldPos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        this.surfaceUp.set(dx / dist, dy / dist, dz / dist);

        const targetR = node.def.radius + 0.12;
        const alt = dist - targetR;

        if (alt <= 0.22) {
          // Touchdown into dedicated true-scale Planetary Biome World!
          this.playerPos.x = node.worldPos.x + this.surfaceUp.x * targetR;
          this.playerPos.y = node.worldPos.y + this.surfaceUp.y * targetR;
          this.playerPos.z = node.worldPos.z + this.surfaceUp.z * targetR;
          this.isLanded = true;
          this.landedBodyId = node.def.id;
          this.autoLandingBodyId = null;
          this.surfaceWalkX = 0;
          this.surfaceWalkZ = 0;
          this.surfaceAltOffset = 0;
          this.surfaceVerticalVel = 0;
          this.currentSpeed = 0;
          this.landingSquash = 0.85;
          this.cameraShakeTrauma = 0.28;
          this.targetPitch = 0.02;
          this.discoveredIds.add(node.def.id);
          this.landedIds.add(node.def.id);
          this.audio.playTouchdown(0.95);
          this.scanMsgCounter++;
          this.scanMessage = {
            id: this.scanMsgCounter,
            title: `Surface Touchdown · ${node.def.name}`,
            detail: `Gravity ${node.def.gravityG.toFixed(2)}g. Explore on foot (WASD + Shift), leap with Space, or press [L] to lift off.`,
          };
          this.scanMsgTimer = 5.0;
          this.emitTelemetry(true);
          return;
        } else {
          // Weighty, cinematic atmospheric deceleration curve: hot plasma upper entry -> cloud-deck break -> gentle touchdown!
          const descentRate = Math.max(3.6, alt * 1.42);
          const step = Math.min(alt, descentRate * dt);
          const nextR = dist - step;
          this.playerPos.x = node.worldPos.x + this.surfaceUp.x * nextR;
          this.playerPos.y = node.worldPos.y + this.surfaceUp.y * nextR;
          this.playerPos.z = node.worldPos.z + this.surfaceUp.z * nextR;
          this.currentSpeed = step / Math.max(1e-4, dt);
          // Point velocity cleanly downward into the atmosphere so bow-shock plasma & sparks stream authentically!
          this.playerVelocity.copy(this.surfaceUp).multiplyScalar(-this.currentSpeed);
          this.distanceTraveledUnits += step;
          return;
        }
      } else {
        this.autoLandingBodyId = null;
      }
    }

    // 3. DEDICATED 1:1 METER-SCALE PLANETARY BIOME WALKING & GRAVITY-TUNED LEAPING
    if (this.isLanded && this.landedBodyId) {
      const node = this.bodyNodes.find((n) => n.def.id === this.landedBodyId);
      if (node) {
        const keyFwd =
          (this.keysHeld.has('KeyW') || this.keysHeld.has('ArrowUp') ? 1 : 0) -
          (this.keysHeld.has('KeyS') || this.keysHeld.has('ArrowDown') ? 1 : 0);
        const keyStrafe =
          (this.keysHeld.has('KeyD') || this.keysHeld.has('ArrowRight') ? 1 : 0) -
          (this.keysHeld.has('KeyA') || this.keysHeld.has('ArrowLeft') ? 1 : 0);

        const moveFwd = THREE.MathUtils.clamp(keyFwd + this.gamepadInput.moveForward, -1, 1);
        const moveStrafe = THREE.MathUtils.clamp(keyStrafe + this.gamepadInput.moveRight, -1, 1);

        const isSprinting =
          this.keysHeld.has('ShiftLeft') ||
          this.keysHeld.has('ShiftRight') ||
          this.gamepadInput.boostHeld;
        // True human-scale walking & sprinting speed (m/s inside the 360m planetary biome!)
        const walkSpeed = isSprinting ? 10.2 : 5.0;

        // Horizontal movement in exact local biome (X, Z) frame aligned to yaw
        const sinY = Math.sin(this.yaw);
        const cosY = Math.cos(this.yaw);
        let dxLocal = -sinY * moveFwd + cosY * moveStrafe;
        let dzLocal = -cosY * moveFwd - sinY * moveStrafe;
        const moveMag = Math.min(1, Math.hypot(dxLocal, dzLocal));
        const moving = moveMag > 0.02;

        if (moving) {
          const invM = 1 / (Math.hypot(dxLocal, dzLocal) || 1);
          dxLocal *= invM * walkSpeed * moveMag * dt;
          dzLocal *= invM * walkSpeed * moveMag * dt;
          this.surfaceWalkX += dxLocal;
          this.surfaceWalkZ += dzLocal;
          this.walkDistance += walkSpeed * moveMag * dt * 0.48;
          this.distanceTraveledUnits += walkSpeed * moveMag * dt * 0.01;
          if (this.surfaceAltOffset <= 0.06) {
            this.audio.playFootstep();
          }
        }

        // True planet-specific gravity physics with coyote time & jump buffering
        const gAccel = THREE.MathUtils.clamp(node.def.gravityG * 9.8, 1.4, 18.0);
        if (this.surfaceAltOffset <= 0.02) {
          this.coyoteTimer = 0.12;
        } else {
          this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
        }
        this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);

        if (this.jumpBufferTimer > 0 && this.coyoteTimer > 0) {
          const jumpV = Math.sqrt(2 * gAccel * 2.5);
          this.surfaceVerticalVel = Math.max(4.4, Math.min(8.8, jumpV));
          this.coyoteTimer = 0;
          this.jumpBufferTimer = 0;
          this.landingSquash = -0.35;
          this.audio.playJumpThrust();
        }

        this.surfaceVerticalVel -= gAccel * dt;
        this.surfaceAltOffset += this.surfaceVerticalVel * dt;

        if (this.surfaceAltOffset <= 0) {
          if (this.surfaceVerticalVel < -2.4) {
            this.landingSquash = 0.65;
            this.audio.playTouchdown(0.45);
          }
          this.surfaceAltOffset = 0;
          this.surfaceVerticalVel = 0;
        }

        // Anchor floating-origin player cleanly to the orbiting planet's landing site normal
        const exactR = node.def.radius + 0.12;
        this.playerPos.x = node.worldPos.x + this.surfaceUp.x * exactR;
        this.playerPos.y = node.worldPos.y + this.surfaceUp.y * exactR;
        this.playerPos.z = node.worldPos.z + this.surfaceUp.z * exactR;
        this.currentSpeed = moving ? walkSpeed * moveMag : Math.abs(this.surfaceVerticalVel);
        return;
      } else {
        this.isLanded = false;
        this.landedBodyId = null;
      }
    }

    // 4. FREE-ROAM 6DOF COSMIC FLIGHT (Megaton Rainfall scale-relative automatic braking!)
    const nearest = this.findNearestBody();
    const sysCenter = SYSTEM_BY_ID[this.activeSystemId]?.position ?? { x: 0, y: 0, z: 0 };
    const distToStar = distance3d(this.playerPos, sysCenter);
    const isBoost =
      this.keysHeld.has('ShiftLeft') ||
      this.keysHeld.has('ShiftRight') ||
      this.gamepadInput.boostHeld;

    const maxSpeed = computeAutoFlightSpeed(
      nearest ? nearest.altitude : 50_000,
      nearest ? nearest.def.radius : 68,
      distToStar,
      isBoost,
      this.speedBiasLevel,
      nearest ? nearest.def.kind : 'planet',
    );

    this._euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this._camQuat.setFromEuler(this._euler);
    this._forward.set(0, 0, -1).applyQuaternion(this._camQuat).normalize();
    this._right.set(1, 0, 0).applyQuaternion(this._camQuat).normalize();
    this._up.set(0, 1, 0).applyQuaternion(this._camQuat).normalize();

    const keyFwd =
      (this.keysHeld.has('KeyW') || this.keysHeld.has('ArrowUp') ? 1 : 0) -
      (this.keysHeld.has('KeyS') || this.keysHeld.has('ArrowDown') ? 1 : 0);
    const keyRight =
      (this.keysHeld.has('KeyD') || this.keysHeld.has('ArrowRight') ? 1 : 0) -
      (this.keysHeld.has('KeyA') || this.keysHeld.has('ArrowLeft') ? 1 : 0);
    const keyUp =
      (this.keysHeld.has('Space') || this.keysHeld.has('KeyE') ? 1 : 0) -
      (this.keysHeld.has('KeyC') || this.keysHeld.has('KeyQ') ? 1 : 0);

    const inputFwd = THREE.MathUtils.clamp(keyFwd + this.gamepadInput.moveForward, -1, 1);
    const inputRight = THREE.MathUtils.clamp(keyRight + this.gamepadInput.moveRight, -1, 1);
    const inputUp = THREE.MathUtils.clamp(keyUp + this.gamepadInput.moveUp, -1, 1);

    this._v1
      .set(0, 0, 0)
      .addScaledVector(this._forward, inputFwd)
      .addScaledVector(this._right, inputRight)
      .addScaledVector(this._up, inputUp);

    const throttleMag = Math.min(1, this._v1.length());
    if (throttleMag > 0.02) {
      this._v1.normalize().multiplyScalar(maxSpeed * throttleMag);
    } else {
      this._v1.set(0, 0, 0);
    }

    // Fluid inertial damping with responsive Megaton-Rainfall approach braking when nearing planets
    const currentVelMag = this.playerVelocity.length();
    const isAutoBraking = currentVelMag > maxSpeed * 1.15;
    const accelLambda = isAutoBraking
      ? 7.8
      : this._v1.lengthSq() > 0
        ? isBoost
          ? 5.2
          : 4.2
        : 3.4;
    const damp = 1 - Math.exp(-accelLambda * dt);
    this.playerVelocity.lerp(this._v1, damp);

    const stepX = this.playerVelocity.x * dt;
    const stepY = this.playerVelocity.y * dt;
    const stepZ = this.playerVelocity.z * dt;
    this.playerPos.x += stepX;
    this.playerPos.y += stepY;
    this.playerPos.z += stepZ;
    this.currentSpeed = this.playerVelocity.length();
    this.distanceTraveledUnits += this.currentSpeed * dt;

    // 4b. General Relativistic Black Hole Tidal Pull, Point-of-No-Return Capture, Time Dilation & Plunge
    this.blackHoleTimeDilation = 1.0;
    this.blackHoleProximity = 0.0;
    this.blackHoleHorizonWarning = false;
    this.blackHoleLastDist = null;
    this.blackHoleLastRadius = null;
    const prevPointOfNoReturn = this.blackHolePointOfNoReturn;
    this.blackHolePointOfNoReturn = false;

    const bhNode = this.bodyNodes.find((n) => n.def.kind === 'black-hole');
    if (bhNode && !this.isLanded) {
      const bdx = this.playerPos.x - bhNode.worldPos.x;
      const bdy = this.playerPos.y - bhNode.worldPos.y;
      const bdz = this.playerPos.z - bhNode.worldPos.z;
      const bDist = Math.sqrt(bdx * bdx + bdy * bdy + bdz * bdz) || 1;
      const rel = computeBlackHoleRelativity(bDist, bhNode.def.radius);
      this.blackHoleLastDist = bDist;
      this.blackHoleLastRadius = bhNode.def.radius;
      this.blackHoleTimeDilation = rel.timeDilation;
      this.blackHoleProximity = rel.dreadIntensity;
      this.blackHoleHorizonWarning = rel.horizonWarning;
      this.blackHolePointOfNoReturn = rel.pointOfNoReturn;

      if (rel.dreadIntensity > 0.08) {
        this.discoveredIds.add(bhNode.def.id);
      }

      if (rel.tidalPullAccel > 0) {
        const invB = 1 / bDist;
        const outX = bdx * invB;
        const outY = bdy * invB;
        const outZ = bdz * invB;
        const pullStep = rel.tidalPullAccel * dt;
        this.playerVelocity.x -= outX * pullStep;
        this.playerVelocity.y -= outY * pullStep;
        this.playerVelocity.z -= outZ * pullStep;

        // REALISTIC POINT OF NO RETURN (<= 1.42 Rs):
        // Light-cones tilt strictly inward — strip any outward radial escape velocity and pull relentlessly into the Event Horizon!
        if (rel.pointOfNoReturn) {
          this.cancelWarp();
          const radialOutSpeed =
            this.playerVelocity.x * outX +
            this.playerVelocity.y * outY +
            this.playerVelocity.z * outZ;
          if (radialOutSpeed > -95) {
            const neededInward = radialOutSpeed + 135;
            this.playerVelocity.x -= outX * neededInward;
            this.playerVelocity.y -= outY * neededInward;
            this.playerVelocity.z -= outZ * neededInward;
          }
          if (!prevPointOfNoReturn) {
            this.cameraShakeTrauma = Math.max(this.cameraShakeTrauma, 0.9);
            triggerGamepadHaptics(550, 0.85, 0.95);
            this.scanMsgCounter++;
            this.scanMessage = {
              id: this.scanMsgCounter,
              title: 'HORIZON CAPTURE · POINT OF NO RETURN',
              detail: 'Thrusters overwhelmed by spacetime curvature (v_esc > c). Unable to reverse — bracing for Event Horizon breach...',
            };
            this.scanMsgTimer = 4.2;
            this.emitTelemetry(true);
          }
        }
      }

      // Escalating gravitational-tide hull tremor as the colossal Black Hole looms closer
      if (rel.dreadIntensity > 0.16) {
        const tidalTremor = rel.pointOfNoReturn
          ? 0.72 + rel.dreadIntensity * 0.28
          : rel.horizonWarning
            ? 0.34 + rel.dreadIntensity * 0.56
            : (rel.dreadIntensity - 0.16) * 0.34;
        this.cameraShakeTrauma = Math.max(this.cameraShakeTrauma, tidalTremor);
        if (rel.horizonWarning && this.realTime - this.lastHapticPulseTime > 0.4) {
          this.lastHapticPulseTime = this.realTime;
          triggerGamepadHaptics(380, 0.45 + rel.dreadIntensity * 0.45, 0.55 + rel.dreadIntensity * 0.4);
        }
      }

      if (rel.crossedHorizon) {
        // Plunge irreversibly past the Event Horizon into the extended 22s accelerating-particle void -> 5D Tesseract!
        this.enterBlackHolePlungeNow();
        return;
      }
    }

    // Collision / seamless manual touchdown detection on planetary & lunar surfaces!
    if (nearest && nearest.def.kind !== 'black-hole') {
      if (nearest.altitude < nearest.def.radius * 3.0) {
        this.discoveredIds.add(nearest.def.id);
      }

      const dx = this.playerPos.x - nearest.node.worldPos.x;
      const dy = this.playerPos.y - nearest.node.worldPos.y;
      const dz = this.playerPos.z - nearest.node.worldPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const nx = dx / dist;
      const ny = dy / dist;
      const nz = dz / dist;

      const groundH = nearest.def.landable
        ? sampleProceduralTerrainHeight(
            nx,
            ny,
            nz,
            nearest.def.seed,
            nearest.def.terrainRelief,
            nearest.def.craterDensity,
          )
        : 0;
      const minRadius = nearest.def.radius + groundH + (nearest.def.landable ? 0.05 : nearest.def.radius * 0.14);

      if (dist <= minRadius) {
        this.playerPos.x = nearest.node.worldPos.x + nx * minRadius;
        this.playerPos.y = nearest.node.worldPos.y + ny * minRadius;
        this.playerPos.z = nearest.node.worldPos.z + nz * minRadius;

        if (nearest.def.landable) {
          this.isLanded = true;
          this.landedBodyId = nearest.def.id;
          this.surfaceUp.set(nx, ny, nz);
          this.surfaceWalkX = 0;
          this.surfaceWalkZ = 0;
          this.surfaceAltOffset = 0;
          this.surfaceVerticalVel = 0;
          this.playerVelocity.set(0, 0, 0);
          this.landingSquash = 0.85;
          this.cameraShakeTrauma = 0.28;
          this.landedIds.add(nearest.def.id);
          this.audio.playTouchdown(0.9);
          this.emitTelemetry(true);
        } else {
          // Gentle buoyancy push-back from star corona or gas-giant clouds
          this.playerVelocity.set(nx * 20, ny * 20, nz * 20);
        }
      }
    }
  }

  private updateSceneTransforms(dt: number): void {
    // =========================================================================
    // ISOLATED INTERIOR MODE: EVENT HORIZON PLUNGE & 5TH-DIMENSIONAL TESSERACT
    // Completely hides all outer-space scenes for zero performance impact & total immersion!
    // =========================================================================
    if (this.tesseractStage !== 'outside') {
      const realm = this.ensureTesseractInitialized();
      this.systemGroup.visible = false;
      this.skyDome.visible = false;
      this.starfieldPoints.visible = false;
      this.localParallaxPoints.visible = false;
      this.orbitLinesGroup.visible = false;
      this.localSurface.hide();
      this.warpStreakLines.visible = false;
      this.entryShockMesh.visible = false;
      this.cloudVeilMesh.visible = false;
      this.entryStreaksLines.visible = false;
      this.lensFlare.mesh.visible = false;
      for (const beacon of this.systemBeacons) {
        beacon.sprite.visible = false;
      }

      const isPlunge = this.tesseractStage === 'plunge';
      const plunge = computePlungeDynamics(this.plungeElapsed);

      this.starKeyLight.intensity = 0;
      this.hemiFillLight.intensity = 0;
      const bgHex = isPlunge ? 0x010103 : 0x040202;
      if (this.scene.background instanceof THREE.Color) {
        this.scene.background.setHex(bgHex);
      }
      const targetFogDensity = isPlunge ? 0.0072 : 0.0155;
      if (!this.scene.fog || !(this.scene.fog instanceof THREE.FogExp2)) {
        this.scene.fog = new THREE.FogExp2(bgHex, targetFogDensity);
      } else {
        this.scene.fog.color.setHex(bgHex);
        this.scene.fog.density = targetFogDensity;
      }

      realm.update({
        stage: this.tesseractStage,
        plunge,
        bulkPos: this.tesseractBulkPos,
        pulseProgress: this.tesseractPulseProgress,
        decodedAnchorIds: this.decodedTesseractAnchors,
        time: this.realTime,
        pixelRatio: this.renderer.getPixelRatio(),
      });

      // Keep Voyager humblingly compact inside the infinite 5D Bulk & Event Horizon Plunge
      this.voyagerScale += (0.28 - this.voyagerScale) * (1 - Math.exp(-8 * dt));
      this.voyager.root.scale.setScalar(this.voyagerScale);

      this._euler.set(this.pitch, this.yaw, 0, 'YXZ');
      this._camQuat.setFromEuler(this._euler);
      this.voyager.root.position.set(0, 0, 0);
      this.voyager.root.quaternion.slerp(this._camQuat, 1 - Math.exp(-9 * dt));
      this.voyager.root.visible = this.cameraMode === 'third-person';
      this.voyager.updatePose({
        dt,
        time: this.realTime,
        isLanded: false,
        walkDistance: 0,
        speedNorm: isPlunge ? 0.92 : Math.min(0.45, this.currentSpeed / 25),
        isBoosting: isPlunge,
        isJumping: false,
        turnBank: isPlunge ? Math.sin(this.realTime * 2.4) * 0.58 : 0,
        landingSquash: 0,
      });

      const targetFov = isPlunge ? 64 + plunge.progress * 28 : 64;
      this.currentFov += (targetFov - this.currentFov) * (1 - Math.exp(-5 * dt));
      if (Math.abs(this.camera.fov - this.currentFov) > 0.05) {
        this.camera.fov = this.currentFov;
        this.camera.updateProjectionMatrix();
      }

      this._forward.set(0, 0, -1).applyQuaternion(this._camQuat);
      this._right.set(1, 0, 0).applyQuaternion(this._camQuat);
      this._up.set(0, 1, 0).applyQuaternion(this._camQuat);

      if (this.cameraMode === 'first-person') {
        this.camera.position.set(0, 0, 0).addScaledVector(this._up, 0.85);
      } else {
        const followDist = isPlunge ? 4.35 : 4.2;
        const followUp = isPlunge ? 1.05 : 1.18;
        this.camera.position
          .set(0, 0, 0)
          .addScaledVector(this._forward, -followDist)
          .addScaledVector(this._up, followUp);
      }

      // Layered multi-frequency tidal vibration + rotational shudder during the 12.5s Event Horizon plunge
      this.camera.quaternion.copy(this._camQuat);
      if (this.cameraShakeTrauma > 0.005) {
        const t2 = this.cameraShakeTrauma * this.cameraShakeTrauma;
        const rt = this.realTime;
        const jitterX = (Math.sin(rt * 37.3) * 0.55 + Math.cos(rt * 61.7) * 0.45) * t2 * 0.24;
        const jitterY = (Math.cos(rt * 43.1) * 0.55 + Math.sin(rt * 71.9) * 0.45) * t2 * 0.24;
        this.camera.position.addScaledVector(this._right, jitterX);
        this.camera.position.addScaledVector(this._up, jitterY);
        const rollShake = (Math.sin(rt * 23.4) * 0.6 + Math.cos(rt * 47.2) * 0.4) * t2 * 0.058;
        const pitchShake = Math.sin(rt * 31.8) * t2 * 0.028;
        this._shakeEuler.set(pitchShake, 0, rollShake, 'YXZ');
        this._shakeQuat.setFromEuler(this._shakeEuler);
        this.camera.quaternion.multiply(this._shakeQuat);
      }

      this.audio.update(
        {
          regime: isPlunge ? 'SINGULARITY' : 'TESSERACT',
          atmosphereDensity: 0,
          soundProfile: 'vacuum',
          speedNorm: isPlunge ? 0.9 : 0.15,
          isWarping: false,
          isBoosting: false,
          starProximity: 0,
          blackHoleProximity: 1,
          tesseractStage: this.tesseractStage,
          plungeProgress: plunge.progress,
          paused: this.phase !== 'playing',
        },
        this.realTime,
      );
      return;
    }

    // Restore outer-space universe visibility & stark realistic space lighting whenever outside the Black Hole
    this.tesseractRealm?.hide();
    this.systemGroup.visible = true;
    this.skyDome.visible = true;
    this.starfieldPoints.visible = true;
    this.localParallaxPoints.visible = true;
    this.starKeyLight.intensity = 3.55;
    this.hemiFillLight.intensity = 0.045;
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.setHex(0x000103);
    }

    const nearest = this.findNearestBody();
    const primaryStarNode =
      this.bodyNodes.find((n) => n.def.kind === 'star' || n.def.kind === 'black-hole') ||
      this.bodyNodes[0];

    const landedBodyDef = this.isLanded && this.landedBodyId ? BODY_BY_ID[this.landedBodyId] : null;
    const activeLowBiomeBodyId =
      nearest && nearest.def.landable && (this.isLanded || nearest.altitude < 7.5)
        ? nearest.def.id
        : null;

    // 1. Floating-origin placement of every celestial body in the active star system
    for (const node of this.bodyNodes) {
      // When standing on a planetary surface, only keep the primary star/black hole, the world's own moons,
      // or its parent gas giant/planet visible in the sky — never show compressed far-shell planets floating in daytime!
      if (landedBodyDef) {
        const isStarOrBh = node.def.kind === 'star' || node.def.kind === 'black-hole';
        const isMoonOfLanded = node.def.parentId === landedBodyDef.id;
        const isParentOfLanded = Boolean(landedBodyDef.parentId && node.def.id === landedBodyDef.parentId);
        const isSelf = node.def.id === landedBodyDef.id;
        node.group.visible = isStarOrBh || isMoonOfLanded || isParentOfLanded || isSelf;
      } else {
        node.group.visible = true;
      }

      const dx = node.worldPos.x - this.playerPos.x;
      const dy = node.worldPos.y - this.playerPos.y;
      const dz = node.worldPos.z - this.playerPos.z;
      const trueDist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

      if (trueDist <= NEAR_SPACE_LIMIT) {
        node.group.position.set(dx, dy, dz);
        node.group.scale.setScalar(1);
      } else {
        const extra = trueDist - NEAR_SPACE_LIMIT;
        const compressedDist =
          FAR_SHELL_START + (FAR_SHELL_SPAN * extra) / (extra + 22_000);
        const ratio = compressedDist / trueDist;
        node.group.position.set(dx * ratio, dy * ratio, dz * ratio);
        node.group.scale.setScalar(Math.max(ratio, 0.002));
      }

      // Hide the orbital sphere seamlessly once Voyager breaks beneath the cloud deck into the 1:1 360m planetary biome!
      const isHiddenForBiome = activeLowBiomeBodyId === node.def.id;
      node.surfaceMesh.visible = !isHiddenForBiome;
      if (node.nightLightsMesh) {
        node.nightLightsMesh.visible = !isHiddenForBiome;
      }
      if (node.cloudMesh) {
        node.cloudMesh.visible = !isHiddenForBiome;
      }

      // Spin planet/star & drift clouds
      if (node.def.kind !== 'black-hole') {
        node.surfaceMesh.rotation.y += node.def.rotationSpeed * dt;
        if (node.nightLightsMesh) {
          node.nightLightsMesh.rotation.y = node.surfaceMesh.rotation.y;
        }
      }
      if (node.cloudMesh) {
        node.cloudMesh.rotation.y += node.def.rotationSpeed * 1.38 * dt;
      }
      if (node.nightLightsMat && primaryStarNode && node !== primaryStarNode) {
        node.nightLightsMat.uniforms.uSunDir.value
          .set(
            primaryStarNode.worldPos.x - node.worldPos.x,
            primaryStarNode.worldPos.y - node.worldPos.y,
            primaryStarNode.worldPos.z - node.worldPos.z,
          )
          .normalize();
      }
      if (node.starMat) {
        node.starMat.uniforms.uTime.value = this.realTime;
      }

      // Update General Relativistic Black Hole Geodesic Shader uniforms & Hawking radiation proximity
      if (node.blackHoleMat) {
        const groupScale = node.group.scale.x;
        const scaledRs = node.def.radius * groupScale;
        const scaledOuter = node.def.radius * 11.5 * groupScale;
        node.blackHoleMat.uniforms.uBlackHoleCenter.value.copy(node.group.position);
        node.blackHoleMat.uniforms.uSchwarzschildRadius.value = scaledRs;
        node.blackHoleMat.uniforms.uOuterRadius.value = scaledOuter;
        node.blackHoleMat.uniforms.uTime.value = this.realTime;

        const tiltRad = THREE.MathUtils.degToRad(node.def.axialTiltDeg);
        node.blackHoleMat.uniforms.uDiskNormal.value
          .set(-Math.sin(tiltRad), Math.cos(tiltRad), 0.14)
          .normalize();

        const camDistToBh = this.camera.position.distanceTo(node.group.position);
        const bhSide = camDistToBh < scaledOuter + 2.5 ? THREE.BackSide : THREE.FrontSide;
        if (node.blackHoleMat.side !== bhSide) {
          node.blackHoleMat.side = bhSide;
        }

        const hawking = computeHawkingRadiationProfile(camDistToBh, scaledRs);
        const [pr, pg, pb] = hawking.primaryColor;
        const [sr, sg, sb] = hawking.secondaryColor;

        node.blackHoleMat.uniforms.uHawkingProximity.value = hawking.proximity;
        node.blackHoleMat.uniforms.uHawkingIntensity.value = hawking.intensity;
        node.blackHoleMat.uniforms.uHawkingColorPrimary.value.setRGB(pr, pg, pb);
        node.blackHoleMat.uniforms.uHawkingColorSecondary.value.setRGB(sr, sg, sb);

        if (node.hawkingMat) {
          node.hawkingMat.uniforms.uBlackHoleCenter.value.copy(node.group.position);
          node.hawkingMat.uniforms.uSchwarzschildRadius.value = scaledRs;
          node.hawkingMat.uniforms.uDiskNormal.value.copy(
            node.blackHoleMat.uniforms.uDiskNormal.value,
          );
          node.hawkingMat.uniforms.uTime.value = this.realTime;
          node.hawkingMat.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
          node.hawkingMat.uniforms.uHawkingProximity.value = hawking.proximity;
          node.hawkingMat.uniforms.uHawkingIntensity.value = hawking.intensity;
          node.hawkingMat.uniforms.uEmissionSpeed.value = hawking.emissionSpeed;
          node.hawkingMat.uniforms.uHawkingColorPrimary.value.setRGB(pr, pg, pb);
          node.hawkingMat.uniforms.uHawkingColorSecondary.value.setRGB(sr, sg, sb);
        }
      }

      // Update dynamic Rayleigh & Mie scattering uniforms
      if (node.atmoMat && primaryStarNode && node !== primaryStarNode) {
        const sx = primaryStarNode.worldPos.x - node.worldPos.x;
        const sy = primaryStarNode.worldPos.y - node.worldPos.y;
        const sz = primaryStarNode.worldPos.z - node.worldPos.z;
        const groupScale = node.group.scale.x;
        const atmoShellRatio = 1 + Math.max(0.085, (node.def.atmosphere?.heightRatio ?? 0.06) * 1.45);
        const scaledAtmoRadius = node.def.radius * atmoShellRatio * groupScale;
        node.atmoMat.uniforms.uPlanetCenter.value.copy(node.group.position);
        node.atmoMat.uniforms.uPlanetRadius.value = node.def.radius * groupScale;
        node.atmoMat.uniforms.uAtmoRadius.value = scaledAtmoRadius;
        node.atmoMat.uniforms.uSunDir.value.set(sx, sy, sz).normalize();
        node.atmoMat.uniforms.uSunColor.value.set(primaryStarNode.def.starColor || '#fff4dc');
        node.atmoMat.uniforms.uTime.value = this.realTime;
        node.atmoMat.uniforms.uImmersion.value = 0;
        node.atmoMat.uniforms.uEntryGlow.value = 0;

        const camDistToPlanet = this.camera.position.distanceTo(node.group.position);
        const targetSide = camDistToPlanet < scaledAtmoRadius + 0.8 ? THREE.BackSide : THREE.FrontSide;
        if (node.atmoMat.side !== targetSide) {
          node.atmoMat.side = targetSide;
        }
        // Hide outer Rayleigh shell seamlessly once inside the 1:1 surface biome (skyDome owns the crisp sky vault)
        if (node.atmoMesh) {
          node.atmoMesh.visible = !isHiddenForBiome;
        }
      }
    }

    // Position orbit path lines & asteroid belt relative to primary star
    if (primaryStarNode) {
      const sx = primaryStarNode.worldPos.x - this.playerPos.x;
      const sy = primaryStarNode.worldPos.y - this.playerPos.y;
      const sz = primaryStarNode.worldPos.z - this.playerPos.z;
      const sDist = Math.sqrt(sx * sx + sy * sy + sz * sz);
      const showOrbits =
        !this.isLanded && sDist < 95_000 && (!nearest || nearest.altitude > nearest.def.radius * 0.45);
      this.orbitLinesGroup.visible = showOrbits;
      if (showOrbits) {
        this.orbitLinesGroup.position.set(sx, sy, sz);
      }
      if (this.asteroidBeltMesh) {
        this.asteroidBeltMesh.visible = !this.isLanded && sDist < 52_000;
        if (this.asteroidBeltMesh.visible) {
          this.asteroidBeltMesh.position.set(sx, sy, sz);
          this.asteroidBeltMesh.rotation.y = this.simTime * 0.0005;
        }
      }

      // Aim warm solar key light from the star toward the player/nearby planet!
      this.starKeyLight.position.set(sx, sy, sz).normalize().multiplyScalar(120);
      this.starKeyLight.color.set(primaryStarNode.def.starColor || '#fff2dc');
    }

    // 2. Position 3D Interstellar Known Star Beacons on far parallax shell
    for (const beacon of this.systemBeacons) {
      const dx = beacon.position.x - this.playerPos.x;
      const dy = beacon.position.y - this.playerPos.y;
      const dz = beacon.position.z - this.playerPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < 160_000 || this.isLanded) {
        beacon.sprite.visible = false;
      } else {
        beacon.sprite.visible = true;
        const shellR = 60_000;
        beacon.sprite.position.set((dx / dist) * shellR, (dy / dist) * shellR, (dz / dist) * shellR);
        const distLy = dist / LY_UNITS;
        const glowSize = THREE.MathUtils.clamp(4_600 / Math.pow(distLy + 1.5, 0.55), 720, 4_800);
        beacon.sprite.scale.set(glowSize, glowSize, 1);
      }
    }

    // 3. Dynamic Dual-Mode Planetary Surface System & Physically-Based Atmospheric Entry Scattering
    let atmoBlend = 0;
    let entryGlowTarget = 0;
    let entryBuffeting = 0;
    let starFadeTarget = 0;
    let activeFogDensity = 0;
    const sunColorHex = primaryStarNode?.def.starColor || '#fff4dc';

    if (nearest) {
      const dx = this.playerPos.x - nearest.node.worldPos.x;
      const dy = this.playerPos.y - nearest.node.worldPos.y;
      const dz = this.playerPos.z - nearest.node.worldPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      if (this.isLanded && this.landedBodyId === nearest.def.id) {
        this._v2.copy(this.surfaceUp);
      } else {
        this._v2.set(dx / dist, dy / dist, dz / dist);
      }
      this._v3.set(
        nearest.node.worldPos.x - this.playerPos.x,
        nearest.node.worldPos.y - this.playerPos.y,
        nearest.node.worldPos.z - this.playerPos.z,
      );

      // Compute star elevation at the player's current planetary longitude/latitude
      let sunElevCos = 0.45;
      if (primaryStarNode && nearest.node !== primaryStarNode) {
        this._sunDirScratch
          .set(
            primaryStarNode.worldPos.x - nearest.node.worldPos.x,
            primaryStarNode.worldPos.y - nearest.node.worldPos.y,
            primaryStarNode.worldPos.z - nearest.node.worldPos.z,
          )
          .normalize();
        sunElevCos = this._v2.dot(this._sunDirScratch);
      } else {
        this._sunDirScratch.set(0.7, 0.5, 0.5).normalize();
      }

      const entryState = computeAtmosphericEntryState(
        nearest.def,
        this.isLanded ? 0 : nearest.altitude,
        this.currentSpeed,
        sunElevCos,
      );

      atmoBlend = entryState.immersion;
      entryGlowTarget = this.isLanded ? 0 : entryState.entryGlow;
      entryBuffeting = this.isLanded ? 0 : entryState.buffeting;
      starFadeTarget = entryState.starAttenuation;

      // Feed real-time immersion & refractive entry airglow into the planet's Rayleigh shader shell
      if (nearest.node.atmoMat) {
        nearest.node.atmoMat.uniforms.uImmersion.value = entryState.immersion;
        nearest.node.atmoMat.uniforms.uEntryGlow.value = entryGlowTarget;
      }

      // Sync Rayleigh zenith-to-horizon sky dome vault with planet optical parameters
      if (nearest.def.atmosphere && entryState.immersion > 0.005) {
        const rayleigh = getPlanetRayleighParams(nearest.def);
        this._skyTargetCol.set(nearest.def.atmosphere.horizonColor);
        const skyDamp = 1 - Math.exp(-6 * dt);
        this.skyDomeMat.uniforms.uSkyTint.value.lerp(this._skyTargetCol, skyDamp);
        this.skyDomeMat.uniforms.uSurfaceUp.value.copy(this._v2);
        this.skyDomeMat.uniforms.uSunDir.value.copy(this._sunDirScratch);
        this.skyDomeMat.uniforms.uSunColor.value.set(sunColorHex);
        this.skyDomeMat.uniforms.uBetaR.value.set(...rayleigh.betaRayleigh);
        this.skyDomeMat.uniforms.uBetaM.value.set(...rayleigh.betaMie);
      }

      // Horizon aerial-perspective fog inside lower planetary atmospheres & surface biomes
      // (Keep upper mesosphere/stratosphere crystal-clear so Earth's blue oceans & clouds stay vivid during re-entry!)
      const lowAltFogBlend = this.isLanded
        ? 1.0
        : THREE.MathUtils.clamp(1 - nearest.altitude / Math.max(4, nearest.def.radius * 0.08), 0, 1);
      if (atmoBlend > 0.1 && lowAltFogBlend > 0.02 && nearest.def.atmosphere) {
        this._fogCol.set(nearest.def.atmosphere.horizonColor);
        activeFogDensity = (this.isLanded ? 0.0044 : 0.0052) * atmoBlend * lowAltFogBlend;
      }

      const isLandedOnNearest = this.isLanded && this.landedBodyId === nearest.def.id;
      this.localSurface.updateForBody({
        body: nearest.def,
        surfaceNormal: this._v2,
        bodyLocalOffset: this._v3,
        altitude: nearest.altitude,
        isLanded: isLandedOnNearest,
        walkX: this.surfaceWalkX,
        walkZ: this.surfaceWalkZ,
        playerAltOffset: this.surfaceAltOffset,
        sunDirWorld: this._sunDirScratch,
        sunColorHex,
        skyColorHex: nearest.def.atmosphere?.color ?? '#1e3a5f',
        fogColorHex: nearest.def.atmosphere?.horizonColor ?? '#0b1322',
        fogDensity: activeFogDensity,
        time: this.realTime,
        maxAnisotropy: this.maxAnisotropy,
      });

      // Smoothly transition hemisphere sky bounce lighting from pitch-black space vacuum (0.045)
      // into realistic sunlit planetary atmospheric scatter as Voyager descends into an atmosphere!
      const dayFactor = THREE.MathUtils.clamp((sunElevCos + 0.16) * 1.08, 0.08, 1.0);
      if (isLandedOnNearest || (nearest.def.landable && nearest.altitude < 7.5)) {
        this.hemiFillLight.color.set(nearest.def.atmosphere?.color ?? '#8fb8e8');
        this.hemiFillLight.groundColor.set(nearest.def.palette[1]);
        this.hemiFillLight.intensity = nearest.def.atmosphere
          ? 0.68 * dayFactor
          : 0.12 * dayFactor; // Airless moons keep dramatic high-contrast lunar shadows!
      } else if (atmoBlend > 0.02 && nearest.def.atmosphere) {
        this.hemiFillLight.color.set(nearest.def.atmosphere.color);
        this.hemiFillLight.groundColor.set('#080b14');
        this.hemiFillLight.intensity = 0.045 + atmoBlend * 0.52 * dayFactor;
      } else {
        this.hemiFillLight.color.set('#3b5582');
        this.hemiFillLight.groundColor.set('#06080f');
        this.hemiFillLight.intensity = 0.045;
      }

      // 3D Volumetric Cloud-Deck Penetration Veil: swells gently around alt = 5..12.5 on cloudy worlds
      // so punching through clouds into the 1:1 terrain biome feels unbroken and awe-inspiring!
      const hasClouds = Boolean(nearest.def.atmosphere && nearest.def.atmosphere.density > 0.15);
      if (!this.isLanded && hasClouds && nearest.altitude > 3.2 && nearest.altitude < 14.0) {
        const cloudPeak = Math.exp(-Math.pow((nearest.altitude - 7.6) / 2.6, 2));
        const veilDensity = cloudPeak * Math.min(1, nearest.def.atmosphere!.density * 0.9) * 0.72;
        this.cloudVeilMesh.visible = veilDensity > 0.015;
        if (this.cloudVeilMesh.visible) {
          this.cloudVeilMesh.position.copy(this.camera.position);
          this.cloudVeilMat.uniforms.uTime.value = this.realTime;
          this.cloudVeilMat.uniforms.uDensity.value = veilDensity;
          this.cloudVeilMat.uniforms.uSunDir.value.copy(this._sunDirScratch);
          this.cloudVeilMat.uniforms.uSunColor.value.set(sunColorHex);
          const arch = nearest.def.archetype;
          const veilHex =
            arch === 'mars'
              ? '#c87e52'
              : arch === 'titan' || arch === 'venus'
                ? '#d8ad68'
                : '#dbe8f8';
          this.cloudVeilMat.uniforms.uCloudColor.value
            .set(veilHex)
            .multiplyScalar(0.18 + 0.88 * dayFactor);
        }
      } else {
        this.cloudVeilMesh.visible = false;
      }
    } else {
      this.localSurface.hide();
      this.cloudVeilMesh.visible = false;
    }

    const skyLerp = 1 - Math.exp(-5 * dt);
    this.skyDomeMat.uniforms.uTime.value = this.realTime;
    this.skyDomeMat.uniforms.uAtmoBlend.value +=
      (atmoBlend - this.skyDomeMat.uniforms.uAtmoBlend.value) * skyLerp;
    this.skyDomeMat.uniforms.uEntryGlow.value +=
      (entryGlowTarget - this.skyDomeMat.uniforms.uEntryGlow.value) * skyLerp;

    // Deep spectral starfield shader uniforms (scintillation + atmospheric daytime attenuation)
    const targetStarOpacity = 0.96 * (1 - starFadeTarget);
    this.starfieldMat.uniforms.uOpacity.value +=
      (targetStarOpacity - this.starfieldMat.uniforms.uOpacity.value) * skyLerp;
    this.starfieldMat.uniforms.uTime.value = this.realTime;
    this.starfieldMat.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
    this.starfieldMat.uniforms.uTwinkleAmount.value = Math.min(1, atmoBlend * 0.85);

    // 3D Parallax local cosmic dust shell (visible in vacuum/orbit for unmistakable depth motion)
    const parallaxTargetOp = this.isLanded ? 0 : 0.48 * (1 - atmoBlend * 0.95);
    this.localParallaxPoints.visible = parallaxTargetOp > 0.015;
    if (this.localParallaxPoints.visible) {
      const span = 1600;
      this.localParallaxMat.uniforms.uPlayerMod.value.set(
        ((this.playerPos.x % span) + span) % span,
        ((this.playerPos.y % span) + span) % span,
        ((this.playerPos.z % span) + span) % span,
      );
      this.localParallaxMat.uniforms.uOpacity.value = parallaxTargetOp;
      this.localParallaxMat.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
    }

    // Apply atmospheric aerial-perspective FogExp2
    if (activeFogDensity > 0.0005) {
      if (!this.scene.fog || !(this.scene.fog instanceof THREE.FogExp2)) {
        this.scene.fog = new THREE.FogExp2(this._fogCol.getHex(), activeFogDensity);
      } else {
        this.scene.fog.color.copy(this._fogCol);
        this.scene.fog.density = activeFogDensity;
      }
    } else if (this.scene.fog) {
      this.scene.fog = null;
    }

    // 4. Voyager Character Orientation & Third-Person / First-Person Camera Rig
    const speedNorm = THREE.MathUtils.clamp(Math.log10(1 + this.currentSpeed) / 5.5, 0, 1);
    const isBoost =
      this.keysHeld.has('ShiftLeft') ||
      this.keysHeld.has('ShiftRight') ||
      this.gamepadInput.boostHeld ||
      this.warpTargetBodyId !== null;

    const turnBank =
      (this.keysHeld.has('KeyA') || this.keysHeld.has('ArrowLeft') ? 1 : 0) -
      (this.keysHeld.has('KeyD') || this.keysHeld.has('ArrowRight') ? 1 : 0);

    if (this.isLanded) {
      this._alignQuat.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, this.surfaceUp);
      this._euler.set(0, this.yaw, 0, 'YXZ');
      this._bodyQuat.setFromEuler(this._euler).premultiply(this._alignQuat);
      this.voyager.root.position.set(0, 0, 0);
      this.voyager.root.quaternion.slerp(this._bodyQuat, 1 - Math.exp(-14 * dt));

      this._euler.set(this.pitch, this.yaw, 0, 'YXZ');
      this._camQuat.setFromEuler(this._euler).premultiply(this._alignQuat);
    } else {
      this._euler.set(this.pitch, this.yaw, 0, 'YXZ');
      this._camQuat.setFromEuler(this._euler);
      this.voyager.root.position.set(0, 0, 0);
      this.voyager.root.quaternion.slerp(this._camQuat, 1 - Math.exp(-10 * dt));
    }

    // Make Voyager feel genuinely tiny and humbling against colossal planets, stars & the Black Hole!
    // In space/orbit: 0.22x (shrinking further to 0.17x near Sagittarius A* or stars!),
    // smoothly growing to full 1:1 human scale (1.0x) as Voyager breaks beneath the clouds to land!
    let targetVoyagerScale = 0.22;
    if (this.isLanded) {
      targetVoyagerScale = 1.0;
    } else if (nearest && nearest.def.landable && nearest.altitude < 7.5) {
      const landT = 1 - Math.max(0, Math.min(1, nearest.altitude / 7.5));
      targetVoyagerScale = 0.22 + landT * landT * 0.78;
    } else if (
      this.blackHoleProximity > 0.1 ||
      nearest?.def.kind === 'black-hole' ||
      nearest?.def.kind === 'star'
    ) {
      targetVoyagerScale = 0.17;
    }
    this.voyagerScale += (targetVoyagerScale - this.voyagerScale) * (1 - Math.exp(-7 * dt));
    this.voyager.root.scale.setScalar(this.voyagerScale);

    this.voyager.root.visible = this.cameraMode === 'third-person';
    this.voyager.updatePose({
      dt,
      time: this.realTime,
      isLanded: this.isLanded,
      walkDistance: this.walkDistance,
      speedNorm,
      isBoosting: isBoost,
      isJumping: this.isLanded && this.surfaceAltOffset > 0.08,
      turnBank,
      landingSquash: this.landingSquash,
    });

    // Atmospheric Re-Entry Ionized Plasma Bow-Shock Cone, 3D Thermal Sparks & Max-Q Aerodynamic Buffeting
    const showShock = !this.isLanded && this.phase === 'playing' && entryGlowTarget > 0.04;
    this.entryShockMesh.visible = showShock;
    const velMag = this.playerVelocity.length();
    if (velMag > 1.0) {
      this._v1.copy(this.playerVelocity).normalize();
    } else {
      this._v1.set(0, 0, -1).applyQuaternion(this._camQuat);
    }

    if (showShock) {
      const palette = nearest ? getEntryPlasmaPalette(nearest.def) : null;
      if (palette) {
        this.entryShockMat.uniforms.uColorHot.value.set(palette.noseHot);
        this.entryShockMat.uniforms.uColorPlasma.value.set(palette.shockCore);
        this.entryShockMat.uniforms.uColorIon.value.set(palette.wakeIon);
      }
      this.entryShockMesh.scale.setScalar(this.voyagerScale * 1.85);
      this.entryShockMesh.position.copy(this._v1).multiplyScalar(0.45 * this.voyagerScale);
      this._bodyQuat.setFromUnitVectors(this._v2.set(0, 0, -1), this._v1);
      this.entryShockMesh.quaternion.copy(this._bodyQuat);
      this.entryShockMat.uniforms.uTime.value = this.realTime;
      this.entryShockMat.uniforms.uIntensity.value = Math.min(1.0, entryGlowTarget * 1.25);
    }

    // Layered Max-Q aerodynamic turbulence & re-entry vibration
    if (!this.isLanded && this.phase === 'playing' && (entryBuffeting > 0.04 || entryGlowTarget > 0.04)) {
      const aeroTrauma = Math.min(0.85, entryBuffeting * 0.42 + entryGlowTarget * 0.44);
      this.cameraShakeTrauma = Math.max(this.cameraShakeTrauma, aeroTrauma);
      if (aeroTrauma > 0.24 && this.realTime - this.lastHapticPulseTime > 0.36) {
        this.lastHapticPulseTime = this.realTime;
        triggerGamepadHaptics(320, aeroTrauma * 0.65, aeroTrauma * 0.78);
      }
    }

    // 3D Atmospheric Thermal Sparks (hot plasma) & Stratospheric Wind-Shear Streaks rushing past Voyager
    const entryStreakAlpha =
      !this.isLanded && this.phase === 'playing'
        ? THREE.MathUtils.clamp(entryGlowTarget * 1.1 + entryBuffeting * 0.65, 0, 0.92)
        : 0;
    this.entryStreaksLines.visible = entryStreakAlpha > 0.03;
    if (this.entryStreaksLines.visible) {
      this.entryStreaksMat.opacity = entryStreakAlpha;
      const palette = nearest ? getEntryPlasmaPalette(nearest.def) : null;
      if (palette && entryGlowTarget > 0.14) {
        this.entryStreaksMat.color.set(palette.shockCore).lerp(this._skyTargetCol.set(palette.noseHot), 0.32);
      } else {
        this.entryStreaksMat.color.setHex(0xcbe4ff);
      }
      // Build orthonormal basis around flight velocity vector _v1
      this._v2.set(0, 1, 0);
      if (Math.abs(this._v1.dot(this._v2)) > 0.92) this._v2.set(1, 0, 0);
      this._v3.crossVectors(this._v1, this._v2).normalize();
      this._v2.crossVectors(this._v3, this._v1).normalize();

      const streakLen = 0.85 + entryGlowTarget * 3.8 + entryBuffeting * 2.2;
      const scroll = (this.realTime * (26 + entryGlowTarget * 58 + entryBuffeting * 34)) % 34;
      const count = this.entryStreaksBase.length / 3;
      const posArr = this.entryStreaksPos;
      for (let i = 0; i < count; i++) {
        const bx = this.entryStreaksBase[i * 3];
        const by = this.entryStreaksBase[i * 3 + 1];
        let bz = this.entryStreaksBase[i * 3 + 2] - scroll;
        if (bz < -17) bz += 34;

        const px = this._v3.x * bx + this._v2.x * by + this._v1.x * bz;
        const py = this._v3.y * bx + this._v2.y * by + this._v1.y * bz;
        const pz = this._v3.z * bx + this._v2.z * by + this._v1.z * bz;

        const idx = i * 6;
        posArr[idx] = px;
        posArr[idx + 1] = py;
        posArr[idx + 2] = pz;
        posArr[idx + 3] = px - this._v1.x * streakLen;
        posArr[idx + 4] = py - this._v1.y * streakLen;
        posArr[idx + 5] = pz - this._v1.z * streakLen;
      }
      (this.entryStreaksLines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }

    // Dynamic FOV kick on high speed, warp, atmospheric re-entry & terrifying black hole gravitational depth
    const targetFov =
      this.phase === 'title'
        ? 54
        : this.isLanded
          ? 62
          : 60 +
            speedNorm * 13 +
            (isBoost ? 9 : 0) +
            this.blackHoleProximity * 11 +
            entryGlowTarget * 7;
    this.currentFov += (targetFov - this.currentFov) * (1 - Math.exp(-6 * dt));
    if (Math.abs(this.camera.fov - this.currentFov) > 0.05) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }

    // Position camera relative to floating-origin Voyager
    this._forward.set(0, 0, -1).applyQuaternion(this._camQuat);
    this._right.set(1, 0, 0).applyQuaternion(this._camQuat);
    this._up.set(0, 1, 0).applyQuaternion(this._camQuat);

    if (this.phase === 'title') {
      this.camera.position
        .set(0, 0, 0)
        .addScaledVector(this._forward, -3.5)
        .addScaledVector(this._up, 1.12)
        .addScaledVector(this._right, -0.72);
    } else if (this.cameraMode === 'first-person') {
      const bob =
        this.isLanded && this.surfaceAltOffset <= 0.04 && this.currentSpeed > 0.4
          ? Math.sin(this.walkDistance * 7.2) * 0.06
          : 0;
      const eyeHeight = this.isLanded ? 1.64 + bob : 0.85;
      this.camera.position.set(0, 0, 0).addScaledVector(this._up, eyeHeight);
    } else {
      // Wide dramatic 3rd-person framing in space so our 0.17x-0.22x Voyager appears genuinely tiny (~6-7% of viewport)
      // against monumental planets and the terrifying Event Horizon, smoothly tightening to 1:1 on touchdown!
      const scaleT = THREE.MathUtils.clamp((this.voyagerScale - 0.17) / 0.83, 0, 1);
      const followDist = THREE.MathUtils.lerp(4.45 + speedNorm * 0.65, 4.8, scaleT);
      const followUp = THREE.MathUtils.lerp(0.68, 2.1, scaleT);
      this.camera.position
        .set(0, 0, 0)
        .addScaledVector(this._forward, -followDist)
        .addScaledVector(this._up, followUp);

      // Prevent 3rd-person camera from ever dipping below rolling planetary hills while walking
      if (this.isLanded && nearest && nearest.def.id === this.landedBodyId) {
        this._invQuat.copy(this._alignQuat).invert();
        this._v1.copy(this.camera.position).applyQuaternion(this._invQuat);
        const playerGroundH = sampleSurfaceBiomeHeight(
          this.surfaceWalkX,
          this.surfaceWalkZ,
          nearest.def,
        );
        const camGroundH = sampleSurfaceBiomeHeight(
          this.surfaceWalkX + this._v1.x,
          this.surfaceWalkZ + this._v1.z,
          nearest.def,
        );
        const camWorldY = playerGroundH + this.surfaceAltOffset + this._v1.y;
        const minCamY = camGroundH + 0.72;
        if (camWorldY < minCamY) {
          this.camera.position.addScaledVector(this.surfaceUp, minCamY - camWorldY);
        }
      }
    }

    // Layered multi-frequency camera vibration & fuselage roll shudder (sonic booms, Max-Q entry, Black Hole tide)
    this.camera.quaternion.copy(this._camQuat);
    if (this.cameraShakeTrauma > 0.005) {
      const t2 = this.cameraShakeTrauma * this.cameraShakeTrauma;
      const rt = this.realTime;
      const jitterX = (Math.sin(rt * 39.2) * 0.55 + Math.cos(rt * 67.4) * 0.45) * t2 * 0.19;
      const jitterY = (Math.cos(rt * 45.7) * 0.55 + Math.sin(rt * 73.1) * 0.45) * t2 * 0.19;
      this.camera.position.addScaledVector(this._right, jitterX);
      this.camera.position.addScaledVector(this._up, jitterY);
      const rollShake = (Math.sin(rt * 25.3) * 0.6 + Math.cos(rt * 51.8) * 0.4) * t2 * 0.044;
      const pitchShake = Math.sin(rt * 33.6) * t2 * 0.022;
      this._shakeEuler.set(pitchShake, 0, rollShake, 'YXZ');
      this._shakeQuat.setFromEuler(this._shakeEuler);
      this.camera.quaternion.multiply(this._shakeQuat);
    }

    // 4b. Dynamic Optical Star Lens Flare System (camera-angle & planetary/lunar/horizon obscuration!)
    if (primaryStarNode && primaryStarNode.def.kind === 'star') {
      this.flareOccluders.length = 0;
      for (const node of this.bodyNodes) {
        if (node === primaryStarNode || !node.group.visible) continue;
        // When standing on a planet's 360m surface biome, horizon sunset occultation replaces the tiny sphere
        if (this.isLanded && node.def.id === this.landedBodyId) continue;
        this.flareOccluders.push({
          x: node.group.position.x,
          y: node.group.position.y,
          z: node.group.position.z,
          radius: node.def.radius * node.group.scale.x,
        });
      }

      const flareState = computeStarLensFlareState({
        cameraPos: this.camera.position,
        cameraForward: this._forward,
        cameraRight: this._right,
        cameraUp: this._up,
        fovRad: THREE.MathUtils.degToRad(this.camera.fov),
        aspect: this.camera.aspect,
        starPos: primaryStarNode.group.position,
        starRadius: primaryStarNode.def.radius * primaryStarNode.group.scale.x,
        occluders: this.flareOccluders,
        landedSurfaceUp: this.isLanded ? this.surfaceUp : null,
        atmosphereImmersion: atmoBlend,
      });

      this.lensFlare.update({
        state: flareState,
        starColorHex: primaryStarNode.def.starColor || '#fff2d8',
        aspect: this.camera.aspect,
        cameraRollRad: this.yaw * 0.35 + this.pitch * 0.45,
        time: this.realTime,
      });
    } else {
      this.lensFlare.mesh.visible = false;
    }

    // 5. Update Relativistic Warp Streak Lines (visible at fast orbital / FTL / interstellar speeds)
    const warpAlpha =
      this.phase === 'playing' && !this.isLanded
        ? THREE.MathUtils.clamp((speedNorm - 0.34) * 1.45 + (this.warpTargetBodyId ? 0.55 : 0), 0, 0.85)
        : 0;
    this.warpStreakLines.visible = warpAlpha > 0.02;
    if (this.warpStreakLines.visible) {
      this.warpStreakMat.opacity = warpAlpha;
      const streakLen = 1.6 + warpAlpha * 18.0;
      const moveZ = (this.realTime * (38 + warpAlpha * 140)) % 90;
      const count = this.warpStreakBase.length / 3;
      const posArr = this.warpStreakPos;
      for (let i = 0; i < count; i++) {
        const bx = this.warpStreakBase[i * 3];
        const by = this.warpStreakBase[i * 3 + 1];
        let bz = this.warpStreakBase[i * 3 + 2] + moveZ;
        if (bz > 45) bz -= 90;

        this._v1
          .set(0, 0, 0)
          .addScaledVector(this._right, bx)
          .addScaledVector(this._up, by)
          .addScaledVector(this._forward, -bz);

        const idx = i * 6;
        posArr[idx] = this._v1.x;
        posArr[idx + 1] = this._v1.y;
        posArr[idx + 2] = this._v1.z;
        posArr[idx + 3] = this._v1.x - this._forward.x * streakLen;
        posArr[idx + 4] = this._v1.y - this._forward.y * streakLen;
        posArr[idx + 5] = this._v1.z - this._forward.z * streakLen;
      }
      (this.warpStreakLines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }

    // 6. Update Cosmic Scan Pulse Wave
    if (this.scanWaveProgress < 1.0) {
      this.scanWaveProgress = Math.min(1.0, this.scanWaveProgress + dt * 0.85);
      const radius = 1.5 + this.scanWaveProgress * 65;
      this.scanWaveMesh.scale.setScalar(radius);
      this.scanWaveMat.uniforms.uProgress.value = this.scanWaveProgress;
      if (this.scanWaveProgress >= 1.0) {
        this.scanWaveMesh.visible = false;
      }
    }

    // 7. Update Procedural Adaptive Cosmic Audio Soundscape
    const sysCenter = SYSTEM_BY_ID[this.activeSystemId]?.position ?? { x: 0, y: 0, z: 0 };
    const distToCenter = distance3d(this.playerPos, sysCenter);
    const regime: FlightRegime = nearest
      ? classifyFlightRegime(this.isLanded, nearest.altitude, nearest.def, distToCenter)
      : 'INTERSTELLAR';
    const starProximity =
      primaryStarNode && primaryStarNode.def.kind === 'star'
        ? THREE.MathUtils.clamp(
            1 - (distance3d(this.playerPos, primaryStarNode.worldPos) - primaryStarNode.def.radius) / 5_200,
            0,
            1,
          )
        : 0;

    this.audio.update(
      {
        regime,
        atmosphereDensity: nearest?.def.atmosphere?.density ?? 0,
        soundProfile: nearest?.def.atmosphere?.soundProfile ?? 'vacuum',
        speedNorm,
        isWarping: this.warpTargetBodyId !== null,
        isBoosting: isBoost,
        starProximity,
        blackHoleProximity: this.blackHoleProximity,
        horizonWarning: this.blackHoleHorizonWarning,
        pointOfNoReturn: this.blackHolePointOfNoReturn,
        entryBuffeting: Math.max(entryBuffeting, entryGlowTarget),
        tesseractStage: 'outside',
        paused: this.phase !== 'playing',
      },
      this.realTime,
    );
  }

  private computeScreenMarkers(): ScreenMarker[] {
    if (this.phase !== 'playing' || !this.showMarkers || this.tesseractStage !== 'outside') {
      return [];
    }
    const markers: ScreenMarker[] = [];

    const landedDef = this.isLanded && this.landedBodyId ? BODY_BY_ID[this.landedBodyId] : null;

    for (const node of this.bodyNodes) {
      if (!node.group.visible) continue;
      if (landedDef) {
        const isLocalMoonOrParent =
          node.def.parentId === landedDef.id ||
          Boolean(landedDef.parentId && node.def.id === landedDef.parentId);
        if (!isLocalMoonOrParent) continue;
      }
      const dist = distance3d(this.playerPos, node.worldPos);
      const hideDist = node.def.kind === 'black-hole' ? node.def.radius * 12.0 : node.def.radius * 4.5;
      if (dist < hideDist) continue;
      if (node.def.kind === 'moon' && dist > 1_800 && this.warpTargetBodyId !== node.def.id) {
        continue;
      }

      this._projVec.copy(node.group.position).project(this.camera);
      if (this._projVec.z < -1 || this._projVec.z > 1) continue;
      const sx = (this._projVec.x + 1) * 0.5;
      const sy = (1 - this._projVec.y) * 0.5;
      if (sx < 0.04 || sx > 0.96 || sy < 0.08 || sy > 0.88) continue;

      markers.push({
        id: node.def.id,
        name: node.def.name,
        subtitle: node.def.kind.toUpperCase(),
        kind: node.def.kind,
        x: sx,
        y: sy,
        distanceLabel: formatDistance(Math.max(0, dist - node.def.radius)),
        color: node.def.starColor || node.def.palette[0],
        isTarget: this.warpTargetBodyId === node.def.id,
      });
    }

    for (const beacon of this.systemBeacons) {
      if (!beacon.sprite.visible) continue;
      this._projVec.copy(beacon.sprite.position).project(this.camera);
      if (this._projVec.z < -1 || this._projVec.z > 1) continue;
      const sx = (this._projVec.x + 1) * 0.5;
      const sy = (1 - this._projVec.y) * 0.5;
      if (sx < 0.05 || sx > 0.95 || sy < 0.09 || sy > 0.86) continue;

      const dist = distance3d(this.playerPos, beacon.position);
      markers.push({
        id: beacon.systemId,
        name: beacon.name,
        subtitle: 'STAR SYSTEM',
        kind: 'system',
        x: sx,
        y: sy,
        distanceLabel: formatDistance(dist),
        color: beacon.color,
        isTarget: this.warpTargetSystemId === beacon.systemId,
      });
    }

    markers.sort((a, b) => {
      if (a.isTarget && !b.isTarget) return -1;
      if (!a.isTarget && b.isTarget) return 1;
      if (a.kind === 'system' && b.kind !== 'system') return 1;
      if (a.kind !== 'system' && b.kind === 'system') return -1;
      return 0;
    });

    const filtered: ScreenMarker[] = [];
    for (const m of markers) {
      const collides = filtered.some(
        (other) => Math.abs(other.x - m.x) < 0.13 && Math.abs(other.y - m.y) < 0.055,
      );
      if (!collides) {
        filtered.push(m);
        if (filtered.length >= 7) break;
      }
    }
    return filtered;
  }

  private emitTelemetry(_force: boolean): void {
    const nearest = this.findNearestBody();
    const sysDef = SYSTEM_BY_ID[this.activeSystemId] || STAR_SYSTEMS[0];
    const distToCenter = distance3d(this.playerPos, sysDef.position);
    const regime: FlightRegime =
      this.tesseractStage === 'plunge'
        ? 'SINGULARITY'
        : this.tesseractStage === 'tesseract'
          ? 'TESSERACT'
          : nearest
            ? classifyFlightRegime(this.isLanded, nearest.altitude, nearest.def, distToCenter)
            : 'INTERSTELLAR';

    const speedNorm = THREE.MathUtils.clamp(Math.log10(1 + this.currentSpeed) / 5.5, 0, 1);
    const canLandNow = Boolean(
      this.tesseractStage === 'outside' &&
        !this.isLanded &&
        nearest &&
        nearest.def.landable &&
        nearest.altitude < nearest.def.radius * 4.5,
    );

    const warpTarget = this.warpTargetBodyId ? BODY_BY_ID[this.warpTargetBodyId] : null;

    this.onTelemetry({
      phase: this.phase,
      cameraMode: this.cameraMode,
      regime,
      currentSystemId: sysDef.id,
      currentSystemName: sysDef.name,
      nearestBodyId: nearest?.def.id ?? 'sun',
      nearestBodyName: nearest?.def.name ?? 'Deep Space',
      nearestBodyKind: nearest?.def.kind ?? 'star',
      nearestBodyLandable: nearest?.def.landable ?? false,
      nearestBodyGravityG: nearest?.def.gravityG ?? 0,
      altitudeLabel:
        this.tesseractStage === 'plunge'
          ? 'r < Rs · FREE-FALL'
          : this.tesseractStage === 'tesseract'
            ? 'TIMELINE LATTICE'
            : this.isLanded
              ? '0 m · SURFACE'
              : formatDistance(nearest ? nearest.altitude : distToCenter),
      altitudeRawUnits: nearest ? nearest.altitude : distToCenter,
      speedLabel:
        this.tesseractStage === 'tesseract'
          ? `${this.currentSpeed.toFixed(1)} m/s`
          : formatSpeed(this.currentSpeed),
      speedNormalized: speedNorm,
      speedBiasLevel: this.speedBiasLevel,
      isLanded: this.isLanded,
      canLandNow,
      isBoosting:
        this.keysHeld.has('ShiftLeft') ||
        this.keysHeld.has('ShiftRight') ||
        this.gamepadInput.boostHeld,
      isWarping: this.warpTargetBodyId !== null,
      warpTargetName: warpTarget ? warpTarget.name : null,
      warpEtaSec: this.warpEtaSec,
      atmosphereDensity: nearest?.def.atmosphere?.density ?? 0,
      timeDilationFactor: this.blackHoleTimeDilation,
      orbitTimeScale: this.orbitTimeScale,
      blackHoleProximity: this.blackHoleProximity,
      horizonWarning: this.blackHoleHorizonWarning,
      pointOfNoReturn: this.blackHolePointOfNoReturn,
      horizonIndicator: computeHorizonProximityIndicator({
        nearestBodyKind: nearest?.def.kind ?? 'star',
        nearestBodyName: nearest?.def.name ?? 'Deep Space',
        altitude: nearest ? nearest.altitude : distToCenter,
        bodyRadius: nearest?.def.radius ?? 68,
        atmosphereDensity: nearest?.def.atmosphere?.density ?? 0,
        atmosphereHeightRatio: nearest?.def.atmosphere?.heightRatio ?? 0,
        blackHoleDistance: this.blackHoleLastDist,
        blackHoleRadius: this.blackHoleLastRadius,
        blackHoleProximity: this.blackHoleProximity,
        horizonWarning: this.blackHoleHorizonWarning,
        pointOfNoReturn: this.blackHolePointOfNoReturn,
        isLanded: this.isLanded,
        tesseractStage: this.tesseractStage,
      }),
      tesseractStage: this.tesseractStage,
      tesseractAnchorsDecoded: this.decodedTesseractAnchors.size,
      tesseractAnchorsTotal: TESSERACT_MEMORY_ANCHORS.length,
      ...(this.tesseractStage === 'tesseract'
        ? (() => {
            const nearestA = findNearestMemoryAnchor(this.tesseractBulkPos);
            return {
              nearestAnchorName: nearestA.anchor.title,
              nearestAnchorDistM: Math.round(nearestA.distance),
              nearestAnchorInRange: nearestA.inRange,
            };
          })()
        : {
            nearestAnchorName: null,
            nearestAnchorDistM: null,
            nearestAnchorInRange: false,
          }),
      discoveredIds: Array.from(this.discoveredIds),
      landedIds: Array.from(this.landedIds),
      totalDiscoverable: CELESTIAL_BODIES.length,
      distanceTraveledLy: this.distanceTraveledUnits / LY_UNITS,
      scanMessage: this.scanMessage,
      muted: this.audio.isMuted(),
      pointerLocked: this.pointerLocked,
      gamepadConnected: this.gamepadInput.connected,
      gamepadName: this.gamepadInput.name,
      markers: this.computeScreenMarkers(),
    });
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    window.removeEventListener('gamepadconnected', this.handleGamepadChange);
    window.removeEventListener('gamepaddisconnected', this.handleGamepadChange);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mouseup', this.handleMouseUp);

    const canvas = this.renderer.domElement;
    canvas.removeEventListener('mousedown', this.handleMouseDown);
    canvas.removeEventListener('wheel', this.handleWheel);

    this.clearActiveSystemMeshes();
    this.voyager.dispose();
    this.localSurface.dispose();
    this.tesseractRealm?.dispose();
    this.lensFlare.dispose();
    this.audio.dispose();

    this.skyDome.geometry.dispose();
    this.skyDomeMat.dispose();
    this.starfieldPoints.geometry.dispose();
    this.starfieldMat.dispose();
    this.localParallaxPoints.geometry.dispose();
    this.localParallaxMat.dispose();
    this.entryShockMesh.geometry.dispose();
    this.entryShockMat.dispose();
    this.cloudVeilMesh.geometry.dispose();
    this.cloudVeilMat.dispose();
    this.entryStreaksLines.geometry.dispose();
    this.entryStreaksMat.dispose();
    this.warpStreakLines.geometry.dispose();
    this.warpStreakMat.dispose();
    this.scanWaveMesh.geometry.dispose();
    this.scanWaveMat.dispose();

    for (const b of this.systemBeacons) {
      (b.sprite.material as THREE.Material).dispose();
    }

    this.voyagerEnvMap?.dispose();
    this.renderer.dispose();
    if (canvas.parentElement === this.container) {
      this.container.removeChild(canvas);
    }
  }
}
