class_name RescueShip
extends Node3D
## The starship that comes for you at the end: what people built with a thousand years' head
## start. The hull is a model ("Osiris Mothership" by alx_flameniro, CC BY 4.0), scaled up to
## 800 m; the engine light, the bay light and the beam that lifts you are added here.
## Nose along -Z. Lives in the astronaut's small world (see AstronautView.stage).

const MODEL := preload("res://assets/models/rescue_ship.glb")
const GLARE_SHADER := preload("res://shaders/ship_glare.gdshader")
const LENGTH := 800.0
## The model is 129.7 units long.
const MODEL_SCALE := LENGTH / 129.744
## Where the bay is, in the ship's own axes.
const BAY := Vector3(0.0, -22.0, 40.0)
## The four clusters of engine bells at the stern, and the two between them.
const ENGINES: Array[Vector3] = [
	Vector3(-102.0, 37.0, 412.0), Vector3(102.0, 37.0, 412.0), Vector3(-102.0, -37.0, 412.0),
	Vector3(102.0, -37.0, 412.0), Vector3(-52.0, 0.0, 376.0), Vector3(52.0, 0.0, 376.0),
]

var _engine_glare: ShaderMaterial
var _engine_discs: StandardMaterial3D
var _bay_glare: ShaderMaterial
var _beam: MeshInstance3D
var _beam_material: StandardMaterial3D


func _ready() -> void:
	var model := MODEL.instantiate() as Node3D
	model.scale = Vector3.ONE * MODEL_SCALE
	add_child(model)
	# The hull is dark, and out here there is little light: let its own panels show a little.
	for node in model.find_children("*", "MeshInstance3D", true, false):
		var mi := node as MeshInstance3D
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		for s in mi.mesh.get_surface_count():
			var mat := mi.mesh.surface_get_material(s) as BaseMaterial3D
			if mat == null:
				continue
			mat = mat.duplicate() as BaseMaterial3D
			mat.transparency = BaseMaterial3D.TRANSPARENCY_DISABLED
			mat.emission_enabled = true
			mat.emission_texture = mat.albedo_texture
			mat.emission = Color.BLACK
			mat.emission_energy_multiplier = 0.2
			mi.set_surface_override_material(s, mat)

	# Engines.
	_engine_discs = StandardMaterial3D.new()
	_engine_discs.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_engine_discs.albedo_color = Color(0.5, 0.75, 1.0)
	_engine_glare = ShaderMaterial.new()
	_engine_glare.shader = GLARE_SHADER
	_engine_glare.set_shader_parameter("radius", 110.0)
	for at in ENGINES:
		for k in 3:
			var disc := CylinderMesh.new()
			disc.top_radius = 7.5
			disc.bottom_radius = 7.5
			disc.height = 1.0
			_add(disc, _engine_discs, at + Vector3((k - 1) * 20.0, 0.0, 0.0), Vector3(-PI / 2.0, 0.0, 0.0))
		var quad := QuadMesh.new()
		quad.size = Vector2(1.0, 1.0)
		_add(quad, _engine_glare, at + Vector3(0.0, 0.0, 6.0))

	# The bay: a strip of warm light underneath, and the beam that draws you up.
	var bay_light := StandardMaterial3D.new()
	bay_light.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	bay_light.albedo_color = Color(1.0, 0.9, 0.7)
	var strip := BoxMesh.new()
	strip.size = Vector3(22.0, 2.0, 60.0)
	_add(strip, bay_light, BAY + Vector3(0.0, 2.0, 0.0))
	_bay_glare = ShaderMaterial.new()
	_bay_glare.shader = GLARE_SHADER
	_bay_glare.set_shader_parameter("color", Color(1.0, 0.85, 0.6))
	_bay_glare.set_shader_parameter("radius", 90.0)
	var bay_quad := QuadMesh.new()
	bay_quad.size = Vector2(1.0, 1.0)
	_add(bay_quad, _bay_glare, BAY + Vector3(0.0, -2.0, 0.0))
	_beam_material = StandardMaterial3D.new()
	_beam_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_beam_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_beam_material.cull_mode = BaseMaterial3D.CULL_DISABLED
	_beam_material.albedo_color = Color(1.0, 0.88, 0.65, 0.0)
	var cone := CylinderMesh.new()
	cone.top_radius = 0.28 # narrow where it holds you, wide at the bay
	cone.bottom_radius = 1.0
	cone.height = 1.0
	cone.cap_top = false
	cone.cap_bottom = false
	_beam = MeshInstance3D.new()
	_beam.mesh = cone
	_beam.material_override = _beam_material
	_beam.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_beam)
	set_engines(0.15)
	set_bay(0.0, Vector3.ZERO)


## 0 idle .. 1 full burn.
func set_engines(power: float) -> void:
	_engine_glare.set_shader_parameter("power", 0.1 + 2.4 * power)
	_engine_discs.albedo_color = Color(0.5, 0.75, 1.0) * (0.6 + 3.0 * power)


## Open the bay: `light` 0..1, and the beam reaches down to `target` (ship axes).
func set_bay(light: float, target: Vector3) -> void:
	_bay_glare.set_shader_parameter("power", light * 1.2)
	_beam.visible = light > 0.01
	if not _beam.visible:
		return
	var span := target - BAY
	var length := maxf(span.length(), 1.0)
	_beam_material.albedo_color.a = 0.1 * light
	# A cylinder runs along Y: point its Y at the target.
	var y := span / length
	var x := y.cross(Vector3.FORWARD).normalized()
	_beam.transform = Transform3D(Basis(x * 9.0, y * length, x.cross(y) * 9.0), BAY + span * 0.5)


func _add(mesh: Mesh, mat: Material, pos: Vector3, rot := Vector3.ZERO) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = pos
	mi.rotation = rot
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	return mi
