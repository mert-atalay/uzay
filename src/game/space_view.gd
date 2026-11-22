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
const SKY_BRIGHTNESS := 1.0
const WARP_SECONDS := 6.0
const WARP_CROSS_SECONDS := 10.0

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
## Warp travel in progress (empty when not warping), and what the HUD should draw for it.
var _warp: Dictionary = {}
var warp_amount := 0.0
var warp_flash := 0.0
## 0..1: how hard the air is burning around you during a fast descent (the HUD draws it).
var entry_heat := 0.0
var _body_light: Dictionary = {} # id -> [direction to the star, energy]
var _prev_time := 0.0

var clouds: CloudLayer
var rocks: SurfaceRocks
var stars: StarPoints
var _at_core := false
var _tesseract_origin := DVec3.new()
var _shake_time := 0.0

## The story: what is coming, what it has eaten, what you did about it.
var story: Story
var leviathan: Leviathan
var ending: Ending
## Which window in the tesseract you are looking at (a Story.Choice, or -1).
var choice_focus := -1
## 0..1 while the screen goes dark after the Devourer swallows you.
var swallow_fade := 0.0
var _swallow_t := -1.0
## Distance to the Devourer's skin this frame (metres), INF when it is not here.
var leviathan_distance := INF
const SWALLOW_SECONDS := 11.0


## The story nodes exist before the HUD (a child, so ready first) looks for them.
func _enter_tree() -> void:
	story = Story.new()
	story.name = "Story"
	add_child(story)
	story.swallowed.connect(func() -> void: _swallow_t = 0.0)
	leviathan = Leviathan.new()
	leviathan.name = "Leviathan"
	add_child(leviathan)
	ending = Ending.new()
	ending.name = "Ending"
	add_child(ending)


func _ready() -> void:
	_setup_sky()
	clouds = CloudLayer.new()
	clouds.name = "Clouds"
	add_child(clouds)
	stars = StarPoints.new()
	stars.name = "Stars"
	add_child(stars)
	rocks = SurfaceRocks.new()
	rocks.name = "Rocks"
	add_child(rocks)
	plunge.phase_changed.connect(_on_plunge_phase)
	_build_system(player.system_id)
	_place_player_near(start_body, start_altitude_m)
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("capture="):
			var cap: Node = load("res://tools/capture_node.gd").new()
			add_child(cap)


func _set_sky_dim(dim: float) -> void:
	(sky.material_override as ShaderMaterial).set_shader_parameter("brightness", SKY_BRIGHTNESS * (1.0 - 0.985 * dim))
	stars.set_brightness(1.0 - 0.985 * dim)


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
	# At the galactic centre the sky is a different place: no familiar constellations, a wall of stars.
	var primary := Universe.catalog.primary_of(system_id)
	_at_core = not primary.is_empty() and primary["kind"] == "black-hole"
	(sky.material_override as ShaderMaterial).set_shader_parameter("core", 1.0 if _at_core else 0.0)
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
	_warp = {}
	_place_player_near(body_id, _arrival_altitude(b))


## How far out a jump or warp to this body ends.
func _arrival_altitude(b: Dictionary) -> float:
	if b["kind"] == "star":
		return b["radius_m"] * 5.0
	if b["kind"] == "black-hole":
		return b["radius_m"] * 24.0
	return b["radius_m"] * 3.0


## Which side of a body you arrive on (unit vector from its centre).
func _arrival_dir(b: Dictionary, center: DVec3) -> Vector3:
	if b["parent"] == null:
		if b["kind"] == "black-hole":
			# High enough above the disk to take in the whole thing, shadow and all.
			return Vector3(0.6, 0.3, 0.74).normalized()
		# A star: approach from slightly above its equator.
		return Vector3(0.62, 0.17, 0.77).normalized()
	# The day side, a little off-axis so the terminator shows.
	var to_star := center.scaled(-1.0).normalized().to_vector3()
	var side := to_star.cross(Vector3.UP).normalized()
	return (to_star * 0.75 + side * 0.6 + Vector3.UP * 0.32).normalized()


