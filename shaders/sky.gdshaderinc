// Shared: direction -> equirectangular UV for the Milky Way panorama.
// Both the sky sphere and the black hole use this, so lensed and unlensed sky line up exactly.
vec2 sky_uv(vec3 dir) {
	return vec2(atan(dir.x, dir.z) / (2.0 * PI) + 0.5, acos(clamp(dir.y, -1.0, 1.0)) / PI);
}
