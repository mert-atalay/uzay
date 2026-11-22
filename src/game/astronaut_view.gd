class_name AstronautView
extends CanvasLayer
## Draws the astronaut you are flying, seen from just behind (V / R3 switches to first person,
## where you see your own gloved hands instead).
##
## At true scale the main camera's near plane is kilometres away when you are in orbit, so a
## 2 m astronaut can never be drawn by it. Instead the astronaut lives in a small world of its
## own, rendered by a second camera and laid over the main view. Sun direction and colour are
## copied from the real scene each frame so the suit is lit by the star you are actually near.

const MODEL_PATH := "res://assets/models/astronaut.glb"
const CAMERA_OFFSET := Vector3(0.0, -1.05, -4.4) # where the astronaut sits in front of the camera

@export var space_view_path: NodePath

var _viewport: SubViewport
var _camera: Camera3D
var _light: DirectionalLight3D
var _body: Node3D
var _arms: Array[Node3D] = []
var _legs: Array[Node3D] = []
var _flames: Array[MeshInstance3D] = []
var _flame_material: StandardMaterial3D
var _lean := Vector3.ZERO
## First person: the astronaut's own gloved hands and forearms, fixed to the camera.
var _first_person := false
var _hands: Node3D
var _hand_pivots: Array[Node3D] = []
var _fingers: Array[Node3D] = [] # curl pivots, five per hand
var _look_lag := Vector2.ZERO
var _prev_basis := Basis.IDENTITY
var _thrust := 0.0
var _time := 0.0
var _stage: Node3D
## Set by the ending: where the astronaut is, instead of just ahead of the camera.
var body_override: Variant = null
var hide_body := false

@onready var space_view := get_node(space_view_path) as SpaceView


func _ready() -> void:
	layer = 0 # under the HUD
	_viewport = SubViewport.new()
	_viewport.own_world_3d = true
	_viewport.transparent_bg = true
	_viewport.msaa_3d = Viewport.MSAA_4X
	_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(_viewport)

	var env := Environment.new()
	env.background_mode = Environment.BG_CLEAR_COLOR
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.5, 0.6, 0.8)
	env.ambient_light_energy = 0.14
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	var we := WorldEnvironment.new()
	we.environment = env
	_viewport.add_child(we)

	_camera = Camera3D.new()
	_camera.near = 0.1
	_camera.far = 50.0
	_viewport.add_child(_camera)
	_light = DirectionalLight3D.new()
	_light.light_energy = 2.2
	_viewport.add_child(_light)

	_stage = Node3D.new()
	_viewport.add_child(_stage)
	_body = Node3D.new()
	_body.position = CAMERA_OFFSET
	_viewport.add_child(_body)
	if ResourceLoader.exists(MODEL_PATH):
		_build_model()
	else:
		_build_suit()
	_build_hands()
	_hands.visible = false

	var rect := TextureRect.new()
	rect.texture = _viewport.get_texture()
	rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	rect.stretch_mode = TextureRect.STRETCH_SCALE
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(rect)
	get_viewport().size_changed.connect(_fit)
	_fit()


func _fit() -> void:
	_viewport.size = get_viewport().get_visible_rect().size


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("toggle_view") and body_override == null:
		# Third person (whole astronaut ahead of you) <-> first person (your own hands).
		_first_person = not _first_person
		_body.visible = not _first_person
		_hands.visible = _first_person


## A place in the astronaut's small world for other things that must be drawn at human scale
## (the rescue ship). Its axes are the camera's: -Z ahead, +Y up.
func stage() -> Node3D:
	return _stage


## How far the small world's camera sees (metres).
func set_reach(far: float) -> void:
	_camera.far = far


func force_third_person() -> void:
	_first_person = false
	_body.visible = true
	_hands.visible = false


func _process(delta: float) -> void:
	if not visible:
		return
	_animate(delta)
	# A cutscene can take the astronaut out of your hands (camera axes, metres).
	if body_override != null:
		_body.position = body_override
		_body.visible = not hide_body


