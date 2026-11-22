// The night sky: an inside-out sphere showing the real Milky Way and stars (tools/bake_sky.py),
// with the faintest stars added per pixel so the sky stays sharp at any resolution.
shader_type spatial;
render_mode unshaded, cull_front, depth_draw_never, fog_disabled;

#include "sky.gdshaderinc"

uniform sampler2D panorama : source_color, filter_linear, repeat_enable;
uniform float brightness = 1.0;
uniform float core = 0.0;
uniform vec3 void_dir = vec3(0.0, 0.0, 1.0);
uniform float void_radius = 0.0;

varying vec3 dir_obj;

void vertex() {
	dir_obj = VERTEX;
	// Pin to the far plane. A sphere "almost at" the far plane loses the last bits of depth
	// precision and gets clipped in a disc at the centre of the view.
	POSITION = PROJECTION_MATRIX * (MODELVIEW_MATRIX * vec4(VERTEX, 1.0));
	POSITION.z = 0.0;
}

void fragment() {
	vec3 d = normalize(dir_obj);
	float edge;
	float left = void_mask(d, void_dir, void_radius, edge);
	// Where the sky has been eaten there is nothing, and the torn rim flickers faintly.
	float crackle = pow(sky_noise(d * 90.0 + TIME * 0.4), 3.0) * (0.6 + 0.4 * sin(TIME * 2.3 + d.x * 40.0));
	ALBEDO = (sky_color(panorama, d, core) * left + vec3(0.3, 0.2, 0.55) * edge * edge * crackle * 0.16) * brightness;
}
