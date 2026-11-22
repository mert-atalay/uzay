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
@onready var terrain: TerrainPatch = $Terrain

## Light falling on the player right now (world axes), for the astronaut overlay.
var star_direction := Vector3.UP
var star_color := Color.WHITE
var star_energy := 2.0

## What is under the player this frame, when close to a body with solid ground (else empty):
## body, center, fixed_up (planet-fixed, 64-bit), tilt, angle, sea_altitude, height.
var ground: Dictionary = {}
## 0..1: how hard the air is burning around you during a fast descent (the HUD draws it).
var entry_heat := 0.0
var _body_light: Dictionary = {} # id -> [direction to the star, energy]
var _prev_time := 0.0

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
	ground = {}
	_body_light.clear()
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
		altitude = b["radius_m"] * 9.0
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

	_carry_with_spin(centers, t)
	_prev_time = t

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

	var sea_alt := nearest_alt
	nearest_alt = _measure_ground(nearest_id, centers, t, nearest_alt)

	_choose_frame_body(nearest_id, sea_alt, centers)
	player.nearest_altitude = nearest_alt
	player.nearest_body_id = nearest_id
	player.nearest_is_black_hole = nearest_id != "" and Universe.catalog.bodies_by_id[nearest_id]["kind"] == "black-hole"

	# Pass 3: fit everything into the camera's depth range around the player.
	# Near a black hole the whole lens region (60 horizon radii) has to fit inside the far plane.
	# Standing on the ground the near plane stays at 20 cm, which still reaches past the horizon.
	space = ScaledSpace.for_altitude(maxf(nearest_alt, 5.0e7) if player.nearest_is_black_hole else maxf(nearest_alt, 10.0))
	player.camera.near = space.near
	player.camera.far = space.far
	for id in bodies:
		var b: Dictionary = Universe.catalog.bodies_by_id[id]
		var rel: DVec3 = centers[id].sub(player.pos)
		var d := rel.length()
		var extent: float = b["radius_m"] * (BodyVisuals.LENS_RADIUS if b["kind"] == "black-hole" else 3.0)
		# The body you're at is drawn uncompressed (exact surface) whenever it fits the far plane.
		# Close in, everything up to the horizon is inside the far plane, so that is exact too.
		var s := 1.0 if (id == nearest_id and (d + extent < space.far * 0.9 or sea_alt < 0.5 * b["radius_m"])) else space.scale_factor(d)
		# With real ground drawn on top, sink the smooth sphere a little so the two never fight.
		var sink := 0.9997 if (not ground.is_empty() and id == nearest_id) else 1.0
		_place(bodies[id], b, rel.scaled(s).to_vector3(), b["radius_m"] * s * sink, t)

	_update_lighting(centers)
	_update_terrain()
	sky.global_transform = Transform3D(_sky_basis.scaled(Vector3.ONE * space.far * 0.95), Vector3.ZERO)


## Close to a spinning body you turn with it, as if its air and gravity had hold of you.
## Otherwise the ground would slide past at hundreds of metres per second.
func _carry_with_spin(centers: Dictionary, t: float) -> void:
	if ground.is_empty() or not centers.has(ground["id"]) or ground["id"] != _frame_body:
		return
	var b: Dictionary = Universe.catalog.bodies_by_id[ground["id"]]
	var radius: float = b["radius_m"]
	var w := 1.0 - smoothstep(0.01 * radius, TerrainPatch.APPEAR_ALTITUDE * radius, ground["sea_altitude"])
	var tilt := BodyFrame.tilt_of(b)
	var before := BodyFrame.spin_angle(b, _prev_time)
	var turn := (BodyFrame.spin_angle(b, t) - before) * w
	if turn == 0.0:
		return
	var center: DVec3 = centers[ground["id"]]
	var fixed := BodyFrame.to_fixed(player.pos.sub(center), tilt, before)
	player.pos = center.add(BodyFrame.to_world(fixed, tilt, before + turn))
	player.transform.basis = (Basis(BodyFrame.axis(tilt), turn) * player.transform.basis).orthonormalized()


