extends TestCase


func _flare(star: Vector3, occluders: Array) -> Dictionary:
	return LensFlareMath.compute(star, 1.0, Vector3(0, 0, -1), Vector3(1, 0, 0), Vector3(0, 1, 0), deg_to_rad(70.0), 16.0 / 9.0, occluders)


func test_flare_follows_the_star_and_hides_behind_you() -> void:
	var ahead := _flare(Vector3(0, 0, -100), [])
	check(ahead["visible"], "star straight ahead flares")
	check(ahead["ndc"].length() < 1.0e-5, "at the centre of the screen")
	check(not _flare(Vector3(0, 0, 100), [])["visible"], "no flare for a star behind you")


func test_planet_in_front_eclipses_the_star() -> void:
	var star := Vector3(0, 0, -1000)
	check(not _flare(star, [[Vector3(0, 0, -50), 10.0]])["visible"], "a planet covering the star blocks it")
	var grazing := _flare(star, [[Vector3(10.0, 0, -50), 10.0 * 0.995]])
	check(grazing["diamond_ring"] > 0.3, "the star's edge peeking past the limb flashes")
	var beside := _flare(star, [[Vector3(30, 0, -50), 5.0]])
	check_near(beside["visibility"], 1.0, 1.0e-6, "a planet off to the side changes nothing")
