// Planet / moon surface lit by its star. Lighting is done by hand (one star, hard vacuum
// shadows, no ambient), with optional Earth extras: night lights, clouds, ocean glint.
shader_type spatial;
render_mode unshaded;

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform bool use_texture = false;
uniform vec3 base_color : source_color = vec3(0.5);
uniform vec3 sun_dir_world = vec3(1.0, 0.0, 0.0);
uniform vec3 sun_color : source_color = vec3(1.0);
uniform float sun_energy = 1.0;
// Soft terminator + rim tint for worlds with air.
uniform vec3 atmo_color : source_color = vec3(0.0);
uniform float atmo_density = 0.0;

uniform bool earth_extras = false;
uniform sampler2D night_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform sampler2D cloud_tex : filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D spec_tex : filter_linear_mipmap, repeat_enable;
uniform float cloud_shift = 0.0;

varying vec3 n_obj;
varying vec3 sun_obj;
varying vec3 view_obj;

void vertex() {
	n_obj = normalize(VERTEX);
	mat3 inv_rot = transpose(mat3(normalize(MODEL_MATRIX[0].xyz), normalize(MODEL_MATRIX[1].xyz), normalize(MODEL_MATRIX[2].xyz)));
	sun_obj = inv_rot * sun_dir_world;
	view_obj = inv_rot * (CAMERA_POSITION_WORLD - (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz);
}

void fragment() {
	vec3 n = normalize(n_obj);
	vec3 l = normalize(sun_obj);
	vec3 v = normalize(view_obj);
	float ndl = dot(n, l);
	// Airless worlds get a razor terminator; air softens and reddens it.
	float soft = mix(0.02, 0.18, clamp(atmo_density, 0.0, 1.0));
	float lit = smoothstep(-soft, soft, ndl) * max(ndl, 0.0) + smoothstep(-soft, soft * 2.0, ndl) * 0.04 * atmo_density;

	vec3 surface = use_texture ? texture(albedo_tex, UV).rgb : base_color;
	vec3 color = surface * lit;

	if (earth_extras) {
		float ocean = texture(spec_tex, UV).r;
		vec3 h = normalize(l + v);
		float glint = pow(max(dot(n, h), 0.0), 420.0) * ocean * smoothstep(0.0, 0.1, ndl);
		color += vec3(1.0, 0.95, 0.85) * glint * 0.7;

		float cloud = texture(cloud_tex, UV + vec2(cloud_shift, 0.0)).r;
		cloud = smoothstep(0.08, 0.85, cloud);
		// Clouds shade the ground a little and catch warm light at the terminator.
		vec3 cloud_lit = mix(vec3(1.0, 0.55, 0.35), vec3(1.0), smoothstep(0.0, 0.35, ndl)) * lit;
		color = mix(color, cloud_lit, cloud * 0.92);

		float night = 1.0 - smoothstep(-0.12, 0.06, ndl);
		vec3 lights = texture(night_tex, UV).rgb;
		color += lights * lights * night * (1.0 - cloud * 0.8) * vec3(1.0, 0.82, 0.55) * 1.4 / max(sun_energy, 0.001);
	}

	// Thin limb haze so the surface blends into the atmosphere shell.
	float rim = pow(1.0 - max(dot(n, v), 0.0), 4.0);
	color += atmo_color * rim * smoothstep(-0.1, 0.4, ndl) * 0.35 * clamp(atmo_density, 0.0, 1.5);

	ALBEDO = color * sun_color * sun_energy;
}
