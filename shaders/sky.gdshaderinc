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

// The hole the Devourer leaves in the sky: everything within a ragged patch around `vdir` is
// gone. Returns how much of the sky survives along `d` (0 inside the hole, 1 outside), and in
// `edge` how close `d` is to the torn rim. `vrad` is the patch's angular radius in radians.
float void_mask(vec3 d, vec3 vdir, float vrad, out float edge) {
	edge = 0.0;
	if (vrad <= 0.0) {
		return 1.0;
	}
	float ang = acos(clamp(dot(d, vdir), -1.0, 1.0));
	float ragged = sky_fbm(d * 5.0 + 2.0) * 0.65 + sky_fbm(d * 21.0) * 0.35;
	float r = vrad * (0.5 + 1.0 * ragged);
	float soft = 0.002 + vrad * 0.012;
	edge = exp(-abs(ang - r) / soft);
	return smoothstep(r - soft, r + soft, ang);
}
