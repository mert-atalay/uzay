class_name Story
extends Node
## The reason to fly: something is coming that will unmake the Solar System, and nobody can
## tell you how to stop it. This keeps the story clock, says the lines (Earth's dispatcher and your own
## thoughts) as it gets closer, and remembers what you did inside the black hole.
## Where the thing is and what it has eaten is StoryMath; this is the part with state.

signal line(who: String, text: String)
signal saved

enum State { COMING, SAVED }

## What you can reach for inside the tesseract.
enum Choice { NONE = -1, THEN, NOW, IT }

const SYSTEM := "sol"
## When the thing gets its marker on your visor.
const MARKER_TIME := 0.0

## What Dispatch says ten seconds in, before your head is turned to it, and what you think
## once you have looked.
const OPENING := "EVA One, Earth Dispatch. For the record: what you are doing up there is brave, and it will not matter. It is already here. We were too late before we knew its name. Look at it."
const AFTER_OPENING := "There it is. Everyone I have ever met is underneath that. I did not come up here with a plan. I came because the answer is not on the ground."

## [seconds, who, text]. "dispatch" is Earth, "self" is the astronaut thinking. Everyone has
## known it was coming for weeks: you are out here looking for a way to stop it, with no idea
## what that could be. Nothing here may ever say where to look.
const LINES := [
	[55.0, "self", "No ship. No body. A face, cut into the sky itself, and wider than everything the Sun holds."],
	[120.0, "dispatch", "Forty days and it has not changed speed. It does not turn toward anything we send. We are not being attacked, EVA One. We are in the way."],
	[190.0, "dispatch", "We are keeping its range on your visor. I am not sure why. So that someone is counting, I suppose."],
	[246.0, "dispatch", "Pluto is gone. No debris, no flash. It was there, and then the sky closed over the place where it was."],
	[330.0, "self", "It does not break things. It unmakes them. Even the dark around it is the wrong kind of dark."],
	[426.0, "dispatch", "Neptune. Eleven minutes of telemetry, then nothing. It is not hurrying. It does not need to."],
	[520.0, "dispatch", "They asked me what you are looking for out there. I said you would know it when you saw it. Tell me I was not lying."],
	[606.0, "dispatch", "Uranus is gone."],
	[700.0, "self", "I keep landing on things as if the answer might be lying on the ground somewhere. It looks the same from every world. Bigger."],
	[816.0, "self", "Saturn. The rings went first, like thread pulled off a spool."],
	[920.0, "self", "Nothing we have built can stop it. Nothing we know can. Whatever would save us is not anywhere I have been."],
	[1026.0, "dispatch", "Jupiter is gone. It fills half the night here now. Nobody screams any more. They stand in the street and watch it not watching them."],
	[1150.0, "dispatch", "In all this time it has not once looked at us. I think that is the worst of it."],
	[1266.0, "dispatch", "The last thing Mars sent was one word. \"Beautiful.\" I do not know what to do with that."],
	[1450.0, "dispatch", "It is past the Moon. I am staying at the desk. Somebody should be here. EVA One, it was good flying with you."],
	[1626.0, "self", "Dispatch? ... Dispatch."],
	[1680.0, "self", "There is no one left to tell me it will not matter."],
	[1776.0, "self", "Venus. Then Mercury. It is not even tidying up. It is just passing through."],
	[2046.0, "self", "It put out the Sun the way you would walk through a cobweb."],
	[2130.0, "self", "Only me now. Me, and whatever is too far away or too deep for it to pass over."],
]

## What each window in the tesseract opens on, in Choice order.
const CHOICE_CAPTIONS: Array[String] = [
	"Earth, a thousand years ago. Someone is looking up at the stars.",
	"Earth, this morning. The dispatch desk, before the first star went out.",
	"The thing itself, before there was a sky to carve it in.",
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


## True once this body, or the world it circles, has been eaten.
func is_eaten(id: String) -> bool:
	if state != State.COMING:
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
			say("self", "For a moment I thought it saw me. It did not. But it is closer than it was.")
