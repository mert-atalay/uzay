// Plasma around you during a fast dive into an atmosphere: streaks of glowing air pouring in
// from the edges of the view.
shader_type canvas_item;

uniform float heat = 0.0;

float hash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float r = length(p);
	float a = atan(p.y, p.x);
	float streaks = noise(vec2(a * 14.0, r * 3.0 - TIME * 9.0)) * noise(vec2(a * 41.0 + 3.0, r * 7.0 - TIME * 17.0));
	float edge = smoothstep(0.35, 1.25, r);
	float glow = edge * (0.35 + 1.9 * streaks) * heat;
	vec3 col = mix(vec3(1.0, 0.35, 0.08), vec3(1.0, 0.9, 0.7), clamp(glow * 0.9, 0.0, 1.0));
	COLOR = vec4(col, clamp(glow, 0.0, 0.92));
}
