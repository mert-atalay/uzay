// Single-scattering atmosphere (Rayleigh + Mie), ray-marched per pixel.
// Drawn on a sphere whose radius is the top of the atmosphere (object-space radius 1);
// the planet's surface is at `planet_radius` (< 1) in the same units. Works from space and
// from inside the air, because we draw back faces and march from the camera.
shader_type spatial;
render_mode unshaded, cull_front, blend_add, depth_test_disabled, depth_draw_never, fog_disabled;

uniform float planet_radius = 0.985;
uniform float scale_height = 0.0013; // density e-folding height, same units
uniform vec3 rayleigh = vec3(37.0, 87.0, 213.0); // scattering per unit length at the surface
uniform float mie = 14.0;
uniform float mie_g = 0.76;
uniform vec3 sun_dir_world = vec3(1.0, 0.0, 0.0);
uniform vec3 sun_color : source_color = vec3(1.0);
uniform float sun_energy = 18.0;
// The Devourer's face (world axes, half-angle in radians; 0 = not here). It shows through
// daylight as a darkening of the sky itself.
uniform vec3 face_right = vec3(1.0, 0.0, 0.0);
uniform vec3 face_up = vec3(0.0, 1.0, 0.0);
uniform vec3 face_towards = vec3(0.0, 0.0, 1.0);
uniform float face_half = 0.0;

#include "sky.gdshaderinc"

const int VIEW_STEPS = 16;
const int LIGHT_STEPS = 6;

varying vec3 pos_obj;
varying vec3 cam_obj;
varying vec3 sun_obj;
varying vec3 dir_world;

void vertex() {
	pos_obj = VERTEX;
	mat4 inv = inverse(MODEL_MATRIX);
	cam_obj = (inv * vec4(CAMERA_POSITION_WORLD, 1.0)).xyz;
	sun_obj = normalize(mat3(inv) * sun_dir_world);
	dir_world = mat3(MODEL_MATRIX) * VERTEX - (CAMERA_POSITION_WORLD - MODEL_MATRIX[3].xyz);
	// Standing on the ground the far plane is only ~100 km away, but the top of the air towards
	// the horizon is over 1000 km off: pin the shell to the far plane so it is never clipped.
	POSITION = PROJECTION_MATRIX * (MODELVIEW_MATRIX * vec4(VERTEX, 1.0));
	POSITION.z = POSITION.w * 1.0e-6;
}

vec2 ray_sphere(vec3 o, vec3 d, float r) {
	float b = dot(o, d);
	float c = dot(o, o) - r * r;
	float disc = b * b - c;
	if (disc < 0.0) {
		return vec2(1.0, -1.0);
	}
	float s = sqrt(disc);
	return vec2(-b - s, -b + s);
}

float density_at(vec3 p) {
	return exp(-(length(p) - planet_radius) / scale_height);
}

void fragment() {
	vec3 o = cam_obj;
	vec3 d = normalize(pos_obj - cam_obj);
	vec3 l = normalize(sun_obj);

	vec2 atmo = ray_sphere(o, d, 1.0);
	float t0 = max(atmo.x, 0.0);
	float t1 = atmo.y;
	vec2 ground = ray_sphere(o, d, planet_radius);
	if (ground.x > 0.0 && ground.y > ground.x) {
		t1 = min(t1, ground.x);
	}
	vec3 result = vec3(0.0);
	if (t1 > t0) {
		float dt = (t1 - t0) / float(VIEW_STEPS);
		float od_view = 0.0;
		vec3 sum_r = vec3(0.0);
		vec3 sum_m = vec3(0.0);
		for (int i = 0; i < VIEW_STEPS; i++) {
			vec3 p = o + d * (t0 + (float(i) + 0.5) * dt);
			float dens = density_at(p) * dt;
			od_view += dens;
			// In the planet's shadow? Then no sunlight reaches this sample.
			vec2 shadow = ray_sphere(p, l, planet_radius);
			if (shadow.x > 0.0 && shadow.y > shadow.x) {
				continue;
			}
			float l_len = ray_sphere(p, l, 1.0).y;
			float l_dt = l_len / float(LIGHT_STEPS);
			float od_light = 0.0;
			for (int j = 0; j < LIGHT_STEPS; j++) {
				od_light += density_at(p + l * ((float(j) + 0.5) * l_dt)) * l_dt;
			}
			vec3 tau = (rayleigh + vec3(mie) * 1.1) * (od_view + od_light);
			vec3 atten = exp(-tau);
			sum_r += dens * atten;
			sum_m += dens * atten;
		}
		float mu = dot(d, l);
		float phase_r = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
		float g2 = mie_g * mie_g;
		float phase_m = 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * mie_g * mu, 1.5));
		result = (sum_r * rayleigh * phase_r + sum_m * mie * phase_m) * sun_color * sun_energy;
	}
	if (face_half > 0.0 && !(ground.x > 0.0 && ground.y > ground.x)) {
		vec3 bend;
		vec4 face = devourer(normalize(dir_world), face_right, face_up, face_towards, face_half, bend);
		result *= clamp(1.0 - 0.62 * (1.0 - face.a) + dot(face.rgb, vec3(4.0)), 0.0, 1.15);
	}
	ALBEDO = result;
}
