class_name DVec3
extends RefCounted
## A 3D vector in 64-bit floats.
##
## Godot's Vector3 is 32-bit, which only gives ~0.5 m precision at Earth's radius and
## kilometres of error at 1 AU. Every simulation position (in metres) is a DVec3; we only
## convert to Vector3 after subtracting the camera position (floating origin).

var x: float
var y: float
var z: float


func _init(px: float = 0.0, py: float = 0.0, pz: float = 0.0) -> void:
	x = px
	y = py
	z = pz


static func from_vector3(v: Vector3) -> DVec3:
	return DVec3.new(v.x, v.y, v.z)


func duplicate() -> DVec3:
	return DVec3.new(x, y, z)


func add(o: DVec3) -> DVec3:
	return DVec3.new(x + o.x, y + o.y, z + o.z)


func sub(o: DVec3) -> DVec3:
	return DVec3.new(x - o.x, y - o.y, z - o.z)


func scaled(s: float) -> DVec3:
	return DVec3.new(x * s, y * s, z * s)


## In-place: self += v * s (v is a 32-bit Vector3, e.g. a velocity).
func add_scaled_vector3(v: Vector3, s: float) -> void:
	x += v.x * s
	y += v.y * s
	z += v.z * s


func length() -> float:
	return sqrt(x * x + y * y + z * z)


func normalized() -> DVec3:
	var l := length()
	if l <= 0.0:
		return DVec3.new()
	return DVec3.new(x / l, y / l, z / l)


func dot(o: DVec3) -> float:
	return x * o.x + y * o.y + z * o.z


func to_vector3() -> Vector3:
	return Vector3(x, y, z)


func _to_string() -> String:
	return "DVec3(%s, %s, %s)" % [x, y, z]
