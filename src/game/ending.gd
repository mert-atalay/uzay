class_name Ending
extends Node
## What happens if you reached back far enough: you come out at Saturn, every star in place,
## and a ship from the Earth you changed is waiting. It takes you aboard and turns for home.
## Runs on a clock; SpaceView starts it and the HUD reads `black` and `title`.

const ARRIVE_AT := 8.0
const ARRIVE_SECONDS := 17.0
const PICKUP_AT := 28.0
const PICKUP_SECONDS := 11.0
const DEPART_AT := 42.0
const TURN_SECONDS := 7.0
const FADE_AT := 60.0
const TITLE_AT := 63.0
const END_AT := 75.0
## Where the ship stops, in the view's axes at the start (x right, y up, z ahead), metres.
const HOVER := Vector3(50.0, 200.0, 430.0)
const APPROACH_DISTANCE := 60000.0

const LINES := [
	[3.0, "self", "Saturn. And every star is where it should be."],
	[12.0, "ship", "Lone traveller, this is the starship Vigil, out of Earth. Hold still. We know exactly who you are."],
	[21.5, "ship", "A thousand years ago a message fell out of the sky, and we built everything we are from it. The thing you saw never got past the outer dark."],
	[32.0, "ship", "We have been keeping this appointment for a very long time. Bringing you aboard."],
	[44.0, "ship", "Helm, set course for Earth. We are taking our traveller home."],
]

var active := false
var t := 0.0
## 0..1 black over the picture, and 0..1 for the closing title.
var black := 0.0
var title := 0.0

var _view: SpaceView
var _astronaut: AstronautView
var _ship: RescueShip
var _forward := Vector3.FORWARD
var _right := Vector3.RIGHT
var _up := Vector3.UP
var _from := Vector3.ZERO
var _next_line := 0


func _ready() -> void:
	# After the astronaut has been animated for the frame, so we can move it.
	process_priority = 20
	_view = get_parent() as SpaceView
	_astronaut = _view.get_node("Astronaut") as AstronautView


func start() -> void:
	active = true
	t = 0.0
	_next_line = 0
	var basis := _view.player.global_basis
	_forward = -basis.z
	_right = basis.x
	_up = basis.y
	# It comes in from high on the right.
	_from = (_right * 0.75 + _up * 0.32 + _forward * 0.58).normalized()
	_view.player.input_blocked = true
	_view.player.controls_locked = true
	_astronaut.force_third_person()
	_astronaut.set_reach(APPROACH_DISTANCE * 4.0)
	_astronaut.body_override = AstronautView.CAMERA_OFFSET
	_astronaut.hide_body = false
	_ship = RescueShip.new()
	_ship.visible = false
	_astronaut.stage().add_child(_ship)


func _process(delta: float) -> void:
	if not active:
		black = move_toward(black, 0.0, delta / 3.0)
		title = move_toward(title, 0.0, delta / 2.0)
		return
	t += delta
	while _next_line < LINES.size() and t >= float(LINES[_next_line][0]):
		if _next_line == LINES.size() - 1 or t < float(LINES[_next_line + 1][0]):
			_view.story.say(LINES[_next_line][1], LINES[_next_line][2])
		_next_line += 1
	var player := _view.player
	player.controls_locked = true
	player.input_blocked = true
	var hover := _right * HOVER.x + _up * HOVER.y + _forward * HOVER.z
	var ship_pos := hover
	var nose := -_from
	var look_dir := _forward
	var engines := 0.15
	_ship.visible = t >= ARRIVE_AT
	_astronaut.body_override = AstronautView.CAMERA_OFFSET
	_ship.set_bay(0.0, Vector3.ZERO)
	if t < DEPART_AT:
		# Arriving: fast and far, then slower and slower until it hangs over you.
		var x := clampf((t - ARRIVE_AT) / ARRIVE_SECONDS, 0.0, 1.0)
		var left := pow(1.0 - x, 4.0)
		ship_pos = hover + _from * APPROACH_DISTANCE * left
		engines = 0.2 + 0.8 * left
		look_dir = _forward.slerp(ship_pos.normalized(), 0.7 * smoothstep(0.0, 0.5, x))
	else:
		# Leaving: it turns its nose to Earth, lights its engines and goes.
		var home := _earth_direction()
		var turn := smoothstep(0.0, 1.0, clampf((t - DEPART_AT) / TURN_SECONDS, 0.0, 1.0))
		nose = (-_from).slerp(home, turn).normalized() if (-_from).dot(home) > -0.99 else home
		var burn := maxf(t - DEPART_AT - TURN_SECONDS * 0.8, 0.0)
		ship_pos = hover + home * 2.5 * burn * burn * burn
		engines = clampf(0.15 + burn * 0.5, 0.0, 1.0)
		look_dir = ship_pos.normalized()
	var ship_basis := Basis.looking_at(nose, _up if absf(nose.dot(_up)) < 0.95 else _right)

	# Everything on the stage is in the camera's axes.
	var to_camera := player.global_basis.inverse()
	_ship.transform = Transform3D(to_camera * ship_basis, to_camera * ship_pos)
	_ship.set_engines(engines)

	# Taken aboard: the astronaut drifts up the beam into the bay.
	if t >= PICKUP_AT:
		var x := clampf((t - PICKUP_AT) / PICKUP_SECONDS, 0.0, 1.0)
		var k := x * x * (3.0 - 2.0 * x)
		var bay_cam: Vector3 = _ship.transform * RescueShip.BAY
		var here := AstronautView.CAMERA_OFFSET.lerp(bay_cam, k * k * k)
		_astronaut.body_override = here
		_astronaut.hide_body = x >= 1.0
		var light := smoothstep(0.0, 0.15, x) * (1.0 - smoothstep(0.0, 4.0, t - PICKUP_AT - PICKUP_SECONDS))
		_ship.set_bay(light, _ship.transform.affine_inverse() * here)

	# The view follows, slowly.
	var want := Basis.looking_at(look_dir, _up if absf(look_dir.dot(_up)) < 0.95 else _right)
	player.transform.basis = player.transform.basis.slerp(want, 1.0 - exp(-0.9 * delta)).orthonormalized()

	black = smoothstep(FADE_AT, FADE_AT + 3.0, t)
	title = smoothstep(TITLE_AT, TITLE_AT + 2.0, t) * (1.0 - smoothstep(END_AT - 2.5, END_AT - 0.5, t))
	if t >= END_AT:
		_finish()


## Unit vector from the player towards Earth.
func _earth_direction() -> Vector3:
	var earth := Universe.catalog.body_position("earth", Universe.sim_time)
	return earth.sub(_view.player.pos).normalized().to_vector3()


## Home: the ship has brought you to Earth, and the game is yours again.
func _finish() -> void:
	active = false
	_ship.queue_free()
	_ship = null
	_astronaut.body_override = null
	_astronaut.hide_body = false
	_astronaut.force_third_person()
	_astronaut.set_reach(50.0)
	_view.player.input_blocked = false
	_view.player.controls_locked = false
	_view.travel_to_body("earth")
	_view.story.say("dispatch", "EVA One, Earth Dispatch. The Vigil says they found you right where the old message said you would be. Welcome home.")
