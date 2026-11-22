// The night sky: an inside-out sphere showing the real Milky Way and stars (tools/bake_sky.py),
// with the faintest stars added per pixel so the sky stays sharp at any resolution.
shader_type spatial;
render_mode unshaded, cull_front, depth_draw_never, fog_disabled;

#include "sky.gdshaderinc"

uniform sampler2D panorama : source_color, filter_linear, repeat_enable;
uniform float brightness = 1.0;
uniform float core = 0.0;
// The Devourer's face: its axes in the sky frame, and half the angle it spans (0 = not here).
uniform vec3 face_right = vec3(1.0, 0.0, 0.0);
uniform vec3 face_up = vec3(0.0, 1.0, 0.0);
uniform vec3 face_towards = vec3(0.0, 0.0, 1.0);
uniform float face_half = 0.0;
// How much of its own light survives daylight (the stars do not, it does).
uniform float face_gain = 1.0;

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
	vec3 bend;
	vec4 face = devourer(d, face_right, face_up, face_towards, face_half, bend);
	ALBEDO = sky_color(panorama, normalize(d + bend), core) * face.a * brightness + face.rgb * face_gain;
}
