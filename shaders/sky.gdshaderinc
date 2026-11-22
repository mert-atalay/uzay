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

// --- The Devourer: a face carved into space itself. ---
// It has no flesh. It is seen by what it does to the sky: the stars thin out across it, are
// gone entirely in the hollows of its eyes and mouth, and the relief of its features catches a
// little cold light. All of this is worked out in two dimensions on the sky: `p` is a point on
// its face, x to its left and right, y from chin (-1) to crown (+1).

// How far each part of the face stands out of the sky: 0 = not there, about 1 = the nose.
float face_relief(vec2 p) {
	// The skull: tall, narrowing to the chin.
	float w = 0.7 * (1.0 - 0.3 * smoothstep(0.1, -1.0, p.y));
	float r2 = (p.x * p.x) / (w * w) + p.y * p.y;
	float h = sqrt(max(1.0 - r2, 0.0)) * 0.75;
	float ax = abs(p.x);
	// Brow ridge, and the hollows of the eyes under it.
	h += 0.14 * exp(-pow((p.y - 0.25) / 0.075, 2.0)) * smoothstep(0.62, 0.12, ax);
	vec2 e = vec2(ax - 0.27, p.y - 0.1);
	h -= 0.42 * exp(-pow(e.x / 0.165, 2.0) - pow(e.y / 0.085, 2.0));
	// Nose: a long ridge, strongest at the tip.
	float along = smoothstep(0.3, 0.12, p.y) * smoothstep(-0.34, -0.22, p.y);
	h += 0.26 * exp(-pow(p.x / 0.065, 2.0)) * along * (0.35 + 0.65 * smoothstep(0.25, -0.25, p.y));
	h += 0.07 * exp(-pow((ax - 0.085) / 0.05, 2.0) - pow((p.y + 0.26) / 0.05, 2.0));
	// Cheekbones, the hollows under them, and the chin.
	h += 0.1 * exp(-pow((ax - 0.43) / 0.16, 2.0) - pow((p.y + 0.04) / 0.13, 2.0));
	h -= 0.1 * exp(-pow((ax - 0.36) / 0.14, 2.0) - pow((p.y + 0.42) / 0.16, 2.0));
	h += 0.08 * exp(-pow(p.x / 0.2, 2.0) - pow((p.y + 0.8) / 0.11, 2.0));
	// The mouth: closed, a long line, with the lips above and below it.
	float lip_w = smoothstep(0.34, 0.2, ax);
	h += 0.07 * exp(-pow((p.y + 0.46) / 0.04, 2.0)) * lip_w + 0.06 * exp(-pow((p.y + 0.6) / 0.05, 2.0)) * lip_w;
	h -= 0.2 * exp(-pow((p.y + 0.525) / 0.022, 2.0)) * lip_w;
	return max(h, 0.0);
}

// What the face does to the sky along `d`. `right`, `up` and `towards` are its axes as seen
// from where you stand (`towards` points at the middle of it), `span` is half the angle it
// spans, chin to crown. Returns the light it adds in rgb and how much of the sky behind it
// survives in a. `bend` is how far the stars behind it are pushed aside (add to `d`).
vec4 devourer(vec3 d, vec3 right, vec3 up, vec3 towards, float span, out vec3 bend) {
	bend = vec3(0.0);
	if (span <= 0.0) {
		return vec4(0.0, 0.0, 0.0, 1.0);
	}
	float ang = acos(clamp(dot(d, towards), -1.0, 1.0));
	if (ang > span * 1.9) {
		return vec4(0.0, 0.0, 0.0, 1.0);
	}
	vec2 plane = vec2(dot(d, right), dot(d, up));
	vec2 p = plane / max(length(plane), 1.0e-5) * (ang / span);
	float h = face_relief(p);
	float eps = 0.012;
	float hx = face_relief(p + vec2(eps, 0.0)) - face_relief(p - vec2(eps, 0.0));
	float hy = face_relief(p + vec2(0.0, eps)) - face_relief(p - vec2(0.0, eps));
	vec3 n = normalize(vec3(-hx, -hy, eps * 2.0 * 1.6));
	// It has no edge. Its features rise out of the dark and the rest of it is lost in the
	// stars: brow, eyes, nose and mouth are clear, crown and jaw dissolve raggedly.
	float pits = sky_fbm(vec3(p * 7.0, 3.0)) * 0.6 + sky_fbm(vec3(p * 31.0, 7.0)) * 0.4;
	float w = 0.7 * (1.0 - 0.3 * smoothstep(0.1, -1.0, p.y));
	float rim = sqrt((p.x * p.x) / (w * w) + p.y * p.y);
	float there = 1.0 - smoothstep(0.5, 1.0, rim + (pits - 0.5) * 0.5);
	// Space bends around it: the stars behind are pushed off the high ground.
	bend = (right * hx + up * hy) * span * 1.2 * there;
	// Lit from above and to one side by nothing in particular. It is made of the same thin
	// dust and starlight as the rest of the sky, only heaped into a shape.
	float lit = max(dot(n, normalize(vec3(-0.45, 0.6, 0.66))), 0.0);
	vec3 dust = mix(vec3(0.3, 0.42, 0.8), vec3(0.6, 0.42, 0.72), sky_fbm(vec3(p * 2.5, 19.0)));
	vec3 stone = dust * (0.004 + 0.07 * pow(lit, 1.7)) * (0.35 + 1.3 * pits);
	// The hollows: eyes and the line of the mouth. Nothing comes back from there.
	float ax = abs(p.x);
	float socket = exp(-pow((ax - 0.27) / 0.15, 2.0) - pow((p.y - 0.1) / 0.075, 2.0));
	float mouth = exp(-pow((p.y + 0.525) / 0.02, 2.0)) * smoothstep(0.34, 0.2, ax);
	float hollow = clamp(smoothstep(0.35, 0.8, socket) + smoothstep(0.4, 0.9, mouth), 0.0, 1.0);
	stone *= 1.0 - hollow;
	// Far down in each eye, something very small and very old is still alight.
	float ember = exp(-(pow(ax - 0.27, 2.0) + pow(p.y - 0.1, 2.0)) / 0.00005);
	stone += vec3(0.7, 0.8, 1.0) * ember * 0.1;
	// Stars survive on the lit ridges, as if it were made of them, and are gone in its shadows.
	// Around it the sky itself is worn thin.
	float halo = 1.0 - smoothstep(0.8, 1.9, ang / span + (pits - 0.5) * 0.5);
	float survive = (1.0 - there * (0.9 - 0.55 * pow(lit, 1.5))) * (1.0 - hollow * there) * (1.0 - 0.4 * halo * (1.0 - there));
	return vec4(stone * there, survive);
}
