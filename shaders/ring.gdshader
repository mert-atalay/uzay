// Planetary rings: a flat annulus, UV.x runs from the inner to the outer edge.
shader_type spatial;
render_mode unshaded, cull_disabled, blend_mix, depth_draw_never;

uniform sampler2D ring_tex : source_color, filter_linear_mipmap, repeat_disable;
uniform bool use_texture = false;
uniform vec3 color_inner : source_color = vec3(0.8, 0.7, 0.55);
uniform vec3 color_outer : source_color = vec3(0.9, 0.85, 0.75);
uniform float opacity = 0.9;
uniform vec3 sun_dir_world = vec3(1.0, 0.0, 0.0);
uniform vec3 sun_color : source_color = vec3(1.0);
uniform float sun_energy = 1.0;
// Planet radius divided by ring-space unit (the planet is radius 1 in ring object space).
varying vec3 pos_obj;
varying vec3 sun_obj;

float hash(float x) { return fract(sin(x * 127.1) * 43758.5453); }

void vertex() {
	pos_obj = VERTEX;
	mat3 inv_rot = transpose(mat3(normalize(MODEL_MATRIX[0].xyz), normalize(MODEL_MATRIX[1].xyz), normalize(MODEL_MATRIX[2].xyz)));
	sun_obj = inv_rot * sun_dir_world;
}

void fragment() {
	vec4 t;
	if (use_texture) {
		t = texture(ring_tex, vec2(UV.x, 0.5));
	} else {
		float bands = 0.55 + 0.45 * hash(floor(UV.x * 90.0)) * (0.5 + 0.5 * hash(floor(UV.x * 17.0)));
		t = vec4(mix(color_inner, color_outer, UV.x), bands * smoothstep(0.0, 0.05, UV.x) * smoothstep(1.0, 0.92, UV.x));
	}
	// The planet's shadow falls across the rings: ray from this point towards the star vs unit sphere.
	vec3 l = normalize(sun_obj);
	float b = dot(pos_obj, l);
	float c = dot(pos_obj, pos_obj) - 1.0;
	float shadow = (b < 0.0 && b * b - c > 0.0) ? 0.03 : 1.0;
	ALBEDO = t.rgb * sun_color * sun_energy * shadow * (0.75 + 0.25 * abs(l.y)) * 2.2;
	ALPHA = t.a * opacity;
}
