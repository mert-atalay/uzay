class_name TerrainPatch
extends MeshInstance3D
## Draws the ground of the body you are close to (see shaders/terrain.gdshader) and answers
## "how high is the ground here?" for collisions, using the matching CPU formula in TerrainField.
##
## The mesh never changes: rings of triangles whose radii the shader stretches from a fraction
## of your altitude out past the horizon. Each frame SpaceView tells it which planet-fixed
## point is below the player, worked out in 64-bit.

const SHADER := preload("res://shaders/terrain.gdshader")
const RINGS := 150
const SEGMENTS := 192 # keep in step with the shader
## Terrain appears below this altitude (in body radii) and is at full height by half of it.
const APPEAR_ALTITUDE := 0.03

var body_id := ""
var field: TerrainField
var _material: ShaderMaterial
var _fields: Dictionary = {} # body id -> TerrainField
var _haze := 0.0 # haze per metre at ground level for the current body
static var _tile_texture: ImageTexture


func _ready() -> void:
	visible = false
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mesh = _build_mesh()
	custom_aabb = AABB(Vector3.ONE * -1.0e9, Vector3.ONE * 2.0e9)
	_material = ShaderMaterial.new()
	_material.shader = SHADER
	_material.set_shader_parameter("tile", _tile())
	_material.set_shader_parameter("tile_mean", TerrainField.tile_mean())
	_material.set_shader_parameter("layer_period", PackedFloat32Array(TerrainField.PERIODS))
	material_override = _material


static func _tile() -> ImageTexture:
	if _tile_texture == null:
		var data := TerrainField.tile_data()
		var img := Image.create_from_data(TerrainField.TILE, TerrainField.TILE, false, Image.FORMAT_RF, data.to_byte_array())
		_tile_texture = ImageTexture.create_from_image(img)
	return _tile_texture


## The height field for a body, or null if it has no solid ground.
func field_for(b: Dictionary) -> TerrainField:
	if not TerrainField.has_terrain(b):
		return null
	if not _fields.has(b["id"]):
		var f := TerrainField.new(b["radius_m"], TerrainField.relief_for(b))
		if b["id"] == "earth":
			var spec := BodyVisuals.texture("earth_spec.jpg")
			if spec != null:
				var img := spec.get_image()
				if img.is_compressed():
					img.decompress()
				f.ocean_image = img
		_fields[b["id"]] = f
	return _fields[b["id"]]


## How much of the full terrain height applies at this altitude above the base radius.
static func amplitude(altitude: float, radius: float) -> float:
	var top := APPEAR_ALTITUDE * radius
	return 1.0 - smoothstep(top * 0.5, top, altitude)


func hide_patch() -> void:
	visible = false
	body_id = ""


## Point the patch at body `b`. Call when the nearest body changes.
func _configure(b: Dictionary) -> void:
	body_id = b["id"]
	field = field_for(b)
	var tex := BodyVisuals.texture(b["id"] + ".jpg")
	_material.set_shader_parameter("use_texture", tex != null)
	if tex != null:
		_material.set_shader_parameter("albedo_tex", tex)
	var base := UniverseCatalog.color_of(b["palette"][0], Color.GRAY)
	_material.set_shader_parameter("base_color", base)
	_material.set_shader_parameter("rock_color", base.lerp(Color(0.3, 0.28, 0.26), 0.6))
	_material.set_shader_parameter("radius", field.radius)
	_material.set_shader_parameter("relief", field.relief)
	var is_earth: bool = b["id"] == "earth"
	_material.set_shader_parameter("has_ocean", is_earth)
	if is_earth:
		_material.set_shader_parameter("ocean_tex", BodyVisuals.texture("earth_spec.jpg"))
		_material.set_shader_parameter("cloud_tex", BodyVisuals.texture("earth_clouds.jpg"))
	var atmo: Variant = b["atmosphere"]
	if atmo != null and atmo["density"] >= 0.1:
		_material.set_shader_parameter("haze_color", UniverseCatalog.color_of(atmo["horizonColor"]).lerp(Color.WHITE, 0.25))
		_haze = clampf(atmo["density"], 0.1, 3.0) / 90000.0
	else:
		_haze = 0.0