## Fly to a body at warp instead of jumping: a few seconds of streaking stars, with a flash
## when the trip crosses to another star system.
func warp_to(body_id: String) -> void:
	var b := Universe.catalog.body(body_id)
	if b.is_empty() or not _warp.is_empty() or plunge.phase != Plunge.Phase.NONE:
		return
	if is_gone(body_id) or ending.active or _swallow_t >= 0.0:
		return
	var cross: bool = b["system"] != player.system_id
	_warp = {"target": body_id, "t": 0.0, "duration": WARP_CROSS_SECONDS if cross else WARP_SECONDS,
		"cross": cross, "start": player.pos.duplicate(), "swapped": not cross}
	player.controls_locked = true
	player.mode = Player.Mode.FLY
	_frame_body = ""


func is_warping() -> bool:
	return not _warp.is_empty()


func _advance_warp(delta: float) -> void:
	_warp["t"] += delta
	var u: float = clampf(_warp["t"] / _warp["duration"], 0.0, 1.0)
	var b := Universe.catalog.body(_warp["target"])
	# Between systems: the first half is spent leaving, then the new system is built around us
	# far from the target, and the second half is the approach.
	var approach := u
	if _warp["cross"]:
		approach = clampf((u - 0.5) * 2.0, 0.0, 1.0)
		warp_flash = 1.0 - smoothstep(0.0, 0.12, absf(u - 0.5))
		if u >= 0.5 and not _warp["swapped"]:
			_warp["swapped"] = true
			_build_system(b["system"])
			var c := Universe.catalog.body_position(b["id"], Universe.sim_time)
			var far: float = (b["radius_m"] + _arrival_altitude(b)) * 300.0
			_warp["start"] = c.add(DVec3.from_vector3(_arrival_dir(b, c)).scaled(far))
			player.pos = _warp["start"].duplicate()
	# Streaks build up, hold, and die away as you arrive.
	warp_amount = smoothstep(0.0, 0.15, u) * (1.0 - smoothstep(0.6, 0.88, approach))
	player.camera.fov = lerpf(70.0, 104.0, warp_amount)
	player.thrust_local = Vector3(0.0, 0.0, -1.0)
	if _warp["swapped"]:
		var center := Universe.catalog.body_position(b["id"], Universe.sim_time)
		var dest := center.add(DVec3.from_vector3(_arrival_dir(b, center)).scaled(b["radius_m"] + _arrival_altitude(b)))
		var start: DVec3 = _warp["start"]
		# Slow away, then cover most of the distance, then ease in: what is left shrinks fast.
		var f := approach * approach * approach * (approach * (approach * 6.0 - 15.0) + 10.0)
		var left := pow(1.0 - f, 4.0)
		player.pos = dest.add(start.sub(dest).scaled(left))
		# Turn to face where we are going.
		var to_target := center.sub(player.pos).normalized().to_vector3()
		var up := player.transform.basis.y
		if absf(to_target.dot(up)) > 0.98:
			up = player.transform.basis.x
		var facing := Basis.looking_at(to_target, up)
		player.transform.basis = player.transform.basis.slerp(facing, 1.0 - exp(-4.0 * delta)).orthonormalized()
	if u >= 1.0:
		_warp = {}
		warp_amount = 0.0
		warp_flash = 0.0
		player.controls_locked = false
		player.velocity = Vector3.ZERO
		player.camera.fov = 70.0
		_frame_body = b["id"]
		_frame_prev = Universe.catalog.body_position(b["id"], Universe.sim_time)


func travel_to_system(system_id: String) -> void:
	var primary := Universe.catalog.primary_of(system_id)
	if not primary.is_empty():
		travel_to_body(primary["id"])


func _place_player_near(body_id: String, altitude: float) -> void:
	var b := Universe.catalog.body(body_id)
	var center := Universe.catalog.body_position(body_id, Universe.sim_time)
	var dir := _arrival_dir(b, center)
	player.pos = center.add(DVec3.from_vector3(dir).scaled(b["radius_m"] + altitude))
	player.velocity = Vector3.ZERO
	player.look_at(-dir, Vector3.UP)
	_frame_body = body_id
	_frame_prev = center


