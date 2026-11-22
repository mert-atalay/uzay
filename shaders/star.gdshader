// A star's surface: churning plasma (two layers of noise, the second warped by the first, as
// in the old prototype), coloured from the star's own palette: a white-hot core colour in the
// brightest cells, the mid colour across most of the disc and the deep limb colour at the edge.
// Bright enough to bloom, but kept below the point where tone mapping bleaches it to white, so
// the Sun reads as a glowing orange-gold ball rather than a flat white disc.
shader_type spatial;
render_mode unshaded, fog_disabled;

#include "sky.gdshaderinc"

uniform sampler2D surface_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform vec3 color_core : source_color = vec3(1.0, 0.965, 0.82);
uniform vec3 color_mid : source_color = vec3(1.0, 0.616, 0.18);
uniform vec3 color_limb : source_color = vec3(0.8, 0.24, 0.0);
uniform float seed = 0.0;
uniform float energy = 2.6;

varying vec3 dir_obj;

void vertex() {
	dir_obj = normalize(VERTEX);
}

void fragment() {
	vec3 d = normalize(dir_obj);
	float t = TIME * 0.05;
	vec3 p = d * 6.5 + vec3(seed);
	float n1 = sky_fbm(p + vec3(t, -t * 0.6, t * 0.4));
	float n2 = sky_fbm(p * 2.1 - vec3(n1 * 1.4) + vec3(-t * 0.5, t * 0.8, 0.0));
	// Fine granules on top: thousands of convection cells, each a few hundred km across.
	float gran = sky_noise(d * 160.0 + vec3(0.0, TIME * 0.06, 0.0)) * sky_noise(d * 230.0 - vec3(TIME * 0.05, 0.0, 0.0));
	// Active regions from the real solar map drift with the rotation.
	float active = dot(texture(surface_tex, UV + vec2(TIME * 0.0004, 0.0)).rgb, vec3(0.4, 0.4, 0.2));
	float plasma = clamp(n1 * 0.55 + n2 * 0.65 + (gran - 0.25) * 0.35 + (active - 0.5) * 0.25, 0.0, 1.0);
	// Sunspots: dark umbra in a lighter penumbra, only here and there.
	float spot_field = sky_fbm(d * 9.0 + vec3(seed * 3.0, 0.0, 0.0));
	float umbra = smoothstep(0.7, 0.76, spot_field);
	float penumbra = smoothstep(0.64, 0.7, spot_field);

	float ndotv = clamp(dot(normalize(NORMAL), normalize(VIEW)), 0.0, 1.0);
	float limb = pow(ndotv, 0.55);
	vec3 col = mix(color_limb, color_mid, smoothstep(0.15, 0.62, plasma));
	col = mix(col, color_core, smoothstep(0.56, 0.92, plasma) * limb);
	col *= 1.0 - 0.45 * penumbra - 0.45 * umbra;
	// Limb darkening into the deep colour, then a thin bright rim where the corona starts.
	col = mix(color_limb * 0.6, col, 0.35 + 0.65 * limb);
	col += color_mid * pow(1.0 - ndotv, 3.2) * 0.95;
	ALBEDO = col * energy;
}
