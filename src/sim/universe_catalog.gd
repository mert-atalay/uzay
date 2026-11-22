class_name UniverseCatalog
extends RefCounted
## The star systems and bodies from data/universe.json, plus where they are at a given time.
##
## Positions are in metres, in a frame centred on each system's primary star (or black hole).
## Systems themselves sit at their real distance from Sol; we never add light-year scale
## numbers to metre-scale ones, so precision is kept (see system_offset).

const DATA_PATH := "res://data/universe.json"

var constants: Dictionary = {}
var systems: Array = []
var bodies: Array = []
var systems_by_id: Dictionary = {}
var bodies_by_id: Dictionary = {}
var _bodies_by_system: Dictionary = {}


static func load_default() -> UniverseCatalog:
	var catalog := UniverseCatalog.new()
	var err := catalog.load_file(DATA_PATH)
	assert(err == OK, "Could not load %s" % DATA_PATH)
	return catalog


func load_file(path: String) -> Error:
	var text := FileAccess.get_file_as_string(path)
	if text.is_empty():
		return ERR_FILE_NOT_FOUND
	var parsed: Variant = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		return ERR_PARSE_ERROR
	constants = parsed["constants"]
	systems = parsed["systems"]
	bodies = parsed["bodies"]
	for s in systems:
		systems_by_id[s["id"]] = s
		_bodies_by_system[s["id"]] = []
	for b in bodies:
		bodies_by_id[b["id"]] = b
		_bodies_by_system[b["system"]].append(b)
	return OK


func body(id: String) -> Dictionary:
	return bodies_by_id.get(id, {})


func system(id: String) -> Dictionary:
	return systems_by_id.get(id, {})


func bodies_in_system(system_id: String) -> Array:
	return _bodies_by_system.get(system_id, [])


## The body with no parent: the star (or black hole) at the system's origin.
func primary_of(system_id: String) -> Dictionary:
	for b in bodies_in_system(system_id):
		if b["parent"] == null:
			return b
	return {}


## Position of a body at time t (seconds), in metres, relative to its system's primary.
func body_position(id: String, t: float) -> DVec3:
	var b: Dictionary = bodies_by_id[id]
	if b["parent"] == null:
		return DVec3.new()
	return body_position(b["parent"], t).add(Kepler.offset_at(b["orbit"], t))


## Vector from one system's origin to another's, in metres.
## Only used for direction and distance of far-away stars, never added to local positions.
func system_offset(from_id: String, to_id: String) -> DVec3:
	var ly: float = constants["LY"]
	var a: Dictionary = systems_by_id[from_id]
	var b: Dictionary = systems_by_id[to_id]
	var pa := DVec3.new(a["direction"]["x"], a["direction"]["y"], a["direction"]["z"]).scaled(a["distance_ly"] * ly)
	var pb := DVec3.new(b["direction"]["x"], b["direction"]["y"], b["direction"]["z"]).scaled(b["distance_ly"] * ly)
	return pb.sub(pa)


static func color_of(hex: Variant, fallback: Color = Color.WHITE) -> Color:
	if typeof(hex) != TYPE_STRING or hex == "":
		return fallback
	return Color.html(hex)
