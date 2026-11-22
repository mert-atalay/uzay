// A window in the tesseract onto another moment: a ring of light with a world hanging in it.
// A billboard quad. kind 0/1 show a world (tinted), kind 2 shows the Devourer's dark.
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled;

uniform sampler2D world : source_color, filter_linear_mipmap, repeat_enable;
uniform vec3 tint : source_color = vec3(1.0);
uniform float kind = 0.0;
uniform float focus = 0.0; // 0..1, raised while you look at it
uniform float appear = 0.0; // 0..1 fade in
uniform float radius = 5.0;

float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void vertex() {
	vec3 center = (MODELVIEW_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	POSITION = PROJECTION_MATRIX * vec4(center + vec3(VERTEX.xy * 2.0 * radius * (1.0 + 0.08 * focus), 0.0), 1.0);
}

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float r = length(p);
	float ang = atan(p.y, p.x);
	vec3 c = vec3(0.0);
	// The rim: a bright thread, with strands of light peeling off it.
	float ring = exp(-pow((r - 0.8) / 0.022, 2.0));
	float strands = pow(0.5 + 0.5 * sin(ang * 37.0 + TIME * 0.6 + sin(ang * 5.0) * 2.0), 6.0) * smoothstep(1.0, 0.82, r) * step(0.8, r);
	float halo = exp(-abs(r - 0.8) * 9.0) * 0.25;
	c += tint * (ring * (1.2 + 1.6 * focus) + strands * 0.5 + halo * (0.6 + focus));
	if (r < 0.62) {
		vec2 q = p / 0.62;
		float r2 = dot(q, q);
		vec3 n = vec3(q.x, -q.y, sqrt(max(1.0 - r2, 0.0)));
		if (kind < 1.5) {
			float a = TIME * 0.05 + kind * 2.0;
			vec3 m = vec3(n.x * cos(a) + n.z * sin(a), n.y, -n.x * sin(a) + n.z * cos(a));
			vec2 uv = vec2(atan(m.x, m.z) / 6.2831853 + 0.5, acos(clamp(m.y, -1.0, 1.0)) / 3.14159265);
			vec3 t = texture(world, uv).rgb;
			if (kind < 0.5) {
				// Long ago: the colour of an old photograph.
				t = vec3(dot(t, vec3(0.4, 0.45, 0.15))) * vec3(1.15, 0.88, 0.55);
			}
			float light = 0.1 + 0.9 * max(dot(n, normalize(vec3(-0.5, 0.45, 0.74))), 0.0);
			c += t * light * (0.9 + 0.5 * focus) + tint * pow(1.0 - n.z, 3.0) * 0.3;
		} else {
			// The thing itself: nothing, except that it is watching.
			vec2 g = q * 7.0;
			vec2 cell = floor(g);
			float pick = hash21(cell);
			if (pick < 0.3) {
				vec2 centre = vec2(hash21(cell + 3.0), hash21(cell + 9.0)) * 0.5 + 0.25;
				float blink = smoothstep(-0.3, 0.2, sin(TIME * (0.3 + pick * 3.0) + pick * 60.0));
				c += vec3(0.7, 0.8, 1.0) * smoothstep(0.1, 0.02, length(fract(g) - centre)) * blink * (0.5 + focus);
			}
			c += tint * pow(1.0 - n.z, 2.0) * 0.15;
		}
	}
	ALBEDO = c * appear;
}
