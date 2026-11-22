class_name Player
extends Node3D
## The astronaut, for now as a first-person camera with a jetpack-style 6DOF float.
## Its true position lives in `pos` (64-bit, metres, system frame). The node itself always
## sits at the origin: the world is moved around it (floating origin).

signal speed_changed(speed: float)

const MOUSE_SENSITIVITY := 0.0022
const STICK_LOOK_SPEED := 2.2 # rad/s at full deflection
const ROLL_SPEED := 1.2 # rad/s
const RESPONSIVENESS := 2.5 # how quickly velocity follows input (1/s)
const BOOST_MULTIPLIER := 4.0
const SURFACE_CLEARANCE := 2.0 # metres kept between you and a surface

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
## This frame's movement input in the astronaut's own axes (x right, y up, z back), length 0..1.
var thrust_local := Vector3.ZERO

@onready var camera: Camera3D = $Camera3D


func _ready() -> void:
	# Move before SpaceView places the world around us, so nothing lags a frame behind.
	process_priority = -10
	camera.fov = 70.0
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _unhandled_input(event: InputEvent) -> void:
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
	# Free 6DOF: rotate around the astronaut's own axes, no fixed "up" in space.
	transform.basis = (transform.basis * Basis(Vector3.UP, yaw) * Basis(Vector3.RIGHT, pitch)).orthonormalized()


func _process(delta: float) -> void:
	var look := Input.get_vector("look_left", "look_right", "look_down", "look_up")
	if look != Vector2.ZERO:
		_look(-look.x * STICK_LOOK_SPEED * delta, look.y * STICK_LOOK_SPEED * delta)
	var roll := Input.get_axis("roll_right", "roll_left")
	if roll != 0.0:
		transform.basis = (transform.basis * Basis(Vector3.FORWARD, -roll * ROLL_SPEED * delta)).orthonormalized()

	var input := Vector3(
		Input.get_axis("move_left", "move_right"),
		Input.get_axis("move_down", "move_up"),
		Input.get_axis("move_forward", "move_back")
	)
	if input.length() > 1.0:
		input = input.normalized()

	thrust_local = Vector3.ZERO if controls_locked else input
	if controls_locked:
		velocity = Vector3.ZERO
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
