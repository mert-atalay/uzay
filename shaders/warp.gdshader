// Warp travel: starlight stretched into streaks pouring out of the point you are flying at.
shader_type canvas_item;

uniform float amount = 0.0;

float hash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}

void fragment() {
	vec2 p = (UV * 2.0 - 1.0) * vec2(SCREEN_PIXEL_SIZE.y / SCREEN_PIXEL_SIZE.x, 1.0);
	float r = length(p);
	float a = atan(p.y, p.x);
	float total = 0.0;
	vec3 col = vec3(0.0);
	// Three layers of stars at different angular densities and speeds.
	for (int i = 0; i < 3; i++) {
		float lanes = 90.0 + 70.0 * float(i);
		float lane = floor(a / 6.2831853 * lanes);
		float seed = hash(vec2(lane, float(i) * 7.0));
		float speed = 0.5 + seed * 1.5 + float(i) * 0.3;
		// Each star runs outward; its streak grows longer with distance from the centre.
		float head = fract(seed * 13.0 + TIME * speed);
		float len = (0.04 + 0.5 * amount) * (0.3 + head);
		float along = (head - r * 0.75) / len;
		float streak = step(0.0, along) * step(along, 1.0) * (1.0 - along);
		float across = abs(fract(a / 6.2831853 * lanes) - 0.5) * 2.0;
		float thin = smoothstep(0.55, 0.0, across) * step(0.35, seed);
		float v = streak * thin * smoothstep(0.02, 0.2, r);
		total += v;
		col += v * mix(vec3(0.6, 0.78, 1.0), vec3(1.0, 0.92, 0.8), seed);
	}
	float glow = smoothstep(0.5, 0.0, r) * 0.25 * amount;
	COLOR = vec4(col * 1.4 + vec3(0.6, 0.8, 1.0) * glow, clamp((total + glow) * amount, 0.0, 1.0));
}
