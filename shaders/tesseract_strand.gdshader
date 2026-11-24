// The tesseract's strands: every object's path through time drawn as a line of light.
// One long thin box per strand. INSTANCE_CUSTOM: r = random seed, g = brightness, b = axis (0,1,2).
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_back, fog_disabled;

uniform vec3 lattice_offset = vec3(0.0); // metres the lattice has been wrapped by, keeps patterns still
uniform float fog_density = 0.02;

varying vec4 custom;
varying vec3 world_pos;
varying float view_dist;

float hash11(float x) { return fract(sin(x * 127.1) * 43758.5453); }

void vertex() {
	custom = INSTANCE_CUSTOM;
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz + lattice_offset;
	view_dist = length((MODELVIEW_MATRIX * vec4(VERTEX, 1.0)).xyz);
}

void fragment() {
	float along = custom.b < 0.5 ? world_pos.x : (custom.b < 1.5 ? world_pos.y : world_pos.z);
	float seed = custom.r;
	// Slices of time: the strand is cut into short lengths of differing brightness, like book spines.
	float s = along * (0.9 + seed * 1.4) + seed * 37.0;
	float h = hash11(floor(s) + seed * 91.0);
	float gap = smoothstep(0.02, 0.07, fract(s)) * smoothstep(1.0, 0.95, fract(s));
	float bright = (0.18 + h * h * 1.7) * gap * custom.g;
	// Light running along the strands.
	bright += pow(0.5 + 0.5 * sin(along * 0.21 - TIME * (0.6 + seed) + seed * 40.0), 14.0) * 4.5 * custom.g;
	vec3 warm = mix(vec3(1.0, 0.36, 0.07), vec3(1.0, 0.62, 0.25), h);
	vec3 cool = vec3(0.35, 0.6, 1.0);
	vec3 col = mix(warm, cool, step(0.93, seed)) * bright;
	float f = exp(-view_dist * fog_density);
	// Glancing strands close to the eye would otherwise smear into solid bars.
	ALBEDO = col * f * smoothstep(0.15, 1.2, view_dist);
}
