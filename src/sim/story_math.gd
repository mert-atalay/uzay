class_name StoryMath
extends RefCounted
## The thing that is coming. Pure maths, no nodes: where the Devourer is at a given story time,
## how much of the sky it fills, and which worlds are already gone.
##
## It is a face wider than the Solar System, carved into space itself, drifting in from one
## fixed direction. It never hurries and never turns. Worlds simply stop being there as it
## nears, outermost first. Times are seconds of play.

## The worlds it eats, in order, and when (seconds since the story began).
const ORDER: Array[String] = ["pluto", "neptune", "uranus", "saturn", "jupiter", "mars", "earth", "venus", "mercury", "sun"]
const EAT_TIMES: Array[float] = [240.0, 420.0, 600.0, 810.0, 1020.0, 1260.0, 1620.0, 1770.0, 1860.0, 2040.0]
const AU := 1.495978707e11
## The direction it comes from, seen from the Sun (unit vector, system axes).
const DIRECTION := Vector3(-0.5145, 0.2968, -0.8045)
## Chin to crown (metres): more than ten times the width of Neptune's orbit.
const HEIGHT := 700.0 * AU
## How far away its face is at the start, and when the Sun goes out (metres from the Sun).
const START_DISTANCE := 520.0 * AU
const END_DISTANCE := 45.0 * AU
## It leans a little, like a head that has never needed to hold itself straight (radians).
const TILT := 0.21


static func end_time() -> float:
	return EAT_TIMES[EAT_TIMES.size() - 1]


## How many worlds on the list are gone at time t.
static func eaten_count(t: float) -> int:
	var n := 0
	for e in EAT_TIMES:
		if t >= e:
			n += 1
	return n


## True if this world (by its place in ORDER) has been eaten.
static func is_eaten_index(index: int, t: float) -> bool:
	return index >= 0 and index < EAT_TIMES.size() and t >= EAT_TIMES[index]


## How far its face is from the Sun at time t (metres). It closes steadily and never stops.
static func distance(t: float) -> float:
	var u := clampf(t / end_time(), 0.0, 1.0)
	return lerpf(START_DISTANCE, END_DISTANCE, u)


## Where the middle of its face is, Sun-centred.
static func face_position(t: float) -> DVec3:
	return DVec3.from_vector3(DIRECTION.normalized()).scaled(distance(t))


## Half the angle its face spans (radians), seen from `range_m` metres away.
static func half_angle(range_m: float) -> float:
	return atan(HEIGHT * 0.5 / maxf(range_m, 1.0))


## Which way is up for its face (unit vector, system axes), square to `towards` (the unit
## vector from the viewer to its face).
static func face_up(towards: Vector3) -> Vector3:
	var up := Vector3.UP - towards * Vector3.UP.dot(towards)
	if up.length() < 1.0e-4:
		up = Vector3.RIGHT
	return up.normalized().rotated(towards, TILT)
