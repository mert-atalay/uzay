class_name SurfaceRocks
extends MultiMeshInstance3D
## Loose rocks and boulders around you on solid ground, so walking has something to measure
## distance and speed against. Where each rock sits comes from a hash of its grid cell on the
## planet's cube face, so the same rock is always in the same place when you come back.
##
## Positions are worked out in 64-bit planet-fixed metres and stored relative to an anchor
## (where the player was at the last rebuild); each frame only the anchor moves.

const SHADER := preload("res://shaders/rock.gdshader")
const MAX_ROCKS := 700
## Rocks only exist this close to the ground.
const MAX_ALTITUDE := 500.0
## Heights are costly on the CPU: spread a fresh area over a few frames.
const NEW_PER_FRAME := 50
## [cell size m, range in cells, chance per cell, smallest size m, largest size m]
const TIERS := [
	[5.0, 13, 0.55, 0.15, 0.9],
	[40.0, 12, 0.3, 1.2, 4.0],
]

var _material := ShaderMaterial.new()
var _cache: Dictionary = {} # Vector4i(i, j, tier, face) -> rock record, or null for an empty cell
var _body_id := ""
var _anchor := DVec3.new()
var _east := DVec3.new(1.0, 0.0, 0.0)
var _up := DVec3.new(0.0, 1.0, 0.0)
var _north := DVec3.new(0.0, 0.0, 1.0)
var _last_cell := Vector3i(1 << 30, 0, 0)
var _pending := false
var _haze := 0.0


func _ready() -> void:
	visible = false
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	custom_aabb = AABB(Vector3.ONE * -1.0e4, Vector3.ONE * 2.0e4)
	_material.shader = SHADER
	material_override = _material
	multimesh = MultiMesh.new()
	multimesh.transform_format = MultiMesh.TRANSFORM_3D
	multimesh.use_custom_data = true
	multimesh.mesh = build_rock_mesh()
	multimesh.instance_count = MAX_ROCKS
	multimesh.visible_instance_count = 0


## A faceted boulder: a sphere cut by random planes, with flat shading.
static func build_rock_mesh() -> ArrayMesh:
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	var planes: Array[Plane] = []
	for i in 14:
		var n := Vector3(rng.randf_range(-1.0, 1.0), rng.randf_range(-1.0, 1.0), rng.randf_range(-1.0, 1.0)).normalized()
		planes.append(Plane(n, rng.randf_range(0.55, 0.9)))
	var sphere := SphereMesh.new()
	sphere.radius = 1.0
	sphere.height = 2.0
	sphere.radial_segments = 14
	sphere.rings = 7
	var arrays := sphere.get_mesh_arrays()
	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var indices: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	st.set_smooth_group(-1) # flat faces
	for idx in indices:
		var dir := verts[idx].normalized()
		var r := 1.0
		for p in planes:
			var along := dir.dot(p.normal)
			if along > 1.0e-4:
				r = minf(r, p.d / along)
		st.add_vertex(dir * r)
	st.generate_normals()
	return st.commit()


func hide_rocks() -> void:
	visible = false


static func _hash(i: int, j: int, k: int) -> int:
	var h := (i * 73856093) ^ (j * 19349663) ^ (k * 83492791)
	h = (h ^ (h >> 13)) * 1274126177
	return (h ^ (h >> 16)) & 0x7fffffff


## Uniform 0..1 numbers for a cell, different for each `n`.
static func _rand(seed_value: int, n: int) -> float:
	return float(_hash(seed_value, n, 0x9e37) % 100003) / 100003.0


func _configure(b: Dictionary) -> void:
	_body_id = b["id"]
	_cache.clear()
	_last_cell = Vector3i(1 << 30, 0, 0)
	var tex := BodyVisuals.texture(b["id"] + ".jpg")
	_material.set_shader_parameter("use_texture", tex != null)
	if tex != null:
		_material.set_shader_parameter("albedo_tex", tex)
	var base := UniverseCatalog.color_of(b["palette"][0], Color.GRAY)
	_material.set_shader_parameter("base_color", base)
	_material.set_shader_parameter("rock_color", base.lerp(Color(0.3, 0.28, 0.26), 0.6))
	var atmo: Variant = b["atmosphere"]
	if atmo != null and atmo["density"] >= 0.1:
		_material.set_shader_parameter("haze_color", UniverseCatalog.color_of(atmo["horizonColor"]).lerp(Color.WHITE, 0.1) * 0.8)
		_haze = clampf(atmo["density"], 0.1, 3.0) / 90000.0
	else:
		_haze = 0.0
	_material.set_shader_parameter("haze_density", _haze)


