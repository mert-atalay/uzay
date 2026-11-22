// The naked-eye stars as sharp points of light, each with its real place, brightness and colour.
// VERTEX = direction in the sky frame, COLOR.rgb = colour, COLOR.a = magnitude / 8.
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, fog_disabled;

#include "sky.gdshaderinc"

uniform float brightness = 1.0;
uniform vec3 face_right = vec3(1.0, 0.0, 0.0);
uniform vec3 face_up = vec3(0.0, 1.0, 0.0);
uniform vec3 face_towards = vec3(0.0, 0.0, 1.0);
uniform float face_half = 0.0;
uniform float pixel_scale = 1.0; // viewport height / 1080

varying float flux;

void vertex() {
	float mag = COLOR.a * 16.0 - 2.0;
	// The Devourer's face covers the stars behind it.
	vec3 bend;
	flux = 1.4 * pow(10.0, -0.2 * (mag - 2.0)) * devourer(normalize(VERTEX), face_right, face_up, face_towards, face_half, bend).a;
	// Brighter stars are a little bigger, as they look to the eye; faint ones stay a pixel or two.
	POSITION = PROJECTION_MATRIX * (MODELVIEW_MATRIX * vec4(VERTEX, 1.0));
	POSITION.z = 0.0;
	POINT_SIZE = clamp(2.2 + 1.3 * (4.0 - mag) * 0.5, 2.0, 7.0) * pixel_scale;
}

void fragment() {
	float r = length(POINT_COORD - 0.5) * 2.0;
	float core_light = exp(-r * r * 5.0) * (1.0 - smoothstep(0.8, 1.0, r));
	ALBEDO = COLOR.rgb * flux * core_light * brightness;
}
