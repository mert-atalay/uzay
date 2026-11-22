// Background stars drawn as points. Colour and brightness come from vertex colour.
shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never, fog_disabled, blend_add;

uniform float point_scale = 1.0;

varying float brightness;

void vertex() {
	brightness = COLOR.a;
	POINT_SIZE = point_scale * mix(1.0, 3.2, brightness * brightness);
}

void fragment() {
	vec2 p = POINT_COORD * 2.0 - 1.0;
	float falloff = exp(-dot(p, p) * 3.0);
	ALBEDO = COLOR.rgb * brightness * falloff * 2.0;
}
