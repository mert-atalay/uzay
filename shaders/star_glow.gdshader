// The light around a star: its corona when you are close, and the glare your eye (or any
// lens) adds around a point that bright when you are far. A camera-facing square centred on
// the star; never smaller on screen than a few degrees, so a distant sun is still a blaze.
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled;

#include "sky.gdshaderinc"

uniform vec3 tint : source_color = vec3(1.0, 0.95, 0.85);
uniform float energy = 1.0;
// Half-width of the square in star radii, and the smallest it may look (tangent of the angle).
uniform float reach = 9.0;
uniform float min_angle = 0.17;
// Brighter when you are near the star, set from its real distance.
uniform float glare_gain = 1.0;

varying float far_glare; // 0 close to the star, 1 once it is small in the sky
varying vec2 p; // position on the square in star radii (the star's disc is |p| < 1)

void vertex() {
	float radius = length(MODEL_MATRIX[0].xyz);
	vec3 centre_view = (VIEW_MATRIX * vec4(MODEL_MATRIX[3].xyz, 1.0)).xyz;
	float dist = length(centre_view);
	float half_size = max(reach * radius, dist * min_angle);
	p = VERTEX.xy * 2.0 * half_size / radius;
	far_glare = smoothstep(0.1, 1.2, dist * min_angle / (reach * radius));
	// Face the camera.
	vec3 pos_view = centre_view + vec3(VERTEX.xy * 2.0 * half_size, 0.0);
	POSITION = PROJECTION_MATRIX * vec4(pos_view, 1.0);
}

void fragment() {
	float r = length(p);
	float a = atan(p.y, p.x);
	// Corona: falls away fast from the limb, combed into faint streamers.
	float out_r = max(r - 1.0, 0.0);
	float streamers = sky_fbm(vec3(cos(a) * 3.0, sin(a) * 3.0, r * 0.35 + TIME * 0.01));
	float fine = sky_fbm(vec3(cos(a) * 11.0, sin(a) * 11.0, r * 0.2 - TIME * 0.006));
	float corona = exp(-out_r * 1.6) * (0.35 + 0.9 * streamers * fine) + 0.22 / (1.0 + out_r * out_r * 1.5);
	corona *= smoothstep(0.93, 1.02, r); // the disc itself is drawn by the photosphere
	// Glare: what a point that bright does in an eye or a lens. A hard core, a soft halo and
	// a few uneven rays; only once the star is small in the sky.
	vec2 q2 = UV * 2.0 - 1.0;
	float q = length(q2);
	float rays = 0.35 + 1.6 * sky_fbm(vec3(cos(a) * 5.0, sin(a) * 5.0, 2.0)) * sky_fbm(vec3(cos(a) * 17.0, sin(a) * 17.0, 7.0));
	float glare = 30.0 / (1.0 + pow(q / 0.01, 2.0)) + 0.55 * rays * rays / (1.0 + pow(q / 0.04, 2.0)) + 0.05 * exp(-q * 5.0);
	glare *= glare_gain;
	float fade = 1.0 - smoothstep(0.55, 1.0, q);
	vec3 color = mix(tint, vec3(1.0), 0.35) * (corona * 2.2 * (1.0 - far_glare) + glare * far_glare);
	ALBEDO = color * energy * fade;
}
