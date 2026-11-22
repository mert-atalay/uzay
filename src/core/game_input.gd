extends Node
## Autoload "GameInput": defines the input actions in code (keyboard, mouse and gamepad),
## so they stay readable and diffable instead of living as serialized blobs in project.godot.

const DEADZONE := 0.18


func _enter_tree() -> void:
	_key("move_forward", [KEY_W])
	_key("move_back", [KEY_S])
	_key("move_left", [KEY_A])
	_key("move_right", [KEY_D])
	_key("move_up", [KEY_SPACE])
	_key("move_down", [KEY_CTRL, KEY_C])
	_key("roll_left", [KEY_Q])
	_key("roll_right", [KEY_E])
	_key("boost", [KEY_SHIFT])
	_key("throttle_up", [KEY_EQUAL, KEY_BRACKETRIGHT])
	_key("throttle_down", [KEY_MINUS, KEY_BRACKETLEFT])
	_key("time_scale", [KEY_T])
	_key("toggle_markers", [KEY_H])
	_key("release_mouse", [KEY_ESCAPE])

	_axis("move_forward", JOY_AXIS_LEFT_Y, -1.0)
	_axis("move_back", JOY_AXIS_LEFT_Y, 1.0)
	_axis("move_left", JOY_AXIS_LEFT_X, -1.0)
	_axis("move_right", JOY_AXIS_LEFT_X, 1.0)
	_axis("look_up", JOY_AXIS_RIGHT_Y, -1.0)
	_axis("look_down", JOY_AXIS_RIGHT_Y, 1.0)
	_axis("look_left", JOY_AXIS_RIGHT_X, -1.0)
	_axis("look_right", JOY_AXIS_RIGHT_X, 1.0)
	_axis("boost", JOY_AXIS_TRIGGER_RIGHT, 1.0)
	_button("move_up", JOY_BUTTON_A)
	_button("move_down", JOY_BUTTON_B)
	_button("roll_left", JOY_BUTTON_LEFT_SHOULDER)
	_button("roll_right", JOY_BUTTON_RIGHT_SHOULDER)
	_button("throttle_up", JOY_BUTTON_DPAD_UP)
	_button("throttle_down", JOY_BUTTON_DPAD_DOWN)
	_button("time_scale", JOY_BUTTON_BACK)
	_button("toggle_markers", JOY_BUTTON_Y)


func _ensure(action: String) -> void:
	if not InputMap.has_action(action):
		InputMap.add_action(action, DEADZONE)


func _key(action: String, keys: Array) -> void:
	_ensure(action)
	for k in keys:
		var ev := InputEventKey.new()
		ev.physical_keycode = k
		InputMap.action_add_event(action, ev)


func _axis(action: String, axis: JoyAxis, direction: float) -> void:
	_ensure(action)
	var ev := InputEventJoypadMotion.new()
	ev.axis = axis
	ev.axis_value = direction
	InputMap.action_add_event(action, ev)


func _button(action: String, button: JoyButton) -> void:
	_ensure(action)
	var ev := InputEventJoypadButton.new()
	ev.button_index = button
	InputMap.action_add_event(action, ev)