## The rock in one cell (or null if the cell is empty), computed once and remembered.
## Returns false if this frame's budget ran out before it could be computed.
func _rock(key: Vector4i, field: TerrainField, f: Array[int], sign_major: float, budget: Array[int]) -> bool:
	if _cache.has(key):
		return true
	var tier: Array = TIERS[key.z]
	var seed_value := _hash(key.x, key.y, key.z * 8 + key.w)
	if _rand(seed_value, 0) > tier[2]:
		_cache[key] = null
		return true
	if budget[0] <= 0:
		return false
	budget[0] -= 1
	var cell: float = tier[0]
	var u := (key.x + _rand(seed_value, 1)) * cell
	var v := (key.y + _rand(seed_value, 2)) * cell
	var c := [0.0, 0.0, 0.0]
	c[f[0]] = u * sign_major
	c[f[1]] = v * sign_major
	c[f[2]] = field.radius * sign_major
	var dir := DVec3.new(c[0], c[1], c[2]).normalized()
	if field.land(dir) < 0.9:
		_cache[key] = null # under water
		return true
	var t := _rand(seed_value, 3)
	var size: float = lerpf(tier[3], tier[4], t * t)
	var squash := Vector3(lerpf(0.7, 1.3, _rand(seed_value, 4)), lerpf(0.6, 1.0, _rand(seed_value, 5)), lerpf(0.7, 1.3, _rand(seed_value, 6)))
	var pos := dir.scaled(field.radius + field.height(dir) - size * squash.y * 0.25)
	var spin := Basis.from_euler(Vector3(_rand(seed_value, 7) * 0.5 - 0.25, _rand(seed_value, 8) * TAU, _rand(seed_value, 9) * 0.5 - 0.25))
	var uv := Vector2(fposmod(atan2(dir.x, dir.z) / TAU, 1.0), acos(clampf(dir.y, -1.0, 1.0)) / PI)
	_cache[key] = [pos, spin.scaled_local(squash * size), Color(cell * tier[1], _rand(seed_value, 10), uv.x, uv.y)]
	return true


## fixed_up: planet-fixed unit direction to the player;  r: the player's distance from the centre
## to_world: planet-fixed DVec3 → system axes;  altitude: height above the ground
func place(b: Dictionary, field: TerrainField, fixed_up: DVec3, r: float, to_world: Callable, altitude: float,
		light_dir: Vector3, light_color: Color, light_energy: float) -> void:
	if field == null or altitude > MAX_ALTITUDE:
		visible = false
		return
	if _body_id != b["id"]:
		_configure(b)
	visible = true
	var f := TerrainField.face_axes(fixed_up)
	var major := TerrainField.component(fixed_up, f[2])
	var sign_major := 1.0 if major >= 0.0 else -1.0
	var u := TerrainField.component(fixed_up, f[0]) / major * field.radius
	var v := TerrainField.component(fixed_up, f[1]) / major * field.radius
	var face := f[2] * 2 + (1 if major < 0.0 else 0)
	var small: float = TIERS[0][0]
	var cell := Vector3i(floori(u / small), floori(v / small), face)
	if cell != _last_cell or _pending:
		_last_cell = cell
		_rebuild(field, f, sign_major, u, v, face, fixed_up, r)
	# Only the anchor moves between rebuilds.
	var here := fixed_up.scaled(r)
	var x: Vector3 = (to_world.call(_east) as DVec3).to_vector3()
	var y: Vector3 = (to_world.call(_up) as DVec3).to_vector3()
	var z: Vector3 = (to_world.call(_north) as DVec3).to_vector3()
	global_transform = Transform3D(Basis(x, y, z), (to_world.call(_anchor.sub(here)) as DVec3).to_vector3())
	_material.set_shader_parameter("sun_dir_world", light_dir)
	_material.set_shader_parameter("up_world", y)
	_material.set_shader_parameter("sun_color", light_color)
	_material.set_shader_parameter("sun_energy", light_energy)


func _rebuild(field: TerrainField, f: Array[int], sign_major: float, u: float, v: float, face: int,
		fixed_up: DVec3, r: float) -> void:
	if _cache.size() > 20000:
		_cache.clear()
	_anchor = fixed_up.scaled(r)
	_up = fixed_up
	_east = DVec3.new(fixed_up.z, 0.0, -fixed_up.x)
	if _east.length() < 1.0e-6:
		_east = DVec3.new(1.0, 0.0, 0.0)
	_east = _east.normalized()
	_north = DVec3.new(
		_east.y * _up.z - _east.z * _up.y,
		_east.z * _up.x - _east.x * _up.z,
		_east.x * _up.y - _east.y * _up.x)
	var budget: Array[int] = [NEW_PER_FRAME]
	_pending = false
	var count := 0
	for tier_index in TIERS.size():
		var tier: Array = TIERS[tier_index]
		var ci := floori(u / tier[0])
		var cj := floori(v / tier[0])
		var reach: int = tier[1]
		for dj in range(-reach, reach + 1):
			for di in range(-reach, reach + 1):
				if di * di + dj * dj > reach * reach or count >= MAX_ROCKS:
					continue
				var key := Vector4i(ci + di, cj + dj, tier_index, face)
				if not _rock(key, field, f, sign_major, budget):
					_pending = true
					continue
				var rock: Variant = _cache[key]
				if rock == null:
					continue
				var rel: DVec3 = (rock[0] as DVec3).sub(_anchor)
				var local := Vector3(rel.dot(_east), rel.dot(_up), rel.dot(_north))
				multimesh.set_instance_transform(count, Transform3D(rock[1], local))
				multimesh.set_instance_custom_data(count, rock[2])
				count += 1
	multimesh.visible_instance_count = count
