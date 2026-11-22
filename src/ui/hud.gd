class_name Hud
extends CanvasLayer
## Minimal telemetry: nearest body, altitude, speed, throttle, time scale, and on-screen markers.

@export var space_view_path: NodePath

var _markers: Dictionary = {} # id -> Label
var _markers_visible := true

@onready var space_view := get_node(space_view_path) as SpaceView
@onready var info: Label = $Info
@onready var help: Label = $Help
@onready var marker_layer: Control = $Markers
@onready var travel_menu: TravelMenu = $TravelMenu
@onready var music: AudioStreamPlayer = $Music
@onready var notice: Label = $Notice
@onready var fade: ColorRect = $Fade
@onready var heat: ColorRect = $Heat
@onready var warp: ColorRect = $Warp

var _marker_targets: Dictionary = {} # marker id -> body id to warp to

## The soundtrack's peak, timed to land as the tesseract opens.
const MUSIC_PEAK_SECONDS := 210.0
const MUSIC_DB := -9.0


func _ready() -> void:
	travel_menu.space_view = space_view
	_set_pad(not Input.get_connected_joypads().is_empty())
	Input.joy_connection_changed.connect(func(_device: int, connected: bool) -> void: _set_pad(connected))
	var stream := load("res://assets/music/interstellar_main_theme.mp3") as AudioStreamMP3
	if stream != null:
		stream.loop = true
		music.stream = stream
		music.volume_db = MUSIC_DB
		music.play()
	(space_view.get_node("Plunge") as Plunge).phase_changed.connect(_on_plunge_phase)


const HELP_KEYS := "F12 screenshot · B black hole · N Earth · J warp to what you look at · Tab travel menu · WASD move · Space/Ctrl up/down · Q/E roll · mouse look · Shift boost · scroll or [ ] throttle · T time speed · V view · H markers · M music · F11 window · Esc free mouse"
const HELP_PAD := "L3 screenshot · D-pad right black hole · D-pad left Earth · X warp to what you look at · Start travel menu · left stick move · A up / jump · B or LT down · right stick look · LB/RB roll · RT boost · D-pad up/down throttle · R3 view · Y markers · Back time speed"


func _input(event: InputEvent) -> void:
	# Show the hints for whatever the player is holding.
	if event is InputEventJoypadButton or (event is InputEventJoypadMotion and absf(event.axis_value) > 0.5):
		_set_pad(true)
	elif event is InputEventKey:
		_set_pad(false)
	if event.is_action_pressed("screenshot"):
		_save_screenshot()
	if event.is_action_pressed("fullscreen"):
		var full := DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_FULLSCREEN
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED if full else DisplayServer.WINDOW_MODE_FULLSCREEN)


var _using_pad := false
var _shot_note_until := 0.0


## Saves what is on screen to a "screenshots" folder next to the game (handy for showing a
## problem exactly as it looked).
func _save_screenshot() -> void:
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	var dir := OS.get_executable_path().get_base_dir().path_join("screenshots")
	if OS.has_feature("editor") or DirAccess.make_dir_recursive_absolute(dir) != OK:
		dir = OS.get_user_data_dir()
	var p := space_view.player
	var name := "uzay-%s-%s.png" % [Time.get_datetime_string_from_system().replace(":", "").replace("T", "-"), p.nearest_body_id]
	var notes := FileAccess.open(dir.path_join(name.get_basename() + ".txt"), FileAccess.WRITE)
	if notes != null:
		notes.store_string("gpu=%s\nfps=%d\nwindow=%s\nbody=%s altitude=%.1f speed=%.1f mode=%d\nphase=%d heat=%.2f warp=%.2f\n" % [
			RenderingServer.get_video_adapter_name(), Engine.get_frames_per_second(), DisplayServer.window_get_size(),
			p.nearest_body_id, p.nearest_altitude, p.velocity.length(), p.mode,
			space_view.plunge.phase, space_view.entry_heat, space_view.warp_amount])
	if img.save_png(dir.path_join(name)) == OK:
		_shot_note_until = Time.get_ticks_msec() / 1000.0 + 2.0
		info_note = "Screenshot saved"


