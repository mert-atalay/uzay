import React from 'react';
import type { TelemetrySnapshot } from '../game/types';

interface PauseModalProps {
  telemetry: TelemetrySnapshot;
  onResume: () => void;
  onReturnEarth: () => void;
  onReturnTitle: () => void;
}

export const PauseModal: React.FC<PauseModalProps> = ({
  telemetry,
  onResume,
  onReturnEarth,
  onReturnTitle,
}) => {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(2, 4, 10, 0.78)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Flight Paused"
    >
      <div
        className="w-full max-w-md rounded-sm border border-sky-400/30 p-6 shadow-2xl"
        style={{ backgroundColor: 'rgba(7, 12, 24, 0.96)' }}
      >
        <div className="text-[11px] font-mono-num uppercase tracking-[0.22em] text-sky-300">
          Simulation Suspended
        </div>
        <h2 className="text-2xl font-bold tracking-wider uppercase text-white mt-1">
          Astralis Paused
        </h2>

        <div className="grid grid-cols-3 gap-2.5 my-6">
          <div className="p-3 rounded-sm border border-slate-800 bg-slate-950/70">
            <div className="text-[10px] font-mono-num uppercase tracking-wider text-slate-400">
              Charted
            </div>
            <div className="text-xl font-mono-num font-semibold text-sky-200 mt-0.5">
              {telemetry.discoveredIds.length}/{telemetry.totalDiscoverable}
            </div>
          </div>
          <div className="p-3 rounded-sm border border-slate-800 bg-slate-950/70">
            <div className="text-[10px] font-mono-num uppercase tracking-wider text-slate-400">
              Landed
            </div>
            <div className="text-xl font-mono-num font-semibold text-emerald-300 mt-0.5">
              {telemetry.landedIds.length}
            </div>
          </div>
          <div className="p-3 rounded-sm border border-slate-800 bg-slate-950/70">
            <div className="text-[10px] font-mono-num uppercase tracking-wider text-slate-400">
              Voyaged
            </div>
            <div className="text-xl font-mono-num font-semibold text-amber-200 mt-0.5">
              {telemetry.distanceTraveledLy < 0.01
                ? `${Math.round(telemetry.distanceTraveledLy * 63_241)} AU`
                : `${telemetry.distanceTraveledLy.toFixed(1)} ly`}
            </div>
          </div>
        </div>

        <div className="text-xs font-mono-num text-slate-400 space-y-1 mb-6 border-t border-slate-800 pt-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-sky-300/80 mb-1">
            Keyboard &amp; Mouse
          </div>
          <div>WASD / Arrows — Fly or Walk · Mouse Drag — Look 360°</div>
          <div>Shift — Hyper-Boost · Space — Ascend / Jump · Scroll — Gear</div>
          <div>L — Land / Liftoff · F — Scan · V — 3P/1P · Tab — Star Map</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-300/80 pt-2 mb-1">
            Controller {telemetry.gamepadConnected ? `· ${telemetry.gamepadName || 'Connected'}` : '· Plug & Play Ready'}
          </div>
          <div>Left Stick — Move · Right Stick — Look · RT — Hyper-Boost</div>
          <div>A / LT — Ascend / Descend · X — Land · Y — Scan · LB/RB — Gear</div>
          <div>View — Star Map · Menu — Pause · D-Pad ↑/↓/→ — Cam / Dock / Sgr A*</div>
        </div>

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={onResume}
            className="w-full py-2.5 text-sm font-semibold uppercase tracking-[0.16em] bg-sky-300 text-slate-950 hover:bg-sky-200 rounded-sm cursor-pointer"
          >
            Resume Flight
          </button>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={onReturnEarth}
              className="py-2 text-xs font-mono-num uppercase tracking-wider border border-slate-700 text-slate-200 hover:border-sky-400 hover:text-white rounded-sm cursor-pointer"
            >
              Return to Earth
            </button>
            <button
              type="button"
              onClick={onReturnTitle}
              className="py-2 text-xs font-mono-num uppercase tracking-wider border border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white rounded-sm cursor-pointer"
            >
              Title Screen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
