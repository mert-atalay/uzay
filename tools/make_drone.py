#!/usr/bin/env python3
"""Synthesises the low drone you hear near the black hole (assets/music/black_hole_drone.ogg).

Everything is built from whole numbers of cycles over the clip, so it loops without a click.
Usage: python3 tools/make_drone.py <repo dir>   (needs numpy and ffmpeg)
"""
import subprocess
import sys
import wave

import numpy as np

RATE = 44100
SECONDS = 32
N = RATE * SECONDS
t = np.arange(N) / RATE
rng = np.random.default_rng(1971)


def tone(freq, cycles_lfo=0, depth=0.0, phase=0.0):
    f = round(freq * SECONDS) / SECONDS  # whole cycles over the loop
    lfo = 1.0 - depth * (0.5 + 0.5 * np.sin(2 * np.pi * cycles_lfo * t / SECONDS + phase))
    return np.sin(2 * np.pi * f * t + phase) * lfo


def shaped_noise(lo, hi, tilt):
    """Noise limited to lo..hi Hz, made in the frequency domain so it is periodic."""
    spec = np.zeros(N // 2 + 1, dtype=complex)
    freqs = np.fft.rfftfreq(N, 1 / RATE)
    band = (freqs >= lo) & (freqs <= hi)
    spec[band] = rng.normal(size=band.sum()) + 1j * rng.normal(size=band.sum())
    spec[band] /= np.maximum(freqs[band], 1.0) ** tilt
    x = np.fft.irfft(spec, N)
    return x / np.max(np.abs(x))


def channel(shift):
    # A deep fundamental with two close neighbours beating against it.
    x = 0.55 * tone(36.0, 3, 0.35, shift) + 0.4 * tone(36.7, 2, 0.3, 1.0 + shift) + 0.3 * tone(54.2, 5, 0.5, 2.0)
    x += 0.22 * tone(72.4, 4, 0.6, 0.5 + shift) + 0.1 * tone(108.9, 7, 0.8, 1.7)
    # A thin, uneasy cluster far above, drifting in and out.
    x += 0.035 * tone(311.0, 3, 0.95, 0.3 + shift) + 0.03 * tone(329.5, 5, 0.95, 2.1) + 0.02 * tone(466.3, 2, 0.97, 4.0 + shift)
    # Rumble and air.
    x += 0.5 * shaped_noise(18, 90, 0.5) * (0.6 + 0.4 * np.sin(2 * np.pi * 2 * t / SECONDS + shift))
    x += 0.05 * shaped_noise(200, 1800, 1.0) * (0.5 + 0.5 * np.sin(2 * np.pi * 3 * t / SECONDS + 1.0 + shift))
    return x


stereo = np.stack([channel(0.0), channel(0.9)], axis=1)
stereo = stereo / np.max(np.abs(stereo)) * 0.85
repo = sys.argv[1]
wav = f"{repo}/assets/music/black_hole_drone.wav"
with wave.open(wav, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(RATE)
    w.writeframes((stereo * 32767).astype("<i2").tobytes())
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-c:a", "libvorbis", "-q:a", "5",
                f"{repo}/assets/music/black_hole_drone.ogg"], check=True)
subprocess.run(["rm", wav], check=True)
