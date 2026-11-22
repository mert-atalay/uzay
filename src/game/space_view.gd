class_name SpaceView
extends Node3D
## Builds the current star system at true scale and keeps it placed around the player.
##
## Every frame: compute each body's 64-bit position, subtract the player's position
## (floating origin), then fit distances into the camera with ScaledSpace so the 32-bit
## renderer can show Earth from 2 m away and the Sun from 1 AU in the same frame.

signal system_changed(system_id: String)

## Where the player starts.
@export var start_body := "earth"
@export var start_altitude_m := 1.2e7

## Within this many radii of a body you travel along with it (otherwise Earth would leave you
## behind at 30 km/s). The prototype called this the co-moving reference frame.
const FRAME_RADII := 200.0
const SKY_SHADER := preload("res://shaders/sky.gdshader")
const SKY_BRIGHTNESS := 0.85

var bodies: Dictionary = {} # id -> MeshInstance3D
var far_systems: Array = [] # [{id}]
var space := ScaledSpace.for_altitude(1.0e7)
var _lit_materials: Array = []
var _frame_body := ""
var _frame_prev := DVec3.new()
## Orientation of the Milky Way panorama relative to the ecliptic-aligned world.
var _sky_basis := Basis(Vector3.RIGHT, deg_to_rad(60.2)) * Basis(Vector3.UP, deg_to_rad(96.0))

@onready var player: Player = $Player
@onready var sky: MeshInstance3D = $Sky
@onready var plunge: Plunge = $Plunge
@onready var tesseract: Tesseract = $Tesseract

var _tesseract_origin := DVec3.new()
var _shake_time := 0.0


func _ready() -> void:
	_setup_sky()
	plunge.phase_changed.connect(_on_plunge_phase)
	_build_system(player.system_id)
	_place_player_near(start_body, start_altitude_m)
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("capture="):
			var cap: Node = load("res://tools/capture_node.gd").new()
			add_child(cap)


func _setup_sky() -> void:
	sky.mesh = BodyVisuals.sphere()
	var m := ShaderMaterial.new()
	m.shader = SKY_SHADER
	m.set_shader_parameter("panorama", BodyVisuals.texture("milky_way.jpg"))
	m.set_shader_parameter("brightness", SKY_BRIGHTNESS)
	sky.material_override = m
	sky.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	# Shaders that never write depth are drawn in the transparent pass: make sure the sky goes first.
	m.render_priority = -100


func _build_system(system_id: String) -> void:
	for id in bodies:
		bodies[id].queue_free()
	bodies.clear()
	far_systems.clear()
	_lit_materials.clear()
	_frame_body = ""
	player.system_id = system_id
	for b in Universe.catalog.bodies_in_system(system_id):
		var mi := BodyVisuals.build(b, _lit_materials)
		add_child(mi)
		bodies[b["id"]] = mi
		if mi.has_meta("black_hole_material"):
			var m: ShaderMaterial = mi.get_meta("black_hole_material")
			m.set_shader_parameter("sky_from_world", _sky_basis.inverse())
			m.set_shader_parameter("sky_brightness", SKY_BRIGHTNESS)
	for s in Universe.catalog.systems:
		if s["id"] != system_id:
			far_systems.append({"id": s["id"]})
	system_changed.emit(system_id)


## Jump next to a body (switching star system if needed).
func travel_to_body(body_id: String) -> void:
	var b := Universe.catalog.body(body_id)
	if b.is_empty():
		return
	if b["system"] != player.system_id:
		_build_system(b["system"])
	var altitude: float = b["radius_m"] * 3.0
	if b["kind"] == "star":
		altitude = b["radius_m"] * 5.0
	elif b["kind"] == "black-hole":
		altitude = b["radius_m"] * 24.0
	_place_player_near(body_id, altitude)


func travel_to_system(system_id: String) -> void:
	var primary := Universe.catalog.primary_of(system_id)
	if not primary.is_empty():
		travel_to_body(primary["id"])


