import React, { useState } from 'react';
import type { TelemetrySnapshot } from '../game/types';
import { CELESTIAL_BODIES, STAR_SYSTEMS, getBodiesInSystem } from '../game/universeData';

interface StarMapModalProps {
  telemetry: TelemetrySnapshot;
  onClose: () => void;
  onWarpToBody: (bodyId: string) => void;
  onWarpToSystem: (systemId: string) => void;
}

type AtlasSection = 'systems' | 'sol' | 'moons';

export const StarMapModal: React.FC<StarMapModalProps> = ({
  telemetry,
  onClose,
  onWarpToBody,
  onWarpToSystem,
}) => {
  const [section, setSection] = useState<AtlasSection>('systems');

  const solBodies = CELESTIAL_BODIES.filter((b) => b.systemId === 'sol' && b.kind !== 'moon');
  const allMoons = CELESTIAL_BODIES.filter((b) => b.kind === 'moon');

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center p-4 sm:p-8"
      style={{ backgroundColor: 'rgba(2, 4, 10, 0.78)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Galactic Star Map & Atlas"
    >
      <div
        className="w-full max-w-4xl max-h-[85vh] flex flex-col rounded-sm border border-sky-400/30 shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'rgba(7, 12, 24, 0.97)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div>
            <h2 className="text-lg sm:text-xl font-semibold tracking-wider uppercase text-slate-50">
              Galactic Star Map &amp; Navigation Atlas
            </h2>
            <p className="text-xs font-mono-num text-slate-400 mt-0.5">
              CURRENT LOCATION: {telemetry.currentSystemName.toUpperCase()} ·{' '}
              {telemetry.discoveredIds.length}/{telemetry.totalDiscoverable} BODIES LOGGED ·{' '}
              {telemetry.landedIds.length} SURFACES LANDED
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Star Map"
            className="px-3 py-1.5 text-xs font-mono-num uppercase tracking-wider border border-slate-700 text-slate-300 hover:text-white hover:border-sky-400 rounded-sm cursor-pointer"
          >
            Close [Tab]
          </button>
        </div>

        {/* Section Tabs */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-slate-800/80">
          {(
            [
              ['systems', `Known Star Systems (${STAR_SYSTEMS.length})`],
              ['sol', `Sol System Planets (${solBodies.length})`],
              ['moons', `Landable Moons (${allMoons.length})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSection(key)}
              className={`px-3.5 py-1.5 text-xs font-mono-num uppercase tracking-wider rounded-sm border transition-colors cursor-pointer ${
                section === key
                  ? 'bg-sky-400/20 border-sky-300/60 text-sky-100'
                  : 'border-slate-800 text-slate-400 hover:text-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content List */}
        <div className="p-6 overflow-y-auto custom-scroll grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {section === 'systems' &&
            STAR_SYSTEMS.map((sys) => {
              const bodies = getBodiesInSystem(sys.id);
              const isHere = telemetry.currentSystemId === sys.id;
              return (
                <div
                  key={sys.id}
                  className={`p-4 rounded-sm border flex flex-col justify-between ${
                    isHere
                      ? 'border-sky-400/60 bg-sky-950/25'
                      : 'border-slate-800 bg-slate-950/60'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`w-3 h-3 rounded-full shrink-0 ${
                            sys.id === 'sagittarius-a' ? 'border-2 border-amber-400' : ''
                          }`}
                          style={{
                            backgroundColor:
                              sys.id === 'sagittarius-a' ? '#000000' : sys.beaconColor,
                          }}
                        />
                        <h3 className="text-base font-semibold text-white">{sys.name}</h3>
                      </div>
                      <span className="text-xs font-mono-num text-sky-300">
                        {sys.distanceLy === 0 ? '0.00 ly' : `${sys.distanceLy} ly`}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono-num text-slate-400 mt-1">
                      {sys.spectralSummary}
                    </div>
                    <p className="text-xs text-slate-300/90 mt-2 leading-relaxed">
                      {sys.description}
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {bodies.slice(0, 6).map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => {
                            onWarpToBody(b.id);
                            onClose();
                          }}
                          className="px-2 py-0.5 text-[10px] font-mono-num rounded-sm bg-slate-900 border border-slate-700/80 text-slate-300 hover:border-sky-400 hover:text-white cursor-pointer"
                        >
                          {b.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                    <span className="text-[10px] font-mono-num uppercase tracking-wider text-slate-400">
                      {bodies.length} Charted Bodies
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onWarpToSystem(sys.id);
                        onClose();
                      }}
                      className="px-3 py-1 text-xs font-mono-num font-semibold uppercase tracking-wider bg-sky-300 text-slate-950 hover:bg-sky-200 rounded-sm cursor-pointer"
                    >
                      Warp to {sys.name}
                    </button>
                  </div>
                </div>
              );
            })}

          {section === 'sol' &&
            solBodies.map((body) => {
              const discovered = telemetry.discoveredIds.includes(body.id);
              const landed = telemetry.landedIds.includes(body.id);
              return (
                <div
                  key={body.id}
                  className="p-4 rounded-sm border border-slate-800 bg-slate-950/60 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: body.starColor || body.palette[0] }}
                        />
                        <h3 className="text-base font-semibold text-white">{body.name}</h3>
                      </div>
                      <span className="text-xs font-mono-num text-sky-300">
                        {body.realDistanceLabel}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono-num text-slate-400 mt-1">
                      RADIUS {body.realRadiusKm.toLocaleString()} km · GRAVITY{' '}
                      {body.gravityG.toFixed(2)} g ·{' '}
                      {body.landable ? 'SOLID SURFACE' : body.kind === 'star' ? 'STELLAR PLASMA' : 'GAS/ICE GIANT'}
                    </div>
                    <p className="text-xs text-slate-300/90 mt-2 leading-relaxed">{body.summary}</p>
                  </div>
                  <div className="mt-3.5 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                    <span className="text-[10px] font-mono-num uppercase tracking-wider text-slate-400">
                      {landed ? 'LANDED' : discovered ? 'VISITED' : 'UNCHARTED'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onWarpToBody(body.id);
                        onClose();
                      }}
                      className="px-3 py-1 text-xs font-mono-num font-semibold uppercase tracking-wider bg-sky-300 text-slate-950 hover:bg-sky-200 rounded-sm cursor-pointer"
                    >
                      Engage Warp
                    </button>
                  </div>
                </div>
              );
            })}

          {section === 'moons' &&
            allMoons.map((body) => {
              const landed = telemetry.landedIds.includes(body.id);
              return (
                <div
                  key={body.id}
                  className="p-4 rounded-sm border border-slate-800 bg-slate-950/60 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: body.palette[0] }}
                        />
                        <h3 className="text-base font-semibold text-white">{body.name}</h3>
                      </div>
                      <span className="text-xs font-mono-num text-amber-200">
                        {body.gravityG.toFixed(3)} g
                      </span>
                    </div>
                    <div className="text-[11px] font-mono-num text-slate-400 mt-1">
                      {body.realDistanceLabel} · RADIUS {body.realRadiusKm.toLocaleString()} km
                    </div>
                    <p className="text-xs text-slate-300/90 mt-2 leading-relaxed">{body.summary}</p>
                  </div>
                  <div className="mt-3.5 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                    <span className="text-[10px] font-mono-num uppercase tracking-wider text-emerald-300/90">
                      {landed ? 'SURFACE LANDED' : 'LANDABLE MOON'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onWarpToBody(body.id);
                        onClose();
                      }}
                      className="px-3 py-1 text-xs font-mono-num font-semibold uppercase tracking-wider bg-sky-300 text-slate-950 hover:bg-sky-200 rounded-sm cursor-pointer"
                    >
                      Warp &amp; Approach
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
};
