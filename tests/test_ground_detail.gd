extends TestCase
## Clouds and rocks: the bits of their maths that do not need a scene.


func test_cloud_layer_fades_out_as_you_pass_through_it() -> void:
	check_near(CloudLayer.amount_at(0.0), 1.0, 1.0e-6, "full strength on the ground")
	check_near(CloudLayer.amount_at(CloudLayer.LAYER_ALTITUDE), 0.0, 1.0e-6, "gone inside the layer")
	check_near(CloudLayer.amount_at(CloudLayer.LAYER_ALTITUDE * 2.0), 1.0, 1.0e-6, "back as a deck below you")
	check_near(CloudLayer.amount_at(CloudLayer.FADE_END + 1.0), 0.0, 1.0e-6, "handed over to the painted clouds")


func test_rock_placement_is_repeatable_and_spread_out() -> void:
	var total := 0.0
	for i in 2000:
		var seed_value := SurfaceRocks._hash(i, -i * 3, 1)
		var r := SurfaceRocks._rand(seed_value, 1)
		check(r >= 0.0 and r < 1.0, "random numbers stay in 0..1")
		total += r
	check_near(total / 2000.0, 0.5, 0.05, "and average out to a half")
	check(SurfaceRocks._hash(12, -7, 3) == SurfaceRocks._hash(12, -7, 3), "same cell, same rock")


func test_time_runs_slower_near_the_horizon() -> void:
	var rs := 1.0e10
	check_near(Hud.time_dilation(rs * 1.0e6, rs), 1.0, 1.0e-5, "far away clocks agree")
	check_rel(Hud.time_dilation(rs / 3.0, rs), 2.0, 1.0e-9, "at 4/3 of the horizon radius time runs at half speed")
	check(Hud.time_dilation(rs * 0.001, rs) > 30.0, "close to the horizon an hour is more than a day")
