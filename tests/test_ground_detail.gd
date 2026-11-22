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
