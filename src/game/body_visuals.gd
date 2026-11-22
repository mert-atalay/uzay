class_name BodyVisuals
extends RefCounted
## Builds the visible node for one catalogue body: textured surface, atmosphere shell, rings,
## star photosphere or black hole lens. Every body is a unit sphere that SpaceView scales to
## its real radius, so children (rings, air) are sized in planet radii.

const TEX_DIR := "res://assets/textures/"
const SPHERE_SEGMENTS := 192
## The black hole is drawn on a sphere this many Schwarzschild radii across; inside it light bends.
const LENS_RADIUS := 60.0

const PLANET_SHADER := preload("res://shaders/planet.gdshader")
const STAR_SHADER := preload("res://shaders/star.gdshader")
const ATMO_SHADER := preload("res://shaders/atmosphere.gdshader")
const RING_SHADER := preload("res://shaders/ring.gdshader")
const BLACK_HOLE_SHADER := preload("res://shaders/black_hole.gdshader")

## Real atmospheres: top of the visible air and density scale height as fractions of the
## planet's radius, Rayleigh colour weights, and how hazy (Mie) it is.
const ATMOSPHERES := {
	"earth": {"top": 0.0125, "scale": 0.00133, "rayleigh": Vector3(5.8, 13.5, 33.1), "strength": 1.0, "mie": 0.5},
	"mars": {"top": 0.02, "scale": 0.0033, "rayleigh": Vector3(19.9, 13.6, 5.8), "strength": 0.12, "mie": 0.9},
	"venus": {"top": 0.014, "scale": 0.0026, "rayleigh": Vector3(26.0, 22.0, 9.0), "strength": 2.2, "mie": 2.5},
	"titan": {"top": 0.2, "scale": 0.016, "rayleigh": Vector3(24.0, 14.0, 4.0), "strength": 1.6, "mie": 2.5},
}

static var _sphere: SphereMesh
static var _textures: Dictionary = {}


static func sphere() -> SphereMesh:
	if _sphere == null:
		_sphere = SphereMesh.new()
		_sphere.radius = 1.0
		_sphere.height = 2.0
		_sphere.radial_segments = SPHERE_SEGMENTS
		_sphere.rings = SPHERE_SEGMENTS / 2
	return _sphere


static func texture(name: String) -> Texture2D:
	if not _textures.has(name):
		var path := TEX_DIR + name
		_textures[name] = load(path) if ResourceLoader.exists(path) else null
	return _textures[name]


## Returns the node for a body. `materials` collects every ShaderMaterial that needs the
## sun direction each frame.
static func build(b: Dictionary, materials: Array) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.name = b["id"]
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	match b["kind"]:
		"star":
			mi.mesh = sphere()
			var m := ShaderMaterial.new()
			m.shader = STAR_SHADER
			m.set_shader_parameter("surface_tex", texture("sun.jpg"))
			m.set_shader_parameter("tint", UniverseCatalog.color_of(b["star_color"], Color(1, 0.95, 0.85)))
			mi.material_override = m
		"black-hole":
			var lens := SphereMesh.new()
			lens.radius = LENS_RADIUS
			lens.height = LENS_RADIUS * 2.0
			lens.radial_segments = 64
			lens.rings = 32
			mi.mesh = lens
			var m := ShaderMaterial.new()
			m.shader = BLACK_HOLE_SHADER
			m.set_shader_parameter("panorama", texture("milky_way.jpg"))
			m.set_shader_parameter("lens_radius", LENS_RADIUS)
			m.set_shader_parameter("disk_normal", Vector3(0.12, 1.0, 0.05).normalized())
			mi.material_override = m
			mi.set_meta("black_hole_material", m)
		_:
			mi.mesh = sphere()
			mi.material_override = _planet_material(b, materials)
			_add_atmosphere(mi, b, materials)
			_add_rings(mi, b, materials)
	return mi


