class_name Plunge
extends Node
## The point of no return. Once the player crosses a black hole's event horizon this takes the
## controls away, drags them inward for PlungeMath.FALL_SECONDS, then opens the tesseract.
## SpaceView owns one of these and asks it where the player is while falling.

signal phase_changed(phase: Phase)

enum Phase { NONE, FALLING, TESSERACT, LEAVING }

## Seconds inside the tesseract before you may let go.
const TESSERACT_MIN_SECONDS := 25.0
const LEAVE_SECONDS := 3.5
## Where the tesseract drops you (as in the film: near Saturn).
const EXIT_BODY := "saturn"

var phase := Phase.NONE
## Seconds spent in the current phase.
var t := 0.0
var hole_id := ""
## Unit vector from the hole's centre to the player at the moment of crossing.
var direction := Vector3.UP
## White-out over the screen, 0..1 (the HUD draws it).
var white := 0.0


func begin_fall(id: String, dir: Vector3) -> void:
	hole_id = id
	direction = dir.normalized()
	_set_phase(Phase.FALLING)


## Skip straight to a phase (used by the screenshot tool).
func debug_jump(to: Phase, seconds: float) -> void:
	_set_phase(to)
	t = seconds


## 0 at the horizon, 1 when the tesseract opens.
func fall_progress() -> float:
	return clampf(t / PlungeMath.FALL_SECONDS, 0.0, 1.0) if phase == Phase.FALLING else 0.0


func can_leave() -> bool:
	return phase == Phase.TESSERACT and t >= TESSERACT_MIN_SECONDS


func leave() -> void:
	if can_leave():
		_set_phase(Phase.LEAVING)


func _process(delta: float) -> void:
	t += delta
	match phase:
		Phase.NONE:
			white = move_toward(white, 0.0, delta / 4.0)
		Phase.FALLING:
			white = smoothstep(0.93, 1.0, fall_progress())
			if t >= PlungeMath.FALL_SECONDS:
				_set_phase(Phase.TESSERACT)
		Phase.TESSERACT:
			white = move_toward(white, 0.0, delta / 5.0)
		Phase.LEAVING:
			white = clampf(t / LEAVE_SECONDS, 0.0, 1.0)
			if t >= LEAVE_SECONDS:
				_set_phase(Phase.NONE)


func _set_phase(p: Phase) -> void:
	phase = p
	t = 0.0
	phase_changed.emit(p)
