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
var _pitch := 0.0
var _heat := -1.0
var _walk := false
var _warp_target := ""
var _fall := -1.0
var _tess := -1.0
var _leave := false
var _fp := false


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
			"pitch": _pitch = deg_to_rad(float(kv[1]))
			"heat": _heat = float(kv[1])
			"walk": _walk = true
			"warp": _warp_target = kv[1]
			"fall": _fall = float(kv[1])
			"tesseract": _tess = float(kv[1])
			"leave": _leave = true
			"fp": _fp = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	var view := get_parent() as SpaceView
	if _goto != "":
		view.travel_to_body(_goto)
	if _altitude >= 0.0:
		view._place_player_near(_goto if _goto != "" else view.start_body, _altitude)
	if _yaw != 0.0:
		view.player.rotate_object_local(Vector3.UP, _yaw)
	if _pitch != 0.0:
		view.player.rotate_object_local(Vector3.RIGHT, _pitch)


func _process(_delta: float) -> void:
	_count += 1
	if _count == 2 and _fp:
		var ev := InputEventAction.new()
		ev.action = "toggle_view"
		ev.pressed = true
		Input.parse_input_event(ev)
	if _count == 2 and OS.get_environment("UZAY_RED") != "":
		(get_parent().get_node("WorldEnvironment") as WorldEnvironment).environment.background_color = Color(0.5, 0.0, 0.0)
	if _count == 2 and OS.get_environment("UZAY_HIDE") != "":
		for name in OS.get_environment("UZAY_HIDE").split(","):
			get_parent().get_node(name).visible = false
	if _count == 8 and OS.get_environment("UZAY_DUMP") != "":
		_dump(get_parent(), 0)
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
	if _heat >= 0.0:
		sv.entry_heat = _heat
	if _walk and _count > 4:
		# Walk forward: press the key for the rest of the run.
		Input.action_press("move_forward")
		print("mode=%d on_ground=%s alt=%.2f speed=%.2f" % [sv.player.mode, sv.player.on_ground, sv.player.nearest_altitude, sv.player.velocity.length()])
	if _warp_target != "" and _count == 4:
		sv.warp_to(_warp_target)
	if _warp_target != "":
		print("warp u=%.2f system=%s alt=%s warping=%s" % [sv._warp.get("t", -1.0), sv.player.system_id, sv.player.nearest_altitude, sv.is_warping()])
	if _menu and _count == 4:
		(sv.get_node("Hud/TravelMenu") as TravelMenu).open()
	if _count >= frames:
		get_viewport().get_texture().get_image().save_png(out_path)
		print("saved ", out_path)
		get_tree().quit()


func _dump(n: Node, depth: int) -> void:
	if n is GeometryInstance3D and (n as GeometryInstance3D).is_visible_in_tree():
		var g := n as GeometryInstance3D
		print("VIS ", g.get_path(), " pos=", g.global_position, " scale=", g.global_basis.get_scale())
	if n is CanvasItem and (n as CanvasItem).is_visible_in_tree():
		print("CAN ", n.get_path(), " ", n.get_class(), " ", (n as Control).get_global_rect() if n is Control else "")
	if n is Light3D or n is Camera3D or n is WorldEnvironment:
		print("ENV ", n.get_path(), " ", n.get_class())
	for c in n.get_children():
		_dump(c, depth + 1)
