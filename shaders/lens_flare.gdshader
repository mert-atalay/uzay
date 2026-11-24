// Full-screen optical flare for the system's star, ported from the old prototype: a hot core
// and bloom, six-point diffraction spikes, a faint horizontal streak, ghost reflections along
// the line through the screen centre, a rainbow halo, and a "diamond ring" flash when the
// star's edge peeks past a planet. src/sim/lens_flare_math.gd decides where and how strong.
shader_type canvas_item;
render_mode blend_add;

uniform vec2 star_ndc = vec2(0.0);
uniform vec3 star_color : source_color = vec3(1.0, 0.94, 0.83);
uniform float intensity = 0.0;
uniform float visibility = 0.0;
uniform float diamond_ring = 0.0;
uniform float aspect = 1.7778;
uniform float roll = 0.0;

float hex_dist(vec2 p) {
	p = abs(p);
	return max(dot(p, normalize(vec2(1.0, 1.73205))), p.x);
}

vec3 lens_ghost(vec2 uv, vec2 centre, float radius, float ring_weight, vec3 tint) {
	vec2 d = uv - centre;
	float r = length(d);
	float h = hex_dist(d);
	float disc = smoothstep(radius, radius * 0.52, h) * (1.0 - ring_weight * 0.65);
	float rim = exp(-pow((r - radius * 0.88) / max(0.008, radius * 0.18), 2.0)) * ring_weight;
	float r_shift = exp(-pow((r - radius * 0.93) / max(0.008, radius * 0.16), 2.0)) * ring_weight;
	float b_shift = exp(-pow((r - radius * 0.82) / max(0.008, radius * 0.16), 2.0)) * ring_weight;
	vec3 col = tint * (disc * 0.35 + rim * 0.55);
	col.r += tint.r * r_shift * 0.32;
	col.b += tint.b * b_shift * 0.36;
	return col;
}

void fragment() {
	if (intensity <= 0.003) {
		discard;
	}
	vec2 ndc = vec2(UV.x * 2.0 - 1.0, 1.0 - UV.y * 2.0);
	vec2 uv = vec2(ndc.x * aspect, ndc.y);
	vec2 star_pos = vec2(star_ndc.x * aspect, star_ndc.y);
	vec2 d = uv - star_pos;
	float dist = length(d);

	float core_glow = exp(-dist * 10.5) * 0.62 + exp(-dist * 3.1) * 0.24;
	float wide_veil = exp(-dist * 1.15) * 0.095;

	float ang = atan(d.y, d.x) + roll * 0.65;
	float spike6 = pow(abs(cos(ang * 3.0)), 32.0);
	float spike12 = pow(abs(cos(ang * 6.0 + 0.52)), 46.0) * 0.48;
	float radial_fall = exp(-dist * 3.0) * (1.0 - smoothstep(0.0, 0.024, dist) * 0.18);
	float starburst = (spike6 + spike12) * radial_fall * (0.68 + diamond_ring * 1.05);

	float anamorphic = exp(-abs(d.y) * 52.0) * exp(-abs(d.x) * 1.45) * (0.42 + diamond_ring * 0.52);
	vec3 streak_tint = mix(star_color, vec3(0.58, 0.84, 1.0), 0.48);

	vec2 axis = -star_pos;
	vec3 ghosts = vec3(0.0);
	float edge_react = 0.72 + 0.48 * clamp(length(star_ndc), 0.0, 1.15);
	ghosts += lens_ghost(uv, star_pos + axis * 0.48, 0.068, 0.68, mix(star_color, vec3(0.45, 0.78, 1.0), 0.55)) * 0.36;
	ghosts += lens_ghost(uv, star_pos + axis * 0.85, 0.038, 0.38, mix(star_color, vec3(1.0, 0.78, 0.45), 0.45)) * 0.42;
	ghosts += lens_ghost(uv, star_pos + axis * 1.28, 0.128, 0.86, vec3(0.38, 0.76, 1.0)) * 0.30;
	ghosts += lens_ghost(uv, star_pos + axis * 1.62, 0.055, 0.44, vec3(0.95, 0.58, 0.74)) * 0.32;
	ghosts += lens_ghost(uv, star_pos + axis * 2.08, 0.18, 0.92, vec3(0.55, 0.85, 0.98)) * 0.26;

	float halo_ring = exp(-pow((dist - 0.36) / 0.055, 2.0)) * 0.085;
	vec3 halo_col = vec3(
		exp(-pow((dist - 0.38) / 0.045, 2.0)),
		exp(-pow((dist - 0.36) / 0.045, 2.0)),
		exp(-pow((dist - 0.34) / 0.045, 2.0))) * 0.075 * visibility;
	float diamond_flash = exp(-dist * 14.0) * diamond_ring * 0.95;
	float shimmer = 0.96 + 0.04 * sin(TIME * 3.8 + dist * 12.0);

	vec3 flare = star_color * (core_glow + wide_veil + starburst + diamond_flash)
		+ streak_tint * anamorphic + ghosts * edge_react * visibility + halo_col + star_color * halo_ring;
	flare *= intensity * shimmer;
	flare = flare / (vec3(1.0) + flare * 0.45);
	COLOR = vec4(flare, 1.0);
}
