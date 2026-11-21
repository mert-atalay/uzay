import type { FlightRegime } from './types';
import type { TesseractStage } from './tesseractMath';

export const INTERSTELLAR_THEME_URL =
  '/assets/aistudio/Interstellar_Main_Theme_-_Hans_Zimmer__1__4d6ce0c5.mp3';

/** Ambient space & planetary exploration plays from 0:00 up to 3:25.5 before looping cleanly */
export const AMBIENT_LOOP_START_SEC = 2.0;
export const AMBIENT_LOOP_END_SEC = 205.5;

/** Event Horizon & 5D Tesseract climax peak starts right at 3:30 (210.0s) through 3:59.2 */
export const PEAK_CUE_START_SEC = 210.0;
export const PEAK_CUE_END_SEC = 239.2;

export interface SoundscapeState {
  regime: FlightRegime;
  atmosphereDensity: number;
  soundProfile: 'vacuum' | 'earth' | 'mars' | 'dense' | 'ice';
  speedNorm: number; // 0..1
  isWarping: boolean;
  isBoosting: boolean;
  starProximity: number; // 0..1
  blackHoleProximity?: number; // 0..1
  horizonWarning?: boolean;
  pointOfNoReturn?: boolean;
  entryBuffeting?: number; // 0..1 hypersonic re-entry plasma & Max-Q turbulence
  tesseractStage?: TesseractStage;
  plungeProgress?: number; // 0..1
  paused: boolean;
}

/**
 * Pure selector determining when the 3:30 (210s) cathedral organ climax stem should take over
 * from the contemplative ambient Interstellar Main Theme stem.
 */
export function shouldUsePeakCue(state: {
  tesseractStage?: TesseractStage;
  blackHoleProximity?: number;
  horizonWarning?: boolean;
  pointOfNoReturn?: boolean;
}): boolean {
  if (state.tesseractStage === 'plunge' || state.tesseractStage === 'tesseract') {
    return true;
  }
  if (state.horizonWarning || state.pointOfNoReturn) {
    return true;
  }
  return (state.blackHoleProximity ?? 0) >= 0.56;
}

/**
 * Computes normalized volume envelopes (0..1) for smooth crossfading at loop boundaries
 * without clicks or abrupt cuts.
 */
export function computeTrackLoopEnvelope(
  currentTimeSec: number,
  windowStartSec: number,
  windowEndSec: number,
  fadeSec = 1.6,
): number {
  const into = currentTimeSec - windowStartSec;
  const remaining = windowEndSec - currentTimeSec;
  const fadeIn = Math.max(0, Math.min(1, into / Math.max(0.1, fadeSec)));
  const fadeOut = Math.max(0, Math.min(1, remaining / Math.max(0.1, fadeSec)));
  return Math.min(fadeIn, fadeOut);
}

/**
 * Dual-Deck Adaptive Interstellar Music Engine + Procedural Cosmic Foley/SFX Synthesizer.
 * - Background music streams the authentic Interstellar Main Theme MP3:
 *   - Outer space & planetary flight: meditative stem (0:00 -> 3:25.5 seamless loop)
 *   - Black Hole Event Horizon approach, Plunge & 5D Tesseract: 3:30+ (210s -> 239.2s) climax peak
 * - Procedural Web Audio layers subtle atmospheric wind, solar plasma rumble, gravitational tidal
 *   sub-bass, relativistic ticks, sonic booms, footsteps, jump jets, and gravity-string chords.
 */
