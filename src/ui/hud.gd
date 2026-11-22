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


func _ready() -> void:
	travel_menu.space_view = space_view
	var stream := load("res://assets/music/interstellar_main_theme.mp3") as AudioStreamMP3
	if stream != null:
		stream.loop = true
		music.stream = stream
		music.volume_db = -9.0
		music.play()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("toggle_markers"):
		_markers_visible = not _markers_visible
		marker_layer.visible = _markers_visible
	elif event.is_action_pressed("time_scale"):
		Universe.cycle_time_scale()
	elif event.is_action_pressed("travel_menu"):
		if travel_menu.visible:
			travel_menu.close()
		else:
			travel_menu.open()
	elif event.is_action_pressed("mute"):
		music.stream_paused = not music.stream_paused


func _process(_delta: float) -> void:
	var p := space_view.player
	var nearest := Universe.catalog.body(p.nearest_body_id)
	var system_name: String = Universe.catalog.system(p.system_id).get("name", "")
	info.text = "%s\n%s   altitude %s\nspeed %s   throttle %+d\ntime %s   %d fps" % [
		system_name.to_upper(),
		nearest.get("name", "—"), Fmt.distance(maxf(p.nearest_altitude, 0.0)),
		Fmt.speed(p.velocity.length()), p.throttle,
		Fmt.time_scale(Universe.time_scale), Engine.get_frames_per_second(),
	]
	if _markers_visible:
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
