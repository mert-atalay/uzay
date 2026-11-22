class_name StoryMath
extends RefCounted
## The thing that is coming. Pure maths, no nodes: where the Devourer is at a given story time,
## which worlds it has already eaten, and how much of the sky behind it is gone.
##
## It swims from far outside the Solar System to each world in turn, outermost first, and
## reaches every one on schedule whatever the planets are doing. Times are seconds of play.

## The worlds it eats, in order, and when (seconds since the story began).
const ORDER: Array[String] = ["pluto", "neptune", "uranus", "saturn", "jupiter", "mars", "earth", "venus", "mercury", "sun"]
const EAT_TIMES: Array[float] = [240.0, 420.0, 600.0, 810.0, 1020.0, 1260.0, 1620.0, 1770.0, 1860.0, 2040.0]
const AU := 1.495978707e11
## Where it is first seen, from the Sun (metres).
const START := Vector3(-0.52, 0.3, -0.8) * 95.0 * AU
## Nose to tail, and the half-width of its body (metres). The Sun would fit in its mouth.
const LENGTH := 1.6 * AU
const RADIUS := 0.055 * AU
## Fraction of each leg spent turning from the last heading to the new one.
const TURN := 0.3


static func end_time() -> float:
	return EAT_TIMES[EAT_TIMES.size() - 1]


## Which leg of the journey it is on at time t (0 = heading for the first world), clamped.
static func leg_at(t: float) -> int:
	for i in EAT_TIMES.size():
		if t < EAT_TIMES[i]:
			return i
	return EAT_TIMES.size() - 1


## 0..1 along the current leg, eased so it slows as it closes on each world.
static func leg_progress(t: float) -> float:
	var i := leg_at(t)
	var t0 := 0.0 if i == 0 else EAT_TIMES[i - 1]
	var u := clampf((t - t0) / (EAT_TIMES[i] - t0), 0.0, 1.0)
	return u * u * (3.0 - 2.0 * u)


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


## Where its head is. `nodes` are the current positions of the worlds in ORDER (Sun-centred).
static func head_position(t: float, nodes: Array) -> DVec3:
	var i := leg_at(t)
	var from: DVec3 = DVec3.from_vector3(START) if i == 0 else nodes[i - 1]
	var to: DVec3 = nodes[i]
	return from.add(to.sub(from).scaled(leg_progress(t)))


static func _leg_direction(i: int, nodes: Array) -> Vector3:
	var from: DVec3 = DVec3.from_vector3(START) if i == 0 else nodes[i - 1]
	var d: DVec3 = nodes[i].sub(from)
	if d.length() < 1.0:
		return Vector3.FORWARD
	return d.normalized().to_vector3()


## Unit vector it is swimming along. It turns smoothly at the start of each leg.
static func heading(t: float, nodes: Array) -> Vector3:
	var i := leg_at(t)
	var now := _leg_direction(i, nodes)
	if i == 0:
		return now
	var before := _leg_direction(i - 1, nodes)
	var t0 := EAT_TIMES[i - 1]
	var u := clampf((t - t0) / ((EAT_TIMES[i] - t0) * TURN), 0.0, 1.0)
	u = u * u * (3.0 - 2.0 * u)
	if before.dot(now) < -0.999:
		return now if u > 0.5 else before
	return before.slerp(now, u).normalized()


## Distance (metres) from `p` to its skin: negative means inside it. The body is taken as a
## capsule from the head back along the heading.
static func distance_to(p: DVec3, head: DVec3, heading_dir: Vector3) -> float:
	var rel := p.sub(head).scaled(1.0 / AU).to_vector3()
	var along := clampf(-rel.dot(heading_dir), 0.0, LENGTH / AU)
	var nearest := -heading_dir * along
	# It tapers: full width at the head, a thread at the tail.
	var width := RADIUS * (1.0 - 0.9 * along / (LENGTH / AU))
	return (rel - nearest).length() * AU - width


## Angular radius (radians) of the hole it has eaten in the sky, seen from inside the system.
static func void_radius(t: float) -> float:
	return 0.02 + 1.3 * pow(clampf(t / end_time(), 0.0, 1.0), 1.6)
