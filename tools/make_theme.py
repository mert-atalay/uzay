#!/usr/bin/env python3
"""Synthesises the game's own theme (assets/music/theme.ogg): a slow piece for organ-like pads,
soft bells and a low pulse that builds for three and a half minutes, peaks, and falls away.

The peak is at 210 s, which the game times to land as the tesseract opens (hud.gd). The piece
is five minutes long and loops without a click: the reverb wraps round the end.
Usage: python3 tools/make_theme.py <repo dir>   (needs numpy and ffmpeg)
"""
import subprocess
import sys
import wave

import numpy as np

RATE = 44100
SECONDS = 300
PEAK = 210.0
BAR = 12.0  # seconds per chord
N = RATE * SECONDS
t = np.arange(N) / RATE
rng = np.random.default_rng(2026)


def hz(semitones_from_a4):
    return 440.0 * 2.0 ** (semitones_from_a4 / 12.0)


# Chords as semitones from A4: (bass, pad notes). D minor, drifting, never quite resolving.
D, E, F, G, A, Bb, C = -7, -5, -4, -2, 0, 1, 3
CHORDS = [
    (D - 24, [D - 12, A - 12, D, F, E + 12]),          # Dm add9
    (Bb - 36, [Bb - 24, F - 12, Bb - 12, D, A]),       # Bb maj7
    (F - 24, [F - 12, C - 12, F, A, G + 12 - 12]),     # F add9
    (C - 24, [C - 12, G - 12, C, E, G]),               # C
    (G - 36, [G - 24, D - 12, G - 12, Bb - 12, F]),    # Gm7
    (D - 24, [D - 12, A - 12, D, F, A]),               # Dm
    (Bb - 36, [Bb - 24, F - 12, D, F, C + 12 - 12]),   # Bb add9
    (A - 36, [A - 24, E - 12, A - 12, D, E]),          # A sus4
]

# How much is going on: quiet, a long climb to the peak, then away.
intensity = np.interp(t, [0, 40, 120, PEAK, PEAK + 25, 285, SECONDS], [0.22, 0.3, 0.6, 1.0, 0.7, 0.22, 0.22])


def window(start, length, fade):
    """1 inside [start, start + length), with soft edges; wraps round the end of the piece."""
    x = (t - start) % SECONDS
    up = np.clip(x / fade, 0, 1)
    down = np.clip((length + fade - x) / fade, 0, 1)
    w = np.minimum(up, down)
    return w * w * (3 - 2 * w)


def pad(shift):
    out = np.zeros(N)
    bars = int(SECONDS / BAR)
    for b in range(bars):
        bass, notes = CHORDS[b % len(CHORDS)]
        env = window(b * BAR - 1.5, BAR, 3.0)
        chord = np.zeros(N)
        for i, n in enumerate(notes):
            f = hz(n)
            # Three slightly detuned voices per note, each with a few soft harmonics.
            for d in (-0.9, 0.0, 1.1):
                ph = rng.uniform(0, 2 * np.pi)
                ff = f * 2.0 ** ((d + shift * 0.4) / 1200.0 * 6.0)
                chord += np.sin(2 * np.pi * ff * t + ph)
                chord += 0.35 * np.sin(2 * np.pi * 2 * ff * t + ph * 1.3)
                chord += 0.12 * intensity * np.sin(2 * np.pi * 3 * ff * t + ph * 0.7)
        swell = 0.75 + 0.25 * np.sin(2 * np.pi * t / 7.3 + b + shift)
        out += chord * env * swell / (len(notes) * 3)
        # Low root, and a slow pulse on it that only arrives as the piece builds.
        fb = hz(bass)
        pulse = 0.5 + 0.5 * np.sin(2 * np.pi * t / 1.5 - np.pi / 2)
        throb = 1.0 - np.clip(intensity - 0.45, 0, 1) * 1.2 * pulse
        out += 0.9 * np.sin(2 * np.pi * fb * t) * env * throb * (0.4 + 0.6 * intensity)
        out += 0.3 * np.sin(2 * np.pi * 2 * fb * t) * env * throb * intensity
    return out


def bells(shift):
    out = np.zeros(N)
    step = 1.5
    pattern = [0, 2, 4, 3, 1, 3, 4, 2]
    for k in range(int(SECONDS / step)):
        start = k * step
        level = float(np.interp(start, t[::RATE], intensity[::RATE]))
        if level < 0.28 and k % 4:
            continue  # sparse at the quiet ends
        _, notes = CHORDS[int(start / BAR) % len(CHORDS)]
        n = notes[pattern[k % len(pattern)]] + 12
        f = hz(n)
        length = int(RATE * 5.0)
        tt = np.arange(length) / RATE
        strike = np.exp(-tt * 1.1) * (1 - np.exp(-tt * 180))
        note = (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * f * 2.76 * tt) * np.exp(-tt * 3)
                + 0.2 * np.sin(2 * np.pi * f * 2 * tt)) * strike
        pan = 0.5 + 0.35 * np.sin(k * 1.7 + shift * np.pi)
        idx = (int(start * RATE) + np.arange(length)) % N
        np.add.at(out, idx, note * pan * (0.15 + 0.85 * level * level))
    return out


def shimmer(shift):
    """High, thin strings that only come in near the peak."""
    out = np.zeros(N)
    near = np.clip((intensity - 0.6) / 0.4, 0, 1) ** 2
    for b in range(int(SECONDS / BAR)):
        _, notes = CHORDS[b % len(CHORDS)]
        env = window(b * BAR - 1.5, BAR, 3.0)
        for n in notes[2:]:
            f = hz(n + 24)
            for d in (-4, 3):
                out += np.sin(2 * np.pi * f * 2.0 ** (d / 1200.0) * t + rng.uniform(0, 6.28) + shift) * env
    return out * near / 6.0


def reverb(x, seconds=4.5, seed=7):
    """A long hall: convolution with decaying noise, wrapped so the loop stays seamless."""
    r = np.random.default_rng(seed)
    n = int(RATE * seconds)
    tail = r.normal(size=n) * np.exp(-np.arange(n) / RATE * 1.5)
    # Darker as it rings on.
    spec = np.fft.rfft(tail)
    spec /= 1.0 + (np.fft.rfftfreq(n, 1 / RATE) / 2500.0) ** 2
    tail = np.fft.irfft(spec, n)
    kernel = np.zeros(N)
    kernel[:n] = tail / np.sqrt(np.sum(tail ** 2))
    return np.fft.irfft(np.fft.rfft(x) * np.fft.rfft(kernel), N)


def channel(shift, seed):
    dry = 0.5 * pad(shift) + 0.28 * bells(shift) + 0.3 * shimmer(shift)
    dry *= 0.35 + 0.65 * intensity
    return 0.55 * dry + 0.6 * reverb(dry, seed=seed)


stereo = np.stack([channel(0.0, 7), channel(1.0, 11)], axis=1)
stereo = np.tanh(stereo / np.max(np.abs(stereo)) * 1.4) / np.tanh(1.4) * 0.9
repo = sys.argv[1]
wav = f"{repo}/assets/music/theme.wav"
with wave.open(wav, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(RATE)
    w.writeframes((stereo * 32767).astype("<i2").tobytes())
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-c:a", "libvorbis", "-q:a", "5",
                f"{repo}/assets/music/theme.ogg"], check=True)
subprocess.run(["rm", wav], check=True)
