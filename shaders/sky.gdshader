// The night sky: an inside-out sphere showing the real Milky Way and stars (tools/bake_sky.py),
// with the faintest stars added per pixel so the sky stays sharp at any resolution.
shader_type spatial;
render_mode unshaded, cull_front, depth_draw_never, fog_disabled;

#include "sky.gdshaderinc"

uniform sampler2D panorama : source_color, filter_linear, repeat_enable;
uniform float brightness = 1.0;
uniform float core = 0.0;
// The Devourer: its own fixed axes and its middle (in half-heights, from here) in the sky
// frame, how far its mouth is open, and half the angle it spans (0 = not here).
uniform vec3 face_right = vec3(1.0, 0.0, 0.0);
uniform vec3 face_up = vec3(0.0, 1.0, 0.0);
uniform vec3 face_normal = vec3(0.0, 0.0, 1.0);
uniform vec3 face_center = vec3(0.0, 0.0, 9.0);
uniform float face_mouth = 0.0;
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
	vec4 face = vec4(0.0, 0.0, 0.0, 1.0);
	if (face_half > 0.0) {
		face = devourer(d, face_center, face_right, face_up, face_normal, face_mouth);
	}
	ALBEDO = sky_color(panorama, d, core) * face.a * brightness + face.rgb * face_gain;
}
