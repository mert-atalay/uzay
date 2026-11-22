// The cloud layer seen from above it. See clouds.gdshaderinc.
shader_type spatial;
render_mode unshaded, cull_front, depth_draw_never, fog_disabled, depth_test_disabled;

#include "clouds.gdshaderinc"

void fragment() {
	vec4 c = cloud_layer(normalize(dir_world));
	ALBEDO = c.rgb;
	ALPHA = c.a;
}
