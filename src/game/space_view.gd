class_name SpaceView
extends Node3D
## Builds the current star system at true scale and keeps it placed around the player.
##
## Every frame: compute each body's 64-bit position, subtract the player's position
## (floating origin), then compress far distances with ScaledSpace so the 32-bit renderer
## can show Earth from 2 m away and the Sun from 1 AU in the same frame.

const SPHERE_SEGMENTS := 128

## Where the player starts: Earth's day side, this far above the surface.
@export var start_body := "earth"
@export var start_altitude_m := 1.2e7

var bodies: Dictionary = {} # id -> MeshInstance3D
var far_systems: Array = [] # [{id, primary}]
var space := ScaledSpace.for_altitude(1.0e7)
## Within this many radii of a body you travel along with it (otherwise Earth would leave you
## behind at 30 km/s). The prototype called this the co-moving reference frame.
const FRAME_RADII := 200.0
var _frame_body := ""
var _frame_prev := DVec3.new()

@onready var player: Player = $Player
@onready var sun_light: DirectionalLight3D = $SunLight
@onready var starfield: Starfield = $Starfield


func _ready() -> void:
	_build_system(player.system_id)
	_place_player_near(start_body, start_altitude_m)
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("capture="):
			var cap: Node = load("res://tools/capture_node.gd").new()
			add_child(cap)


func _build_system(system_id: String) -> void:
	for b in Universe.catalog.bodies_in_system(system_id):
		var mi := MeshInstance3D.new()
		mi.name = b["id"]
		var sphere := SphereMesh.new()
		sphere.radius = 1.0
		sphere.height = 2.0
		sphere.radial_segments = SPHERE_SEGMENTS
		sphere.rings = SPHERE_SEGMENTS / 2
		mi.mesh = sphere
		mi.material_override = _material_for(b)
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mi)
		bodies[b["id"]] = mi
	for s in Universe.catalog.systems:
		if s["id"] != system_id:
			far_systems.append({"id": s["id"], "primary": Universe.catalog.primary_of(s["id"])})


func _material_for(b: Dictionary) -> Material:
	var palette: Array = b["palette"]
	match b["kind"]:
		"star":
			var m := StandardMaterial3D.new()
			m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			m.albedo_color = UniverseCatalog.color_of(b["star_color"], Color(1, 0.95, 0.85))
			m.emission_enabled = true
			m.emission = m.albedo_color
			m.emission_energy_multiplier = 40.0 # far above the glow threshold, so stars bloom
			return m
		"black-hole":
			# Placeholder: pure shadow. Milestone 3 replaces it with ray-traced lensing.
			var m := StandardMaterial3D.new()
			m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			m.albedo_color = Color.BLACK
			return m
		_:
			var m := StandardMaterial3D.new()
			# Flat placeholder colours until each world gets real surface shaders (milestone 4+).
			m.albedo_color = Color(0.13, 0.3, 0.58) if b["id"] == "earth" else UniverseCatalog.color_of(palette[0], Color.GRAY)
			m.roughness = 0.95
			m.metallic_specular = 0.2
			return m


func _place_player_near(body_id: String, altitude: float) -> void:
	var b := Universe.catalog.body(body_id)
	var center := Universe.catalog.body_position(body_id, Universe.sim_time)
	var star := Universe.catalog.body_position(Universe.catalog.primary_of(player.system_id)["id"], Universe.sim_time)
	# Sit between the planet and its star (day side), a little off-axis so the terminator shows.
	var to_star := star.sub(center).normalized().to_vector3()
	var side := to_star.cross(Vector3.UP).normalized()
	var dir := (to_star * 0.75 + side * 0.66).normalized()
	player.pos = center.add(DVec3.from_vector3(dir).scaled(b["radius_m"] + altitude))
	player.look_at(-dir, Vector3.UP)
	_frame_body = body_id
	_frame_prev = center


