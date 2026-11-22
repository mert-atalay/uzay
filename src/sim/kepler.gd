class_name Kepler
extends RefCounted
## Two-body Keplerian orbits, ported from the prototype's physics.ts.
## All lengths in metres, angles in radians, time in seconds.

const TAU_F := TAU


## Solve Kepler's equation M = E - e*sin(E) for the eccentric anomaly E (Newton-Raphson).
static func solve_eccentric_anomaly(mean_anomaly: float, e: float) -> float:
	e = clampf(e, 0.0, 0.99)
	var m := fposmod(mean_anomaly + PI, TAU_F) - PI
	if e < 1e-9:
		return m
	var ecc_anomaly := m + e * sin(m) if e < 0.8 else (PI if m >= 0.0 else -PI)
	for i in 30:
		var f := ecc_anomaly - e * sin(ecc_anomaly) - m
		var delta := f / maxf(1e-12, 1.0 - e * cos(ecc_anomaly))
		ecc_anomaly -= delta
		if absf(delta) < 1e-13:
			break
	return ecc_anomaly


## Rotate a point from the orbital plane (periapsis along +X, motion towards +Z)
## into the system frame using argument of periapsis w, inclination i, ascending node O.
## Godot convention: Y is up, the reference plane (ecliptic) is XZ.
static func orbital_plane_to_3d(x_orb: float, z_orb: float, w: float, i: float, node: float) -> DVec3:
	var x1 := x_orb * cos(w) - z_orb * sin(w)
	var z1 := x_orb * sin(w) + z_orb * cos(w)
	var y2 := z1 * sin(i)
	var z2 := z1 * cos(i)
	return DVec3.new(x1 * cos(node) - z2 * sin(node), y2, x1 * sin(node) + z2 * cos(node))


## Position relative to the parent at time t. `orbit` is a body's "orbit" dictionary from universe.json.
static func offset_at(orbit: Dictionary, t: float) -> DVec3:
	var a: float = orbit["semi_major_axis_m"]
	if a <= 0.0:
		return DVec3.new()
	var e: float = clampf(orbit["eccentricity"], 0.0, 0.99)
	var mean_anomaly: float = orbit["mean_anomaly_epoch_rad"] + orbit["mean_motion_rad_s"] * t
	var ecc_anomaly := solve_eccentric_anomaly(mean_anomaly, e)
	var x_orb := a * (cos(ecc_anomaly) - e)
	var z_orb := a * sqrt(1.0 - e * e) * sin(ecc_anomaly)
	return orbital_plane_to_3d(
		x_orb, z_orb, orbit["arg_periapsis_rad"], orbit["inclination_rad"], orbit["ascending_node_rad"]
	)


## Orbital period in seconds.
static func period_s(orbit: Dictionary) -> float:
	var n: float = absf(orbit["mean_motion_rad_s"])
	return INF if n == 0.0 else TAU_F / n
