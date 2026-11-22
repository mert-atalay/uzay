// The light around a star, on a camera-facing square: up close a soft corona in the star's
// colour with faint streamers (the old prototype's glow, done per pixel); from far away a
// small hot halo so the star stays a blaze. The lens flare in the HUD does the rest.
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled;

#include "sky.gdshaderinc"

uniform vec3 tint : source_color = vec3(1.0, 0.87, 0.62);
uniform float energy = 1.0;
// Half-width of the square in star radii, and the smallest it may look (tangent of the angle).
uniform float reach = 4.0;
uniform float min_angle = 0.17;
// Brighter when you are near the star, set from its real distance.
uniform float glare_gain = 1.0;

varying float far_glare;
varying vec2 p; // position on the square in star radii (the disc is |p| < 1)

void vertex() {
	float radius = length(MODEL_MATRIX[0].xyz);
	vec3 centre_view = (VIEW_MATRIX * vec4(MODEL_MATRIX[3].xyz, 1.0)).xyz;
	float dist = length(centre_view);
	float half_size = max(reach * radius, dist * min_angle);
	p = VERTEX.xy * 2.0 * half_size / radius;
	far_glare = smoothstep(0.1, 1.2, dist * min_angle / (reach * radius));
	vec3 pos_view = centre_view + vec3(VERTEX.xy * 2.0 * half_size, 0.0);
	POSITION = PROJECTION_MATRIX * vec4(pos_view, 1.0);
}

// The prototype's glow gradient: 1 at the centre, 0.88 at 14%, 0.32 at 38%, 0.08 at 70%, 0 at the edge.
float glow_profile(float x) {
	x = clamp(x, 0.0, 1.0);
	if (x < 0.14) return mix(1.0, 0.88, x / 0.14);
	if (x < 0.38) return mix(0.88, 0.32, (x - 0.14) / 0.24);
	if (x < 0.7) return mix(0.32, 0.08, (x - 0.38) / 0.32);
	return mix(0.08, 0.0, (x - 0.7) / 0.3);
}

void fragment() {
	float r = length(p);
	float a = atan(p.y, p.x);
	// Corona: the soft gradient out to 2.6 radii, plus faint streamers further out.
	float soft = glow_profile(r / 2.6);
	float out_r = max(r - 1.0, 0.0);
	float streamers = sky_fbm(vec3(cos(a) * 3.0, sin(a) * 3.0, r * 0.35 + TIME * 0.01))
		* sky_fbm(vec3(cos(a) * 11.0, sin(a) * 11.0, r * 0.2 - TIME * 0.006));
	float corona = soft * 0.55 + exp(-out_r * 1.2) * streamers * 0.5;
	corona *= smoothstep(0.96, 1.03, r); // the disc itself is drawn by the surface shader
	// From far away: a hot point and a tight halo.
	vec2 q2 = UV * 2.0 - 1.0;
	float q = length(q2);
	float glare = 30.0 / (1.0 + pow(q / 0.01, 2.0)) + 0.6 / (1.0 + pow(q / 0.05, 2.0)) + 0.05 * exp(-q * 5.0);
	glare *= glare_gain;
	float fade = 1.0 - smoothstep(0.6, 1.0, q);
	vec3 color = tint * (corona * 1.6 * (1.0 - far_glare)) + mix(tint, vec3(1.0), 0.4) * glare * far_glare;
	ALBEDO = color * energy * fade;
}
