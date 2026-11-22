class_name Leviathan
extends MeshInstance3D
## The Devourer's body: a mouth ringed with jaw prongs, a long tapering trunk, two great fins
## and a trail of tendrils, all built once in code. One unit of the mesh is its whole length,
## the head is at the origin and it swims along -Z. The shader makes it move.

const SHADER := preload("res://shaders/leviathan.gdshader")
const BODY_RINGS := 150
const BODY_SIDES := 36
const PRONGS := 7
const TENDRILS := 13

var _verts := PackedVector3Array()
var _normals := PackedVector3Array()
var _uvs := PackedVector2Array()
var _parts := PackedVector2Array()
var _indices := PackedInt32Array()
var _material := ShaderMaterial.new()


func _ready() -> void:
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_material.shader = SHADER
	material_override = _material
	custom_aabb = AABB(Vector3(-2.0, -2.0, -1.0), Vector3(4.0, 4.0, 4.0))
	mesh = _build()
	visible = false


## Half-width of the trunk at `u` (0 mouth .. 1 tail), in lengths.
static func body_radius(u: float) -> float:
	var r0 := StoryMath.RADIUS / StoryMath.LENGTH
	var shape := lerpf(0.86, 1.0, clampf(u / 0.05, 0.0, 1.0))
	if u > 0.1:
		shape = pow(1.0 - (u - 0.1) / 0.9, 0.7)
	# Ribbed, like something with segments.
	return r0 * (shape * (1.0 + 0.045 * sin(u * 150.0)) + 0.012)


## Put it in the view. `rel` is its head relative to the camera (metres), `heading` the way it
## swims, `space` the camera's depth fitting. Returns nothing; hides itself if `shown` is false.
func place(rel: DVec3, heading: Vector3, space: ScaledSpace, sun_dir: Vector3, sun_energy: float) -> void:
	var d := rel.length()
	# Pull it inside the far plane like everything else, tail and tendrils included.
	var s := minf(space.scale_factor(d), 0.8 * space.far / (d + StoryMath.LENGTH * 1.7))
	var up := Vector3.UP if absf(heading.dot(Vector3.UP)) < 0.95 else Vector3.RIGHT
	var basis := Basis.looking_at(heading, up)
	global_transform = Transform3D(basis.scaled(Vector3.ONE * StoryMath.LENGTH * s), rel.scaled(s).to_vector3())
	visible = true
	# From far away it is only a shadow; close up, every eye is lit.
	var presence := clampf(pow(0.6 * StoryMath.AU / maxf(d, 1.0), 0.8), 0.04, 1.0)
	_material.set_shader_parameter("presence", presence)
	_material.set_shader_parameter("sun_dir_world", sun_dir)
	_material.set_shader_parameter("sun_energy", sun_energy)


func _build() -> ArrayMesh:
	var rng := RandomNumberGenerator.new()
	rng.seed = 7741
	# The trunk, open at the mouth so you can see down the throat.
	var centers := PackedVector3Array()
	var radii := PackedFloat32Array()
	for i in BODY_RINGS + 1:
		var u := float(i) / BODY_RINGS
		centers.append(Vector3(0.0, 0.0, u))
		radii.append(body_radius(u))
	_tube(centers, radii, BODY_SIDES, 0.0, 0.0)
	var r0 := body_radius(0.03)
	# Jaw prongs: long hooks reaching forward around whatever it is about to swallow.
	for p in PRONGS:
		var a := TAU * p / PRONGS + 0.2
		var radial := Vector3(cos(a), sin(a), 0.0)
		centers = PackedVector3Array()
		radii = PackedFloat32Array()
		for i in 25:
			var s := i / 24.0
			var out := r0 * (0.98 + 1.25 * sin(PI * s) * (1.0 - 0.3 * s) - 0.55 * s * s)
			centers.append(radial * out + Vector3(0.0, 0.0, 0.04 - 0.2 * s))
			radii.append(r0 * (0.15 * pow(1.0 - s, 0.8) + 0.004))
		_tube(centers, radii, 8, 0.5, rng.randf())
	# Tendrils trailing from its flanks and tail.
	for k in TENDRILS:
		var a := rng.randf() * TAU
		var u0 := rng.randf_range(0.14, 0.7)
		var length := rng.randf_range(0.35, 0.95)
		var radial := Vector3(cos(a), sin(a), 0.0)
		var thick := rng.randf_range(0.05, 0.12)
		centers = PackedVector3Array()
		radii = PackedFloat32Array()
		for i in 41:
			var s := i / 40.0
			centers.append(radial * (body_radius(u0) * 0.8 + 0.07 * pow(s, 0.6)) + Vector3(0.0, 0.0, u0 + length * s))
			radii.append(r0 * (thick * (1.0 - s) + 0.004))
		_tube(centers, radii, 6, 0.75, rng.randf())
	# Two fins like a ray's wings.
	for side: float in [-1.0, 1.0]:
		_fin(side, rng.randf())
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = _verts
	arrays[Mesh.ARRAY_NORMAL] = _normals
	arrays[Mesh.ARRAY_TEX_UV] = _uvs
	arrays[Mesh.ARRAY_TEX_UV2] = _parts
	arrays[Mesh.ARRAY_INDEX] = _indices
	var am := ArrayMesh.new()
	am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return am


## A tube along `centers` with a radius at each point.
func _tube(centers: PackedVector3Array, radii: PackedFloat32Array, sides: int, part: float, phase: float) -> void:
	var base := _verts.size()
	var n := centers.size()
	for i in n:
		var tangent := (centers[mini(i + 1, n - 1)] - centers[maxi(i - 1, 0)]).normalized()
		var ref := Vector3.UP if absf(tangent.dot(Vector3.UP)) < 0.9 else Vector3.RIGHT
		var x := ref.cross(tangent).normalized()
		var y := tangent.cross(x)
		var s := float(i) / (n - 1)
		for j in sides + 1:
			var a := TAU * j / sides
			var dir := x * cos(a) + y * sin(a)
			_verts.append(centers[i] + dir * radii[i])
			_normals.append(dir)
			_uvs.append(Vector2(float(j) / sides, s))
			_parts.append(Vector2(part, phase))
	for i in n - 1:
		for j in sides:
			var a := base + i * (sides + 1) + j
			var b := a + sides + 1
			_indices.append_array([a, b, a + 1, a + 1, b, b + 1])


## A thin swept wing from the flank.
func _fin(side: float, phase: float) -> void:
	var base := _verts.size()
	var na := 28
	var nb := 10
	for i in na + 1:
		var a := float(i) / na
		var u := lerpf(0.1, 0.58, a)
		var span := 0.2 * pow(sin(PI * a), 0.55)
		for j in nb + 1:
			var b := float(j) / nb
			_verts.append(Vector3(side * (body_radius(u) * 0.7 + span * b), -0.035 * b * b, u + 0.14 * b * b))
			_normals.append(Vector3.UP)
			_uvs.append(Vector2(a, b))
			_parts.append(Vector2(1.0, phase))
	for i in na:
		for j in nb:
			var a := base + i * (nb + 1) + j
			var b := a + nb + 1
			_indices.append_array([a, b, a + 1, a + 1, b, b + 1])
