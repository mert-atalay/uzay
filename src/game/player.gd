class_name Player
extends Node3D
## The astronaut, for now as a first-person camera with a jetpack-style 6DOF float.
## Its true position lives in `pos` (64-bit, metres, system frame). The node itself always
## sits at the origin: the world is moved around it (floating origin).

signal speed_changed(speed: float)

enum Mode { FLY, WALK }

const MOUSE_SENSITIVITY := 0.0022
const STICK_LOOK_SPEED := 2.2 # rad/s at full deflection
const ROLL_SPEED := 1.2 # rad/s
const RESPONSIVENESS := 2.5 # how quickly velocity follows input (1/s)
const BOOST_MULTIPLIER := 4.0
const SURFACE_CLEARANCE := 2.0 # eye height: metres kept between the camera and the ground
const WALK_SPEED := 4.0
const RUN_SPEED := 11.0
const JUMP_SPEED := 4.5
const LIFTOFF_HOLD := 0.45 # hold "up" this long on the ground to fire the jetpack again

var system_id: String = "sol"
var pos := DVec3.new()
var velocity := Vector3.ZERO
var throttle: int = 0

## Filled in each frame by SpaceView: the closest surface and what it is.
var nearest_altitude: float = INF
var nearest_body_id: String = ""
var nearest_is_black_hole: bool = false
## True while something else is moving the astronaut (the fall into a black hole). You can still look.
var controls_locked: bool = false
## True while the travel menu is open: sticks and buttons drive the menu, not the astronaut.
var input_blocked: bool = false
## True on frames where the ground is holding you up.
var on_ground: bool = false
## Set by SpaceView when there is solid ground nearby: which way is up (world axes) and how
## hard the body pulls (m/s²).
var has_ground: bool = false
var ground_up := Vector3.UP
var gravity: float = 0.0
var mode := Mode.FLY
## Distance walked, for the astronaut's stride.
var stride: float = 0.0
var _vertical_speed := 0.0
var _liftoff_hold := 0.0
## This frame's movement input in the astronaut's own axes (x right, y up, z back), length 0..1.
var thrust_local := Vector3.ZERO

@onready var camera: Camera3D = $Camera3D


func _ready() -> void:
	# Move before SpaceView places the world around us, so nothing lags a frame behind.
	process_priority = -10
	camera.fov = 70.0
	# Eyes that adapt: a sunlit planet filling the view dims the picture, deep space opens it up
	# so the Milky Way comes out. The limits keep space dark and stop planets blowing out.
	var eye := CameraAttributesPractical.new()
	eye.auto_exposure_enabled = true
	eye.auto_exposure_scale = 0.22
	eye.auto_exposure_speed = 1.2
	eye.auto_exposure_min_sensitivity = 110.0
	eye.auto_exposure_max_sensitivity = 600.0
	camera.attributes = eye
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _unhandled_input(event: InputEvent) -> void:
	if input_blocked:
		return
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		_look(-event.relative.x * MOUSE_SENSITIVITY, -event.relative.y * MOUSE_SENSITIVITY)
	elif event is InputEventMouseButton and event.pressed:
		if Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
			if event.button_index == MOUSE_BUTTON_LEFT:
				Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
		elif event.button_index == MOUSE_BUTTON_WHEEL_UP:
			throttle = mini(throttle + 1, 6)
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			throttle = maxi(throttle - 1, -8)
	elif event.is_action_pressed("throttle_up"):
		throttle = mini(throttle + 1, 6)
	elif event.is_action_pressed("throttle_down"):
		throttle = maxi(throttle - 1, -8)
	elif event.is_action_pressed("release_mouse"):
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


func _look(yaw: float, pitch: float) -> void:
	if mode == Mode.WALK:
		# On foot: turn about the ground's up, and don't let the view flip over.
		var b := Basis(ground_up, yaw) * transform.basis
		var forward := -b.z
		var tilt := asin(clampf(forward.dot(ground_up), -1.0, 1.0))
		pitch = clampf(tilt + pitch, -1.4, 1.4) - tilt
		transform.basis = (b * Basis(Vector3.RIGHT, pitch)).orthonormalized()
		return
	# Free 6DOF: rotate around the astronaut's own axes, no fixed "up" in space.
	transform.basis = (transform.basis * Basis(Vector3.UP, yaw) * Basis(Vector3.RIGHT, pitch)).orthonormalized()


