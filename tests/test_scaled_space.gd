extends TestCase

const ALTITUDES := [0.0, 2.0, 1.0e3, 4.0e5, 1.2e7, 1.0e11, 1.0e17]


func test_near_plane_follows_altitude() -> void:
	check(ScaledSpace.for_altitude(2.0).near == ScaledSpace.MIN_NEAR, "5 cm near plane on the ground")
	check(ScaledSpace.for_altitude(4.0e5).near > 1000.0, "kilometre near plane in orbit")
	for alt in ALTITUDES:
		var s := ScaledSpace.for_altitude(alt)
		check(s.far / s.near <= 1.0e7, "far/near stays inside what the renderer handles (alt %s)" % alt)


func test_no_compression_up_close() -> void:
	var s := ScaledSpace.for_altitude(1.0e3)
	check(s.render_distance(s.limit * 0.5) == s.limit * 0.5, "below the limit, true distance")
	check(s.scale_factor(s.limit) == 1.0, "limit itself is uncompressed")


func test_monotonic_so_depth_order_is_kept() -> void:
	for alt in ALTITUDES:
		var s := ScaledSpace.for_altitude(alt)
		var last := 0.0
		for d in [1.0, 1.0e4, 1.0e7, 5.0e7, 6.0e7, 1.0e9, 1.5e11, 4.1e16, 2.5e20]:
			var r := s.render_distance(d)
			check(r > last, "render distance increases at %s (alt %s)" % [d, alt])
			last = r


func test_preserves_angular_size() -> void:
	var s := ScaledSpace.for_altitude(2.0)
	var d := 1.496e11 # Sun seen from Earth's surface
	var radius := 6.9634e8
	check_rel((radius * s.scale_factor(d)) / s.render_distance(d), radius / d, 1e-9, "same angular size")


func test_whole_galaxy_fits_inside_far_plane() -> void:
	for alt in ALTITUDES:
		var s := ScaledSpace.for_altitude(alt)
		check(s.render_distance(2.6e20) < s.far, "galactic centre fits (alt %s)" % alt)