## True if the Devourer has eaten this body (or the world it circles).
func is_gone(id: String) -> bool:
	return story.is_eaten(id)


## True while the Devourer is somewhere in the system you are in.
func leviathan_here() -> bool:
	return story.state != Story.State.SAVED and player.system_id == Story.SYSTEM


func _process(delta: float) -> void:
	_advance_swallow(delta)
	if plunge.phase == Plunge.Phase.TESSERACT or plunge.phase == Plunge.Phase.LEAVING:
		_process_tesseract()
		return
	if not _warp.is_empty():
		_advance_warp(delta)
	var t := Universe.sim_time
	var centers := {}
	var nearest_alt := INF
	var nearest_id := ""

	# Pass 1: true positions this frame.
	var gone := {}
	for id in bodies:
		centers[id] = Universe.catalog.body_position(id, t)
		if is_gone(id):
			gone[id] = true
			bodies[id].visible = false

	# Travel along with the body we were near, before measuring anything.
	if _frame_body != "" and centers.has(_frame_body):
		player.pos = player.pos.add(centers[_frame_body].sub(_frame_prev))

	_carry_with_spin(centers, t)
	_prev_time = t

	_black_hole_gravity(centers, delta)

	# Pass 2: surface collision, and which body is closest.
	for id in bodies:
		if gone.has(id):
			continue
		var b: Dictionary = Universe.catalog.bodies_by_id[id]
		var center: DVec3 = centers[id]
		var radius: float = b["radius_m"]
		if b["kind"] != "black-hole" and center.sub(player.pos).length() < radius:
			player.resolve_surface(center, radius)
		var alt := center.sub(player.pos).length() - radius
		if alt < nearest_alt:
			nearest_alt = alt
			nearest_id = id

	# The Devourer counts as a surface too: you slow down as you close on it, and it can eat you.
	var head := DVec3.new()
	var heading := Vector3.FORWARD
	leviathan_distance = INF
	if leviathan_here():
		head = story.head()
		heading = story.heading()
		leviathan_distance = StoryMath.distance_to(player.pos, head, heading)
		if leviathan_distance < 0.0 and plunge.phase == Plunge.Phase.NONE and _warp.is_empty():
			story.be_swallowed()
	player.hazard_altitude = maxf(leviathan_distance, 0.0)
	if nearest_id == "":
		nearest_alt = minf(maxf(leviathan_distance, 1.0e6), 1.0e14)

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
		if gone.has(id):
			continue
		bodies[id].visible = true
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
	stars.global_transform = Transform3D(_sky_basis.scaled(Vector3.ONE * space.far * 0.93), Vector3.ZERO)
	stars.visible = sky.visible and not _at_core
	_update_devourer(head, heading)


## Draw the Devourer where it is, and take out of the sky everything it has eaten behind it.
func _update_devourer(head: DVec3, heading: Vector3) -> void:
	var sky_m := sky.material_override as ShaderMaterial
	if not leviathan_here():
		leviathan.visible = false
		sky_m.set_shader_parameter("void_radius", 0.0)
		stars.set_void(Vector3.BACK, 0.0)
		return
	var sun_gone := is_gone("sun")
	leviathan.place(head.sub(player.pos), heading, space, head.scaled(-1.0).normalized().to_vector3(), 0.0 if sun_gone else 1.0)
	# The hole in the sky sits where it came from and grows as it comes.
	var from_dir := _sky_basis.inverse() * DVec3.from_vector3(StoryMath.START).sub(player.pos).normalized().to_vector3()
	var radius := StoryMath.void_radius(story.time)
	sky_m.set_shader_parameter("void_dir", from_dir)
	sky_m.set_shader_parameter("void_radius", radius)
	stars.set_void(from_dir, radius)
	if sun_gone:
		star_energy = 0.05


## Coming out of the tesseract straight into its mouth would be no choice at all: if it is
## right there, start a little way off to one side of it.
func _clear_of_devourer() -> void:
	if not leviathan_here():
		return
	var head := story.head()
	var heading := story.heading()
	var safe := 0.4 * StoryMath.AU
	var d := StoryMath.distance_to(player.pos, head, heading)
	if d >= safe:
		return
	var rel := player.pos.sub(head).scaled(1.0 / StoryMath.AU).to_vector3()
	var side := rel - heading * rel.dot(heading)
	if side.length() < 1.0e-4:
		side = heading.cross(Vector3.UP)
	player.pos = player.pos.add(DVec3.from_vector3(side.normalized()).scaled(safe - d))
	_frame_body = ""


