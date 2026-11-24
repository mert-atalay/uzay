class_name ScaledSpace
extends RefCounted
## Fits true-scale space (metres to tens of thousands of light-years) into one camera.
##
## Godot's 32-bit camera breaks down when far/near exceeds ~1e7 (everything gets culled), so:
##  1. The near plane follows your altitude: 5 cm when standing on a surface, kilometres in orbit.
##  2. The far plane is near × FAR_NEAR_RATIO.
##  3. Objects beyond `limit` are pulled in along their line of sight and shrunk by the same
##     factor. Scaling about the camera is a perspective no-op, so each object looks exactly the
##     same on screen; only its depth changes. The mapping is monotonic, so depth order is kept.
## The body you are closest to is drawn uncompressed (see SpaceView), so its surface is exact.

const FAR_NEAR_RATIO := 2.0e6
const MIN_NEAR := 0.05
const MAX_NEAR := 1.0e6
## Never compress anything closer than this, whatever the far plane (50,000 km).
const MAX_LIMIT := 5.0e7
## Farthest thing we ever draw: a bit beyond the galactic centre.
const MAX_DISTANCE := 3.0e20
## Compressed distances end at this fraction of the far plane (stars sit just beyond).
const FILL := 0.8

var near: float
var far: float
var limit: float
var _log_divisor: float


static func for_altitude(altitude: float) -> ScaledSpace:
	var s := ScaledSpace.new()
	s.near = clampf(altitude * 0.02, MIN_NEAR, MAX_NEAR)
	s.far = s.near * FAR_NEAR_RATIO
	s.limit = minf(MAX_LIMIT, s.far * 0.02)
	# Choose the log divisor so MAX_DISTANCE lands exactly at FILL * far.
	s._log_divisor = maxf(1.0, log(MAX_DISTANCE / s.limit) / (FILL * s.far / s.limit - 1.0))
	return s


func render_distance(d: float) -> float:
	if d <= limit:
		return d
	return limit * (1.0 + log(d / limit) / _log_divisor)


## Multiply both an object's position (relative to the camera) and its size by this.
func scale_factor(d: float) -> float:
	if d <= limit or d <= 0.0:
		return 1.0
	return render_distance(d) / d