static func _planet_material(b: Dictionary, materials: Array) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = PLANET_SHADER
	var tex := texture(b["id"] + ".jpg")
	m.set_shader_parameter("use_texture", tex != null)
	if tex != null:
		m.set_shader_parameter("albedo_tex", tex)
	m.set_shader_parameter("base_color", UniverseCatalog.color_of(b["palette"][0], Color.GRAY))
	if b["atmosphere"] != null:
		m.set_shader_parameter("atmo_color", UniverseCatalog.color_of(b["atmosphere"]["color"]))
		m.set_shader_parameter("atmo_density", b["atmosphere"]["density"])
	if b["id"] == "earth":
		m.set_shader_parameter("earth_extras", true)
		m.set_shader_parameter("night_tex", texture("earth_night.jpg"))
		m.set_shader_parameter("cloud_tex", texture("earth_clouds.jpg"))
		m.set_shader_parameter("spec_tex", texture("earth_spec.jpg"))
	materials.append(m)
	return m


static func _add_atmosphere(parent: MeshInstance3D, b: Dictionary, materials: Array) -> void:
	var atmo: Variant = b["atmosphere"]
	if atmo == null or atmo["density"] < 0.1 or b["archetype"] in ["jupiter", "saturn", "uranus", "neptune"]:
		return # airless, or a gas giant whose "surface" already is its cloud tops
	var p: Dictionary
	if ATMOSPHERES.has(b["id"]):
		p = ATMOSPHERES[b["id"]]
	else:
		# Exoplanets and moons without real data: Earth-like air tinted by the catalogue colour.
		var c := UniverseCatalog.color_of(atmo["color"])
		p = {"top": 0.014, "scale": 0.0015, "rayleigh": Vector3(c.r, c.g, c.b) * 30.0 + Vector3.ONE * 3.0,
			"strength": clampf(atmo["density"], 0.1, 2.0), "mie": 0.6}
	var top: float = 1.0 + p["top"]
	var shell := MeshInstance3D.new()
	shell.name = "Atmosphere"
	shell.mesh = sphere()
	shell.scale = Vector3.ONE * top
	shell.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var m := ShaderMaterial.new()
	m.shader = ATMO_SHADER
	# In shell object space the top of the air is radius 1 and the ground is 1 / top.
	# Earth's blue-light Rayleigh coefficient is 33.1e-6 per metre; in "per planet radius" that is ~211.
	m.set_shader_parameter("planet_radius", 1.0 / top)
	m.set_shader_parameter("scale_height", p["scale"] / top)
	m.set_shader_parameter("rayleigh", p["rayleigh"] * 6.371 * top * p["strength"])
	m.set_shader_parameter("mie", 13.4 * top * p["strength"] * p["mie"])
	shell.material_override = m
	parent.add_child(shell)
	materials.append(m)


static func _add_rings(parent: MeshInstance3D, b: Dictionary, materials: Array) -> void:
	var rings: Variant = b["rings"]
	if rings == null:
		return
	var inner: float = rings["innerRatio"]
	var outer: float = rings["outerRatio"]
	if b["id"] == "saturn":
		inner = 1.28 # D ring inner edge, 74,500 km
		outer = 2.41 # A ring outer edge, 140,220 km
	var ring := MeshInstance3D.new()
	ring.name = "Rings"
	ring.mesh = _annulus(inner, outer, 256)
	ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var m := ShaderMaterial.new()
	m.shader = RING_SHADER
	var tex := texture(b["id"] + "_ring.png")
	m.set_shader_parameter("use_texture", tex != null)
	if tex != null:
		m.set_shader_parameter("ring_tex", tex)
	m.set_shader_parameter("color_inner", UniverseCatalog.color_of(rings["colorInner"]))
	m.set_shader_parameter("color_outer", UniverseCatalog.color_of(rings["colorOuter"]))
	m.set_shader_parameter("opacity", rings["opacity"])
	ring.material_override = m
	parent.add_child(ring)
	materials.append(m)


static func _annulus(inner: float, outer: float, segments: int) -> ArrayMesh:
	var verts := PackedVector3Array()
	var uvs := PackedVector2Array()
	var indices := PackedInt32Array()
	for i in segments + 1:
		var a := TAU * float(i) / float(segments)
		var dir := Vector3(cos(a), 0.0, sin(a))
		verts.append(dir * inner)
		uvs.append(Vector2(0.0, float(i) / float(segments)))
		verts.append(dir * outer)
		uvs.append(Vector2(1.0, float(i) / float(segments)))
		if i < segments:
			var k := i * 2
			indices.append_array([k, k + 1, k + 2, k + 1, k + 3, k + 2])
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh
