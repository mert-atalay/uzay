class_name TerrainField
extends RefCounted
## Height of the ground on a body, as a function of the planet-fixed direction from its centre.
## The same formula runs in `shaders/terrain.gdshader` (to draw the ground) and here on the CPU
## (so your feet land exactly on what is drawn). Keep the two in step.
##
## The planet is mapped onto a cube. On each face, six layers of one small tileable noise image
## are added up, each layer ten times finer than the last: 400 km continents-scale swells down
## to 4 m bumps. Coordinates are wrapped per layer in 64-bit before any 32-bit maths, which is
## what keeps centimetre detail stable on a 12,000 km wide world.

const TILE := 128
const LAYERS := 6
const PERIODS: Array[float] = [400000.0, 40000.0, 4000.0, 400.0, 40.0, 4.0]

static var _tile: PackedFloat32Array
static var _tile_mean := 0.5

var radius: float
## Height of the biggest mountains above the lowest plains, in metres.
var relief: float
## Optional land mask (Earth): 1 = land, 0 = sea. Sampled by latitude and longitude.
var ocean_image: Image


func _init(body_radius: float, body_relief: float) -> void:
	radius = body_radius
	relief = body_relief


## How rugged a body is. Small moons get gentler relief so it stays in proportion.
static func relief_for(b: Dictionary) -> float:
	var r: float = b["radius_m"]
	var base := 4500.0
	match b["archetype"]:
		"mars", "exo-desert": base = 7000.0
		"moon", "mercury", "callisto": base = 3500.0
		"europa", "enceladus", "exo-ice", "exo-ocean": base = 900.0
		"venus", "titan": base = 3000.0
		"io", "exo-lava": base = 5000.0
	return minf(base, r * 0.004)


static func has_terrain(b: Dictionary) -> bool:
	return b["kind"] in ["planet", "moon", "dwarf-planet", "asteroid"] and b.get("landable", false) \
		and not (b["archetype"] in ["jupiter", "saturn", "uranus", "neptune"])


## The shared noise image: TILE × TILE values in 0..1 that wrap seamlessly.
static func tile_data() -> PackedFloat32Array:
	if not _tile.is_empty():
		return _tile
	var rng := RandomNumberGenerator.new()
	rng.seed = 20261122
	var out := PackedFloat32Array()
	out.resize(TILE * TILE)
	var amp := 1.0
	for cells: int in [4, 8, 16, 32]:
		var lattice := PackedFloat32Array()
		lattice.resize(cells * cells)
		for i in lattice.size():
			lattice[i] = rng.randf()
		var scale := float(cells) / TILE
		for y in TILE:
			var fy := y * scale
			var y0 := int(fy)
			var ty := fy - y0
			ty = ty * ty * (3.0 - 2.0 * ty)
			var row0 := (y0 % cells) * cells
			var row1 := ((y0 + 1) % cells) * cells
			for x in TILE:
				var fx := x * scale
				var x0 := int(fx)
				var tx := fx - x0
				tx = tx * tx * (3.0 - 2.0 * tx)
				var xa := x0 % cells
				var xb := (x0 + 1) % cells
				var top := lerpf(lattice[row0 + xa], lattice[row0 + xb], tx)
				var bottom := lerpf(lattice[row1 + xa], lattice[row1 + xb], tx)
				out[y * TILE + x] += amp * lerpf(top, bottom, ty)
		amp *= 0.5
	var lo := INF
	var hi := -INF
	for v in out:
		lo = minf(lo, v)
		hi = maxf(hi, v)
	var total := 0.0
	for i in out.size():
		out[i] = (out[i] - lo) / (hi - lo)
		total += out[i]
	_tile_mean = total / out.size()
	_tile = out
	return _tile


static func tile_mean() -> float:
	tile_data()
	return _tile_mean


## Sample the tile at (x, y) in tile units (1 = one full repeat) with a cubic B-spline,
## exactly as the shader does.
static func tile_sample(x: float, y: float) -> float:
	var t := tile_data()
	var px := fposmod(x, 1.0) * TILE - 0.5
	var py := fposmod(y, 1.0) * TILE - 0.5
	var x0 := floori(px)
	var y0 := floori(py)
	var wx := _bspline(px - x0)
	var wy := _bspline(py - y0)
	var total := 0.0
	for j in 4:
		var row := posmod(y0 - 1 + j, TILE) * TILE
		var acc := 0.0
		for i in 4:
			acc += wx[i] * t[row + posmod(x0 - 1 + i, TILE)]
		total += wy[j] * acc
	return total


static func _bspline(f: float) -> Array[float]:
	var f2 := f * f
	var g := 1.0 - f
	return [g * g * g / 6.0, (3.0 * f2 * f - 6.0 * f2 + 4.0) / 6.0, (-3.0 * f2 * f + 3.0 * f2 + 3.0 * f + 1.0) / 6.0, f2 * f / 6.0]


## Which cube face a direction is on, and how its axes are ordered there.
## Returns [a, b, m]: m is the dominant axis (0 = x, 1 = y, 2 = z), a and b the other two.
static func face_axes(d: DVec3) -> Array[int]:
	var ax := absf(d.x)
	var ay := absf(d.y)
	var az := absf(d.z)
	var m := 0
	if ay >= ax and ay >= az:
		m = 1
	elif az >= ax and az >= ay:
		m = 2
	return [(m + 1) % 3, (m + 2) % 3, m]


static func component(d: DVec3, i: int) -> float:
	return d.x if i == 0 else (d.y if i == 1 else d.z)


## Where each noise layer is sampled for the direction `d` (planet-fixed, any length):
## LAYERS pairs of tile coordinates in 0..1.
func layer_coords(d: DVec3) -> PackedVector2Array:
	var f := face_axes(d)
	var major := component(d, f[2])
	var u := component(d, f[0]) / major * radius
	var v := component(d, f[1]) / major * radius
	var face := f[2] * 2 + (1 if major < 0.0 else 0)
	var out := PackedVector2Array()
	for l in LAYERS:
		var p := Vector2(
			fposmod((v if l % 2 == 1 else u) / PERIODS[l] + 0.13 * l + 0.37 * face, 1.0),
			fposmod((u if l % 2 == 1 else v) / PERIODS[l] + 0.71 * l + 0.19 * face, 1.0))
		out.append(p)
	return out


## Combine the six layer values (each 0..1) into a height in metres. Mirrors the shader.
func combine(n: PackedFloat32Array) -> float:
	return relief * (n[0] * n[0] + (0.3 + 1.4 * n[0]) * (0.32 * n[1] + 0.06 * n[2])
		+ 0.004 * n[3] + 0.0004 * n[4] + 0.00004 * n[5])


## 1 on land, 0 at sea, for a planet-fixed direction. Always 1 without a mask.
func land(d: DVec3) -> float:
	if ocean_image == null:
		return 1.0
	var len := d.length()
	var u := fposmod(atan2(d.x, d.z) / TAU, 1.0)
	var v := acos(clampf(d.y / len, -1.0, 1.0)) / PI
	var w := ocean_image.get_width()
	var h := ocean_image.get_height()
	var px := u * w - 0.5
	var py := clampf(v * h - 0.5, 0.0, h - 1.001)
	var x0 := floori(px)
	var y0 := floori(py)
	var fx := px - x0
	var fy := py - y0
	var a := ocean_image.get_pixel(posmod(x0, w), y0).r
	var b := ocean_image.get_pixel(posmod(x0 + 1, w), y0).r
	var c := ocean_image.get_pixel(posmod(x0, w), mini(y0 + 1, h - 1)).r
	var e := ocean_image.get_pixel(posmod(x0 + 1, w), mini(y0 + 1, h - 1)).r
	var sea := lerpf(lerpf(a, b, fx), lerpf(c, e, fx), fy)
	return smoothstep(0.35, 0.65, 1.0 - sea)


## Ground height above the body's base radius, in metres, for a planet-fixed direction.
func height(d: DVec3) -> float:
	var coords := layer_coords(d)
	var n := PackedFloat32Array()
	n.resize(LAYERS)
	for l in LAYERS:
		n[l] = tile_sample(coords[l].x, coords[l].y)
	return combine(n) * land(d)
