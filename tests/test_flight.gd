extends TestCase


func test_speed_grows_with_altitude() -> void:
	var last := 0.0
	for alt in [0.0, 10.0, 1.0e3, 1.0e5, 1.0e7, 1.0e9, 1.0e12, 1.0e16]:
		var v := Flight.max_speed(alt)
		check(v >= last, "speed should not drop as altitude rises (alt %s)" % alt)
		last = v


func test_slow_near_surface_fast_in_deep_space() -> void:
	check(Flight.max_speed(1.0) <= 5.0, "walking pace just above ground")
	check(Flight.max_speed(4.0e5) < 3.0e5, "low orbit is a few hundred km/s at most")
	check(Flight.max_speed(4.0e16) > 2.99792458e8 * 1000.0, "interstellar space allows > 1000 c")


func test_black_hole_approach_is_slower() -> void:
	check(Flight.max_speed(1.0e10, 0, true) < Flight.max_speed(1.0e10, 0, false) * 0.5,
		"same altitude is slower near a black hole")


func test_throttle_doubles_speed() -> void:
	check_rel(Flight.max_speed(1.0e8, 1), 2.0 * Flight.max_speed(1.0e8, 0), 1e-9, "throttle +1 doubles")
