// The night sky: an inside-out sphere showing the Milky Way panorama (real star positions).
shader_type spatial;
render_mode unshaded, cull_front, depth_draw_never, fog_disabled;

#include "sky.gdshaderinc"

uniform sampler2D panorama : source_color, filter_linear, repeat_enable;
uniform float brightness = 1.0;

varying vec3 dir_obj;

void vertex() {
	dir_obj = VERTEX;
}

void fragment() {
	vec3 c = textureLod(panorama, sky_uv(normalize(dir_obj)), 0.0).rgb;
	// Deepen the blacks so space reads as a void, keep bright stars punchy.
	c = pow(c, vec3(1.35)) * brightness;
	ALBEDO = c;
}