func _place_player_near(body_id: String, altitude: float) -> void:
	var b := Universe.catalog.body(body_id)
	var center := Universe.catalog.body_position(body_id, Universe.sim_time)
	var dir: Vector3
	if b["parent"] == null:
		# A star or the black hole: approach from slightly above its equator.
		dir = Vector3(0.62, 0.17, 0.77).normalized()
	else:
		# Sit on the day side, a little off-axis so the terminator shows.
		var to_star := center.scaled(-1.0).normalized().to_vector3()
		var side := to_star.cross(Vector3.UP).normalized()
		dir = (to_star * 0.75 + side * 0.6 + Vector3.UP * 0.32).normalized()
	player.pos = center.add(DVec3.from_vector3(dir).scaled(b["radius_m"] + altitude))
	player.velocity = Vector3.ZERO
	player.look_at(-dir, Vector3.UP)
	_frame_body = body_id
	_frame_prev = center


func _process(delta: float) -> void:
	if plunge.phase == Plunge.Phase.TESSERACT or plunge.phase == Plunge.Phase.LEAVING:
		_process_tesseract()
		return
	var t := Universe.sim_time
	var centers := {}
	var nearest_alt := INF
	var nearest_id := ""

	# Pass 1: true positions this frame.
	for id in bodies:
		centers[id] = Universe.catalog.body_position(id, t)

	# Travel along with the body we were near, before measuring anything.
	if _frame_body != "" and centers.has(_frame_body):
		player.pos = player.pos.add(centers[_frame_body].sub(_frame_prev))

	_black_hole_gravity(centers, delta)

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
	# Near a black hole the whole lens region (60 horizon radii) has to fit inside the far plane.
	space = ScaledSpace.for_altitude(maxf(nearest_alt, 5.0e7) if player.nearest_is_black_hole else nearest_alt)
	player.camera.near = space.near
	player.camera.far = space.far
	for id in bodies:
		var b: Dictionary = Universe.catalog.bodies_by_id[id]
		var rel: DVec3 = centers[id].sub(player.pos)
		var d := rel.length()
		var extent: float = b["radius_m"] * (BodyVisuals.LENS_RADIUS if b["kind"] == "black-hole" else 3.0)
		# The body you're at is drawn uncompressed (exact surface) whenever it fits the far plane.
		var s := 1.0 if (id == nearest_id and d + extent < space.far * 0.9) else space.scale_factor(d)
		_place(bodies[id], b, rel.scaled(s).to_vector3(), b["radius_m"] * s, t)

	_update_lighting(centers)
	sky.global_transform = Transform3D(_sky_basis.scaled(Vector3.ONE * space.far * 0.95), Vector3.ZERO)


## A black hole pulls you in. Outside the horizon it is a drift you can fight; once you cross,
## Plunge takes over and there is no way back.
func _black_hole_gravity(centers: Dictionary, delta: float) -> void:
	var primary := Universe.catalog.primary_of(player.system_id)
	if primary.is_empty() or primary["kind"] != "black-hole" or not centers.has(primary["id"]):
		return
	var center: DVec3 = centers[primary["id"]]
	var rs: float = primary["radius_m"]
	var m: ShaderMaterial = bodies[primary["id"]].get_meta("black_hole_material")
	if plunge.phase == Plunge.Phase.FALLING:
		var u := plunge.fall_progress()
		player.pos = center.add(DVec3.from_vector3(plunge.direction).scaled(rs * PlungeMath.radius_fraction(u)))
		m.set_shader_parameter("fall", u)
		# The fall gets rougher and the view stretches as you go deeper.
		_shake_time += delta
		var k := 0.004 + 0.02 * u * u
		player.camera.rotation = Vector3(sin(_shake_time * 23.0) + sin(_shake_time * 37.3), sin(_shake_time * 29.0) + sin(_shake_time * 41.7), sin(_shake_time * 17.0)) * k
		player.camera.fov = lerpf(70.0, 108.0, u)
		return
	m.set_shader_parameter("fall", 0.0)
	var rel := player.pos.sub(center)
	var r := rel.length()
	if r < rs:
		plunge.begin_fall(primary["id"], rel.normalized().to_vector3())
		return
	player.pos = player.pos.add(rel.scaled(-PlungeMath.pull_speed(r, rs) * delta / r))


func _on_plunge_phase(phase: Plunge.Phase) -> void:
	player.controls_locked = phase == Plunge.Phase.FALLING
	match phase:
		Plunge.Phase.TESSERACT:
			_tesseract_origin = player.pos.duplicate()
			for id in bodies:
				bodies[id].visible = false
			sky.visible = false
			tesseract.visible = true
			player.camera.rotation = Vector3.ZERO
			player.camera.fov = 78.0
			player.velocity = Vector3.ZERO
		Plunge.Phase.NONE:
			# Let go: the tesseract closes and drops you back into ordinary space.
			tesseract.visible = false
			sky.visible = true
			player.camera.fov = 70.0
			travel_to_body(Plunge.EXIT_BODY)


