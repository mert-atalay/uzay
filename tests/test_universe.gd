extends TestCase

const DAY := 86400.0
var u := UniverseCatalog.load_default()


func test_catalog_loads_everything() -> void:
	check(u.systems.size() == 10, "10 star systems, got %d" % u.systems.size())
	check(u.bodies.size() == 50, "50 bodies, got %d" % u.bodies.size())
	for b in u.bodies:
		if b["parent"] != null:
			check(u.bodies_by_id.has(b["parent"]), "%s has a real parent" % b["id"])
	for s in u.systems:
		check(not u.primary_of(s["id"]).is_empty(), "%s has a primary" % s["id"])


func test_true_scale_sizes() -> void:
	check_rel(u.body("earth")["radius_m"], 6.371e6, 1e-6, "Earth radius")
	check_rel(u.body("sun")["radius_m"], 6.9634e8, 1e-6, "Sun radius")
	check_rel(u.body("sun")["mass_kg"], 1.989e30, 1e-3, "Sun mass")
	# Sagittarius A*: event horizon radius = 2GM/c^2 for 4.3 million solar masses ≈ 12.7 million km.
	check_rel(u.body("sgr-a-star")["radius_m"], 1.27e10, 0.01, "Sgr A* Schwarzschild radius")


func test_real_orbital_periods() -> void:
	check_rel(Kepler.period_s(u.body("earth")["orbit"]) / DAY, 365.25, 0.002, "Earth year (days)")
	check_rel(Kepler.period_s(u.body("moon")["orbit"]) / DAY, 27.32, 0.01, "Moon month (days)")
	check_rel(Kepler.period_s(u.body("jupiter")["orbit"]) / DAY, 4332.6, 0.003, "Jupiter year (days)")
	check_rel(Kepler.period_s(u.body("sgr-s2")["orbit"]) / (365.25 * DAY), 16.05, 0.03, "S2 around Sgr A* (years)")


func test_earth_stays_between_perihelion_and_aphelion() -> void:
	var au: float = u.constants["AU"]
	for i in 24:
		var d := u.body_position("earth", i * 15.2 * DAY).length()
		check(d > 0.982 * au and d < 1.018 * au, "Earth-Sun distance %s AU on step %d" % [d / au, i])


func test_moon_follows_earth() -> void:
	for t in [0.0, 100.0 * DAY, 200.0 * DAY]:
		var d := u.body_position("moon", t).sub(u.body_position("earth", t)).length()
		check(d > 3.5e8 and d < 4.1e8, "Moon-Earth distance %s m" % d)


func test_real_distances_between_systems() -> void:
	var ly: float = u.constants["LY"]
	check_rel(u.system_offset("sol", "alpha-centauri").length() / ly, 4.37, 1e-6, "Alpha Centauri (ly)")
	check_rel(u.system_offset("sol", "sagittarius-a").length() / ly, 26670.0, 1e-6, "Galactic centre (ly)")
