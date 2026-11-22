class_name PlungeMath
extends RefCounted
## Numbers behind the fall into a black hole. Pure maths, no nodes.

## How long the fall from the event horizon to the tesseract lasts (seconds).
const FALL_SECONDS := 70.0
## How deep you get before the tesseract takes over, as a fraction of the horizon radius.
const DEEPEST := 0.12
## Inward drift at the horizon, in horizon radii per second. For Sgr A* (rs = 12.7 million km)
## that is about 0.85 c, close to what a real infalling observer would have.
const PULL_AT_HORIZON := 0.02


## Inward drift speed (m/s) at distance `r` from a hole with horizon radius `rs`: inverse square,
## so it is a nudge at 10 rs and beats the jetpack just above the horizon.
static func pull_speed(r: float, rs: float) -> float:
	if r <= 0.0 or rs <= 0.0:
		return 0.0
	return PULL_AT_HORIZON * rs * pow(rs / r, 2.0)


## Radius during the fall as a fraction of rs, for progress u in 0..1. Starts gently at the
## horizon and keeps speeding up, never turning back.
static func radius_fraction(u: float) -> float:
	u = clampf(u, 0.0, 1.0)
	return 1.0 - (1.0 - DEEPEST) * pow(u, 1.5)