func _process_tesseract() -> void:
	var p := player.pos.sub(_tesseract_origin).to_vector3()
	tesseract.update(p)
	player.nearest_altitude = 14.0 # metres: a gentle drifting pace
	player.nearest_is_black_hole = false
	player.camera.near = 0.05
	player.camera.far = 600.0


func _choose_frame_body(nearest_id: String, nearest_alt: float, centers: Dictionary) -> void:
	_frame_body = ""
	if nearest_id != "" and nearest_alt < Universe.catalog.body(nearest_id)["radius_m"] * FRAME_RADII:
		_frame_body = nearest_id
		_frame_prev = centers[nearest_id]


func _place(mi: MeshInstance3D, b: Dictionary, render_pos: Vector3, render_radius: float, t: float) -> void:
	var basis := Basis.IDENTITY
	if b["kind"] != "black-hole":
		var period_h: float = b["rotation_period_h"]
		var angle := TAU * t / (period_h * 3600.0) if period_h != 0.0 else 0.0
		basis = Basis(Vector3.FORWARD, deg_to_rad(b["axial_tilt_deg"])) * Basis(Vector3.UP, angle)
	mi.global_transform = Transform3D(basis.scaled(Vector3.ONE * render_radius), render_pos)


func _update_lighting(centers: Dictionary) -> void:
	# Everything is lit by the system's primary (for Sgr A*: the glow of its accretion disk).
	var primary := Universe.catalog.primary_of(player.system_id)
	if primary.is_empty():
		return
	var au: float = Universe.catalog.constants["AU"]
	var is_hole: bool = primary["kind"] == "black-hole"
	var color := Color(1.0, 0.62, 0.36) if is_hole else UniverseCatalog.color_of(primary["star_color"], Color.WHITE)
	# Stars keep most of their colour out of the light: sunlight looks white to an adapted eye.
	color = color.lerp(Color.WHITE, 0.0 if is_hole else 0.6)
	for id in bodies:
		var mi: MeshInstance3D = bodies[id]
		var mats := _materials_of(mi)
		if mats.is_empty():
			continue
		var c: DVec3 = centers[id]
		var d := c.length()
		var to_star := c.scaled(-1.0).normalized().to_vector3()
		# Gentle falloff (not inverse-square) until auto-exposure lands: far worlds are dimmer but readable.
		var energy := clampf(1.5 * pow(au / maxf(d, 1.0), 0.3), 0.35, 2.4)
		if is_hole:
			energy = 0.9
		for m in mats:
			m.set_shader_parameter("sun_dir_world", to_star)
			m.set_shader_parameter("sun_color", color)
			if m.shader == BodyVisuals.ATMO_SHADER:
				m.set_shader_parameter("sun_energy", energy * 8.0)
			else:
				m.set_shader_parameter("sun_energy", energy)
			if m.shader == BodyVisuals.PLANET_SHADER:
				m.set_shader_parameter("cloud_shift", Universe.sim_time * 2.0e-6)


func _materials_of(mi: MeshInstance3D) -> Array:
	var out := []
	if mi.material_override is ShaderMaterial and _lit_materials.has(mi.material_override):
		out.append(mi.material_override)
	for child in mi.get_children():
		if child is MeshInstance3D and child.material_override is ShaderMaterial:
			out.append(child.material_override)
	return out


## True if the body you're next to blocks the line of sight to `render_pos` (so its marker hides).
func is_occluded(render_pos: Vector3, target_id: String) -> bool:
	var near_id := player.nearest_body_id
	if near_id == "" or near_id == target_id or not bodies.has(near_id):
		return false
	var mi: MeshInstance3D = bodies[near_id]
	var c := mi.global_position
	var r := mi.global_transform.basis.get_scale().x
	var dist := render_pos.length()
	var dir := render_pos / maxf(dist, 1e-6)
	var b := c.dot(dir)
	if b < 0.0 or b > dist:
		return false
	return c.length_squared() - b * b < r * r


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
