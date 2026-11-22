// A star's photosphere up close: boiling granulation, darker cooler spots, and a limb that
// dims and reddens towards the edge (you look through more of the cooler upper layers there).
// Bright enough to bloom, but not so bright the surface burns out to flat white.
shader_type spatial;
render_mode unshaded;

#include "sky.gdshaderinc"

uniform sampler2D surface_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform vec3 tint : source_color = vec3(1.0, 0.95, 0.85);
uniform float energy = 4.5;

varying vec3 dir_obj;

void vertex() {
	dir_obj = normalize(VERTEX);
}

void fragment() {
	vec3 d = normalize(dir_obj);
	float t = TIME;
	// Large slow convection cells, then fine granules that churn faster.
	float big = sky_fbm(d * 6.0 + vec3(0.0, t * 0.01, 0.0));
	float mid = sky_fbm(d * 28.0 + vec3(t * 0.03, 0.0, t * 0.02));
	float fine = sky_noise(d * 140.0 + vec3(0.0, t * 0.12, 0.0)) * sky_noise(d * 210.0 - vec3(t * 0.1, 0.0, 0.0));
	float granules = 0.55 * mid + 0.75 * fine;
	// Active regions from the real solar map, drifting with the star's rotation.
	vec3 map = texture(surface_tex, UV + vec2(t * 0.0004, 0.0)).rgb;
	float active = dot(map, vec3(0.4, 0.4, 0.2));
	float spots = smoothstep(0.62, 0.72, big) * smoothstep(0.5, 0.75, sky_noise(d * 13.0 + 4.0));
	float heat = 0.62 + 0.5 * granules + 0.35 * (active - 0.5) + 0.25 * (big - 0.5);
	heat *= 1.0 - 0.75 * spots;

	float mu = clamp(dot(normalize(NORMAL), normalize(VIEW)), 0.0, 1.0);
	float limb = 1.0 - 0.62 * (1.0 - sqrt(mu)) - 0.2 * (1.0 - mu);
	// Hotter patches are whiter, cooler ones and the limb more orange.
	vec3 hot = mix(tint, vec3(1.0, 0.97, 0.9), 0.4);
	vec3 cool = tint * vec3(1.0, 0.5, 0.18);
	vec3 color = mix(cool, hot, clamp(heat * (0.3 + 0.6 * mu), 0.0, 1.0));
	ALBEDO = color * heat * limb * energy;
}
