// A star's photosphere: boiling granulation texture, limb darkening, far brighter than the
// glow threshold so it blooms.
shader_type spatial;
render_mode unshaded;

uniform sampler2D surface_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform vec3 tint : source_color = vec3(1.0, 0.95, 0.85);
uniform float energy = 30.0;

void fragment() {
	vec2 flow = vec2(TIME * 0.0006, 0.0);
	vec3 a = texture(surface_tex, UV + flow).rgb;
	vec3 b = texture(surface_tex, UV * vec2(2.0, 2.0) - flow * 1.7).rgb;
	float granules = dot(mix(a, b, 0.35), vec3(0.4, 0.4, 0.2));
	float mu = max(dot(normalize(NORMAL), normalize(VIEW)), 0.0);
	float limb = 0.35 + 0.65 * pow(mu, 0.55);
	ALBEDO = tint * (0.55 + granules * 0.9) * limb * energy;
}
