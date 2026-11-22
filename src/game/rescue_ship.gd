class_name RescueShip
extends Node3D
## The starship that comes for you at the end: what people built with a thousand years' head
## start. Made in code from simple shapes: a long pale hull, two slowly turning habitat rings,
## three engines, and a bay underneath that opens to take you in.
## Nose along -Z, 800 m long. Lives in the astronaut's small world (see AstronautView.stage).

const HULL_SHADER := preload("res://shaders/ship_hull.gdshader")
const GLARE_SHADER := preload("res://shaders/ship_glare.gdshader")
const LENGTH := 800.0
## Where the bay is, in the ship's own axes.
const BAY := Vector3(0.0, -34.0, 60.0)

var _rings: Array[Node3D] = []
var _engine_glare: ShaderMaterial
var _engine_discs: StandardMaterial3D
var _bay_glare: ShaderMaterial
var _beam: MeshInstance3D
var _beam_material: StandardMaterial3D


func _ready() -> void:
	var hull := ShaderMaterial.new()
	hull.shader = HULL_SHADER
	var trim := StandardMaterial3D.new()
	trim.albedo_color = Color(0.3, 0.32, 0.36)
	trim.metallic = 0.8
	trim.roughness = 0.35

	var body := MeshInstance3D.new()
	body.mesh = _hull_mesh()
	body.material_override = hull
	add_child(body)

	# Habitat rings, turning opposite ways.
	for i in 2:
		var ring := Node3D.new()
		ring.position = Vector3(0.0, 0.0, -90.0 + i * 210.0)
		add_child(ring)
		var torus := TorusMesh.new()
		torus.inner_radius = 150.0
		torus.outer_radius = 172.0
		torus.rings = 96
		torus.ring_segments = 16
		var tm := MeshInstance3D.new()
		tm.mesh = torus
		tm.rotation.x = PI / 2.0
		var ring_mat := ShaderMaterial.new()
		ring_mat.shader = HULL_SHADER
		ring_mat.set_shader_parameter("panels", Vector2(90.0, 6.0))
		ring_mat.set_shader_parameter("windows", Vector2(600.0, 24.0))
		ring_mat.set_shader_parameter("window_rows", 3.0)
		tm.material_override = ring_mat
		ring.add_child(tm)
		for k in 3:
			var spoke := BoxMesh.new()
			spoke.size = Vector3(7.0, 320.0, 7.0)
			var sm := MeshInstance3D.new()
			sm.mesh = spoke
			sm.material_override = trim
			sm.rotation.z = PI * k / 3.0
			ring.add_child(sm)
		_rings.append(ring)

	# A dorsal spine and a sensor mast.
	var spine := BoxMesh.new()
	spine.size = Vector3(5.0, 16.0, 520.0)
	_add(spine, trim, Vector3(0.0, 34.0, 30.0))
	var mast := CylinderMesh.new()
	mast.top_radius = 0.6
	mast.bottom_radius = 2.5
	mast.height = 120.0
	_add(mast, trim, Vector3(0.0, 0.0, -450.0), Vector3(-PI / 2.0, 0.0, 0.0))

	# Engines.
	_engine_discs = StandardMaterial3D.new()
	_engine_discs.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_engine_discs.albedo_color = Color(0.5, 0.75, 1.0)
	_engine_glare = ShaderMaterial.new()
	_engine_glare.shader = GLARE_SHADER
	_engine_glare.set_shader_parameter("radius", 170.0)
	for k in 3:
		var a := TAU * k / 3.0 + PI / 2.0
		var at := Vector3(cos(a) * 30.0, sin(a) * 17.0, 0.0)
		var bell := CylinderMesh.new()
		bell.top_radius = 15.0
		bell.bottom_radius = 24.0
		bell.height = 70.0
		_add(bell, trim, at + Vector3(0.0, 0.0, 405.0), Vector3(-PI / 2.0, 0.0, 0.0))
		var disc := CylinderMesh.new()
		disc.top_radius = 21.0
		disc.bottom_radius = 21.0
		disc.height = 1.0
		_add(disc, _engine_discs, at + Vector3(0.0, 0.0, 441.0), Vector3(-PI / 2.0, 0.0, 0.0))
		var quad := QuadMesh.new()
		quad.size = Vector2(1.0, 1.0)
		_add(quad, _engine_glare, at + Vector3(0.0, 0.0, 446.0))

	# The bay: a strip of warm light underneath, and the beam that draws you up.
	var bay_light := StandardMaterial3D.new()
	bay_light.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	bay_light.albedo_color = Color(1.0, 0.9, 0.7)
	var strip := BoxMesh.new()
	strip.size = Vector3(26.0, 2.0, 70.0)
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


func _process(delta: float) -> void:
	for i in _rings.size():
		_rings[i].rotation.z += delta * (0.12 if i == 0 else -0.12)


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


## The hull: a long needle-nosed body, wider than it is tall, cut off square at the engines.
func _hull_mesh() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var rings := 80
	var sides := 48
	for i in rings + 1:
		var v := float(i) / rings
		var r := 56.0 * pow(sin(PI * pow(v, 0.62)), 0.75)
		r = maxf(r, 30.0 * smoothstep(0.7, 1.0, v))
		for j in sides + 1:
			var a := TAU * j / sides
			st.set_uv(Vector2(float(j) / sides, v))
			st.add_vertex(Vector3(cos(a) * r, sin(a) * r * 0.58, lerpf(-LENGTH * 0.5, LENGTH * 0.5, v)))
	for i in rings:
		for j in sides:
			var a := i * (sides + 1) + j
			var b := a + sides + 1
			for k: int in [a, a + 1, b, a + 1, b + 1, b]:
				st.add_index(k)
	st.generate_normals()
	return st.commit()
