extends TestCase

const AU := StoryMath.AU


## Worlds standing in a row, one per entry in ORDER, each closer to the Sun than the last.
func _nodes() -> Array:
	var out := []
	for i in StoryMath.ORDER.size():
		out.append(DVec3.new((StoryMath.ORDER.size() - 1 - i) * 4.0 * AU, 0.0, 0.0))
	return out


func test_schedule_is_in_order_and_ends_at_the_sun() -> void:
	check(StoryMath.ORDER.size() == StoryMath.EAT_TIMES.size(), "one time per world")
	for i in range(1, StoryMath.EAT_TIMES.size()):
		check(StoryMath.EAT_TIMES[i] > StoryMath.EAT_TIMES[i - 1], "times increase (%d)" % i)
	check(StoryMath.ORDER[StoryMath.ORDER.size() - 1] == "sun", "the Sun goes last")
	check(StoryMath.ORDER.find("earth") > StoryMath.ORDER.find("jupiter"), "outer worlds first")


func test_head_reaches_each_world_on_time() -> void:
	var nodes := _nodes()
	check_rel(StoryMath.head_position(0.0, nodes).length(), StoryMath.START.length(), 1e-6, "starts far out")
	for i in StoryMath.EAT_TIMES.size():
		var head := StoryMath.head_position(StoryMath.EAT_TIMES[i] - 1e-3, nodes)
		check(head.sub(nodes[i]).length() < 0.01 * AU, "at world %d when it is eaten" % i)
		check(not StoryMath.is_eaten_index(i, StoryMath.EAT_TIMES[i] - 1.0), "world %d still there just before" % i)
		check(StoryMath.is_eaten_index(i, StoryMath.EAT_TIMES[i]), "world %d gone on time" % i)
	check(StoryMath.eaten_count(0.0) == 0, "nothing eaten at the start")
	check(StoryMath.eaten_count(StoryMath.end_time()) == StoryMath.ORDER.size(), "everything eaten at the end")


func test_it_only_gets_closer_to_its_next_meal() -> void:
	var nodes := _nodes()
	var last := INF
	for step in 60:
		var t := StoryMath.EAT_TIMES[0] * step / 60.0
		var d := StoryMath.head_position(t, nodes).sub(nodes[0]).length()
		check(d <= last, "never backs away (step %d)" % step)
		last = d


func test_heading_is_a_unit_vector_and_turns_smoothly() -> void:
	var nodes := _nodes()
	nodes[1] = DVec3.new(20.0 * AU, 9.0 * AU, 3.0 * AU)
	var before := StoryMath.heading(StoryMath.EAT_TIMES[0] - 0.01, nodes)
	var after := StoryMath.heading(StoryMath.EAT_TIMES[0] + 0.01, nodes)
	check_near(before.length(), 1.0, 1e-4, "unit heading")
	check(before.dot(after) > 0.999, "no snap when it turns for the next world")


func test_distance_is_negative_inside_and_grows_outside() -> void:
	var head := DVec3.new(5.0 * AU, 0.0, 0.0)
	var heading := Vector3(-1.0, 0.0, 0.0)
	# Half-way down its body, on the axis: inside.
	check(StoryMath.distance_to(DVec3.new(5.0 * AU + 0.5 * StoryMath.LENGTH, 0.0, 0.0), head, heading) < 0.0, "inside the body")
	var near := StoryMath.distance_to(DVec3.new(5.0 * AU, 0.2 * AU, 0.0), head, heading)
	var far := StoryMath.distance_to(DVec3.new(5.0 * AU, 2.0 * AU, 0.0), head, heading)
	check(near > 0.0 and far > near, "outside, and farther is farther")
	check_rel(far, 2.0 * AU - StoryMath.RADIUS, 1e-3, "distance to the skin beside the head")


func test_the_hole_in_the_sky_only_grows() -> void:
	var last := 0.0
	for step in 50:
		var r := StoryMath.void_radius(StoryMath.end_time() * step / 49.0)
		check(r > last, "grows (step %d)" % step)
		last = r
	check(StoryMath.void_radius(0.0) < 0.05, "barely there at first")
	check(last < PI, "never the whole sky")
