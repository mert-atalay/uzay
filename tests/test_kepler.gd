extends TestCase


func test_solves_keplers_equation() -> void:
	for e in [0.0, 0.0167, 0.2, 0.5, 0.88, 0.97]:
		for m in [-3.0, -1.0, 0.0, 0.5, 2.0, 3.1]:
			var ecc := Kepler.solve_eccentric_anomaly(m, e)
			check_near(ecc - e * sin(ecc), fposmod(m + PI, TAU) - PI, 1e-10, "M=%s e=%s" % [m, e])


func test_circular_orbit_keeps_constant_radius() -> void:
	var orbit := _orbit(1.0e9, 0.0, 1e-6)
	for t in [0.0, 1.0e5, 2.5e6, 7.0e6]:
		check_rel(Kepler.offset_at(orbit, t).length(), 1.0e9, 1e-12, "radius at t=%s" % t)


func test_periapsis_and_apoapsis_distances() -> void:
	var orbit := _orbit(1.0e11, 0.5, 1e-7)
	var peri := Kepler.offset_at(orbit, 0.0).length()
	var apo := Kepler.offset_at(orbit, PI / 1e-7).length()
	check_rel(peri, 0.5e11, 1e-9, "periapsis = a(1-e)")
	check_rel(apo, 1.5e11, 1e-9, "apoapsis = a(1+e)")


func test_second_law_faster_at_periapsis() -> void:
	var orbit := _orbit(1.0e11, 0.6, 1e-7)
	var dt := 10.0
	var v_peri := Kepler.offset_at(orbit, dt).sub(Kepler.offset_at(orbit, 0.0)).length() / dt
	var t_apo := PI / 1e-7
	var v_apo := Kepler.offset_at(orbit, t_apo + dt).sub(Kepler.offset_at(orbit, t_apo)).length() / dt
	check(v_peri > 3.0 * v_apo, "periapsis speed %s should far exceed apoapsis speed %s" % [v_peri, v_apo])


func test_inclination_lifts_orbit_out_of_plane() -> void:
	var orbit := _orbit(1.0e9, 0.0, 1e-6)
	orbit["inclination_rad"] = PI / 2.0
	var p := Kepler.offset_at(orbit, (PI / 2.0) / 1e-6)
	check_rel(absf(p.y), 1.0e9, 1e-9, "90° inclination puts the quarter-orbit point straight up")


func _orbit(a: float, e: float, n: float) -> Dictionary:
	return {
		"semi_major_axis_m": a, "eccentricity": e, "inclination_rad": 0.0,
		"arg_periapsis_rad": 0.0, "ascending_node_rad": 0.0,
		"mean_anomaly_epoch_rad": 0.0, "mean_motion_rad_s": n,
	}
