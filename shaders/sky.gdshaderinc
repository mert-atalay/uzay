// Shared by the sky sphere and the black hole, so lensed and unlensed sky line up exactly.
// `dir` is in the sky frame (galactic: +Z the galactic centre, +Y galactic north).

// Direction -> equirectangular UV for the Milky Way panorama.
vec2 sky_uv(vec3 dir) {
	return vec2(atan(dir.x, dir.z) / (2.0 * PI) + 0.5, acos(clamp(dir.y, -1.0, 1.0)) / PI);
}

float sky_hash(vec3 p) {
	p = fract(p * vec3(0.1031, 0.1030, 0.0973));
	p += dot(p, p.yzx + 33.33);
	return fract((p.x + p.y) * p.z);
}

float sky_noise(vec3 p) {
	vec3 i = floor(p);
	vec3 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(mix(sky_hash(i), sky_hash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(sky_hash(i + vec3(0.0, 1.0, 0.0)), sky_hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
		mix(mix(sky_hash(i + vec3(0.0, 0.0, 1.0)), sky_hash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(sky_hash(i + vec3(0.0, 1.0, 1.0)), sky_hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
		f.z);
}

float sky_fbm(vec3 p) {
	float a = 0.5;
	float s = 0.0;
	for (int i = 0; i < 4; i++) {
		s += a * sky_noise(p);
		p = p * 2.07 + 11.3;
		a *= 0.5;
	}
	return s;
}

// The countless stars too faint to be in any catalogue: one possible star per cell of a grid
// on the cube around you, more of them where the sky is already bright (the Milky Way's band
// resolves into stars instead of staying a smooth glow). `cells` = grid cells across 90 degrees.
vec3 star_dust(vec3 d, float cells, float chance) {
	vec3 a = abs(d);
	vec3 q;
	float face;
	if (a.x >= a.y && a.x >= a.z) {
		q = vec3(d.y, d.z, a.x);
		face = d.x > 0.0 ? 0.0 : 1.0;
	} else if (a.y >= a.z) {
		q = vec3(d.z, d.x, a.y);
		face = d.y > 0.0 ? 2.0 : 3.0;
	} else {
		q = vec3(d.x, d.y, a.z);
		face = d.z > 0.0 ? 4.0 : 5.0;
	}
	vec2 uv = q.xy / q.z * cells * 0.5;
	vec2 cell = floor(uv);
	vec3 id = vec3(cell, face * 17.0 + cells);
	float pick = sky_hash(id);
	if (pick > chance) {
		return vec3(0.0);
	}
	vec2 centre = vec2(sky_hash(id + 1.7), sky_hash(id + 5.3)) * 0.6 + 0.2;
	float dist = length(fract(uv) - centre);
	float size = 0.12 + 0.16 * sky_hash(id + 9.1);
	float glow = smoothstep(size, 0.0, dist);
	float mag = sky_hash(id + 3.1);
	float warmth = sky_hash(id + 7.7);
	vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.78, 0.55), warmth * warmth);
	return tint * glow * (0.05 + 0.9 * mag * mag * mag * mag);
}

// Everything in the sky along one direction. `core` is 0 near home and 1 at the galactic
// centre, where you are inside the densest star field and gas in the galaxy.
vec3 sky_color(sampler2D pano, vec3 d, float core) {
	vec3 c = textureLod(pano, sky_uv(d), 0.0).rgb;
	float lum = dot(c, vec3(0.3, 0.5, 0.2));
	// A touch more colour than the photograph, still natural.
	c = max(mix(vec3(lum), c, 1.25), vec3(0.0));
	vec3 dust = star_dust(d, 700.0, clamp(0.015 + lum * 5.0, 0.0, 0.8)) * 0.3;
	dust += star_dust(d, 1500.0, clamp(0.02 + lum * 8.0, 0.0, 0.9)) * 0.18;
	vec3 home = c * 0.8 + dust;
	if (core <= 0.001) {
		return home;
	}
	// Galactic centre: stars in every direction, thickest in the plane of the galaxy, behind
	// lanes of dark dust and faintly glowing gas. Old red giants dominate, so the light is warm.
	float plane = exp(-abs(d.y) * 3.2);
	float lanes = sky_fbm(d * 5.0 + vec3(3.1, 0.0, 1.7));
	float fine = sky_fbm(d * 17.0);
	float dark = smoothstep(0.42, 0.62, lanes * 0.7 + fine * 0.3) * plane;
	float thick = clamp(0.25 + 0.75 * plane, 0.0, 1.0) * (1.0 - 0.85 * dark);
	vec3 crowd = star_dust(d, 500.0, 0.4 * thick) * 0.7 + star_dust(d, 1100.0, 0.55 * thick) * 0.4
		+ star_dust(d, 2300.0, 0.7 * thick) * 0.22;
	crowd *= mix(vec3(1.0), vec3(1.0, 0.82, 0.62), 0.6);
	// Unresolved starlight and warm gas: a soft glow hugging the plane, eaten into by the dust.
	float gas = sky_fbm(d * 3.0 + vec3(9.0, 2.0, 4.0));
	vec3 glow = vec3(1.0, 0.62, 0.34) * plane * plane * (0.06 + 0.14 * gas) * (1.0 - dark);
	glow += vec3(0.55, 0.12, 0.1) * smoothstep(0.55, 0.8, gas) * plane * 0.1;
	return mix(home, crowd + glow + c * 0.25, core);
}

// --- The Devourer: a cloud wider than the Solar System, with a face in it. ---
// It is a real thing with a real place: a slab of thin cold mist, fixed in space, that does
// not turn to look at anyone. Each ray of sight is marched through it. All positions here are
// in its own axes and measured in half-heights: x to its side, y from chin (-1) to crown (+1),
// z out of its face (+) towards what it is coming for. The eyes and mouth are hollows in the
// front of the cloud only, so from the side or from behind there is nothing but mist.

const float FACE_DEPTH = 0.42;
const int FACE_STEPS = 12;

// How thick the mist is at q, and (in `feature`) how close q is to an eye or the mouth.
float face_mist(vec3 q, out float wisp) {
	float w = 0.74 * (1.0 - 0.32 * smoothstep(0.1, -1.0, q.y));
	// Pull it about first, so no two parts of its outline match.
	vec3 pull = vec3(sky_noise(q * 1.4 + 31.0), sky_noise(q * 1.4 + 57.0), 0.5) - 0.5;
	vec3 c = q + pull * 0.4;
	wisp = sky_fbm(c * vec3(3.2, 3.2, 1.3) + vec3(4.0, 9.0, 1.0));
	float r = length(vec3(q.x / w, q.y, q.z / FACE_DEPTH));
	// No edge anywhere: it frays out into the dark in long ragged strands.
	float body = 1.0 - smoothstep(0.25, 1.15, r + (wisp - 0.5) * 1.3);
	float fine = sky_fbm(c * vec3(11.0, 11.0, 3.0) + wisp * 2.0);
	return body * (0.1 + 0.9 * smoothstep(0.36, 0.68, wisp * 0.6 + fine * 0.4));
}

// The hollows: 1 inside an eye or the mouth, 0 outside. `mouth` is 0 shut .. 1 gaping.
float face_hollow(vec3 q, float mouth, float wisp, out float near_it) {
	float ax = abs(q.x);
	// Eyes: deep sockets, a little heavier at the outer corners.
	vec2 e = vec2(ax - 0.27, q.y - 0.13 - 0.16 * (ax - 0.27));
	float eye = exp(-pow(e.x / 0.115, 2.0) - pow(e.y / 0.062, 2.0));
	// Mouth: a thin line when shut. The jaw drops as it opens.
	float tall = mix(0.012, 0.27, mouth);
	float wide = mix(0.3, 0.25, mouth);
	vec2 m = vec2(q.x / wide, (q.y + 0.5 + 0.13 * mouth) / tall);
	float gape = exp(-pow(dot(m, m), 1.5)) * (0.45 + 0.55 * mouth);
	// Ragged, like everything else about it.
	float any = max(eye, gape) + (wisp - 0.5) * 0.3;
	// Only the front of the cloud is hollowed: shallow bowls, not tunnels.
	float front = smoothstep(-0.02, 0.08, q.z) * (1.0 - smoothstep(0.2, 0.34, q.z));
	near_it = smoothstep(0.0, 0.6, any) * front;
	return smoothstep(0.3, 0.85, any) * front;
}

// What it does to the sky along `d`. `center` is the middle of it as seen from where you
// stand, in half-heights; `right`, `up` and `normal` are its own fixed axes (normal = out of
// its face). `mouth` is 0 shut .. 1 open. Returns the light it adds in rgb and how much of the
// sky behind it survives in a.
vec4 devourer(vec3 d, vec3 center, vec3 right, vec3 up, vec3 normal, float mouth) {
	// Cheap test first: a ball around the whole thing.
	float along = dot(center, d);
	float miss2 = dot(center, center) - along * along;
	const float REACH = 1.45;
	if (miss2 > REACH * REACH) {
		return vec4(0.0, 0.0, 0.0, 1.0);
	}
	float chord = sqrt(REACH * REACH - miss2);
	float t0 = max(along - chord, 0.0);
	float t1 = along + chord;
	// Then the slab it lives in.
	vec3 o = -vec3(dot(center, right), dot(center, up), dot(center, normal));
	vec3 dl = vec3(dot(d, right), dot(d, up), dot(d, normal));
	float thick = FACE_DEPTH * 1.25;
	if (abs(dl.z) > 1.0e-5) {
		float a = (-thick - o.z) / dl.z;
		float b = (thick - o.z) / dl.z;
		t0 = max(t0, min(a, b));
		t1 = min(t1, max(a, b));
	} else if (abs(o.z) > thick) {
		return vec4(0.0, 0.0, 0.0, 1.0);
	}
	if (t1 <= t0) {
		return vec4(0.0, 0.0, 0.0, 1.0);
	}
	float dt = (t1 - t0) / float(FACE_STEPS);
	float t = t0 + dt * sky_hash(d * 913.0 + 3.0);
	float through = 1.0;
	vec3 light = vec3(0.0);
	// Its features are set into the front of it. Looking across it or from behind, the mist
	// in the way hides them.
	float facing = smoothstep(0.1, 0.6, -dl.z);
	for (int i = 0; i < FACE_STEPS; i++) {
		vec3 q = o + dl * t;
		t += dt;
		float wisp;
		float near_it;
		float mist = face_mist(q, wisp);
		float hollow = face_hollow(q, mouth, wisp, near_it) * facing;
		near_it *= facing;
		// In the hollows there is no mist, and nothing behind them comes back.
		mist *= 1.0 - near_it;
		float void_here = hollow * 14.0;
		float seen = 1.0 - exp(-mist * 3.2 * dt);
		// Cold, faint, a little warmer deep inside. The rims of the hollows catch more of it.
		vec3 tint = mix(vec3(0.28, 0.4, 0.85), vec3(0.62, 0.4, 0.75), wisp);
		float rim = near_it * (1.0 - near_it) * 4.0;
		light += through * seen * tint * (0.075 + 0.1 * rim);
		// Far down in each eye something very small and very old is still alight, and when
		// the mouth is open there is a dull red a long way down its throat.
		vec2 pupil = vec2(abs(q.x) - 0.27, q.y - 0.13);
		float ember = exp(-dot(pupil, pupil) / 0.0004 - pow((q.z - 0.1) / 0.07, 2.0));
		vec2 gullet = vec2(q.x, q.y + 0.5 + 0.13 * mouth) / vec2(0.16, 0.17);
		float throat = exp(-dot(gullet, gullet) * 2.0) * mouth * mouth * smoothstep(0.1, 0.0, abs(q.z));
		light += through * (vec3(0.7, 0.8, 1.0) * ember * 0.6 * facing + vec3(0.55, 0.06, 0.04) * throat * 0.12 * facing) * dt;
		through *= exp(-(mist * 2.6 + void_here) * dt);
	}
	// Even thin mist takes the faint stars. Thick mist takes nearly all of them.
	return vec4(light, through);
}