func _process(_delta: float) -> void:
	var t := Universe.sim_time
	var centers := {}
	var nearest_alt := INF
	var nearest_id := ""

	# Pass 1: true positions this frame.
	for id in bodies:
		centers[id] = Universe.catalog.body_position(id, t)

	# Travel along with the body we were near, before measuring anything.
	if _frame_body != "":
		player.pos = player.pos.add(centers[_frame_body].sub(_frame_prev))

	# Pass 2: surface collision, and which body is closest.
	for id in bodies:
		var b: Dictionary = Universe.catalog.bodies_by_id[id]
		var center: DVec3 = centers[id]
		var radius: float = b["radius_m"]
		if b["kind"] != "black-hole" and center.sub(player.pos).length() < radius:
			player.resolve_surface(center, radius)
		var alt := center.sub(player.pos).length() - radius
		if alt < nearest_alt:
			nearest_alt = alt
			nearest_id = id

	_choose_frame_body(nearest_id, nearest_alt, centers)
	player.nearest_altitude = nearest_alt
	player.nearest_body_id = nearest_id
	player.nearest_is_black_hole = nearest_id != "" and Universe.catalog.bodies_by_id[nearest_id]["kind"] == "black-hole"

	# Pass 3: fit everything into the camera's depth range around the player.
	space = ScaledSpace.for_altitude(nearest_alt)
	player.camera.near = space.near
	player.camera.far = space.far
	for id in bodies:
		var b: Dictionary = Universe.catalog.bodies_by_id[id]
		var rel: DVec3 = centers[id].sub(player.pos)
		var d := rel.length()
		# The body you're closest to is never compressed, so its surface stays exact.
		var s := 1.0 if id == nearest_id else space.scale_factor(d)
		_place(bodies[id], b, rel.scaled(s).to_vector3(), b["radius_m"] * s, t)

	_update_sun()
	var sky_radius := space.far * 0.9
	starfield.global_transform = Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * sky_radius), Vector3.ZERO)


func _choose_frame_body(nearest_id: String, nearest_alt: float, centers: Dictionary) -> void:
	_frame_body = ""
	if nearest_id != "" and nearest_alt < Universe.catalog.body(nearest_id)["radius_m"] * FRAME_RADII:
		_frame_body = nearest_id
		_frame_prev = centers[nearest_id]


func _place(mi: MeshInstance3D, b: Dictionary, render_pos: Vector3, render_radius: float, t: float) -> void:
	var period_h: float = b["rotation_period_h"]
	var angle := TAU * t / (period_h * 3600.0) if period_h != 0.0 else 0.0
	var tilt := Basis(Vector3.FORWARD, deg_to_rad(b["axial_tilt_deg"]))
	mi.global_transform = Transform3D((tilt * Basis(Vector3.UP, angle)).scaled(Vector3.ONE * render_radius), render_pos)


func _update_sun() -> void:
	# The system's primary lights everything; point the directional light from it to us.
	var primary := Universe.catalog.primary_of(player.system_id)
	if primary.is_empty() or primary["kind"] == "black-hole":
		sun_light.visible = primary.is_empty()
		return
	var star_pos := Universe.catalog.body_position(primary["id"], Universe.sim_time)
	var dir := player.pos.sub(star_pos).normalized().to_vector3()
	if dir.is_zero_approx():
		return
	sun_light.light_color = UniverseCatalog.color_of(primary["star_color"], Color.WHITE)
	sun_light.global_transform = Transform3D(Basis.looking_at(dir, Vector3.UP if absf(dir.y) < 0.99 else Vector3.RIGHT), Vector3.ZERO)


## Render-space position of a body (for HUD markers). Returns null if unknown.
func render_position_of(id: String) -> Variant:
	if not bodies.has(id):
		return null
	return bodies[id].global_position


## Direction and distance (metres) of another star system's primary, for HUD markers.
func far_system_vectors() -> Array:
	var out := []
	for fs in far_systems:
		var off := Universe.catalog.system_offset(player.system_id, fs["id"]).sub(player.pos)
		out.append({"id": fs["id"], "name": Universe.catalog.system(fs["id"])["name"],
			"dir": off.normalized().to_vector3(), "distance": off.length()})
	return out
