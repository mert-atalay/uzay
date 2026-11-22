class_name LensFlareMath
extends RefCounted
## Where the star is on screen and how strong its flare should be, including eclipses by planets
## and moons (ported from the old prototype's lensFlareMath.ts). Pure maths, so it is testable.
## All positions are relative to the camera, in any one consistent unit.


## star: position of the star;  star_radius: its radius
## forward, right, up: camera axes (unit);  fov: vertical field of view in radians;  aspect: w / h
## occluders: Array of [Vector3 position, float radius]
## Returns {visible, ndc: Vector2, intensity, visibility, diamond_ring}.
static func compute(star: Vector3, star_radius: float, forward: Vector3, right: Vector3, up: Vector3,
		fov: float, aspect: float, occluders: Array) -> Dictionary:
	var off := {"visible": false, "ndc": Vector2.ZERO, "intensity": 0.0, "visibility": 0.0, "diamond_ring": 0.0}
	var star_dist := star.length()
	if star_dist < 1.0e-6:
		return off
	var s := star / star_dist
	var cam_z := s.dot(forward)
	if cam_z <= 0.12:
		return off
	var tan_half := tan(maxf(0.2, fov * 0.5))
	var ndc := Vector2(s.dot(right) / (cam_z * tan_half * maxf(0.3, aspect)), s.dot(up) / (cam_z * tan_half))
	var edge_fade := 1.0 - smoothstep(0.95, 1.62, ndc.length())
	var angle_factor := smoothstep(0.28, 0.96, cam_z) * edge_fade
	if angle_factor <= 0.002:
		return off
	var alpha_star := maxf(0.011, atan2(star_radius, star_dist))
	var visibility := 1.0
	var diamond := 0.0
	for occ: Array in occluders:
		var o: Vector3 = occ[0]
		var radius: float = occ[1]
		var proj := o.dot(s)
		if proj <= 0.0 or proj >= star_dist - star_radius * 0.5:
			continue
		var occ_dist := o.length()
		if occ_dist <= radius * 1.001:
			visibility = 0.0
			diamond = 0.0
			break
		var sep := acos(clampf(proj / occ_dist, -1.0, 1.0))
		var alpha_occ := asin(clampf(radius / occ_dist, 0.0, 0.9999))
		if sep <= alpha_occ - alpha_star:
			visibility = 0.0
			diamond = 0.0
			break
		if sep < alpha_occ + alpha_star * 1.65:
			var occ_vis := smoothstep(alpha_occ - alpha_star * 0.92, alpha_occ + alpha_star * 1.08, sep)
			visibility = minf(visibility, occ_vis)
			var limb := absf(sep - alpha_occ) / maxf(0.008, alpha_star * 1.25)
			diamond = maxf(diamond, exp(-limb * limb * 2.4) * smoothstep(0.04, 0.45, occ_vis))
	# A lens flare belongs to a point of light; once the star is a big disc you see its surface instead.
	var size_fade := 1.0 - smoothstep(0.02, 0.12, atan2(star_radius, star_dist))
	var intensity := clampf((angle_factor * visibility + angle_factor * diamond * 0.45) * size_fade, 0.0, 1.25)
	return {"visible": intensity > 0.004, "ndc": ndc, "intensity": intensity,
		"visibility": visibility, "diamond_ring": clampf(diamond, 0.0, 1.0)}
