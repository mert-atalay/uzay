extends Node
## Saves a screenshot after N frames, then quits. For checking visuals on a machine without a
## monitor. SpaceView adds this node when the game is started with a `capture=` user argument:
##   godot --rendering-driver opengl3 -- capture=shot.png frames=90 look=sun
## (On headless Linux, wrap it in xvfb-run.)

var out_path := ""
var frames := 90
var look_at_body := ""
var _count := 0
var _altitude := -1.0
var _goto := ""
var _yaw := 0.0
var _menu := false
var _fall := -1.0
var _tess := -1.0
var _leave := false


func _ready() -> void:
	for arg in OS.get_cmdline_user_args():
		var kv := arg.split("=", true, 1)
		if kv.size() != 2:
			continue
		match kv[0]:
			"capture": out_path = kv[1]
			"frames": frames = int(kv[1])
			"look": look_at_body = kv[1]
			"altitude": _altitude = float(kv[1])
			"goto": _goto = kv[1]
			"yaw": _yaw = deg_to_rad(float(kv[1]))
			"menu": _menu = true
			"fall": _fall = float(kv[1])
			"tesseract": _tess = float(kv[1])
			"leave": _leave = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	var view := get_parent() as SpaceView
	if _goto != "":
		view.travel_to_body(_goto)
	if _altitude >= 0.0:
		view._place_player_near(_goto if _goto != "" else view.start_body, _altitude)
	if _yaw != 0.0:
		view.player.rotate_object_local(Vector3.UP, _yaw)


func _process(_delta: float) -> void:
	_count += 1
	var sv := get_parent() as SpaceView
	if look_at_body != "" and _count >= 3:
		var target: Variant = sv.render_position_of(look_at_body)
		if target != null:
			sv.player.look_at(target, Vector3.UP)
	if _count == 4 and _fall >= 0.0:
		# Start falling from where we are, already `fall` seconds in.
		var hole_id: String = sv.player.nearest_body_id
		var c := Universe.catalog.body_position(hole_id, Universe.sim_time)
		sv.plunge.begin_fall(hole_id, sv.player.pos.sub(c).normalized().to_vector3())
		sv.plunge.t = _fall
	if _count == 4 and _tess >= 0.0:
		sv.plunge.debug_jump(Plunge.Phase.TESSERACT, _tess)
	if _count == 4 and _leave:
		sv.plunge.debug_jump(Plunge.Phase.LEAVING, Plunge.LEAVE_SECONDS - 0.1)
	if _menu and _count == 4:
		(sv.get_node("Hud/TravelMenu") as TravelMenu).open()
	if _count >= frames:
		get_viewport().get_texture().get_image().save_png(out_path)
		print("saved ", out_path)
		get_tree().quit()
