extends Node
## Autoload "Universe": the shared catalog plus the simulation clock.

## Simulation time in seconds since the data epoch.
var sim_time: float = 0.0
## How many simulated seconds pass per real second.
var time_scale: float = 1.0

var catalog: UniverseCatalog

const TIME_SCALES: Array[float] = [1.0, 60.0, 3600.0, 86400.0, 0.0]


func _ready() -> void:
	catalog = UniverseCatalog.load_default()


func _process(delta: float) -> void:
	sim_time += delta * time_scale


func cycle_time_scale() -> void:
	var i := TIME_SCALES.find(time_scale)
	time_scale = TIME_SCALES[(i + 1) % TIME_SCALES.size()]