func _animate(delta: float) -> void:
	_time += delta
	var player := space_view.player
	_camera.fov = player.camera.fov
	# Sunlight, turned into the astronaut's own frame.
	var to_star := player.global_basis.inverse() * space_view.star_direction
	if to_star.length() > 0.01:
		var up := Vector3.UP if absf(to_star.normalized().dot(Vector3.UP)) < 0.95 else Vector3.RIGHT
		_light.basis = Basis.looking_at(-to_star.normalized(), up)
	_light.light_color = space_view.star_color
	_light.light_energy = space_view.star_energy
	if _first_person:
		_animate_hands(player, delta)
		return

	# Lean into the direction of thrust, and drift a little when idle.
	var push := player.thrust_local
	var target := Vector3(-push.z * 0.42 - push.y * 0.12, -push.x * 0.2, -push.x * 0.38)
	_lean = _lean.lerp(target, 1.0 - exp(-3.0 * delta))
	_thrust = lerpf(_thrust, clampf(push.length(), 0.0, 1.0), 1.0 - exp(-6.0 * delta))
	var falling := space_view.plunge.fall_progress()
	_body.rotation = _lean + Vector3(sin(_time * 0.5) * 0.03, sin(_time * 0.31) * 0.05, sin(_time * 0.43) * 0.03) \
		+ Vector3(sin(_time * 1.3), sin(_time * 0.9), sin(_time * 1.1)) * 0.5 * falling
	_body.position = CAMERA_OFFSET + Vector3(-push.x * 0.25, sin(_time * 0.7) * 0.03 - push.y * 0.15, push.z * 0.3) * _thrust
	for i in _arms.size():
		var side := -1.0 if i == 0 else 1.0
		_arms[i].rotation = Vector3(0.25 + 0.3 * _thrust * -push.z + sin(_time * 0.8 + i) * 0.06 + falling * sin(_time * 2.0 + i * 2.0) * 0.8, 0.0, side * (0.28 + 0.1 * sin(_time * 0.6 + i * 1.7) + falling * 0.9))
	if player.mode == Player.Mode.WALK:
		# On foot: stand straight and swing arms and legs with each stride.
		var swing := sin(player.stride * 2.6) * clampf(player.velocity.length() / 4.0, 0.0, 1.2) * 0.55
		_body.rotation = Vector3(0.0, 0.0, 0.0)
		_body.position = CAMERA_OFFSET + Vector3(0.0, absf(sin(player.stride * 2.6)) * 0.03, 0.0)
		for i in _arms.size():
			_arms[i].rotation = Vector3((swing if i == 0 else -swing) * 0.8, 0.0, (-1.0 if i == 0 else 1.0) * 0.12)
		for i in _legs.size():
			_legs[i].rotation = Vector3(-swing if i == 0 else swing, 0.0, 0.0)
		_flame_material.emission_energy_multiplier = 0.0
		for f in _flames:
			f.scale = Vector3(1.0, 0.01, 1.0)
		return
	for i in _legs.size():
		_legs[i].rotation = Vector3(0.12 + 0.35 * _thrust * maxf(-push.z, 0.0) + sin(_time * 0.7 + i * 2.1) * 0.07 + falling * sin(_time * 1.7 + i * 3.0) * 0.5, 0.0, (-1.0 if i == 0 else 1.0) * 0.05)
	_flame_material.emission_energy_multiplier = 0.3 + 9.0 * _thrust
	for f in _flames:
		f.scale = Vector3(1.0, 0.25 + 1.6 * _thrust, 1.0)