var info_note := ""


## Show the hints for whatever the player is holding, and name the controller so it is plain
## whether the game has seen one at all.
func _set_pad(on: bool) -> void:
	_using_pad = on
	var pads := Input.get_connected_joypads()
	if on and not pads.is_empty():
		help.text = "%s\nController: %s" % [HELP_PAD, Input.get_joy_name(pads[0])]
	else:
		help.text = HELP_KEYS + ("" if not pads.is_empty() else "\nNo controller detected")


func _unhandled_input(event: InputEvent) -> void:
	if travel_menu.visible:
		# The menu owns the controller while it is open; only its own toggle gets through.
		if event.is_action_pressed("travel_menu"):
			travel_menu.close()
		return
	if event.is_action_pressed("toggle_markers"):
		_markers_visible = not _markers_visible
		marker_layer.visible = _markers_visible
	elif event.is_action_pressed("time_scale"):
		Universe.cycle_time_scale()
	elif space_view.plunge.can_leave() and (event.is_action_pressed("travel_menu") \
			or (event is InputEventKey and event.pressed and event.keycode in [KEY_ENTER, KEY_KP_ENTER])):
		space_view.plunge.leave()
	elif event.is_action_pressed("travel_menu") and space_view.plunge.phase == Plunge.Phase.NONE:
		if travel_menu.visible:
			travel_menu.close()
		else:
			travel_menu.open()
	elif event.is_action_pressed("jump_black_hole") and space_view.plunge.phase == Plunge.Phase.NONE:
		space_view.warp_to("sgr-a-star")
	elif event.is_action_pressed("jump_home") and space_view.plunge.phase == Plunge.Phase.NONE:
		space_view.warp_to("earth")
	elif event.is_action_pressed("warp_to_look") and space_view.plunge.phase == Plunge.Phase.NONE:
		var target := _looked_at_target()
		if target != "":
			space_view.warp_to(target)
	elif event.is_action_pressed("mute"):
		music.stream_paused = not music.stream_paused


func _on_plunge_phase(phase: Plunge.Phase) -> void:
	if phase == Plunge.Phase.FALLING:
		# Nothing gets out, and the music knows it: line the peak up with the end of the fall.
		travel_menu.visible = false
		music.stream_paused = false
		music.play(maxf(MUSIC_PEAK_SECONDS - PlungeMath.FALL_SECONDS, 0.0))
		music.volume_db = -3.0
	elif phase == Plunge.Phase.NONE:
		music.volume_db = MUSIC_DB


func _update_plunge(p: Player) -> void:
	var plunge := space_view.plunge
	fade.color.a = maxf(plunge.white, space_view.warp_flash)
	warp.visible = space_view.warp_amount > 0.01
	(warp.material as ShaderMaterial).set_shader_parameter("amount", space_view.warp_amount)
	heat.visible = space_view.entry_heat > 0.01
	(heat.material as ShaderMaterial).set_shader_parameter("heat", space_view.entry_heat)
	var in_space := plunge.phase == Plunge.Phase.NONE
	if space_view.is_warping():
		notice.text = ""
	info.visible = in_space
	help.visible = in_space
	marker_layer.visible = in_space and _markers_visible
	notice.text = ""
	match plunge.phase:
		Plunge.Phase.NONE:
			if p.nearest_is_black_hole:
				var rs: float = Universe.catalog.body(p.nearest_body_id)["radius_m"]
				var away := maxf(p.nearest_altitude, 0.0) / rs
				if away < 0.5:
					notice.text = "POINT OF NO RETURN   %.2f horizon radii to go" % away
					notice.modulate = Color(1.0, 0.35, 0.25, 0.6 + 0.4 * sin(Time.get_ticks_msec() * 0.008))
				elif away < 6.0:
					notice.text = "Event horizon in %.1f radii. It is pulling you in." % away
					notice.modulate = Color(1.0, 0.8, 0.55, 0.85)
		Plunge.Phase.FALLING:
			if plunge.t < 8.0:
				notice.text = "You crossed the event horizon. Nothing comes back from here."
				notice.modulate = Color(1.0, 0.9, 0.8, clampf(minf(plunge.t, 8.0 - plunge.t), 0.0, 1.0))
		Plunge.Phase.TESSERACT:
			if plunge.can_leave():
				notice.text = "Press Start to let go" if _using_pad else "Press Enter to let go"
				notice.modulate = Color(1.0, 0.92, 0.8, 0.5 + 0.3 * sin(Time.get_ticks_msec() * 0.003))