export class CosmicAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private warpGain: GainNode | null = null;
  private warpOsc1: OscillatorNode | null = null;
  private warpOsc2: OscillatorNode | null = null;
  private solarGain: GainNode | null = null;
  private abyssGain: GainNode | null = null;
  private abyssFilter: BiquadFilterNode | null = null;

  // Dual HTMLAudioElement decks for glitch-free crossfading between Ambient (0:00..3:25) & Peak (3:30..3:59)
  private ambientBgm: HTMLAudioElement | null = null;
  private peakBgm: HTMLAudioElement | null = null;
  private ambientMix = 1.0;
  private peakMix = 0.0;
  private wasPeakMode = false;
  private bgmPausedByGame = false;

  private lastTickTime = 0;
  private muted = false;
  private initialized = false;
  private lastRegime: FlightRegime = 'ORBITAL';
  private lastFootstepTime = 0;

  private initMusicDecks(): void {
    if (this.ambientBgm || typeof Audio === 'undefined') return;
    try {
      const ambient = new Audio(INTERSTELLAR_THEME_URL);
      ambient.preload = 'auto';
      ambient.loop = false;
      ambient.volume = 0;

      const peak = new Audio(INTERSTELLAR_THEME_URL);
      peak.preload = 'auto';
      peak.loop = false;
      peak.volume = 0;

      this.ambientBgm = ambient;
      this.peakBgm = peak;
    } catch {
      // Gracefully degrade if HTMLAudio is unavailable
    }
  }

  private safePlayAudio(el: HTMLAudioElement | null, targetTimeSec?: number): void {
    if (!el) return;
    try {
      if (targetTimeSec !== undefined && Number.isFinite(targetTimeSec)) {
        if (el.readyState >= 1) {
          el.currentTime = targetTimeSec;
        } else {
          const seekOnce = () => {
            try {
              el.currentTime = targetTimeSec;
            } catch {
              // ignore
            }
          };
          el.addEventListener('loadedmetadata', seekOnce, { once: true });
        }
      }
      if (el.paused) {
        const p = el.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {});
        }
      }
    } catch {
      // ignore autoplay blocks before user gesture
    }
  }

  public unlock(): void {
    this.initMusicDecks();

    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => {});
      }
      if (!this.bgmPausedByGame && !this.muted) {
        if (this.wasPeakMode) {
          this.safePlayAudio(this.peakBgm);
        } else {
          this.safePlayAudio(this.ambientBgm);
        }
      }
      return;
    }

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.36;
      master.connect(ctx.destination);
      this.masterGain = master;

      // Shared pink-noise buffer for atmospheric wind & solar/entry rumble
      const noiseLen = ctx.sampleRate * 3;
      const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      let b0 = 0,
        b1 = 0,
        b2 = 0,
        b3 = 0,
        b4 = 0,
        b5 = 0,
        b6 = 0;
      for (let i = 0; i < noiseLen; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.045;
        b6 = white * 0.115926;
      }

      // 1. Adaptive Atmospheric Wind Synth
      const windSource = ctx.createBufferSource();
      windSource.buffer = noiseBuf;
      windSource.loop = true;

      const windFilter = ctx.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 320;
      windFilter.Q.value = 1.8;

      const windGain = ctx.createGain();
      windGain.gain.value = 0;

      windSource.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(master);
      windSource.start();

      this.windFilter = windFilter;
      this.windGain = windGain;

      // 2. Solar Proximity & Re-Entry Plasma Rumble
      const solarSource = ctx.createBufferSource();
      solarSource.buffer = noiseBuf;
      solarSource.loop = true;

      const solarFilter = ctx.createBiquadFilter();
      solarFilter.type = 'lowpass';
      solarFilter.frequency.value = 130;

      const solarGain = ctx.createGain();
      solarGain.gain.value = 0;

      solarSource.connect(solarFilter);
      solarFilter.connect(solarGain);
      solarGain.connect(master);
      solarSource.start();
      this.solarGain = solarGain;

      // 3. Superluminal Flight & Warp Doppler Hum
      const warpGain = ctx.createGain();
      warpGain.gain.value = 0;

      const warpFilter = ctx.createBiquadFilter();
      warpFilter.type = 'lowpass';
      warpFilter.frequency.value = 900;

      const warpOsc1 = ctx.createOscillator();
      warpOsc1.type = 'sawtooth';
      warpOsc1.frequency.value = 58;

      const warpOsc2 = ctx.createOscillator();
      warpOsc2.type = 'sine';
      warpOsc2.frequency.value = 116;

      const w1g = ctx.createGain();
      w1g.gain.value = 0.22;
      const w2g = ctx.createGain();
      w2g.gain.value = 0.45;

      warpOsc1.connect(w1g);
      warpOsc2.connect(w2g);
      w1g.connect(warpFilter);
      w2g.connect(warpFilter);
      warpFilter.connect(warpGain);
      warpGain.connect(master);
      warpOsc1.start();
      warpOsc2.start();

      this.warpGain = warpGain;
      this.warpOsc1 = warpOsc1;
      this.warpOsc2 = warpOsc2;

      // 4. Black Hole Abyssal Gravitational Sub-Bass Texture (supports the 3:30 organ peak cleanly)
      const abyssGain = ctx.createGain();
      abyssGain.gain.value = 0;

      const abyssFilter = ctx.createBiquadFilter();
      abyssFilter.type = 'lowpass';
      abyssFilter.frequency.value = 84;
      abyssFilter.Q.value = 1.8;

      const abyssNoise = ctx.createBufferSource();
      abyssNoise.buffer = noiseBuf;
      abyssNoise.loop = true;
      const abyssNoiseGain = ctx.createGain();
      abyssNoiseGain.gain.value = 0.85;
      abyssNoise.connect(abyssNoiseGain);
      abyssNoiseGain.connect(abyssFilter);
      abyssNoise.start();

      const subOsc = ctx.createOscillator();
      subOsc.type = 'sine';
      subOsc.frequency.value = 36.71; // Deep D1 gravitational rumble
      const subG = ctx.createGain();
      subG.gain.value = 0.24;
      subOsc.connect(subG);
      subG.connect(abyssFilter);
      subOsc.start();

      abyssFilter.connect(abyssGain);
      abyssGain.connect(master);
      this.abyssGain = abyssGain;
      this.abyssFilter = abyssFilter;

      this.initialized = true;

      // Start the contemplative Interstellar Main Theme immediately upon user gesture unlock
      if (!this.muted) {
        this.safePlayAudio(this.ambientBgm, 0);
      }
    } catch {
      // Gracefully degrade if Web Audio is unavailable in headless browser
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.36, this.ctx.currentTime, 0.08);
    }
    if (this.ambientBgm) this.ambientBgm.muted = muted;
    if (this.peakBgm) this.peakBgm.muted = muted;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  private updateMusicStems(state: SoundscapeState): void {
    if (!this.ambientBgm || !this.peakBgm) return;

    if (state.paused) {
      if (!this.bgmPausedByGame) {
        this.bgmPausedByGame = true;
        this.ambientBgm.pause();
        this.peakBgm.pause();
      }
      return;
    }

    if (this.bgmPausedByGame) {
      this.bgmPausedByGame = false;
      if (!this.muted) {
        if (this.peakMix > 0.02) this.safePlayAudio(this.peakBgm);
        if (this.ambientMix > 0.02) this.safePlayAudio(this.ambientBgm);
      }
    }

    const wantPeak = shouldUsePeakCue(state);

    // When freshly entering Event Horizon / Plunge / Tesseract climax, cue peak deck right at 3:30 (210.0s)!
    if (wantPeak && !this.wasPeakMode) {
      this.safePlayAudio(this.peakBgm, PEAK_CUE_START_SEC);
    } else if (!wantPeak && this.wasPeakMode) {
      if (this.ambientBgm.paused && !this.muted) {
        this.safePlayAudio(this.ambientBgm);
      }
    }
    this.wasPeakMode = wantPeak;

    // Smooth crossfade rate (~1.4s full transition at 60fps)
    const fadeStep = 0.016;
    if (wantPeak) {
      this.peakMix = Math.min(1, this.peakMix + fadeStep);
      this.ambientMix = Math.max(0, this.ambientMix - fadeStep);
    } else {
      this.ambientMix = Math.min(1, this.ambientMix + fadeStep);
      this.peakMix = Math.max(0, this.peakMix - fadeStep);
    }

    // Keep ambient stem looping seamlessly inside 0:00 -> 3:25.5 (never drifting into the 3:30 climax during normal flight)
    if (this.ambientMix > 0.01) {
      if (this.ambientBgm.paused && !this.muted) {
        this.safePlayAudio(this.ambientBgm);
      }
      if (this.ambientBgm.currentTime >= AMBIENT_LOOP_END_SEC || this.ambientBgm.ended) {
        try {
          this.ambientBgm.currentTime = AMBIENT_LOOP_START_SEC;
        } catch {
          // ignore
        }
      }
      const env =
        this.ambientBgm.currentTime < 6
          ? 1.0
          : computeTrackLoopEnvelope(
              this.ambientBgm.currentTime,
              AMBIENT_LOOP_START_SEC,
              AMBIENT_LOOP_END_SEC,
              2.2,
            );
      // Softly breathe slightly quieter on planetary surfaces so wind & footsteps stay crisp
      const regimeScale = state.regime === 'SURFACE' ? 0.44 : 0.62;
      this.ambientBgm.volume = this.muted ? 0 : Math.max(0, Math.min(1, this.ambientMix * regimeScale * env));
    } else {
      this.ambientBgm.volume = 0;
      if (!this.ambientBgm.paused) this.ambientBgm.pause();
    }

    // Keep 3:30+ climax peak deck surging across Event Horizon, Plunge & 5D Tesseract!
    if (this.peakMix > 0.01) {
      if (this.peakBgm.paused && !this.muted) {
        const startAt =
          this.peakBgm.currentTime >= PEAK_CUE_START_SEC &&
          this.peakBgm.currentTime < PEAK_CUE_END_SEC
            ? undefined
            : PEAK_CUE_START_SEC;
        this.safePlayAudio(this.peakBgm, startAt);
      }
      if (
        this.peakBgm.currentTime >= PEAK_CUE_END_SEC ||
        this.peakBgm.currentTime < PEAK_CUE_START_SEC - 0.5 ||
        this.peakBgm.ended
      ) {
        try {
          this.peakBgm.currentTime = PEAK_CUE_START_SEC;
        } catch {
          // ignore
        }
      }
      const peakEnv = computeTrackLoopEnvelope(
        this.peakBgm.currentTime,
        PEAK_CUE_START_SEC,
        PEAK_CUE_END_SEC,
        1.4,
      );
      const peakGain = state.tesseractStage === 'plunge' ? 0.86 : 0.78;
      this.peakBgm.volume = this.muted
        ? 0
        : Math.max(0, Math.min(1, this.peakMix * peakGain * Math.max(0.25, peakEnv)));
    } else {
      this.peakBgm.volume = 0;
      if (!this.peakBgm.paused) this.peakBgm.pause();
    }
  }

  private playRelativisticTick(intensity = 0.14): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1480, now);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.025);
    filter.type = 'bandpass';
    filter.frequency.value = 1850;
    filter.Q.value = 3.5;
    gain.gain.setValueAtTime(intensity, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.055);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  public playGravityChord(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const chord = [220.0, 329.63, 440.0, 493.88, 659.25];
    chord.forEach((f, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = idx < 2 ? 'triangle' : 'sine';
      const t0 = now + idx * 0.045;
      osc.frequency.setValueAtTime(f, t0);
      osc.detune.value = (idx - 2) * 3.0;
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(0.11, t0 + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0008, t0 + 1.85);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t0);
      osc.stop(t0 + 1.9);
    });
  }

  public playAnchorDecodedChime(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    // Luminous Morse-like harmonic arpeggio (A4 -> E5 -> B5 -> C#6 -> E6)
    const freqs = [440, 659.25, 987.77, 1108.73, 1318.51];
    freqs.forEach((f, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      const t0 = now + idx * 0.095;
      osc.frequency.setValueAtTime(f, t0);
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(0.12, t0 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0008, t0 + 1.45);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t0);
      osc.stop(t0 + 1.5);
    });
  }

  public update(state: SoundscapeState, timeSec: number): void {
    this.updateMusicStems(state);

    if (!this.initialized || !this.ctx) return;
    const now = this.ctx.currentTime;

    if (state.paused) {
      this.windGain?.gain.setTargetAtTime(0, now, 0.1);
      this.warpGain?.gain.setTargetAtTime(0, now, 0.1);
      this.solarGain?.gain.setTargetAtTime(0, now, 0.1);
      this.abyssGain?.gain.setTargetAtTime(0, now, 0.1);
      return;
    }

    const tStage = state.tesseractStage ?? 'outside';

    // === EVENT HORIZON PLUNGE & 5D TESSERACT FOLEY LAYER (supports 3:30 Hans Zimmer climax) ===
    if (tStage !== 'outside') {
      this.windGain?.gain.setTargetAtTime(0, now, 0.25);
      this.solarGain?.gain.setTargetAtTime(0, now, 0.25);
      this.warpGain?.gain.setTargetAtTime(0, now, 0.2);

      if (tStage === 'plunge') {
        const prog = state.plungeProgress ?? 0;
        const tidalSwell = 0.85 + 0.15 * Math.sin(timeSec * 3.0);
        this.abyssGain?.gain.setTargetAtTime(0.62 * tidalSwell * (1 - prog * 0.35), now, 0.18);
        this.abyssFilter?.frequency.setTargetAtTime(72 + prog * 240, now, 0.18);

        const tickInterval = Math.max(0.38, 1.25 - prog * 0.8);
        if (now - this.lastTickTime >= tickInterval) {
          this.lastTickTime = now;
          this.playRelativisticTick(0.11 + prog * 0.07);
        }
      } else {
        // Subtle deep bulk resonance + gentle 1.25s Miller-planet watch tick underneath the 3:30 climax
        this.abyssGain?.gain.setTargetAtTime(0.14, now, 0.55);
        this.abyssFilter?.frequency.setTargetAtTime(64, now, 0.55);
        if (now - this.lastTickTime >= 1.25) {
          this.lastTickTime = now;
          this.playRelativisticTick(0.055);
        }
      }
      return;
    }

    // Sonic boom / atmospheric entry transient when diving into an atmosphere
    if (
      state.regime === 'ATMOSPHERE' &&
      this.lastRegime !== 'ATMOSPHERE' &&
      this.lastRegime !== 'SURFACE' &&
      state.atmosphereDensity > 0.25
    ) {
      this.playSonicBoom(0.65);
    }
    this.lastRegime = state.regime;

    // 1. Planet-specific Atmospheric Wind
    const isAtmoPresent =
      (state.regime === 'SURFACE' || state.regime === 'ATMOSPHERE') &&
      state.atmosphereDensity > 0.05;
    if (isAtmoPresent && this.windFilter && this.windGain) {
      const gust = Math.sin(timeSec * 0.7) * 0.3 + Math.sin(timeSec * 1.9) * 0.15;
      let baseFreq = 320;
      let q = 1.6;
      let gainLevel = 0.18;
      if (state.soundProfile === 'earth') {
        baseFreq = 380 + gust * 140 + state.speedNorm * 320;
        q = 1.2;
        gainLevel = 0.16 + state.speedNorm * 0.22;
      } else if (state.soundProfile === 'mars') {
        baseFreq = 520 + gust * 220 + state.speedNorm * 280;
        q = 3.2;
        gainLevel = 0.14 + state.speedNorm * 0.16;
      } else if (state.soundProfile === 'dense') {
        baseFreq = 165 + gust * 60 + state.speedNorm * 180;
        q = 0.9;
        gainLevel = 0.28 + state.speedNorm * 0.2;
      } else if (state.soundProfile === 'ice') {
        baseFreq = 690 + gust * 190;
        q = 4.2;
        gainLevel = 0.12 + state.speedNorm * 0.12;
      }
      const buffet = state.entryBuffeting ?? 0;
      const roarBoost = buffet * 0.32;
      this.windFilter.frequency.setTargetAtTime(Math.max(80, baseFreq + buffet * 260), now, 0.18);
      this.windFilter.Q.setTargetAtTime(Math.max(0.65, q - buffet * 0.8), now, 0.18);
      this.windGain.gain.setTargetAtTime(Math.min(0.72, gainLevel + roarBoost), now, 0.18);
    } else {
      this.windGain?.gain.setTargetAtTime(0, now, 0.35);
    }

    // 2. Solar Proximity & Hypersonic Re-Entry Sub-Bass Plasma Rumble
    const entryRumble = (state.entryBuffeting ?? 0) * 0.52;
    this.solarGain?.gain.setTargetAtTime(
      Math.min(0.62, Math.max(state.starProximity * 0.42, entryRumble)),
      now,
      0.18,
    );

    // 3. Black Hole Abyssal Gravitational Sub-Bass Texture
    const bhProx = state.blackHoleProximity ?? 0;
    if (this.abyssGain && this.abyssFilter) {
      const tidalPulse = 0.84 + 0.16 * Math.sin(timeSec * (1.1 + bhProx * 2.2));
      this.abyssGain.gain.setTargetAtTime(bhProx * 0.45 * tidalPulse, now, 0.28);
      this.abyssFilter.frequency.setTargetAtTime(64 + bhProx * 125 * tidalPulse, now, 0.28);
    }

    // 4. Flight & Superluminal Warp Doppler Hum
    const flightEnergy =
      state.regime === 'SURFACE'
        ? 0
        : Math.min(
            1,
            state.speedNorm * 0.72 + (state.isBoosting ? 0.32 : 0) + (state.isWarping ? 0.46 : 0),
          );
    const warpTarget = flightEnergy > 0.1 ? flightEnergy * 0.14 : 0;
    this.warpGain?.gain.setTargetAtTime(warpTarget, now, 0.15);
    if (this.warpOsc1 && this.warpOsc2) {
      const freqBase = 48 + flightEnergy * 115 + (state.isWarping ? 45 : 0);
      this.warpOsc1.frequency.setTargetAtTime(freqBase, now, 0.12);
      this.warpOsc2.frequency.setTargetAtTime(freqBase * 2.01, now, 0.12);
    }
  }

  public playSonicBoom(weight = 1.0): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(145, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.45);
    gain.gain.setValueAtTime(0.45 * weight, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.52);
  }

  public playTouchdown(impactWeight = 0.8): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(92, now);
    osc.frequency.exponentialRampToValueAtTime(32, now + 0.22);
    gain.gain.setValueAtTime(0.35 * impactWeight, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.26);
  }

  public playFootstep(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastFootstepTime < 0.26) return;
    this.lastFootstepTime = now;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const jitter = 0.92 + Math.random() * 0.16;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(120 * jitter, now);
    osc.frequency.exponentialRampToValueAtTime(48 * jitter, now + 0.065);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  public playJumpThrust(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(460, now + 0.18);
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.24);
  }

  public playScanPulse(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const freqs = [523.25, 659.25, 987.77];
    freqs.forEach((f, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      const t0 = now + idx * 0.055;
      osc.frequency.setValueAtTime(f, t0);
      osc.frequency.exponentialRampToValueAtTime(f * 1.12, t0 + 0.55);
      gain.gain.setValueAtTime(0.12, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.65);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t0);
      osc.stop(t0 + 0.68);
    });
  }

  public playWarpEngage(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(240, now);
    filter.frequency.exponentialRampToValueAtTime(2200, now + 0.65);

    osc.frequency.setValueAtTime(65, now);
    osc.frequency.exponentialRampToValueAtTime(340, now + 0.65);
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.78);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.8);
  }

  public playHorizonEjection(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(520, now);
    filter.frequency.exponentialRampToValueAtTime(48, now + 1.15);

    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(24, now + 1.15);
    gain.gain.setValueAtTime(0.55, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.25);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 1.28);
  }

  public dispose(): void {
    if (this.ambientBgm) {
      this.ambientBgm.pause();
      this.ambientBgm.src = '';
      this.ambientBgm = null;
    }
    if (this.peakBgm) {
      this.peakBgm.pause();
      this.peakBgm.src = '';
      this.peakBgm = null;
    }
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.initialized = false;
  }
}