func _material(color: Color, rough: float, metal := 0.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = rough
	m.metallic = metal
	return m


func _part(parent: Node3D, mesh: Mesh, mat: Material, pos: Vector3, rot := Vector3.ZERO) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = pos
	mi.rotation = rot
	parent.add_child(mi)
	return mi


func _capsule(radius: float, height: float) -> CapsuleMesh:
	var c := CapsuleMesh.new()
	c.radius = radius
	c.height = height
	return c


func _box(size: Vector3) -> BoxMesh:
	var b := BoxMesh.new()
	b.size = size
	return b


func _ball(radius: float) -> SphereMesh:
	var s := SphereMesh.new()
	s.radius = radius
	s.height = radius * 2.0
	return s


## Two gloved hands at the bottom of the view, built from simple shapes in the suit's colours:
## a white sleeve, a grey wrist ring, a padded glove with a darker palm, four fingers and a thumb.
func _build_hands() -> void:
	_hands = Node3D.new()
	_camera.add_child(_hands)
	var sleeve := _material(Color(0.74, 0.74, 0.72), 0.85)
	var ring := _material(Color(0.55, 0.56, 0.6), 0.4, 0.7)
	var glove := _material(Color(0.82, 0.82, 0.8), 0.7)
	var palm := _material(Color(0.2, 0.2, 0.22), 0.8)
	var accent := _material(Color(0.85, 0.3, 0.08), 0.6)
	for side: float in [-1.0, 1.0]:
		var pivot := Node3D.new() # the wrist
		pivot.position = Vector3(side * 0.15, -0.17, -0.42)
		pivot.basis = _hand_basis(side, 0.0, 0.0, 0.0)
		_hands.add_child(pivot)
		_hand_pivots.append(pivot)
		# Forearm running back and down out of view.
		# The forearm drops away down and back towards the bottom corner of the view.
		var forearm := _part(pivot, _capsule(0.05, 0.5), sleeve, Vector3(0.0, -0.11, 0.22), Vector3(2.04, 0.0, 0.0))
		var band := CylinderMesh.new()
		band.top_radius = 0.052
		band.bottom_radius = 0.052
		band.height = 0.025
		_part(forearm, band, accent, Vector3(0.0, -0.1, 0.0))
		var cuff := CylinderMesh.new()
		cuff.top_radius = 0.05
		cuff.bottom_radius = 0.056
		cuff.height = 0.035
		_part(pivot, cuff, ring, Vector3(0.0, -0.005, 0.0), Vector3(PI / 2.0, 0.0, 0.0))
		# A space glove is big and padded: the glove is built at hand size and scaled up.
		var glove_root := Node3D.new()
		glove_root.scale = Vector3.ONE * 1.6
		glove_root.position = Vector3(0.0, 0.0, -0.01)
		pivot.add_child(glove_root)
		# Back of the hand and the palm under it.
		var back := _part(glove_root, _ball(0.052), glove, Vector3(0.0, 0.004, -0.058))
		back.scale = Vector3(1.05, 0.5, 1.2)
		var under := _part(glove_root, _ball(0.048), palm, Vector3(0.0, -0.012, -0.058))
		under.scale = Vector3(1.0, 0.42, 1.15)
		# Fingers: two segments each, hinged so they can curl.
		for f in 4:
			var knuckle := Node3D.new()
			knuckle.position = Vector3((f - 1.5) * 0.023 * -side, 0.0, -0.115)
			glove_root.add_child(knuckle)
			_part(knuckle, _capsule(0.0115, 0.05), glove, Vector3(0.0, 0.0, -0.02), Vector3(PI / 2.0, 0.0, 0.0))
			var tip := Node3D.new()
			tip.position = Vector3(0.0, 0.0, -0.042)
			knuckle.add_child(tip)
			_part(tip, _capsule(0.0105, 0.04), glove, Vector3(0.0, 0.0, -0.016), Vector3(PI / 2.0, 0.0, 0.0))
			_fingers.append(knuckle)
		var thumb := Node3D.new()
		thumb.position = Vector3(side * 0.05, -0.005, -0.07)
		thumb.rotation = Vector3(0.0, side * 0.7, 0.0)
		glove_root.add_child(thumb)
		_part(thumb, _capsule(0.013, 0.055), glove, Vector3(0.0, 0.0, -0.022), Vector3(PI / 2.0, 0.0, 0.0))
		_fingers.append(thumb)


## Orientation of a hand: fingers pointing ahead, a little down and inwards, back of the glove
## up. `lift` raises the fingers, `yaw` turns them sideways, `roll` twists the wrist.
static func _hand_basis(side: float, lift: float, yaw: float, roll: float) -> Basis:
	var fingers := Vector3(-side * 0.18 + yaw, -0.32 + lift, -1.0).normalized()
	return Basis.looking_at(fingers, Vector3.UP) * Basis(Vector3.FORWARD, side * 0.25 + roll)


## The hands drift as you breathe, lag behind when you turn, push forward when you thrust and
## swing when you walk. Fingers relax open in flight and curl a little while thrusting.
func _animate_hands(player: Player, delta: float) -> void:
	# How the view turned since last frame, in the camera's own axes.
	var turn := (_prev_basis.inverse() * player.global_basis).get_euler()
	_prev_basis = player.global_basis
	var lag_target := Vector2(clampf(turn.y / maxf(delta, 1.0e-3), -3.0, 3.0), clampf(turn.x / maxf(delta, 1.0e-3), -3.0, 3.0)) * 0.03
	_look_lag = _look_lag.lerp(lag_target, 1.0 - exp(-8.0 * delta))
	var push := player.thrust_local
	_thrust = lerpf(_thrust, clampf(push.length(), 0.0, 1.0), 1.0 - exp(-6.0 * delta))
	var walking := player.mode == Player.Mode.WALK
	var swing := sin(player.stride * 2.6) * clampf(player.velocity.length() / 4.0, 0.0, 1.2) if walking else 0.0
	var falling := space_view.plunge.fall_progress()
	for i in _hand_pivots.size():
		var side := -1.0 if i == 0 else 1.0
		var pivot := _hand_pivots[i]
		var breathe := sin(_time * 0.9 + i * 1.3) * 0.006
		var reach := -0.07 * _thrust * maxf(-push.z, 0.0) + 0.04 * maxf(push.z, 0.0)
		pivot.position = Vector3(side * 0.15 + _look_lag.x * 0.4 - push.x * 0.03,
			-0.17 + breathe - _look_lag.y * 0.3 - push.y * 0.03 + absf(swing) * 0.01,
			-0.42 + reach + (swing * side) * 0.05)
		pivot.basis = _hand_basis(side, 0.25 * _thrust * maxf(-push.z, 0.0) + falling * sin(_time * 2.0 + i) * 0.3,
			_look_lag.x * 0.5, falling * sin(_time * 1.6 + i * 2.0) * 0.25)
	var curl := 0.25 + 0.55 * _thrust + 0.3 * falling
	for j in _fingers.size():
		var is_thumb := j % 5 == 4
		var f := _fingers[j]
		var wobble := sin(_time * 0.7 + j) * 0.04
		if is_thumb:
			f.rotation.x = -0.2 * curl + wobble
		else:
			f.rotation.x = -(curl + wobble + (j % 5) * 0.06)
			(f.get_child(1) as Node3D).rotation.x = -(curl * 1.1 + wobble)


## The modelled astronaut (Poly by Google, CC BY), turned to face away from the camera, with
## the two jetpack flames added at the pack.
func _build_model() -> void:
	var model := (load(MODEL_PATH) as PackedScene).instantiate() as Node3D
	model.position = Vector3(0.0, -1.0, 0.0) # the model's origin is at its feet
	model.rotation.y = PI
	_body.add_child(model)
	_flame_material = StandardMaterial3D.new()
	_flame_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_flame_material.albedo_color = Color(0.55, 0.8, 1.0, 0.7)
	_flame_material.emission_enabled = true
	_flame_material.emission = Color(0.5, 0.78, 1.0)
	_flame_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	for side: float in [-1.0, 1.0]:
		var flame := CylinderMesh.new()
		flame.top_radius = 0.05
		flame.bottom_radius = 0.0
		flame.height = 0.3
		var holder := MeshInstance3D.new()
		holder.position = Vector3(side * 0.17, -0.28, 0.3)
		_body.add_child(holder)
		_part(holder, flame, _flame_material, Vector3(0.0, -0.15, 0.0))
		_flames.append(holder)


## A space suit from simple shapes. The astronaut faces away from the camera (-Z), so the
## life-support pack on the back is what you mostly see.
func _build_suit() -> void:
	var white := _material(Color(0.7, 0.7, 0.68), 0.8)
	var grey := _material(Color(0.32, 0.33, 0.36), 0.6, 0.2)
	var dark := _material(Color(0.07, 0.07, 0.08), 0.5, 0.3)
	var orange := _material(Color(0.9, 0.35, 0.08), 0.6)
	var visor := _material(Color(0.95, 0.68, 0.22), 0.12, 1.0)

	_part(_body, _capsule(0.27, 0.74), white, Vector3(0.0, 0.0, 0.0)) # torso
	_part(_body, _box(Vector3(0.36, 0.1, 0.3)), grey, Vector3(0.0, -0.3, 0.0)) # belt
	_part(_body, _ball(0.215), white, Vector3(0.0, 0.5, -0.01)) # helmet
	_part(_body, _ball(0.18), visor, Vector3(0.0, 0.5, -0.075)) # visor (front)
	_part(_body, _capsule(0.13, 0.3), grey, Vector3(0.0, 0.33, 0.0), Vector3(0.0, 0.0, PI / 2.0)) # neck ring
	# Life-support pack with two thrusters.
	_part(_body, _box(Vector3(0.5, 0.66, 0.24)), white, Vector3(0.0, 0.08, 0.27))
	_part(_body, _box(Vector3(0.42, 0.2, 0.26)), grey, Vector3(0.0, 0.3, 0.27))
	_part(_body, _box(Vector3(0.1, 0.5, 0.02)), orange, Vector3(0.0, 0.02, 0.395))
	_flame_material = StandardMaterial3D.new()
	_flame_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_flame_material.albedo_color = Color(0.55, 0.8, 1.0)
	_flame_material.emission_enabled = true
	_flame_material.emission = Color(0.5, 0.78, 1.0)
	_flame_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_flame_material.albedo_color.a = 0.7
	for side in [-1.0, 1.0]:
		var nozzle := CylinderMesh.new()
		nozzle.top_radius = 0.045
		nozzle.bottom_radius = 0.07
		nozzle.height = 0.12
		_part(_body, nozzle, dark, Vector3(side * 0.16, -0.3, 0.3))
		var flame := CylinderMesh.new()
		flame.top_radius = 0.05
		flame.bottom_radius = 0.0
		flame.height = 0.3
		# The flame hangs below a pivot at the nozzle, so stretching the pivot lengthens it downwards.
		var holder := MeshInstance3D.new()
		holder.position = Vector3(side * 0.16, -0.36, 0.3)
		_body.add_child(holder)
		_part(holder, flame, _flame_material, Vector3(0.0, -0.15, 0.0))
		_flames.append(holder)
		# Arms hang from the shoulders, legs from the hips; each has a pivot so it can swing.
		var shoulder := Node3D.new()
		shoulder.position = Vector3(side * 0.33, 0.24, 0.0)
		_body.add_child(shoulder)
		_part(shoulder, _capsule(0.085, 0.4), white, Vector3(0.0, -0.17, 0.0))
		_part(shoulder, _capsule(0.075, 0.36), white, Vector3(0.0, -0.46, -0.03), Vector3(-0.25, 0.0, 0.0))
		_part(shoulder, _ball(0.085), grey, Vector3(0.0, -0.66, -0.08))
		_part(shoulder, _ball(0.1), grey, Vector3(0.0, 0.0, 0.0))
		_arms.append(shoulder)
		var hip := Node3D.new()
		hip.position = Vector3(side * 0.13, -0.36, 0.0)
		_body.add_child(hip)
		_part(hip, _capsule(0.105, 0.48), white, Vector3(0.0, -0.2, 0.0))
		_part(hip, _capsule(0.095, 0.44), white, Vector3(0.0, -0.56, 0.02), Vector3(0.12, 0.0, 0.0))
		_part(hip, _box(Vector3(0.17, 0.12, 0.3)), grey, Vector3(0.0, -0.82, -0.02))
		_legs.append(hip)
