// Shared by clouds_below.gdshader and clouds_above.gdshader: one cloud layer at `layer_alt`
// above a planet's base radius, found per pixel by intersecting the view ray with that shell.
// Where clouds are comes from the planet's cloud map (so they match the view from orbit);
// their close-up shape comes from a small noise tile, since the map is kilometres per pixel.

uniform sampler2D cloud_tex : filter_linear_mipmap, repeat_enable;
uniform sampler2D tile : filter_linear, repeat_enable;
uniform mat3 world_to_fixed = mat3(1.0);
uniform vec3 up_world = vec3(0.0, 1.0, 0.0);
uniform float radius = 6.371e6;
uniform float cam_alt = 0.0; // camera height above the base radius
uniform float layer_alt = 5000.0;
uniform float side = 1.0; // +1 looking up at the layer, -1 looking down on it
uniform float amount = 1.0;
uniform float cloud_shift = 0.0;
uniform vec3 sun_dir_world = vec3(1.0, 0.0, 0.0);
uniform vec3 sun_color : source_color = vec3(1.0);
uniform float sun_energy = 1.0;
uniform vec3 haze_color : source_color = vec3(0.5, 0.6, 0.8);

varying vec3 dir_world;

void vertex() {
	dir_world = VERTEX;
	// Pin to the far plane. A sphere "almost at" the far plane loses the last bits of depth
	// precision and gets clipped in a disc at the centre of the view.
	POSITION = PROJECTION_MATRIX * (MODELVIEW_MATRIX * vec4(VERTEX, 1.0));
	POSITION.z = 0.0;
}

float noise_at(vec2 p, float period, vec2 drift) {
	return texture(tile, p / period + drift).r;
}

vec4 cloud_layer(vec3 d) {
	float r = radius + cam_alt;
	float mu = dot(d, up_world);
	// Distance along the ray to the shell, written so nothing large is subtracted.
	float c = (layer_alt - cam_alt) * (2.0 * radius + layer_alt + cam_alt);
	float disc = r * mu * r * mu + c;
	if (disc <= 0.0) {
		return vec4(0.0);
	}
	float denom = r * mu + side * sqrt(disc);
	if (abs(denom) < 1.0e-3) {
		return vec4(0.0);
	}
	float t = c / denom;
	if (t <= 0.0) {
		return vec4(0.0);
	}
	vec3 hit = world_to_fixed * (up_world * r + d * t);
	vec3 hd = normalize(hit);
	vec2 uv = vec2(fract(atan(hd.x, hd.z) / 6.28318530718), acos(clamp(hd.y, -1.0, 1.0)) / 3.14159265359);
	float cover = smoothstep(0.08, 0.85, textureLod(cloud_tex, uv + vec2(cloud_shift, 0.0), 0.0).r);

	// Close-up shape: flat coordinates on the nearest cube face, in metres.
	vec3 a = abs(hd);
	vec2 p = a.x >= a.y && a.x >= a.z ? hd.yz / a.x : (a.y >= a.z ? hd.zx / a.y : hd.xy / a.z);
	p *= radius;
	vec2 wind = vec2(TIME * 0.00035, TIME * 0.00012);
	float far_fade = 1.0 - smoothstep(4.0e4, 1.6e5, t);
	float shape = 0.55 * noise_at(p, 31000.0, wind) + 0.3 * noise_at(p.yx, 7300.0, wind * 3.0)
		+ 0.15 * mix(0.5, noise_at(p, 1700.0, wind * 9.0), far_fade);
	float value = cover * 1.1 + (shape - 0.5) * 1.3;
	float density = smoothstep(0.2, 0.7, value);

	vec3 l = normalize(sun_dir_world);
	float sun_up = dot(up_world, l);
	float day = smoothstep(-0.08, 0.15, sun_up);
	vec3 tint = mix(vec3(1.0, 0.5, 0.28), vec3(1.0), smoothstep(0.0, 0.3, sun_up));
	// From below, thick cloud is grey underneath; from above it is bright white.
	float body = side > 0.0 ? mix(1.0, 0.5, smoothstep(0.3, 1.0, density)) : mix(0.85, 1.0, density);
	// Thin edges light up towards the sun.
	float glow = pow(max(dot(d, l), 0.0), 6.0) * (1.0 - density) * 0.6 * step(0.0, side);
	vec3 color = tint * (body + glow) * day;
	float haze = 1.0 - exp(-t / 9.0e4);
	color = mix(color, haze_color * (0.15 + 0.85 * day), haze);
	float alpha = density * amount * (1.0 - smoothstep(2.2e5, 3.6e5, t));
	return vec4(color * sun_color * sun_energy, alpha);
}
