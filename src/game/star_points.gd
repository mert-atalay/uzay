class_name StarPoints
extends MeshInstance3D
## The ~15,000 stars you could see with your own eyes, drawn as points at their real positions
## (data/stars.bin, baked from the HYG catalogue by tools/bake_sky.py). The panorama behind
## them carries the same stars, but a texture can never be as sharp as a point.

const SHADER := preload("res://shaders/star_points.gdshader")
const DATA := "res://data/stars.bin"

var _material := ShaderMaterial.new()


func _ready() -> void:
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_material.shader = SHADER
	# After the sky itself, before anything else see-through.
	_material.render_priority = -90
	material_override = _material
	custom_aabb = AABB(Vector3.ONE * -2.0, Vector3.ONE * 4.0)
	var bytes := FileAccess.get_file_as_bytes(DATA)
	if bytes.is_empty():
		visible = false
		return
	var values := bytes.to_float32_array()
	var count := values.size() / 7
	var verts := PackedVector3Array()
	var colors := PackedColorArray()
	verts.resize(count)
	colors.resize(count)
	for i in count:
		var o := i * 7
		verts[i] = Vector3(values[o], values[o + 1], values[o + 2])
		colors[i] = Color(values[o + 4], values[o + 5], values[o + 6], clampf((values[o + 3] + 2.0) / 16.0, 0.0, 1.0))
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_COLOR] = colors
	var am := ArrayMesh.new()
	am.add_surface_from_arrays(Mesh.PRIMITIVE_POINTS, arrays)
	mesh = am


func set_brightness(b: float) -> void:
	_material.set_shader_parameter("brightness", b)
	_material.set_shader_parameter("pixel_scale", maxf(DisplayServer.window_get_size().y, 360.0) / 1080.0)


## The patch of sky the Devourer has eaten (direction in the sky frame, radius in radians).
func set_void(dir: Vector3, radius: float) -> void:
	_material.set_shader_parameter("void_dir", dir)
	_material.set_shader_parameter("void_radius", radius)