func _process(_delta: float) -> void:
	var p := space_view.player
	_update_plunge(p)
	var nearest := Universe.catalog.body(p.nearest_body_id)
	var system_name: String = Universe.catalog.system(p.system_id).get("name", "")
	info.text = "%s\n%s   altitude %s\nspeed %s   throttle %+d\ntime %s   %d fps" % [
		system_name.to_upper(),
		nearest.get("name", "—"), Fmt.distance(maxf(p.nearest_altitude, 0.0)),
		Fmt.speed(p.velocity.length()), p.throttle,
		Fmt.time_scale(Universe.time_scale), Engine.get_frames_per_second(),
	]
	if Time.get_ticks_msec() / 1000.0 < _shot_note_until:
		info.text += "\n" + info_note
	if marker_layer.visible:
		_update_markers()


## The body whose marker is closest to the middle of the screen (within reach), or "".
func _looked_at_target() -> String:
	var middle := get_viewport().get_visible_rect().size * 0.5
	var best := ""
	var best_d := 220.0
	for id in _markers:
		var label: Label = _markers[id]
		if not label.visible or not _marker_targets.has(id):
			continue
		var d := (label.position + Vector2(4, 9)).distance_to(middle)
		if d < best_d:
			best_d = d
			best = _marker_targets[id]
	return best


func _update_markers() -> void:
	var cam := space_view.player.camera
	var seen := {}
	for id in space_view.bodies:
		var b := Universe.catalog.body(id)
		if b["kind"] == "moon" and b["parent"] != space_view.player.nearest_body_id \
				and id != space_view.player.nearest_body_id:
			continue # only show moons of the world you're at, to keep the sky clean
		var world_pos: Vector3 = space_view.render_position_of(id)
		var dist := Universe.catalog.body_position(id, Universe.sim_time).sub(space_view.player.pos).length()
		if b["radius_m"] / maxf(dist, 1.0) > 0.03:
			continue # it fills a good part of the view already: no label across its face
		_marker_targets[id] = id
		_show_marker(cam, id, world_pos, "%s  %s" % [b["name"], Fmt.distance(dist)], seen)
	for fs in space_view.far_system_vectors():
		var world_pos: Vector3 = fs["dir"] * space_view.space.far * 0.5
		var star := Universe.catalog.primary_of(fs["id"])
		if not star.is_empty():
			_marker_targets[fs["id"]] = star["id"]
		_show_marker(cam, fs["id"], world_pos, "✦ %s  %s" % [fs["name"], Fmt.distance(fs["distance"])], seen)
	for id in _markers:
		if not seen.has(id):
			_markers[id].visible = false


func _show_marker(cam: Camera3D, id: String, world_pos: Vector3, text: String, seen: Dictionary) -> void:
	if cam.is_position_behind(world_pos) or space_view.is_occluded(world_pos, id):
		return
	var screen := cam.unproject_position(world_pos)
	if not get_viewport().get_visible_rect().has_point(screen):
		return
	var label: Label = _markers.get(id)
	if label == null:
		label = Label.new()
		label.add_theme_font_size_override("font_size", 13)
		label.add_theme_color_override("font_color", Color(0.75, 0.85, 1.0, 0.8))
		marker_layer.add_child(label)
		_markers[id] = label
	label.text = "· " + text
	label.position = screen + Vector2(-4, -9)
	label.visible = true
	seen[id] = true
