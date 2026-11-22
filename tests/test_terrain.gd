extends TestCase


func test_body_frame_round_trip_and_matches_mesh_orientation() -> void:
	var tilt := deg_to_rad(23.44)
	var angle := 1.234
	var v := DVec3.new(0.3, -0.8, 0.52)
	var back := BodyFrame.to_fixed(BodyFrame.to_world(v, tilt, angle), tilt, angle)
	check_rel(back.x, v.x, 1e-12, "round trip x")
	check_rel(back.y, v.y, 1e-12, "round trip y")
	check_rel(back.z, v.z, 1e-12, "round trip z")
	# Same rotation SpaceView gives the mesh.
	var basis := Basis(Vector3.FORWARD, tilt) * Basis(Vector3.UP, angle)
	var expect := basis * v.to_vector3()
	var got := BodyFrame.to_world(v, tilt, angle).to_vector3()
	check(expect.distance_to(got) < 1e-5, "matches the mesh basis")
	check(BodyFrame.axis(tilt).distance_to(basis * Vector3.UP) < 1e-5, "spin axis matches")


func test_tile_wraps_and_is_smooth() -> void:
	check_rel(TerrainField.tile_sample(0.25, 0.6), TerrainField.tile_sample(1.25, -0.4), 1e-6, "tile repeats")
	var a := TerrainField.tile_sample(0.4, 0.4)
	var b := TerrainField.tile_sample(0.4 + 1e-6, 0.4)
	check(absf(a - b) < 1e-3, "no jumps between neighbouring samples")
	check(a >= 0.0 and a <= 1.0, "values stay in 0..1")


func test_ground_is_continuous_and_above_base_radius() -> void:
	var f := TerrainField.new(6.371e6, 4500.0)
	var d := DVec3.new(0.3, 0.5, 0.81).normalized()
	var h := f.height(d)
	check(h >= 0.0 and h < 4500.0 * 2.0, "height within the expected range")
	# One centimetre along the ground changes the height by far less than a centimetre-scale cliff.
	var step := 0.01 / 6.371e6
	var h2 := f.height(DVec3.new(d.x + step, d.y, d.z))
	check(absf(h2 - h) < 0.05, "no cliffs between points a centimetre apart (got %s)" % absf(h2 - h))


func test_gas_giants_have_no_ground() -> void:
	check(TerrainField.has_terrain({"kind": "planet", "archetype": "mars", "landable": true}), "Mars has ground")
	check(not TerrainField.has_terrain({"kind": "planet", "archetype": "jupiter", "landable": true}), "Jupiter does not")
	check(not TerrainField.has_terrain({"kind": "star", "archetype": "star-g", "landable": false}), "stars do not")
