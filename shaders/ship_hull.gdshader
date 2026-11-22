// Hull of the rescue ship: pale plating in panels, with rows of lit windows.
shader_type spatial;

uniform vec2 panels = vec2(40.0, 60.0);
uniform vec2 windows = vec2(260.0, 520.0);
uniform float window_rows = 16.0;

float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void fragment() {
	vec2 cell = floor(UV * panels);
	float shade = 0.82 + 0.18 * hash21(cell);
	vec2 seam = abs(fract(UV * panels) - 0.5);
	float line = smoothstep(0.47, 0.5, max(seam.x, seam.y));
	ALBEDO = vec3(0.74, 0.77, 0.82) * shade * (1.0 - 0.35 * line);
	METALLIC = 0.55;
	ROUGHNESS = 0.38;
	// Windows only in bands along the hull, most of them lit.
	float band = step(0.78, fract(UV.y * window_rows));
	vec2 w = UV * windows;
	vec2 in_cell = abs(fract(w) - 0.5);
	float lit = step(hash21(floor(w)), 0.55) * step(in_cell.x, 0.28) * step(in_cell.y, 0.3) * band;
	EMISSION = vec3(1.0, 0.86, 0.6) * lit * 2.5;
}
