// Echoes of the worlds you have seen, hanging in the tesseract: each one a ghostly planet,
// repeated along a line like frames of the same moment. A billboard quad shaded as a sphere.
// INSTANCE_CUSTOM: rgb = lattice cell (integers), a = which repeat (0 = brightest).
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled;

uniform sampler2D world0 : source_color, filter_linear_mipmap, repeat_enable;
uniform sampler2D world1 : source_color, filter_linear_mipmap, repeat_enable;
uniform sampler2D world2 : source_color, filter_linear_mipmap, repeat_enable;
uniform sampler2D world3 : source_color, filter_linear_mipmap, repeat_enable;
uniform sampler2D world4 : source_color, filter_linear_mipmap, repeat_enable;
uniform sampler2D world5 : source_color, filter_linear_mipmap, repeat_enable;
uniform vec3 cell_origin = vec3(0.0); // lattice cell the player is in
uniform float radius = 2.6;
uniform float fog_density = 0.02;

varying flat float world_index;
varying float strength;
varying float spin;

float hash31(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }

void vertex() {
	vec3 cell = INSTANCE_CUSTOM.rgb + cell_origin;
	float present = step(hash31(cell), 0.22); // most cells are empty
	world_index = floor(hash31(cell + 19.0) * 5.999);
	spin = hash31(cell + 7.0) * 6.283 + INSTANCE_CUSTOM.a * 0.35;
	vec3 center = (MODELVIEW_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	float fog = exp(-length(center) * fog_density);
	strength = present * fog * pow(0.6, INSTANCE_CUSTOM.a) * 1.5;
	POSITION = PROJECTION_MATRIX * vec4(center + vec3(VERTEX.xy * 2.0 * radius * present, 0.0), 1.0);
}

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float r2 = dot(p, p);
	if (r2 > 1.0 || strength < 0.004) {
		discard;
	}
	vec3 n = vec3(p.x, -p.y, sqrt(1.0 - r2));
	float a = TIME * 0.07 + spin;
	vec3 m = vec3(n.x * cos(a) + n.z * sin(a), n.y, -n.x * sin(a) + n.z * cos(a));
	vec2 uv = vec2(atan(m.x, m.z) / 6.2831853 + 0.5, acos(clamp(m.y, -1.0, 1.0)) / 3.14159265);
	vec3 c;
	if (world_index < 0.5) { c = texture(world0, uv).rgb; }
	else if (world_index < 1.5) { c = texture(world1, uv).rgb; }
	else if (world_index < 2.5) { c = texture(world2, uv).rgb; }
	else if (world_index < 3.5) { c = texture(world3, uv).rgb; }
	else if (world_index < 4.5) { c = texture(world4, uv).rgb; }
	else { c = texture(world5, uv).rgb; }
	float light = 0.12 + 0.88 * max(dot(n, normalize(vec3(-0.5, 0.45, 0.74))), 0.0);
	float rim = pow(1.0 - n.z, 3.0);
	ALBEDO = (c * light + vec3(1.0, 0.75, 0.45) * rim * 0.35) * strength;
}