## Swallowed: the view goes dark, a few seconds of nothing, and then it all begins again.
func _advance_swallow(delta: float) -> void:
	if _swallow_t < 0.0:
		swallow_fade = move_toward(swallow_fade, 0.0, delta / 3.0)
		return
	_swallow_t += delta
	swallow_fade = clampf(_swallow_t / 2.5, 0.0, 1.0)
	player.controls_locked = true
	if _swallow_t >= SWALLOW_SECONDS:
		_swallow_t = -1.0
		story.restart()
		player.controls_locked = false
		if player.system_id != Story.SYSTEM:
			_build_system(Story.SYSTEM)
		_place_player_near(start_body, start_altitude_m)


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
		clouds.hide_layer()
		rocks.hide_rocks()
		_set_sky_dim(0.0)
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
	# Daylight in thick air drowns out the stars.
	var atmo: Variant = b["atmosphere"]
	var up := rel.scaled(-1.0 / d).to_vector3()
	if atmo != null and atmo["density"] >= 0.1:
		var air := clampf(float(atmo["density"]), 0.0, 1.0) * exp(-maxf(ground["sea_altitude"], 0.0) / 12000.0)
		_set_sky_dim(minf(air * 4.0, 1.0) * smoothstep(-0.1, 0.1, up.dot(light[0])))
	else:
		_set_sky_dim(0.0)
	rocks.place(b, terrain.field, ground["fixed_up"], radius + ground["sea_altitude"],
		func(v: DVec3) -> DVec3: return BodyFrame.to_world(v, tilt, angle),
		ground["sea_altitude"] - ground["height"], light[0], star_color, light[1])
	var to_world := func(x: float, y: float, z: float) -> Vector3:
		return BodyFrame.to_world(DVec3.new(x, y, z), tilt, angle).to_vector3()
	clouds.place(b, Basis(to_world.call(1.0, 0.0, 0.0), to_world.call(0.0, 1.0, 0.0), to_world.call(0.0, 0.0, 1.0)),
		rel.scaled(-1.0 / d).to_vector3(), ground["sea_altitude"], space.far * 0.9, light[0], star_color, light[1])


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
	# Past the horizon the clock outside is no longer yours: the story waits.
	story.paused = phase != Plunge.Phase.NONE
	match phase:
		Plunge.Phase.TESSERACT:
			leviathan.visible = false
			choice_focus = -1
			tesseract.open_choices(player.global_basis)
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
			tesseract.close_choices()
			choice_focus = -1
			var choice := plunge.choice
			plunge.choice = Story.Choice.NONE
			story.apply_choice(choice)
			travel_to_body(Plunge.EXIT_BODY)
			_clear_of_devourer()
			if choice == Story.Choice.THEN:
				ending.start()


func _process_tesseract() -> void:
	var p := player.pos.sub(_tesseract_origin).to_vector3()
	tesseract.update(p)
	# After a while three windows open, each on a different moment. Look at one to read it,
	# fly into it (or press the button) to reach through.
	if plunge.phase == Plunge.Phase.TESSERACT:
		var seen := tesseract.update_choices(p, player.global_basis, plunge.t - Plunge.CHOICE_SECONDS)
		choice_focus = seen["focus"]
		if seen["touched"] >= 0:
			plunge.choose(seen["touched"])
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
		var c: DVec3 = centers[id]
		var d := c.length()
		var glow := mi.get_node_or_null("Glow") as MeshInstance3D
		if glow != null:
			# A sun is a blaze from one AU and still the brightest star by far from forty.
			(glow.material_override as ShaderMaterial).set_shader_parameter("glare_gain", clampf(pow(au / maxf(d, 1.0), 0.55), 0.12, 2.5))
		var mats := _materials_of(mi)
		if mats.is_empty():
			continue
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
