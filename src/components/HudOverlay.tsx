import React, { useMemo, useState } from 'react';
import type { TelemetrySnapshot } from '../game/types';
import { CELESTIAL_BODIES, STAR_SYSTEMS } from '../game/universeData';

interface HudOverlayProps {
  telemetry: TelemetrySnapshot;
  dockExpanded: boolean;
  onToggleDock: () => void;
  onOpenStarMap: () => void;
  onTogglePause: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onLandToggle: () => void;
  onScanPulse: () => void;
  onWarpToBody: (bodyId: string) => void;
  onWarpToSystem: (systemId: string) => void;
  onCancelWarp: () => void;
  onSpeedBiasDelta: (delta: number) => void;
}

type DockTab = 'planets' | 'moons' | 'stars';

const QUICK_SOL_PLANETS = [
  'sun',
  'mercury',
  'venus',
  'earth',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
  'pluto',
];

const QUICK_MOONS = [
  'moon',
  'phobos',
  'io',
  'europa',
  'ganymede',
  'titan',
  'enceladus',
  'triton',
  'charon',
  'aethel',
];

export const HudOverlay: React.FC<HudOverlayProps> = ({
  telemetry,
  dockExpanded,
  onToggleDock,
  onOpenStarMap,
  onTogglePause,
  onToggleMute,
  onToggleCamera,
  onLandToggle,
  onScanPulse,
  onWarpToBody,
  onWarpToSystem,
  onCancelWarp,
  onSpeedBiasDelta,
}) => {
  const [activeTab, setActiveTab] = useState<DockTab>('planets');

  const planetItems = useMemo(
    () =>
      QUICK_SOL_PLANETS.map((id) => CELESTIAL_BODIES.find((b) => b.id === id)).filter(
        (b): b is NonNullable<typeof b> => Boolean(b),
      ),
    [],
  );

  const moonItems = useMemo(
    () =>
      QUICK_MOONS.map((id) => CELESTIAL_BODIES.find((b) => b.id === id)).filter(
        (b): b is NonNullable<typeof b> => Boolean(b),
      ),
    [],
  );

  const dreadOpacity =
    telemetry.tesseractStage === 'outside'
      ? Math.min(0.82, telemetry.blackHoleProximity * 0.62 + (telemetry.horizonWarning ? 0.22 : 0))
      : 0;

  return (
    <div className="fixed inset-0 z-10 pointer-events-none select-none">
      {/* Subtle Gravitational Dread Edge Vignette when gazing at Sagittarius A*'s Event Horizon */}
      {dreadOpacity > 0.04 && (
        <div
          className="fixed inset-0 pointer-events-none transition-opacity duration-300"
          style={{
            opacity: telemetry.pointOfNoReturn ? 0.94 : dreadOpacity,
            background: telemetry.pointOfNoReturn
              ? 'radial-gradient(ellipse at center, rgba(0,0,0,0) 34%, rgba(82,8,8,0.62) 74%, rgba(6,0,2,0.96) 100%)'
              : telemetry.horizonWarning
                ? 'radial-gradient(ellipse at center, rgba(0,0,0,0) 42%, rgba(28,8,2,0.52) 78%, rgba(2,1,4,0.92) 100%)'
                : 'radial-gradient(ellipse at center, rgba(0,0,0,0) 48%, rgba(4,3,8,0.44) 82%, rgba(1,1,4,0.84) 100%)',
          }}
          aria-hidden="true"
        />
      )}

      {/* 3D Projected World & Star Beacons (clickable to engage warp) */}
      {telemetry.markers.map((m) => (
        <button
          key={`${m.kind}-${m.id}`}
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            if (m.kind === 'system') onWarpToSystem(m.id);
            else onWarpToBody(m.id);
          }}
          style={{
            left: `${(m.x * 100).toFixed(2)}%`,
            top: `${(m.y * 100).toFixed(2)}%`,
            transform: 'translate(-50%, -50%)',
          }}
          className="fixed pointer-events-auto group flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm transition-opacity opacity-75 hover:opacity-100 cursor-pointer"
          aria-label={`Warp to ${m.name} (${m.distanceLabel})`}
        >
          <span
            className="w-2.5 h-2.5 rounded-full border border-white/80 shrink-0"
            style={{
              backgroundColor: m.isTarget ? '#38bdf8' : m.color,
              boxShadow: m.isTarget ? '0 0 10px rgba(56,189,248,0.9)' : 'none',
            }}
          />
          <span className="text-[11px] font-mono-num tracking-wide text-slate-100 hud-text-shadow whitespace-nowrap">
            {m.name}{' '}
            <span className="text-slate-400 text-[10px]">{m.distanceLabel}</span>
          </span>
        </button>
      ))}

      {/* Minimal Center Reticle */}
      <div
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none opacity-60"
        aria-hidden="true"
      >
        <svg viewBox="0 0 36 36" className="w-7 h-7">
          <circle
            cx="18"
            cy="18"
            r={telemetry.isWarping || telemetry.isBoosting ? 13 : 9}
            fill="none"
            stroke="#bae6fd"
            strokeWidth="1"
            strokeOpacity="0.65"
          />
          <line x1="18" y1="3" x2="18" y2="8" stroke="#e0f2fe" strokeWidth="1" />
          <line x1="18" y1="28" x2="18" y2="33" stroke="#e0f2fe" strokeWidth="1" />
          <line x1="3" y1="18" x2="8" y2="18" stroke="#e0f2fe" strokeWidth="1" />
          <line x1="28" y1="18" x2="33" y2="18" stroke="#e0f2fe" strokeWidth="1" />
          <circle cx="18" cy="18" r="1.4" fill="#38bdf8" />
        </svg>
      </div>

      {/* Top-Left Compact Telemetry Cluster */}
      <div
        className={`fixed top-4 left-4 sm:top-5 sm:left-5 px-4 py-3 rounded-sm border ${
          telemetry.tesseractStage !== 'outside'
            ? 'border-amber-400/35'
            : 'border-sky-400/20'
        }`}
        style={{
          backgroundColor:
            telemetry.tesseractStage !== 'outside'
              ? 'rgba(12, 8, 5, 0.80)'
              : 'rgba(5, 9, 18, 0.78)',
        }}
      >
        <div
          className={`flex items-center gap-2.5 text-[10px] font-mono-num uppercase tracking-[0.2em] ${
            telemetry.tesseractStage !== 'outside' ? 'text-amber-300/90' : 'text-sky-300/90'
          }`}
        >
          <span>
            {telemetry.tesseractStage === 'tesseract'
              ? '5D BULK SPACE'
              : telemetry.tesseractStage === 'plunge'
                ? 'EVENT HORIZON'
                : telemetry.currentSystemName}
          </span>
          <span className="text-slate-500">·</span>
          <span className="text-slate-300">{telemetry.regime}</span>
          {telemetry.orbitTimeScale > 1 && telemetry.tesseractStage === 'outside' && (
            <>
              <span className="text-slate-500">·</span>
              <span className="text-amber-300/90">ORBIT {telemetry.orbitTimeScale}×</span>
            </>
          )}
        </div>

        <div className="mt-1 flex items-baseline gap-3">
          <span className="text-lg sm:text-xl font-semibold tracking-tight text-slate-50">
            {telemetry.tesseractStage === 'tesseract'
              ? 'The Tesseract'
              : telemetry.tesseractStage === 'plunge'
                ? 'Singularity Plunge'
                : telemetry.nearestBodyName}
          </span>
          <span className="text-xs font-mono-num text-slate-400">
            {telemetry.tesseractStage === 'outside'
              ? `ALT ${telemetry.altitudeLabel}`
              : telemetry.altitudeLabel}
          </span>
        </div>

        {/* Hero-scale Speed Readout + Velocity Bar */}
        <div className="mt-2.5 flex items-baseline justify-between gap-4">
          <div>
            <div className="text-[10px] font-mono-num uppercase tracking-[0.18em] text-slate-400">
              {telemetry.tesseractStage === 'tesseract' ? 'Bulk Drift' : 'Velocity'}
            </div>
            <div
              className={`text-xl sm:text-2xl font-mono-num font-semibold leading-tight ${
                telemetry.tesseractStage !== 'outside' ? 'text-amber-200' : 'text-sky-200'
              }`}
            >
              {telemetry.speedLabel}
            </div>
          </div>
          {telemetry.isLanded && telemetry.tesseractStage === 'outside' && (
            <div className="text-right">
              <div className="text-[10px] font-mono-num uppercase tracking-[0.18em] text-slate-400">
                Gravity
              </div>
              <div className="text-sm font-mono-num text-amber-200">
                {telemetry.nearestBodyGravityG.toFixed(2)} g
              </div>
            </div>
          )}
          {!telemetry.isLanded &&
            telemetry.tesseractStage === 'outside' &&
            telemetry.timeDilationFactor < 0.992 && (
              <div className="text-right">
                <div className="text-[10px] font-mono-num uppercase tracking-[0.18em] text-amber-300/80">
                  Time Flow
                </div>
                <div className="text-sm font-mono-num font-semibold text-amber-200">
                  {telemetry.timeDilationFactor.toFixed(2)}×
                </div>
              </div>
            )}
          {telemetry.tesseractStage === 'tesseract' && (
            <div className="text-right">
              <div className="text-[10px] font-mono-num uppercase tracking-[0.18em] text-amber-300/80">
                Dimension
              </div>
              <div className="text-sm font-mono-num font-semibold text-amber-200">
                5D · ∞
              </div>
            </div>
          )}
        </div>

        {/* Dynamic Horizon Proximity Indicator (Subtle Celestial Blue -> Amber -> Urgent Red) */}
        {telemetry.horizonIndicator.visible && (
          <div
            data-testid="horizon-proximity-indicator"
            data-mode={telemetry.horizonIndicator.mode}
            data-severity={telemetry.horizonIndicator.severity}
            className="mt-2.5 px-2.5 py-2 rounded-sm border transition-colors duration-200"
            style={{
              borderColor: `${telemetry.horizonIndicator.colorHex}66`,
              backgroundColor:
                telemetry.horizonIndicator.severity === 'irreversible'
                  ? 'rgba(42, 6, 8, 0.82)'
                  : telemetry.horizonIndicator.severity === 'critical'
                    ? 'rgba(34, 12, 6, 0.72)'
                    : 'rgba(6, 14, 28, 0.68)',
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    telemetry.horizonIndicator.pulseUrgent ? 'animate-pulse' : ''
                  }`}
                  style={{
                    backgroundColor: telemetry.horizonIndicator.colorHex,
                    boxShadow: `0 0 8px ${telemetry.horizonIndicator.colorHex}`,
                  }}
                />
                <span
                  className="text-[10px] font-mono-num font-semibold uppercase tracking-[0.16em] truncate"
                  style={{ color: telemetry.horizonIndicator.colorHex }}
                >
                  {telemetry.horizonIndicator.label}
                </span>
              </div>
              <span className="text-[10px] font-mono-num text-slate-200 shrink-0">
                {telemetry.horizonIndicator.metricText}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full bg-slate-900/95 overflow-hidden rounded-full">
              <div
                className="h-full transition-all duration-150 rounded-full"
                style={{
                  width: `${Math.round(Math.max(5, telemetry.horizonIndicator.proximity * 100))}%`,
                  backgroundColor: telemetry.horizonIndicator.colorHex,
                  boxShadow: `0 0 10px ${telemetry.horizonIndicator.colorHex}aa`,
                }}
              />
            </div>
          </div>
        )}

        {/* Rare Localized World-Particle Echo Telemetry inside the 5D Tesseract */}
        {telemetry.tesseractStage === 'tesseract' && (
          <div
            data-testid="tesseract-echo-status"
            className="mt-2.5 px-2.5 py-2 rounded-sm border border-amber-400/35"
            style={{ backgroundColor: 'rgba(20, 12, 5, 0.74)' }}
          >
            <div className="flex items-center justify-between gap-3 text-[10px] font-mono-num uppercase tracking-[0.16em]">
              <span className="text-amber-300/90">World-Particle Echoes</span>
              <span className="text-amber-100 font-semibold">
                {telemetry.tesseractAnchorsDecoded}/{telemetry.tesseractAnchorsTotal}
              </span>
            </div>
            {telemetry.nearestAnchorName && (
              <div className="mt-1 text-[10px] font-mono-num text-amber-200/85 truncate">
                {telemetry.nearestAnchorInRange
                  ? `IN RANGE · PRESS [F] TO TRANSMIT`
                  : `SIGNAL ${telemetry.nearestAnchorDistM ?? 0} m · PULSE [F] TO TRACE`}
              </div>
            )}
          </div>
        )}

        <div className="mt-2 h-1 w-48 sm:w-56 bg-slate-800/90 overflow-hidden rounded-full">
          <div
            className="h-full transition-all duration-150"
            style={{
              width: `${Math.round(Math.max(4, telemetry.speedNormalized * 100))}%`,
              backgroundColor:
                telemetry.tesseractStage !== 'outside'
                  ? '#f59e0b'
                  : telemetry.isWarping
                    ? '#7dd3fc'
                    : telemetry.isBoosting
                      ? '#fbbf24'
                      : '#38bdf8',
            }}
          />
        </div>
      </div>

      {/* Top-Center Active Warp Banner or Scan Discovery Log */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 max-w-md w-[90vw]">
        {telemetry.isWarping && telemetry.warpTargetName && (
          <div
            className="pointer-events-auto flex items-center gap-3 px-4 py-2 rounded-sm border border-sky-400/45"
            style={{ backgroundColor: 'rgba(5, 11, 24, 0.88)' }}
          >
            <div className="text-xs font-mono-num tracking-wider text-sky-200">
              HYPER-WARP → <span className="font-semibold text-white">{telemetry.warpTargetName}</span>{' '}
              <span className="text-slate-400">({telemetry.warpEtaSec.toFixed(1)}s)</span>
            </div>
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onCancelWarp();
              }}
              className="text-[10px] font-mono-num uppercase tracking-wider px-2 py-0.5 border border-slate-600 text-slate-300 hover:text-white hover:border-slate-400 rounded-sm cursor-pointer"
            >
              Abort
            </button>
          </div>
        )}

        {telemetry.scanMessage && (
          <div
            className={`px-4 py-2.5 rounded-sm border text-center ${
              telemetry.tesseractStage !== 'outside'
                ? 'border-amber-300/40'
                : 'border-sky-300/35'
            }`}
            style={{
              backgroundColor:
                telemetry.tesseractStage !== 'outside'
                  ? 'rgba(14, 9, 5, 0.90)'
                  : 'rgba(6, 12, 24, 0.88)',
            }}
          >
            <div
              className={`text-xs font-mono-num uppercase tracking-widest ${
                telemetry.tesseractStage !== 'outside' ? 'text-amber-300' : 'text-sky-300'
              }`}
            >
              {telemetry.scanMessage.title}
            </div>
            <p className="mt-0.5 text-xs text-slate-200 leading-snug">
              {telemetry.scanMessage.detail}
            </p>
          </div>
        )}
      </div>

      {/* Top-Right Compact Utility Controls (SVG icon buttons) */}
      <div className="fixed top-4 right-4 sm:top-5 sm:right-5 flex items-center gap-2 pointer-events-auto">
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            onOpenStarMap();
          }}
          aria-label="Open Star Map (Tab)"
          title="Star Map & Known Stars (Tab)"
          className="h-9 px-3 flex items-center gap-2 rounded-sm border border-sky-400/30 text-xs font-mono-num uppercase tracking-wider text-sky-200 hover:text-white hover:border-sky-300 cursor-pointer"
          style={{ backgroundColor: 'rgba(5, 9, 18, 0.82)' }}
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="1.8" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(-24 12 12)" />
            <circle cx="12" cy="12" r="2" fill="currentColor" />
          </svg>
          <span className="hidden sm:inline">Star Map</span>
        </button>

        {telemetry.gamepadConnected && (
          <div
            title={`Controller active: ${telemetry.gamepadName || 'Gamepad'}`}
            aria-label={`Controller connected: ${telemetry.gamepadName || 'Gamepad'}`}
            className="h-9 px-2.5 flex items-center gap-1.5 rounded-sm border border-emerald-400/40 text-emerald-200"
            style={{ backgroundColor: 'rgba(5, 16, 18, 0.84)' }}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="1.8" aria-hidden="true">
              <path d="M6 12h4M8 10v4M15 11h.01M17.5 13h.01" strokeLinecap="round" />
              <path d="M4.5 9.5C3.5 12 3 16 4.5 17.5c1.2 1.2 2.7.5 4-1h7c1.3 1.5 2.8 2.2 4 1 1.5-1.5 1-5.5 0-8C18.8 7.8 17.4 7 15.8 7H8.2C6.6 7 5.2 7.8 4.5 9.5z" />
            </svg>
            <span className="text-[10px] font-mono-num uppercase tracking-wider">PAD</span>
          </div>
        )}

        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleCamera();
          }}
          aria-label={`Switch Camera View (Current: ${telemetry.cameraMode})`}
          title="Toggle 3rd / 1st Person Camera (V)"
          className="w-9 h-9 flex items-center justify-center rounded-sm border border-slate-700/80 text-slate-200 hover:text-white hover:border-sky-400/60 cursor-pointer"
          style={{ backgroundColor: 'rgba(5, 9, 18, 0.82)' }}
        >
          <span className="text-[11px] font-mono-num font-semibold">
            {telemetry.cameraMode === 'third-person' ? '3P' : '1P'}
          </span>
        </button>

        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleMute();
          }}
          aria-label={telemetry.muted ? 'Unmute Soundscapes (M)' : 'Mute Soundscapes (M)'}
          title="Toggle Cosmic Soundscapes (M)"
          className="w-9 h-9 flex items-center justify-center rounded-sm border border-slate-700/80 text-slate-200 hover:text-white hover:border-sky-400/60 cursor-pointer"
          style={{ backgroundColor: 'rgba(5, 9, 18, 0.82)' }}
        >
          {telemetry.muted ? (
            <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="1.8" aria-hidden="true">
              <path d="M11 5L6 9H3v6h3l5 4V5z" />
              <line x1="16" y1="9" x2="21" y2="15" />
              <line x1="21" y1="9" x2="16" y2="15" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="1.8" aria-hidden="true">
              <path d="M11 5L6 9H3v6h3l5 4V5z" />
              <path d="M15.5 8.5a5 5 0 0 1 0 7" />
              <path d="M18.5 5.5a9 9 0 0 1 0 13" />
            </svg>
          )}
        </button>

        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            onTogglePause();
          }}
          aria-label="Pause Game (Esc)"
          title="Pause (Esc / P)"
          className="w-9 h-9 flex items-center justify-center rounded-sm border border-slate-700/80 text-slate-200 hover:text-white hover:border-sky-400/60 cursor-pointer"
          style={{ backgroundColor: 'rgba(5, 9, 18, 0.82)' }}
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        </button>
      </div>

      {/* Unified Collapsible Bottom Navigation Dock (hidden during cinematic plunge for stark immersion) */}
      {telemetry.tesseractStage !== 'plunge' && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[min(920px,95vw)] flex flex-col items-center pointer-events-none">
          {/* Contextual Primary Action Strip + Collapse Toggle */}
          <div className="flex items-center gap-2 mb-1.5 pointer-events-auto">
            {telemetry.tesseractStage === 'tesseract' ? (
              <>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onLandToggle();
                  }}
                  className="px-3.5 py-1.5 rounded-sm text-xs font-mono-num font-semibold uppercase tracking-wider text-slate-950 bg-amber-300 hover:bg-amber-200 transition-colors cursor-pointer"
                >
                  Exit Tesseract [L]
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onScanPulse();
                  }}
                  className="px-3 py-1.5 rounded-sm border border-amber-400/45 text-xs font-mono-num uppercase tracking-wider text-amber-200 hover:text-white hover:border-amber-300 cursor-pointer"
                  style={{ backgroundColor: 'rgba(18, 11, 5, 0.88)' }}
                >
                  {telemetry.nearestAnchorInRange ? 'Transmit Echo [F]' : 'Gravity Pulse [F]'}
                </button>
              </>
            ) : (
              <>
                {(telemetry.canLandNow || telemetry.isLanded) && (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onLandToggle();
                    }}
                    className="px-3.5 py-1.5 rounded-sm text-xs font-mono-num font-semibold uppercase tracking-wider text-slate-950 bg-sky-300 hover:bg-sky-200 transition-colors cursor-pointer"
                  >
                    {telemetry.isLanded
                      ? 'Lift Off [L]'
                      : `Land on ${telemetry.nearestBodyName} [L]`}
                  </button>
                )}

                {telemetry.currentSystemId !== 'sagittarius-a' && (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onWarpToBody('sgr-a-star');
                    }}
                    className="px-3 py-1.5 rounded-sm border border-amber-400/45 text-xs font-mono-num uppercase tracking-wider text-amber-200 hover:text-white hover:border-amber-300 flex items-center gap-1.5 cursor-pointer"
                    style={{ backgroundColor: 'rgba(18, 10, 6, 0.86)' }}
                  >
                    <span className="w-2.5 h-2.5 rounded-full bg-black border border-amber-400 inline-block" />
                    <span>Black Hole · Sgr A*</span>
                  </button>
                )}

                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onScanPulse();
                  }}
                  className="px-3 py-1.5 rounded-sm border border-sky-400/35 text-xs font-mono-num uppercase tracking-wider text-sky-200 hover:text-white hover:border-sky-300 cursor-pointer"
                  style={{ backgroundColor: 'rgba(5, 9, 18, 0.84)' }}
                >
                  Scan [F]
                </button>
              </>
            )}

            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleDock();
              }}
              aria-expanded={dockExpanded}
              className="px-3 py-1.5 rounded-sm border border-slate-700/80 text-[11px] font-mono-num uppercase tracking-wider text-slate-300 hover:text-white cursor-pointer"
              style={{ backgroundColor: 'rgba(5, 9, 18, 0.84)' }}
            >
              {dockExpanded ? '▾ Hide Dock [H]' : '▴ Navigation Dock [H]'}
            </button>
          </div>

          {dockExpanded && (
            <div
              className="w-full rounded-sm border border-sky-400/20 px-3.5 py-2.5 pointer-events-auto"
              style={{ backgroundColor: 'rgba(5, 9, 18, 0.86)' }}
            >
            {/* Top row: Category tabs + Speed Gear + Atlas Progress */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-800">
              <div className="flex items-center gap-1" role="tablist" aria-label="Destination categories">
                {(
                  [
                    ['planets', 'Sol System'],
                    ['moons', 'Landable Moons'],
                    ['stars', 'Known Stars'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === key}
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      setActiveTab(key);
                    }}
                    className={`px-2.5 py-1 text-[11px] font-mono-num uppercase tracking-wider rounded-sm transition-colors cursor-pointer ${
                      activeTab === key
                        ? 'bg-sky-400/20 text-sky-200 border border-sky-400/45'
                        : 'text-slate-400 hover:text-slate-200 border border-transparent'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3 text-[11px] font-mono-num text-slate-400">
                <div className="flex items-center gap-1">
                  <span className="uppercase text-[10px]">Thrust</span>
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onSpeedBiasDelta(-1);
                    }}
                    aria-label="Decrease cruise speed"
                    className="w-5 h-5 flex items-center justify-center rounded-sm border border-slate-700 text-slate-300 hover:text-white cursor-pointer"
                  >
                    -
                  </button>
                  <span className="w-6 text-center text-sky-200">
                    {telemetry.speedBiasLevel >= 0
                      ? `+${telemetry.speedBiasLevel}`
                      : telemetry.speedBiasLevel}
                  </span>
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onSpeedBiasDelta(1);
                    }}
                    aria-label="Increase cruise speed"
                    className="w-5 h-5 flex items-center justify-center rounded-sm border border-slate-700 text-slate-300 hover:text-white cursor-pointer"
                  >
                    +
                  </button>
                </div>

                <span className="text-slate-600">|</span>
                <span>
                  ATLAS{' '}
                  <span className="text-slate-100">
                    {telemetry.discoveredIds.length}/{telemetry.totalDiscoverable}
                  </span>
                </span>
              </div>
            </div>

            {/* Bottom row: Quick-Warp Celestial Destination Buttons */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 custom-scroll">
              {activeTab === 'planets' &&
                planetItems.map((b) => {
                  const isCurrent = telemetry.nearestBodyId === b.id;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      tabIndex={-1}
                      onClick={(e) => {
                        e.currentTarget.blur();
                        onWarpToBody(b.id);
                      }}
                      className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-xs transition-colors border cursor-pointer ${
                        isCurrent
                          ? 'bg-sky-400/20 border-sky-300/60 text-white'
                          : 'bg-slate-900/70 border-slate-800 text-slate-300 hover:border-sky-400/50 hover:text-white'
                      }`}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: b.starColor || b.palette[0] }}
                      />
                      <span>{b.name.replace(' (Sol)', '')}</span>
                    </button>
                  );
                })}

              {activeTab === 'moons' &&
                moonItems.map((b) => {
                  const isCurrent = telemetry.nearestBodyId === b.id;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      tabIndex={-1}
                      onClick={(e) => {
                        e.currentTarget.blur();
                        onWarpToBody(b.id);
                      }}
                      className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-xs transition-colors border cursor-pointer ${
                        isCurrent
                          ? 'bg-sky-400/20 border-sky-300/60 text-white'
                          : 'bg-slate-900/70 border-slate-800 text-slate-300 hover:border-sky-400/50 hover:text-white'
                      }`}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: b.palette[0] }}
                      />
                      <span>{b.name.replace(' (Luna)', '').replace(' (Exomoon)', '')}</span>
                    </button>
                  );
                })}

              {activeTab === 'stars' &&
                STAR_SYSTEMS.map((sys) => {
                  const isCurrent = telemetry.currentSystemId === sys.id;
                  return (
                    <button
                      key={sys.id}
                      type="button"
                      tabIndex={-1}
                      onClick={(e) => {
                        e.currentTarget.blur();
                        onWarpToSystem(sys.id);
                      }}
                      className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-xs transition-colors border cursor-pointer ${
                        isCurrent
                          ? 'bg-sky-400/20 border-sky-300/60 text-white'
                          : 'bg-slate-900/70 border-slate-800 text-slate-300 hover:border-sky-400/50 hover:text-white'
                      }`}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: sys.beaconColor }}
                      />
                      <span>{sys.name}</span>
                      <span className="text-[10px] font-mono-num text-slate-400">
                        {sys.distanceLy === 0 ? '0 ly' : `${sys.distanceLy} ly`}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
};
