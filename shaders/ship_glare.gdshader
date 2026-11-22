// Soft light around something bright on the rescue ship (engines, the open bay). A billboard.
shader_type spatial;
// Premultiplied alpha, not additive: this is drawn into a see-through picture that is laid over
// the main view, and plain additive light would leave a black square there.
render_mode unshaded, blend_premul_alpha, depth_draw_never, cull_disabled, fog_disabled;

uniform vec3 color : source_color = vec3(0.6, 0.8, 1.0);
uniform float power = 1.0;
uniform float radius = 100.0;

void vertex() {
	vec3 center = (MODELVIEW_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	// Never smaller than a bright star, however far away it gets.
	float size = max(radius, -center.z * 0.006);
	POSITION = PROJECTION_MATRIX * vec4(center + vec3(VERTEX.xy * 2.0 * size, 0.0), 1.0);
}

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float r = length(p);
	float core = exp(-r * r * 30.0);
	float glow = pow(max(1.0 - r, 0.0), 3.0);
	float streak = exp(-abs(p.y) * 40.0) * pow(max(1.0 - abs(p.x), 0.0), 2.0);
	vec3 light = color * (core * 3.0 + glow * 0.7 + streak * 0.6) * power;
	ALBEDO = light;
	ALPHA = clamp(max(light.r, max(light.g, light.b)), 0.0, 1.0);
}
