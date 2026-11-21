import React from 'react';

interface TitleScreenProps {
  onStart: () => void;
}

export const TitleScreen: React.FC<TitleScreenProps> = ({ onStart }) => {
  return (
    <div
      className="fixed inset-0 z-20 flex flex-col justify-between pointer-events-none"
      style={{
        background:
          'linear-gradient(90deg, rgba(2, 4, 10, 0.84) 0%, rgba(2, 4, 10, 0.48) 38%, rgba(2, 4, 10, 0.0) 68%)',
      }}
    >
      {/* Top safe spacer */}
      <div className="h-8" />

      {/* Left-third negative-space Title Lockup & Start CTA */}
      <div className="px-8 sm:px-14 md:px-20 max-w-xl pointer-events-auto">
        {/* Bespoke Inline SVG Orbital Crest & Wordmark */}
        <svg
          viewBox="0 0 420 124"
          className="w-72 sm:w-96 h-auto mb-5"
          role="img"
          aria-label="ASTRALIS"
        >
          <defs>
            <linearGradient id="astralis-gold" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f8fafc" />
              <stop offset="65%" stopColor="#dbeafe" />
              <stop offset="100%" stopColor="#93c5fd" />
            </linearGradient>
          </defs>
          {/* Minimal astronomical ecliptic crest */}
          <g transform="translate(36, 44)">
            <ellipse
              cx="0"
              cy="0"
              rx="30"
              ry="11"
              fill="none"
              stroke="#7dd3fc"
              strokeWidth="1.5"
              transform="rotate(-24)"
              opacity="0.85"
            />
            <circle cx="0" cy="0" r="10" fill="none" stroke="#e2e8f0" strokeWidth="1.6" />
            <circle cx="0" cy="0" r="3.4" fill="#fde68a" />
            <circle cx="24" cy="-10" r="2.6" fill="#7dd3fc" />
          </g>
          {/* Display wordmark */}
          <text
            x="80"
            y="58"
            fill="url(#astralis-gold)"
            fontFamily="'Space Grotesk', sans-serif"
            fontWeight="700"
            fontSize="50"
            letterSpacing="0.16em"
            style={{ paintOrder: 'stroke fill' }}
            stroke="#02040a"
            strokeWidth="3"
          >
            ASTRALIS
          </text>
          <line x1="82" y1="74" x2="386" y2="74" stroke="#38bdf8" strokeOpacity="0.45" strokeWidth="1" />
          <text
            x="82"
            y="96"
            fill="#94a3b8"
            fontFamily="'JetBrains Mono', monospace"
            fontWeight="500"
            fontSize="12"
            letterSpacing="0.26em"
          >
            SOLAR &amp; INTERSTELLAR FREE-ROAM
          </text>
        </svg>

        <p className="text-sm sm:text-base text-slate-300/90 leading-relaxed max-w-md mb-8 hud-text-shadow">
          Roam our complete Solar System, descend through living atmospheres to walk on planets
          and moons, and ignite superluminal flight across light-years to Alpha Centauri and
          beyond.
        </p>

        <div className="flex items-center gap-4">
          <button
            type="button"
            data-start="true"
            onClick={(e) => {
              e.currentTarget.blur();
              onStart();
            }}
            className="group inline-flex items-center gap-3 px-7 py-3.5 text-sm sm:text-base font-semibold tracking-[0.16em] uppercase text-slate-950 bg-sky-300 hover:bg-sky-200 active:bg-sky-400 transition-colors rounded-sm shadow-[0_0_28px_rgba(56,189,248,0.35)] cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-300 focus:ring-offset-2 focus:ring-offset-[#02040a]"
          >
            <span>Enter Cosmos</span>
            <svg viewBox="0 0 20 20" className="w-4 h-4 fill-current" aria-hidden="true">
              <path d="M4 10h10.5l-4.2-4.2 1.1-1.1L17.5 10l-6.1 5.3-1.1-1.1 4.2-4.2H4z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Single flat borderless control-hint line in bottom safe margin */}
      <div className="px-8 sm:px-14 md:px-20 pb-7">
        <p className="text-xs font-mono-num tracking-wider text-slate-400/90 hud-text-shadow">
          WASD Fly · Drag Look · Shift Hyper-Boost · L Land / Liftoff · F Scan · Tab Star Map · Esc Pause
        </p>
      </div>
    </div>
  );
};