## If the nearest body has solid ground and we are close, find the ground height below the
## player, keep them above it, and return the altitude above the ground. Otherwise returns
## `sea_altitude` (height above the smooth base radius) unchanged.
func _measure_ground(id: String, centers: Dictionary, t: float, sea_altitude: float) -> float:
	ground = {}
	player.on_ground = false
	player.has_ground = false
	entry_heat = move_toward(entry_heat, 0.0, 0.02)
	if id == "":
		return sea_altitude
	var b: Dictionary = Universe.catalog.bodies_by_id[id]
	var field := terrain.field_for(b)
	var radius: float = b["radius_m"]
	if field == null or sea_altitude > TerrainPatch.APPEAR_ALTITUDE * radius:
		return sea_altitude
	var center: DVec3 = centers[id]
	var tilt := BodyFrame.tilt_of(b)
	var angle := BodyFrame.spin_angle(b, t)
	var fixed_up := BodyFrame.to_fixed(player.pos.sub(center), tilt, angle).normalized()
	var height := field.height(fixed_up) * TerrainPatch.amplitude(sea_altitude, radius)
	player.on_ground = false
	if sea_altitude < height + Player.SURFACE_CLEARANCE + 0.02:
		player.resolve_surface(center, radius + height)
		player.on_ground = true
		sea_altitude = center.sub(player.pos).length() - radius
	player.has_ground = true
	player.ground_up = player.pos.sub(center).normalized().to_vector3()
	player.gravity = 9.81 * float(b.get("surface_gravity_g", 1.0))
	_update_entry_heat(b, sea_altitude)
	ground = {"id": id, "body": b, "center": center, "fixed_up": fixed_up, "tilt": tilt, "angle": angle,
		"sea_altitude": sea_altitude, "height": height}
	return sea_altitude - height


## Diving into air fast heats it: strongest where the air is thick enough and you are still quick.
func _update_entry_heat(b: Dictionary, sea_altitude: float) -> void:
	var target := 0.0
	var atmo: Variant = b["atmosphere"]
	if atmo != null and atmo["density"] >= 0.1 and plunge.phase == Plunge.Phase.NONE:
		var scale_height := 8500.0 * float(atmo["heightRatio"]) / 0.075
		var air := float(atmo["density"]) * exp(-maxf(sea_altitude, 0.0) / scale_height)
		var speed := player.velocity.length()
		target = clampf(air * speed * speed / 1.5e7, 0.0, 1.0)
	entry_heat = lerpf(entry_heat, target, 0.08)
	if plunge.phase == Plunge.Phase.NONE:
		_shake_time += 0.016
		player.camera.rotation = Vector3(sin(_shake_time * 31.0) + sin(_shake_time * 47.3), sin(_shake_time * 37.0) + sin(_shake_time * 53.1), 0.0) * 0.006 * entry_heat


func _update_terrain() -> void:
	if ground.is_empty():
		terrain.hide_patch()
		return
	var b: Dictionary = ground["body"]
	var center: DVec3 = ground["center"]
	var rel := center.sub(player.pos) # camera → body centre
	var d := rel.length()
	var radius: float = b["radius_m"]
	var tilt: float = ground["tilt"]
	var angle: float = ground["angle"]
	var light: Array = _body_light.get(ground["id"], [Vector3.UP, 1.0])
	terrain.place(b, ground["fixed_up"], func(v: DVec3) -> DVec3: return BodyFrame.to_world(v, tilt, angle),
		rel.scaled(1.0 - radius / d).to_vector3(), ground["sea_altitude"] - ground["height"], ground["sea_altitude"],
		light[0], star_color, light[1])


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
			terrain.hide_patch()
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
	# Lit from the strands all around: warm, from above and behind.
	star_direction = player.global_basis * Vector3(0.3, 0.8, 0.5).normalized()
	star_color = Color(1.0, 0.7, 0.4)
	star_energy = 1.1
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
	if centers.has(primary["id"]):
		star_direction = centers[primary["id"]].sub(player.pos).normalized().to_vector3()
	star_color = color
	star_energy = 1.0 if is_hole else 1.5
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
		_body_light[id] = [to_star, energy]
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
