extends TestCase


func test_pull_is_weak_far_out_and_strong_at_horizon() -> void:
	var rs := 1.27e10
	check_rel(PlungeMath.pull_speed(rs, rs), PlungeMath.PULL_AT_HORIZON * rs, 1e-9, "pull at the horizon")
	check(PlungeMath.pull_speed(10.0 * rs, rs) < 0.011 * PlungeMath.pull_speed(rs, rs), "inverse square falloff")
	# At 10 rs the jetpack (altitude-scaled, damped near the hole) easily beats the pull.
	check(Flight.max_speed(9.0 * rs, 0, true) > 100.0 * PlungeMath.pull_speed(10.0 * rs, rs), "escapable at 10 rs")
	# Just above the horizon it cannot, even boosting at default throttle.
	check(Flight.max_speed(0.01 * rs, 0, true) * 4.0 < PlungeMath.pull_speed(1.01 * rs, rs), "no escape at 1.01 rs")


func test_fall_only_goes_inward() -> void:
	check_rel(PlungeMath.radius_fraction(0.0), 1.0, 1e-9, "starts at the horizon")
	check_rel(PlungeMath.radius_fraction(1.0), PlungeMath.DEEPEST, 1e-9, "ends at the deepest point")
	var last := 1.0
	for i in range(1, 101):
		var f := PlungeMath.radius_fraction(i / 100.0)
		check(f < last, "radius must keep shrinking (step %d)" % i)
		last = f
