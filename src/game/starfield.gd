class_name Starfield
extends MeshInstance3D
## Placeholder sky: deterministic procedural stars with realistic colour and brightness spread.
## Milestone 2 replaces this with a real star catalogue (positions, magnitudes, colours).

const STAR_COUNT := 9000
## Stars sit on a unit sphere; SpaceView scales it to just inside the camera far plane each frame.
const SKY_RADIUS := 1.0


func _ready() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 20261121
	var verts := PackedVector3Array()
	var colors := PackedColorArray()
	for i in STAR_COUNT:
		# Uniform direction, slightly concentrated towards a tilted galactic plane.
		var dir := Vector3(rng.randfn(), rng.randfn(), rng.randfn()).normalized()
		if rng.randf() < 0.45:
			dir.y *= 0.18
			dir = dir.normalized()
		dir = Basis(Vector3.RIGHT, deg_to_rad(62.0)) * dir
		verts.append(dir * SKY_RADIUS)
		# Brightness follows a steep power law: a few bright stars, many faint ones.
		var b := pow(rng.randf(), 7.0) * 0.9 + 0.08
		colors.append(_star_color(rng.randf()) * Color(1, 1, 1, b))
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_COLOR] = colors
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_POINTS, arrays)
	mesh = m
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/starfield.gdshader")
	material_override = mat
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	custom_aabb = AABB(Vector3.ONE * -SKY_RADIUS, Vector3.ONE * SKY_RADIUS * 2.0)


## Rough blackbody colours weighted by how common each stellar class is (mostly orange/red dwarfs).
static func _star_color(r: float) -> Color:
	if r < 0.04:
		return Color(0.62, 0.72, 1.0) # O/B blue-white
	if r < 0.14:
		return Color(0.80, 0.86, 1.0) # A white
	if r < 0.34:
		return Color(1.0, 0.97, 0.90) # F/G yellow-white
	if r < 0.70:
		return Color(1.0, 0.85, 0.65) # K orange
	return Color(1.0, 0.70, 0.50) # M red
