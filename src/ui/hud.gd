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

## The soundtrack's peak, timed to land as the tesseract opens.
const MUSIC_PEAK_SECONDS := 210.0
const MUSIC_DB := -9.0


func _ready() -> void:
	travel_menu.space_view = space_view
	var stream := load("res://assets/music/interstellar_main_theme.mp3") as AudioStreamMP3
	if stream != null:
		stream.loop = true
		music.stream = stream
		music.volume_db = MUSIC_DB
		music.play()
	(space_view.get_node("Plunge") as Plunge).phase_changed.connect(_on_plunge_phase)


func _unhandled_input(event: InputEvent) -> void:
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
	fade.color.a = plunge.white
	var in_space := plunge.phase == Plunge.Phase.NONE
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
				notice.text = "Press Enter to let go"
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
	if marker_layer.visible:
		_update_markers()


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
		_show_marker(cam, id, world_pos, "%s  %s" % [b["name"], Fmt.distance(dist)], seen)
	for fs in space_view.far_system_vectors():
		var world_pos: Vector3 = fs["dir"] * space_view.space.far * 0.5
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
