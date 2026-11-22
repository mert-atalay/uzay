// Schwarzschild black hole: every pixel traces a light ray backwards through curved space.
// Object space is in units of the Schwarzschild radius (event horizon at r = 1). The mesh is
// a big sphere (the "lens region"); outside it space is treated as flat.
//
// What falls out of the physics, with nothing faked:
//  - the shadow (2.6 rs across) and the thin photon ring at its edge,
//  - the far side of the accretion disk bent up over the top and under the bottom,
//  - the real Milky Way smeared into Einstein arcs around it,
//  - one side of the disk brighter and bluer (Doppler beaming), the other dim and red.
shader_type spatial;
render_mode unshaded, cull_front, fog_disabled;

#include "sky.gdshaderinc"

uniform sampler2D panorama : source_color, filter_linear, repeat_enable;
uniform float sky_brightness = 1.0;
uniform mat3 sky_from_world = mat3(1.0);
uniform float lens_radius = 60.0;
uniform vec3 disk_normal = vec3(0.0, 1.0, 0.0);
uniform float disk_inner = 3.0; // innermost stable circular orbit
uniform float disk_outer = 16.0;
uniform float disk_energy = 5.0;

const int MAX_STEPS = 260;

varying vec3 pos_obj;
varying vec3 cam_obj;

void vertex() {
	pos_obj = VERTEX;
	cam_obj = (inverse(MODEL_MATRIX) * vec4(CAMERA_POSITION_WORLD, 1.0)).xyz;
}

float hash21(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
		mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
	float a = 0.5;
	float s = 0.0;
	for (int i = 0; i < 5; i++) {
		s += a * noise(p);
		p = p * 2.03 + 17.1;
		a *= 0.5;
	}
	return s;
}

// Rough blackbody colour for a temperature factor t (1 = warm white).
vec3 blackbody(float t) {
	t = clamp(t, 0.0, 2.5);
	return vec3(1.0, pow(clamp(0.18 + 0.62 * t, 0.0, 1.0), 1.6), pow(clamp(t - 0.42, 0.0, 1.0), 1.35) * 1.15);
}

vec3 sky(vec3 dir) {
	vec3 c = textureLod(panorama, sky_uv(normalize(sky_from_world * dir)), 0.0).rgb;
	return pow(c, vec3(1.35)) * sky_brightness;
}

// Emission where a ray crosses the disk plane at point p (in rs units), travelling along v.
vec4 disk_sample(vec3 p, vec3 v, vec3 n) {
	float r = length(p);
	if (r < disk_inner || r > disk_outer) {
		return vec4(0.0);
	}
	vec3 radial = p / r;
	vec3 tangent = normalize(cross(n, radial));
	// Orbital speed as seen by a static observer (fraction of c), and the resulting Doppler factor.
	float beta = min(sqrt(0.5 / (r - 1.0)), 0.75);
	float gamma = 1.0 / sqrt(1.0 - beta * beta);
	float doppler = 1.0 / (gamma * (1.0 + beta * dot(tangent, normalize(v))));
	float grav = sqrt(1.0 - 1.0 / r);
	float shift = doppler * grav;

	// Differential rotation: inner gas laps outer gas, shearing clumps into streaks.
	vec3 e1 = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
	vec3 e2 = cross(n, e1);
	float ang = atan(dot(p, e2), dot(p, e1));
	float omega = 2.2 * pow(r, -1.5);
	float a = ang + TIME * omega;
	float streaks = fbm(vec2(r * 2.6, a * 3.0 + r * 0.8)) * 0.65 + fbm(vec2(r * 9.0, a * 14.0)) * 0.35;
	float lanes = smoothstep(0.25, 0.75, streaks);

	float temp = pow(disk_inner / r, 0.75);
	float edge = smoothstep(disk_inner, disk_inner * 1.18, r) * smoothstep(disk_outer, disk_outer * 0.55, r);
	vec3 col = blackbody(temp * shift * 1.25) * pow(shift, 3.5) * temp * temp * (0.25 + 1.1 * lanes);
	float alpha = edge * (0.55 + 0.45 * lanes);
	return vec4(col * disk_energy, alpha);
}

void fragment() {
	vec3 n = normalize(disk_normal);
	vec3 pos = cam_obj;
	vec3 vel = normalize(pos_obj - cam_obj);

	// Outside the lens region: jump to where the ray enters it.
	float r_cam = length(pos);
	if (r_cam > lens_radius) {
		float b = dot(pos, vel);
		float disc = b * b - (r_cam * r_cam - lens_radius * lens_radius);
		pos += vel * max(-b - sqrt(max(disc, 0.0)), 0.0);
	}

	vec3 color = vec3(0.0);
	float alpha = 0.0;
	bool captured = r_cam < 1.0;
	bool escaped = false;
	vec3 hvec = cross(pos, vel);
	float h2 = dot(hvec, hvec);

	for (int i = 0; i < MAX_STEPS && !captured && !escaped; i++) {
		float r = length(pos);
		float dt = clamp(0.11 * (r - 0.85), 0.012, 4.0);
		// Leapfrog step of the photon equation of motion around a Schwarzschild mass.
		vec3 acc = -1.5 * h2 * pos / pow(r, 5.0);
		vec3 v_half = vel + acc * (0.5 * dt);
		vec3 next = pos + v_half * dt;
		float rn = length(next);
		vec3 acc2 = -1.5 * h2 * next / pow(rn, 5.0);
		vec3 v_next = v_half + acc2 * (0.5 * dt);

		float side_a = dot(pos, n);
		float side_b = dot(next, n);
		if (side_a * side_b < 0.0 && alpha < 0.995) {
			vec3 hit = mix(pos, next, side_a / (side_a - side_b));
			vec4 d = disk_sample(hit, v_half, n);
			color += (1.0 - alpha) * d.rgb * d.a;
			alpha += (1.0 - alpha) * d.a;
		}

		pos = next;
		vel = v_next;
		if (rn < 1.0) {
			captured = true;
		} else if (rn > lens_radius && dot(pos, vel) > 0.0) {
			escaped = true;
		}
	}

	if (!captured) {
		color += (1.0 - alpha) * sky(vel);
	}
	ALBEDO = color;
}