func _process(delta: float) -> void:
	var look := Input.get_vector("look_left", "look_right", "look_down", "look_up")
	if input_blocked:
		look = Vector2.ZERO
	if look != Vector2.ZERO:
		_look(-look.x * STICK_LOOK_SPEED * delta, look.y * STICK_LOOK_SPEED * delta)
	var roll := Input.get_axis("roll_right", "roll_left")
	if roll != 0.0 and mode == Mode.FLY:
		transform.basis = (transform.basis * Basis(Vector3.FORWARD, -roll * ROLL_SPEED * delta)).orthonormalized()

	var input := Vector3(
		Input.get_axis("move_left", "move_right"),
		Input.get_axis("move_down", "move_up"),
		Input.get_axis("move_forward", "move_back")
	)
	if input.length() > 1.0:
		input = input.normalized()
	if input_blocked:
		input = Vector3.ZERO

	if not controls_locked:
		thrust_local = input
	if controls_locked:
		velocity = Vector3.ZERO
		mode = Mode.FLY
		return

	_update_mode(input, delta)
	if mode == Mode.WALK:
		_walk(input, delta)
		return

	var top_speed := Flight.max_speed(nearest_altitude, throttle, nearest_is_black_hole)
	if Input.is_action_pressed("boost"):
		top_speed *= BOOST_MULTIPLIER
	var target := transform.basis * input * top_speed
	velocity = velocity.lerp(target, 1.0 - exp(-RESPONSIVENESS * delta))
	# Never carry more speed than the current altitude allows (e.g. diving towards a planet).
	if velocity.length() > top_speed:
		velocity = velocity.normalized() * top_speed

	pos.add_scaled_vector3(velocity, delta)
	speed_changed.emit(velocity.length())


func _update_mode(input: Vector3, delta: float) -> void:
	if mode == Mode.FLY:
		if has_ground and on_ground and input.y <= 0.0:
			mode = Mode.WALK
			_vertical_speed = 0.0
			_liftoff_hold = 0.0
		return
	# Walking: hold "up" to lift off again; lose the ground and you are flying anyway.
	_liftoff_hold = _liftoff_hold + delta if input.y > 0.5 else 0.0
	if not has_ground or _liftoff_hold > LIFTOFF_HOLD:
		mode = Mode.FLY
		velocity = ground_up * 3.0


func _walk(input: Vector3, delta: float) -> void:
	var up := ground_up
	# Stand upright: remove any roll left over from flying, keep where you are looking.
	var forward := -transform.basis.z
	var right := forward.cross(up)
	if right.length() < 0.05:
		right = transform.basis.x
	right = right.normalized()
	var upright := Basis(right, right.cross(forward).normalized(), -forward).orthonormalized()
	transform.basis = transform.basis.slerp(upright, 1.0 - exp(-8.0 * delta)).orthonormalized()

	var ahead := up.cross(right).normalized() # level forward
	var speed := RUN_SPEED if Input.is_action_pressed("boost") else WALK_SPEED
	var wish := (ahead * -input.z + right * input.x) * speed
	var level := velocity - up * velocity.dot(up)
	level = level.lerp(wish, 1.0 - exp(-10.0 * delta))
	if on_ground:
		_vertical_speed = maxf(_vertical_speed, 0.0)
		if Input.is_action_just_pressed("move_up"):
			_vertical_speed = JUMP_SPEED
	else:
		_vertical_speed -= gravity * delta
	velocity = level + up * _vertical_speed
	stride += level.length() * delta
	pos.add_scaled_vector3(velocity, delta)
	speed_changed.emit(velocity.length())


## Called by SpaceView when the player would end up inside a body: push back out.
func resolve_surface(body_center: DVec3, radius: float) -> void:
	var rel := pos.sub(body_center)
	var d := rel.length()
	var min_d := radius + SURFACE_CLEARANCE
	if d < min_d and d > 0.0:
		pos = body_center.add(rel.scaled(min_d / d))
		var n := rel.normalized().to_vector3()
		var inward := velocity.dot(n)
		if inward < 0.0:
			velocity -= n * inward
