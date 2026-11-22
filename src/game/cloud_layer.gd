class_name CloudLayer
extends MeshInstance3D
## Clouds over a planet when you are inside its air: overhead while you are below the layer,
## a deck beneath you once you climb through it. Drawn on a sphere around the camera; the
## shader works out where each view ray meets the layer (shaders/clouds.gdshaderinc).
##
## Below the layer the ground must hide the clouds behind it, so that pass tests depth.
## Above it the deck lies in front of the ground, so that pass draws over everything.

const BELOW := preload("res://shaders/clouds_below.gdshader")
const ABOVE := preload("res://shaders/clouds_above.gdshader")
## Height of the cloud layer above the base radius, metres.
const LAYER_ALTITUDE := 5000.0
## Above this the painted clouds on the terrain and planet take over.
const FADE_START := 30000.0
const FADE_END := 80000.0

var _below := ShaderMaterial.new()
var _above := ShaderMaterial.new()


func _ready() -> void:
	visible = false
	mesh = BodyVisuals.sphere()
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_below.shader = BELOW
	_above.shader = ABOVE
	for m: ShaderMaterial in [_below, _above]:
		# After the sky (-100), before the air and everything else see-through.
		m.render_priority = -50
		m.set_shader_parameter("tile", TerrainPatch._tile())
		m.set_shader_parameter("layer_alt", LAYER_ALTITUDE)
	_below.set_shader_parameter("side", 1.0)
	_above.set_shader_parameter("side", -1.0)


static func has_clouds(b: Dictionary) -> bool:
	return b["id"] == "earth"


## How strongly the layer shows at this height: gone as you pass through it (you would be
## inside fog there), and handed over to the painted clouds far above.
static func amount_at(sea_altitude: float) -> float:
	if sea_altitude < LAYER_ALTITUDE:
		return 1.0 - smoothstep(LAYER_ALTITUDE * 0.8, LAYER_ALTITUDE, sea_altitude)
	return smoothstep(LAYER_ALTITUDE, LAYER_ALTITUDE * 1.3, sea_altitude) \
		* (1.0 - smoothstep(FADE_START, FADE_END, sea_altitude))


func hide_layer() -> void:
	visible = false


## fixed_to_world: the body's planet-fixed axes expressed in render axes.
func place(b: Dictionary, fixed_to_world: Basis, up_world: Vector3, sea_altitude: float, size: float,
		light_dir: Vector3, light_color: Color, light_energy: float) -> void:
	var amount := amount_at(sea_altitude)
	if not has_clouds(b) or amount <= 0.001:
		visible = false
		return
	visible = true
	var m := _below if sea_altitude < LAYER_ALTITUDE else _above
	material_override = m
	global_transform = Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * size), Vector3.ZERO)
	m.set_shader_parameter("cloud_tex", BodyVisuals.texture("earth_clouds.jpg"))
	m.set_shader_parameter("world_to_fixed", fixed_to_world.inverse())
	m.set_shader_parameter("up_world", up_world)
	m.set_shader_parameter("radius", float(b["radius_m"]))
	m.set_shader_parameter("cam_alt", sea_altitude)
	m.set_shader_parameter("amount", amount)
	m.set_shader_parameter("cloud_shift", Universe.sim_time * 2.0e-6)
	m.set_shader_parameter("sun_dir_world", light_dir)
	m.set_shader_parameter("sun_color", light_color)
	m.set_shader_parameter("sun_energy", light_energy)
	var atmo: Variant = b["atmosphere"]
	if atmo != null:
		m.set_shader_parameter("haze_color", UniverseCatalog.color_of(atmo["horizonColor"]).lerp(Color.WHITE, 0.1) * 0.8)
