extends TestCase

const AU := StoryMath.AU


func test_schedule_is_in_order_and_ends_at_the_sun() -> void:
	check(StoryMath.ORDER.size() == StoryMath.EAT_TIMES.size(), "one time per world")
	for i in range(1, StoryMath.EAT_TIMES.size()):
		check(StoryMath.EAT_TIMES[i] > StoryMath.EAT_TIMES[i - 1], "times increase (%d)" % i)
	check(StoryMath.ORDER[StoryMath.ORDER.size() - 1] == "sun", "the Sun goes last")
	check(StoryMath.ORDER.find("earth") > StoryMath.ORDER.find("jupiter"), "outer worlds first")


func test_worlds_go_on_schedule() -> void:
	for i in StoryMath.EAT_TIMES.size():
		check(not StoryMath.is_eaten_index(i, StoryMath.EAT_TIMES[i] - 1.0), "world %d still there just before" % i)
		check(StoryMath.is_eaten_index(i, StoryMath.EAT_TIMES[i]), "world %d gone on time" % i)
	check(StoryMath.eaten_count(0.0) == 0, "nothing eaten at the start")
	check(StoryMath.eaten_count(StoryMath.end_time()) == StoryMath.ORDER.size(), "everything eaten at the end")


func test_it_only_ever_comes_closer() -> void:
	var last := INF
	for step in 60:
		var d := StoryMath.distance(StoryMath.end_time() * step / 59.0)
		check(d < last, "closer every step (%d)" % step)
		last = d
	check_rel(StoryMath.distance(0.0), StoryMath.START_DISTANCE, 1e-9, "starts far out")
	check_rel(StoryMath.face_position(0.0).length(), StoryMath.START_DISTANCE, 1e-4, "position matches distance")


func test_it_is_bigger_than_anything_else_in_the_sky() -> void:
	# From Earth at the start it already spans more than fifty Moons side by side.
	var at_start := 2.0 * StoryMath.half_angle(StoryMath.START_DISTANCE)
	check(at_start > deg_to_rad(60.0), "huge from the first minute")
	var at_end := 2.0 * StoryMath.half_angle(StoryMath.END_DISTANCE)
	check(at_end > deg_to_rad(150.0) and at_end < PI, "fills the sky at the end, never more than half of it")
	check(StoryMath.HEIGHT > 60.0 * AU, "wider than Neptune's orbit")


func test_its_face_is_fixed_and_looks_at_the_sun() -> void:
	var n := StoryMath.face_normal()
	var up := StoryMath.face_up()
	var right := StoryMath.face_right()
	check_near(n.length(), 1.0, 1e-4, "unit normal")
	check_near(up.length(), 1.0, 1e-4, "unit up")
	check_near(up.dot(n), 0.0, 1e-4, "up square to the normal")
	check_near(right.dot(n), 0.0, 1e-4, "right square to the normal")
	check_near(right.cross(up).dot(n), 1.0, 1e-4, "right-handed")
	# From its middle, the Sun is straight out of its face at any time.
	for t: float in [0.0, 700.0, StoryMath.end_time()]:
		var to_sun := StoryMath.face_position(t).scaled(-1.0).normalized().to_vector3()
		check_near(to_sun.dot(n), 1.0, 1e-4, "faces the Sun (t=%d)" % int(t))


func test_its_mouth_opens_only_when_a_world_is_about_to_go() -> void:
	check_near(StoryMath.mouth_open(0.0), 0.0, 1e-6, "shut at the start")
	for i in StoryMath.EAT_TIMES.size():
		var e := StoryMath.EAT_TIMES[i]
		check_near(StoryMath.mouth_open(e), 1.0, 1e-6, "wide open as world %d goes" % i)
		check(StoryMath.mouth_open(e - 20.0) > 0.2, "already opening before world %d" % i)
		check_near(StoryMath.mouth_open(e - StoryMath.MOUTH_OPENS - 1.0), 0.0, 1e-6, "shut before world %d" % i)
		check_near(StoryMath.mouth_open(e + StoryMath.MOUTH_CLOSES + 1.0), 0.0, 1e-6, "shut again after world %d" % i)
	for step in 400:
		var m := StoryMath.mouth_open(StoryMath.end_time() * step / 399.0)
		check(m >= 0.0 and m <= 1.0, "between shut and open (%d)" % step)