## Place the patch under the player.
##  fixed_up: planet-fixed unit direction from the body's centre to the player (64-bit)
##  to_world: Callable turning a planet-fixed DVec3 into system axes
##  render_up_point: where the base-radius point below the player is, relative to the camera
##  altitude: height above the ground;  sea_altitude: height above the base radius
func place(b: Dictionary, fixed_up: DVec3, to_world: Callable, render_up_point: Vector3,
		altitude: float, sea_altitude: float, light_dir: Vector3, light_color: Color, light_energy: float) -> void:
	if body_id != b["id"]:
		_configure(b)
	visible = true
	# Two ground axes at that point: east, and the one completing a right-handed set.
	var east := DVec3.new(fixed_up.z, 0.0, -fixed_up.x) # +Y cross up
	if east.length() < 1.0e-6:
		east = DVec3.new(1.0, 0.0, 0.0)
	east = east.normalized()
	var north := DVec3.new(
		east.y * fixed_up.z - east.z * fixed_up.y,
		east.z * fixed_up.x - east.x * fixed_up.z,
		east.x * fixed_up.y - east.y * fixed_up.x) # east cross up
	var f := TerrainField.face_axes(fixed_up)
	var m := _material
	m.set_shader_parameter("face_c", _face(fixed_up, f))
	m.set_shader_parameter("face_e1", _face(east, f))
	m.set_shader_parameter("face_e2", _face(north, f))
	m.set_shader_parameter("fixed_c", fixed_up.to_vector3())
	m.set_shader_parameter("fixed_e1", east.to_vector3())
	m.set_shader_parameter("fixed_e2", north.to_vector3())
	m.set_shader_parameter("layer_center", field.layer_coords(fixed_up))
	m.set_shader_parameter("amp_scale", amplitude(sea_altitude, field.radius))
	# From a fraction of your height out to past the horizon (allowing for distant peaks).
	var rho_min := 0.12 * maxf(altitude, 1.5)
	var rho_max := 1.3 * sqrt(2.0 * field.radius * (maxf(sea_altitude, 2.0) + field.relief * 2.0))
	m.set_shader_parameter("rho_min", rho_min)
	m.set_shader_parameter("rho_ratio", maxf(rho_max / rho_min, 2.0))
	# Haze thins out as you climb above the dense air.
	m.set_shader_parameter("haze_density", _haze * maxf(exp(-sea_altitude / 9000.0), 0.02))
	m.set_shader_parameter("sun_dir_world", light_dir)
	m.set_shader_parameter("sun_color", light_color)
	m.set_shader_parameter("sun_energy", light_energy)
	m.set_shader_parameter("cloud_shift", Universe.sim_time * 2.0e-6)
	m.set_shader_parameter("cloud_amount", smoothstep(8000.0, 60000.0, sea_altitude))
	var x: Vector3 = (to_world.call(east) as DVec3).to_vector3()
	var y: Vector3 = (to_world.call(fixed_up) as DVec3).to_vector3()
	var z: Vector3 = (to_world.call(north) as DVec3).to_vector3()
	global_transform = Transform3D(Basis(x, y, z), render_up_point)


static func _face(v: DVec3, f: Array[int]) -> Vector3:
	return Vector3(TerrainField.component(v, f[0]), TerrainField.component(v, f[1]), TerrainField.component(v, f[2]))


## Rings × segments grid. VERTEX.x = ring position 0..1, VERTEX.z = angle, VERTEX.y = 1 for the centre.
static func _build_mesh() -> ArrayMesh:
	var verts := PackedVector3Array()
	var indices := PackedInt32Array()
	verts.append(Vector3(0.0, 1.0, 0.0))
	for r in RINGS:
		for s in SEGMENTS:
			verts.append(Vector3(float(r) / float(RINGS - 1), 0.0, TAU * float(s) / float(SEGMENTS)))
	for s in SEGMENTS:
		indices.append_array([0, 1 + s, 1 + (s + 1) % SEGMENTS])
	for r in RINGS - 1:
		var a := 1 + r * SEGMENTS
		var b := a + SEGMENTS
		for s in SEGMENTS:
			var s2 := (s + 1) % SEGMENTS
			indices.append_array([a + s, b + s, b + s2, a + s, b + s2, a + s2])
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_INDEX] = indices
	var am := ArrayMesh.new()
	am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return am
