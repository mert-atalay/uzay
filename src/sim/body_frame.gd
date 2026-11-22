class_name BodyFrame
extends RefCounted
## Converts between a star system's axes and a spinning body's own (planet-fixed) axes, in
## 64-bit. A body's orientation is: spin by `angle` about its axis (+Y), then tilt the axis by
## `tilt` (the same convention SpaceView uses to orient the mesh).
## Float32 would only be good to about half a metre on an Earth-sized planet, which shows up as
## the ground jittering under your feet.


static func spin_angle(b: Dictionary, t: float) -> float:
	var period_h: float = b.get("rotation_period_h", 0.0)
	return TAU * t / (period_h * 3600.0) if period_h != 0.0 else 0.0


static func tilt_of(b: Dictionary) -> float:
	return deg_to_rad(b.get("axial_tilt_deg", 0.0))


static func _rot_y(v: DVec3, a: float) -> DVec3:
	var c := cos(a)
	var s := sin(a)
	return DVec3.new(v.x * c + v.z * s, v.y, -v.x * s + v.z * c)


static func _rot_z(v: DVec3, a: float) -> DVec3:
	var c := cos(a)
	var s := sin(a)
	return DVec3.new(v.x * c - v.y * s, v.x * s + v.y * c, v.z)


## Planet-fixed vector → system axes.
static func to_world(v: DVec3, tilt: float, angle: float) -> DVec3:
	return _rot_z(_rot_y(v, angle), -tilt)


## System axes → planet-fixed vector.
static func to_fixed(v: DVec3, tilt: float, angle: float) -> DVec3:
	return _rot_y(_rot_z(v, tilt), -angle)


## The spin axis in system axes.
static func axis(tilt: float) -> Vector3:
	return _rot_z(DVec3.new(0.0, 1.0, 0.0), -tilt).to_vector3()
