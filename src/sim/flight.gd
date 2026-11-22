class_name Flight
extends RefCounted
## Megaton Rainfall-style speed: how fast you can fly depends on how far you are from the
## nearest surface. Near a planet you crawl; in empty space you cross light-hours.

## Below this altitude you move at walking/hover pace.
const MIN_SPEED := 2.0 # m/s
## Upper cap (≈ 330,000 c) so interstellar distances are crossable before warp exists.
const MAX_SPEED := 1.0e14 # m/s
## Base rate: at full throttle you cover this fraction of your altitude per second.
const BASE_RATE := 0.6
## Extra caution near black holes: the approach should feel heavy and slow.
const BLACK_HOLE_DAMPING := 0.15


## altitude: distance to the nearest surface (or event horizon) in metres.
## throttle: integer steps, each doubles or halves speed (0 = default).
static func max_speed(altitude: float, throttle: int = 0, near_black_hole: bool = false) -> float:
	var rate := BASE_RATE * pow(2.0, throttle)
	if near_black_hole:
		rate *= BLACK_HOLE_DAMPING
	return clampf(maxf(altitude, 0.0) * rate, MIN_SPEED, MAX_SPEED)
