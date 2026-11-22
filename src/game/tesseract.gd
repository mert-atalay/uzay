class_name Tesseract
extends Node3D
## What waits at the bottom of the black hole: an endless lattice of light where time is a
## direction you can fly along. Hollow corridors of glowing strands run along all three axes
## and cross every SPACING metres; ghostly echoes of the worlds hang in the gaps.
##
## The lattice is only built around the player (HALF cells each way) and wrapped by whole
## cells as they move, so it never ends. Fog hides the edge.

const SPACING := 22.0
const HALF := 5
const TUBE := 2.4 # half-width of a corridor
const STRANDS_PER_WALL := 14
const ECHO_REPEATS := 5
const STRAND_SHADER := preload("res://shaders/tesseract_strand.gdshader")
const ECHO_SHADER := preload("res://shaders/tesseract_echo.gdshader")
const ECHO_WORLDS := ["earth.jpg", "mars.jpg", "saturn.jpg", "jupiter.jpg", "moon.jpg", "neptune.jpg"]

var _strand_material: ShaderMaterial
var _echo_material: ShaderMaterial


func _ready() -> void:
	visible = false
	_build_strands()
	_build_echoes()


## `p` is the player's position inside the tesseract, in metres from where they arrived.
func update(p: Vector3) -> void:
	var cell := (p / SPACING).round()
	position = -(p - cell * SPACING)
	_strand_material.set_shader_parameter("lattice_offset", cell * SPACING - position)
	_echo_material.set_shader_parameter("cell_origin", cell)


func _build_strands() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 1977
	var count := (2 * HALF + 1)
	var length := count * SPACING
	var box := BoxMesh.new()
	box.size = Vector3(1.0, 1.0, 1.0)
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_custom_data = true
	mm.mesh = box
	var per_line := STRANDS_PER_WALL * 4
	mm.instance_count = 3 * count * count * per_line
	var i := 0
	for axis in 3:
		for a in range(-HALF, HALF + 1):
			for b in range(-HALF, HALF + 1):
				for wall in 4:
					for s in STRANDS_PER_WALL:
						# Position on the square outline of the corridor.
						var u := lerpf(-TUBE, TUBE, (s + rng.randf() * 0.7) / float(STRANDS_PER_WALL))
						var off: Vector2
						match wall:
							0: off = Vector2(u, -TUBE)
							1: off = Vector2(u, TUBE)
							2: off = Vector2(-TUBE, u)
							_: off = Vector2(TUBE, u)
						off += Vector2(rng.randf_range(-0.12, 0.12), rng.randf_range(-0.12, 0.12))
						var thick := rng.randf_range(0.012, 0.045)
						var center := Vector2(a, b) * SPACING + off
						var origin: Vector3
						var scale_v: Vector3
						match axis:
							0:
								origin = Vector3(0.0, center.x, center.y)
								scale_v = Vector3(length, thick, thick)
							1:
								origin = Vector3(center.x, 0.0, center.y)
								scale_v = Vector3(thick, length, thick)
							_:
								origin = Vector3(center.x, center.y, 0.0)
								scale_v = Vector3(thick, thick, length)
						mm.set_instance_transform(i, Transform3D(Basis.from_scale(scale_v), origin))
						mm.set_instance_custom_data(i, Color(rng.randf(), rng.randf_range(0.35, 1.0), float(axis), 0.0))
						i += 1
	var inst := MultiMeshInstance3D.new()
	inst.name = "Strands"
	inst.multimesh = mm
	inst.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	inst.custom_aabb = AABB(Vector3.ONE * -length, Vector3.ONE * length * 2.0)
	_strand_material = ShaderMaterial.new()
	_strand_material.shader = STRAND_SHADER
	inst.material_override = _strand_material
	add_child(inst)


func _build_echoes() -> void:
	var quad := QuadMesh.new()
	quad.size = Vector2(1.0, 1.0)
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_custom_data = true
	mm.mesh = quad
	var count := 2 * HALF + 1
	mm.instance_count = count * count * count * ECHO_REPEATS
	var i := 0
	for x in range(-HALF, HALF + 1):
		for y in range(-HALF, HALF + 1):
			for z in range(-HALF, HALF + 1):
				# Echoes sit in the open space between corridors (half a cell off the lattice).
				var base := (Vector3(x, y, z) + Vector3(0.5, 0.5, 0.5)) * SPACING
				for e in ECHO_REPEATS:
					mm.set_instance_transform(i, Transform3D(Basis.IDENTITY, base + Vector3(e * 3.4, e * 0.5, e * 1.1)))
					mm.set_instance_custom_data(i, Color(x, y, z, e))
					i += 1
	var inst := MultiMeshInstance3D.new()
	inst.name = "Echoes"
	inst.multimesh = mm
	inst.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	inst.custom_aabb = AABB(Vector3.ONE * -count * SPACING, Vector3.ONE * count * SPACING * 2.0)
	_echo_material = ShaderMaterial.new()
	_echo_material.shader = ECHO_SHADER
	for w in ECHO_WORLDS.size():
		_echo_material.set_shader_parameter("world%d" % w, BodyVisuals.texture(ECHO_WORLDS[w]))
	inst.material_override = _echo_material
	add_child(inst)
