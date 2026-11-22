import { useCallback, useEffect, useRef, useState } from 'react';
import { HudOverlay } from './components/HudOverlay';
import { PauseModal } from './components/PauseModal';
import { StarMapModal } from './components/StarMapModal';
import { TitleScreen } from './components/TitleScreen';
import { SpaceEngine } from './game/SpaceEngine';
import type { TelemetrySnapshot } from './game/types';
import { CELESTIAL_BODIES } from './game/universeData';

const INITIAL_TELEMETRY: TelemetrySnapshot = {
  phase: 'title',
  cameraMode: 'third-person',
  regime: 'ORBITAL',
  currentSystemId: 'sol',
  currentSystemName: 'Sol System',
  nearestBodyId: 'earth',
  nearestBodyName: 'Earth',
  nearestBodyKind: 'planet',
  nearestBodyLandable: true,
  nearestBodyGravityG: 1.0,
  altitudeLabel: '1,240 km',
  altitudeRawUnits: 100,
  speedLabel: '0 m/s',
  speedNormalized: 0,
  speedBiasLevel: 0,
  isLanded: false,
  canLandNow: true,
  isBoosting: false,
  isWarping: false,
  warpTargetName: null,
  warpEtaSec: 0,
  atmosphereDensity: 1.0,
  timeDilationFactor: 1.0,
  orbitTimeScale: 1,
  blackHoleProximity: 0,
  horizonWarning: false,
  pointOfNoReturn: false,
  horizonIndicator: {
    visible: false,
    mode: 'none',
    severity: 'nominal',
    proximity: 0,
    colorHex: '#38bdf8',
    label: '',
    metricText: '',
    pulseUrgent: false,
  },
  tesseractStage: 'outside',
  tesseractAnchorsDecoded: 0,
  tesseractAnchorsTotal: 3,
  nearestAnchorName: null,
  nearestAnchorDistM: null,
  nearestAnchorInRange: false,
  discoveredIds: ['earth'],
  landedIds: [],
  totalDiscoverable: CELESTIAL_BODIES.length,
  distanceTraveledLy: 0,
  scanMessage: null,
  muted: false,
  pointerLocked: false,
  gamepadConnected: false,
  gamepadName: null,
  markers: [],
};

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<SpaceEngine | null>(null);

  const [telemetry, setTelemetry] = useState<TelemetrySnapshot>(INITIAL_TELEMETRY);
  const [starMapOpen, setStarMapOpen] = useState(false);
  const [dockExpanded, setDockExpanded] = useState(true);

  const starMapOpenRef = useRef(starMapOpen);
  starMapOpenRef.current = starMapOpen;

  const phaseRef = useRef(telemetry.phase);
  phaseRef.current = telemetry.phase;

  // Mount Three.js WebGLRenderer once in isolated container (never torn down on HUD state updates)
  useEffect(() => {
    const mountEl = canvasMountRef.current;
    if (!mountEl) return;

    const engine = new SpaceEngine(
      mountEl,
      (snap) => {
        setTelemetry(snap);
      },
      {
        onStart: () => {
          document.body.dataset.state = 'playing';
          setStarMapOpen(false);
          engine.startGame(true);
        },
        onTogglePause: () => {
          if (phaseRef.current === 'title') return;
          if (starMapOpenRef.current) {
            setStarMapOpen(false);
            return;
          }
          const nextPaused = phaseRef.current !== 'paused';
          document.body.dataset.state = nextPaused ? 'paused' : 'playing';
          engine.setPaused(nextPaused);
        },
        onToggleStarMap: () => {
          if (phaseRef.current === 'playing') {
            setStarMapOpen((prev) => !prev);
          }
        },
        onToggleDock: () => {
          if (phaseRef.current === 'playing') {
            setDockExpanded((prev) => !prev);
          }
        },
        onCloseModals: () => {
          if (starMapOpenRef.current) {
            setStarMapOpen(false);
          }
        },
      },
    );
    engineRef.current = engine;

    // Support ?autostart=1 with optional ?target=..., ?land=1, ?entry=1, ?view=flare, ?plunge=1, ?tesseract=1
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      document.body.dataset.state = 'playing';
      engine.startGame(false);
      const targetId = params.get('target');
      if (params.get('tesseract') === '1') {
        setDockExpanded(false);
        engine.enterTesseractNow();
      } else if (params.get('plunge') === '1') {
        setDockExpanded(false);
        engine.enterBlackHolePlungeNow();
      } else if (params.get('entry') === '1') {
        setDockExpanded(false);
        engine.spawnAtmosphericEntryVista(targetId || 'earth');
      } else if (params.get('land') === '1') {
        setDockExpanded(false);
        engine.landOnBodyNow(targetId || 'earth');
      } else if (params.get('view') === 'flare') {
        setDockExpanded(false);
        engine.spawnSolarFlareVista();
      } else if (targetId) {
        const distParam = params.get('dist');
        const distNum = distParam ? Number(distParam) : undefined;
        engine.spawnAtBody(targetId, Number.isFinite(distNum) ? distNum : undefined);
      }
    } else {
      document.body.dataset.state = 'title';
    }

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // Mirror game state machine cleanly onto document.body.dataset.state
  useEffect(() => {
    document.body.dataset.state = telemetry.phase;
  }, [telemetry.phase]);

  const handleStart = useCallback(() => {
    document.body.dataset.state = 'playing';
    setStarMapOpen(false);
    engineRef.current?.startGame();
  }, []);

  const handleResume = useCallback(() => {
    document.body.dataset.state = 'playing';
    engineRef.current?.setPaused(false);
  }, []);

  const handleTogglePause = useCallback(() => {
    if (phaseRef.current === 'title') return;
    setStarMapOpen(false);
    const nextPaused = phaseRef.current !== 'paused';
    document.body.dataset.state = nextPaused ? 'paused' : 'playing';
    engineRef.current?.setPaused(nextPaused);
  }, []);

  const handleReturnEarth = useCallback(() => {
    setStarMapOpen(false);
    engineRef.current?.spawnAtEarthOrbit();
    engineRef.current?.setPaused(false);
    document.body.dataset.state = 'playing';
  }, []);

  const handleReturnTitle = useCallback(() => {
    setStarMapOpen(false);
    document.body.dataset.state = 'title';
    engineRef.current?.returnToTitle();
  }, []);

  // Global keyboard shortcuts for Title Start (Enter/Space), Star Map (Tab), Dock (H), Pause (Esc/P)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const phase = phaseRef.current;

      if (phase === 'title') {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          handleStart();
        }
        return;
      }

      if (e.code === 'Tab') {
        e.preventDefault();
        if (phase === 'playing') {
          setStarMapOpen((prev) => !prev);
        }
        return;
      }

      if (e.code === 'Escape' || e.code === 'KeyP') {
        e.preventDefault();
        if (starMapOpenRef.current) {
          setStarMapOpen(false);
        } else {
          handleTogglePause();
        }
        return;
      }

      if (e.code === 'KeyH' && phase === 'playing' && !starMapOpenRef.current) {
        setDockExpanded((prev) => !prev);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleStart, handleTogglePause]);

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#02040a]">
      {/* Isolated WebGL Viewport Container */}
      <div
        ref={canvasMountRef}
        data-testid="space-viewport"
        className="fixed inset-0 w-full h-full"
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* Title Screen */}
      {telemetry.phase === 'title' && <TitleScreen onStart={handleStart} />}

      {/* Playing HUD */}
      {telemetry.phase === 'playing' && (
        <HudOverlay
          telemetry={telemetry}
          dockExpanded={dockExpanded}
          onToggleDock={() => setDockExpanded((v) => !v)}
          onOpenStarMap={() => setStarMapOpen(true)}
          onTogglePause={handleTogglePause}
          onToggleMute={() => engineRef.current?.toggleMute()}
          onToggleCamera={() => engineRef.current?.toggleCameraMode()}
          onLandToggle={() => engineRef.current?.toggleLandOrLiftoff()}
          onScanPulse={() => engineRef.current?.triggerScanPulse()}
          onWarpToBody={(id) => engineRef.current?.warpToBody(id)}
          onWarpToSystem={(id) => engineRef.current?.warpToSystem(id)}
          onCancelWarp={() => engineRef.current?.cancelWarp()}
          onSpeedBiasDelta={(d) => engineRef.current?.adjustSpeedBias(d)}
        />
      )}

      {/* Galactic Star Map Modal */}
      {telemetry.phase === 'playing' && starMapOpen && (
        <StarMapModal
          telemetry={telemetry}
          onClose={() => setStarMapOpen(false)}
          onWarpToBody={(id) => engineRef.current?.warpToBody(id)}
          onWarpToSystem={(id) => engineRef.current?.warpToSystem(id)}
        />
      )}

      {/* Pause Modal */}
      {telemetry.phase === 'paused' && (
        <PauseModal
          telemetry={telemetry}
          onResume={handleResume}
          onReturnEarth={handleReturnEarth}
          onReturnTitle={handleReturnTitle}
        />
      )}
    </main>
  );
}
