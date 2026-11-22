class_name Story
extends Node
## The reason to fly: something is coming to eat the Solar System, and nobody tells you how to
## stop it. This keeps the story clock, says the lines (Earth's dispatcher and your own
## thoughts) as it gets closer, and remembers what you did inside the black hole.
## Where the thing is and what it has eaten is StoryMath; this is the part with state.

signal line(who: String, text: String)
signal swallowed
signal saved

enum State { COMING, SWALLOWED, SAVED }

## What you can reach for inside the tesseract.
enum Choice { NONE = -1, THEN, NOW, IT }

const SYSTEM := "sol"
## When the thing gets its marker on your visor.
const MARKER_TIME := 200.0

## [seconds, who, text]. "dispatch" is Earth, "self" is the astronaut thinking.
const LINES := [
	[14.0, "dispatch", "EVA One, Earth Dispatch. The deep-field arrays just lost forty stars out past Pluto. Not dimmed. Gone. Stand by."],
	[75.0, "dispatch", "It is not a fault. Something is in front of those stars, and it is moving. It is moving this way."],
	[140.0, "self", "A patch of sky with nothing in it. I keep looking at it. I think it is looking back."],
	[200.0, "dispatch", "We have marked it on your visor. The size estimate has to be wrong. It says the Sun would fit in its mouth."],
	[246.0, "dispatch", "Pluto is gone. There is no debris, no flash. It is simply not there any more."],
	[330.0, "self", "It does not break things. It unmakes them. Even the dark it leaves behind is the wrong kind of dark."],
	[426.0, "dispatch", "Neptune. Eleven minutes of telemetry, then nothing. It is not hurrying. It does not need to."],
	[520.0, "dispatch", "Every ship and every warhead we have would not leave a mark. People are just going outside and looking up."],
	[606.0, "dispatch", "Uranus is gone."],
	[700.0, "dispatch", "EVA One, you are the only one of us not standing on something it wants. If you can think of anything, anything at all, now is the time."],
	[816.0, "self", "Saturn. The rings went first, like thread pulled off a spool."],
	[920.0, "self", "Nothing we have built can stop it. Nothing we know can. Whatever would save us is not anywhere I have been."],
	[1026.0, "dispatch", "Jupiter is gone. You can see it from the ground now, without a telescope. A hole in the sky with an edge."],
	[1150.0, "dispatch", "The children are asking what the stars were. We do not have long. I do not know what to tell you to do."],
	[1266.0, "dispatch", "The last thing Mars sent was one word. \"Beautiful.\" I do not know what to do with that."],
	[1450.0, "dispatch", "It is past the Moon. I am staying at the desk. Somebody should be here. EVA One, it was good flying with you."],
	[1626.0, "self", "Dispatch? ... Dispatch."],
	[1680.0, "self", "There is no one left to tell me what to do."],
	[1776.0, "self", "Venus. Then Mercury. It is tidying up."],
	[2046.0, "self", "It put out the Sun the way you would blow out a candle."],
	[2130.0, "self", "Only me now. Me, and whatever is too far away or too deep for it to reach."],
]

## What each window in the tesseract opens on, in Choice order.
const CHOICE_CAPTIONS: Array[String] = [
	"Earth, a thousand years ago. Someone is looking up at the stars.",
	"Earth, this morning. The dispatch desk, before the first star went out.",
	"The thing itself, long before it was hungry.",
]

var state := State.COMING
## Seconds of play since the thing was first seen.
var time := 0.0
## Stops the clock (inside the black hole, where time is not yours any more).
var paused := false
var _next_line := 0
var _catalog: UniverseCatalog


func _ready() -> void:
	_catalog = Universe.catalog


func _process(delta: float) -> void:
	if state != State.COMING or paused:
		return
	time += delta
	while _next_line < LINES.size() and time >= float(LINES[_next_line][0]):
		# After a jump in time only the newest line is worth saying.
		if _next_line == LINES.size() - 1 or time < float(LINES[_next_line + 1][0]):
			line.emit(LINES[_next_line][1], LINES[_next_line][2])
		_next_line += 1


func say(who: String, text: String) -> void:
	line.emit(who, text)


## Jump the clock (the screenshot tool, and the price of a bad choice).
func set_time(t: float) -> void:
	time = maxf(t, 0.0)
	_next_line = 0
	while _next_line < LINES.size() and time >= float(LINES[_next_line][0]):
		_next_line += 1


func coming() -> bool:
	return state == State.COMING


func marker_shown() -> bool:
	return coming() and time >= MARKER_TIME


## Current positions of the worlds on its list, Sun-centred.
func _nodes() -> Array:
	var out := []
	for id in StoryMath.ORDER:
		out.append(_catalog.body_position(id, Universe.sim_time))
	return out


func head() -> DVec3:
	return StoryMath.head_position(time, _nodes())


func heading() -> Vector3:
	return StoryMath.heading(time, _nodes())


## True once this body, or the world it circles, has been eaten.
func is_eaten(id: String) -> bool:
	if state != State.COMING and state != State.SWALLOWED:
		return false
	var b := _catalog.body(id)
	while not b.is_empty() and b["system"] == SYSTEM:
		var i := StoryMath.ORDER.find(b["id"])
		if i >= 0:
			return StoryMath.is_eaten_index(i, time)
		if b["parent"] == null:
			return false
		b = _catalog.body(b["parent"])
	return false


func earth_is_gone() -> bool:
	return is_eaten("earth")


func be_swallowed() -> void:
	if state == State.COMING:
		state = State.SWALLOWED
		swallowed.emit()


## Start over after it has eaten you.
func restart() -> void:
	state = State.COMING
	set_time(0.0)


## What your reach through the tesseract did, once you are back out.
func apply_choice(choice: Choice) -> void:
	match choice:
		Choice.THEN:
			state = State.SAVED
			saved.emit()
		Choice.NOW:
			set_time(time + 60.0)
			say("self", "I warned them this morning. I gave them a few more hours to be afraid. That is all I gave them.")
		Choice.IT:
			set_time(time + 300.0)
			say("self", "It felt me. It knows the way now. It is closer than it was.")
