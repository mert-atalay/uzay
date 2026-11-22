// The Devourer: a body so dark it is mostly seen by the stars it covers. A cold sheen along
// its edges, slow veins of light under the skin, a scatter of small eyes near the mouth, and a
// throat that glows the wrong colour. UV2.x = part (0 body, 0.5 jaw prong, 0.75 tendril,
// 1 fin), UV2.y = a random phase per part, UV.y = 0..1 along the part. UV.y = 0..1 along.
shader_type spatial;
render_mode unshaded, cull_disabled, fog_disabled;

uniform float presence = 0.2; // 0 far away (a shadow), 1 close (every detail lit)
uniform vec3 sun_dir_world = vec3(0.0, 1.0, 0.0);
uniform float sun_energy = 1.0;

varying vec3 opos;

float hash3(vec3 p) {
	p = fract(p * vec3(0.1031, 0.1030, 0.0973));
	p += dot(p, p.yzx + 33.33);
	return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
	vec3 i = floor(p);
	vec3 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(mix(hash3(i), hash3(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
		mix(mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
		f.z);
}

float fbm3(vec3 p) {
	float a = 0.5;
	float s = 0.0;
	for (int i = 0; i < 4; i++) {
		s += a * noise3(p);
		p = p * 2.03 + 7.1;
		a *= 0.5;
	}
	return s;
}

void vertex() {
	float part_id = UV2.x;
	opos = VERTEX;
	float z = VERTEX.z;
	float t = TIME * 0.16;
	// The whole length swims: a slow wave that grows towards the tail.
	float w = smoothstep(0.04, 1.0, z);
	VERTEX.x += 0.07 * w * sin(z * 6.5 - t);
	VERTEX.y += 0.045 * w * sin(z * 4.7 - t * 0.8 + 1.3);
	if (part_id > 0.6 && part_id < 0.9) {
		// Tendrils trail and wander on their own.
		float s = UV.y;
		float ph = UV2.y * 6.283;
		VERTEX.x += 0.06 * s * s * sin(s * 7.0 - t * 1.7 + ph);
		VERTEX.y += 0.06 * s * s * cos(s * 6.0 - t * 1.4 + ph * 1.7);
	} else if (part_id > 0.9) {
		// Fins beat, slowly.
		float s = UV.y;
		VERTEX.y += 0.07 * s * s * sin(t * 2.2 - z * 5.0 + UV2.y * 3.14159);
	} else if (part_id > 0.4) {
		// The jaw opens and closes a little, like breathing.
		float s = UV.y;
		vec2 radial = normalize(VERTEX.xy + vec2(1.0e-5));
		VERTEX.xy += radial * 0.012 * s * sin(t * 1.9 + UV2.y * 0.6);
	}
}

void fragment() {
	vec3 n = normalize(NORMAL);
	if (!FRONT_FACING) {
		n = -n;
	}
	float part = UV2.x;
	float facing = abs(dot(n, normalize(VIEW)));
	float rim = pow(clamp(1.0 - facing, 0.0, 1.0), 3.0);
	vec3 sun_v = normalize((VIEW_MATRIX * vec4(sun_dir_world, 0.0)).xyz);
	float lit = max(dot(n, sun_v), 0.0) * sun_energy;
	float grain = fbm3(opos * vec3(70.0, 70.0, 28.0));
	// Skin: almost nothing. Just enough to give it a shape where the Sun catches it.
	vec3 c = vec3(0.006, 0.008, 0.013) * lit * (0.5 + grain);
	c += vec3(0.1, 0.16, 0.36) * rim * rim * (0.3 + 0.7 * presence) * 0.09;
	if (part < 0.25) {
		float along = UV.y;
		if (FRONT_FACING) {
			// Veins of light under the skin, pulsing towards the mouth.
			float ridged = 1.0 - abs(2.0 * fbm3(opos * vec3(46.0, 46.0, 15.0) + 3.0) - 1.0);
			float veins = pow(clamp(ridged, 0.0, 1.0), 12.0);
			float pulse = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(opos.z * 26.0 + TIME * 0.5), 3.0);
			c += mix(vec3(0.4, 0.15, 0.95), vec3(0.1, 0.7, 0.75), grain) * veins * pulse * 0.22 * presence;
			// Eyes: far too many, crowded behind the jaw. Each one blinks on its own time.
			if (along > 0.012 && along < 0.16) {
				vec2 g = vec2(UV.x * 34.0, along * 300.0);
				vec2 cell = floor(g);
				float pick = hash3(vec3(cell, 4.0));
				if (pick < 0.07) {
					vec2 centre = vec2(hash3(vec3(cell, 1.0)), hash3(vec3(cell, 2.0))) * 0.5 + 0.25;
					float d = length(fract(g) - centre);
					float blink = smoothstep(-0.2, 0.1, sin(TIME * (0.15 + pick * 2.0) + pick * 90.0));
					float fade = smoothstep(0.16, 0.06, along);
					c += vec3(0.75, 0.85, 1.0) * smoothstep(0.13, 0.04, d) * blink * fade * (0.08 + 0.5 * presence);
				}
			}
		} else {
			// Down the throat: rings of light sliding inward, and something pale at the bottom.
			float rings = pow(0.5 + 0.5 * sin(along * 150.0 + TIME * 1.1), 10.0);
			c = vec3(0.45, 0.12, 0.85) * rings * exp(-along * 7.0) * (0.06 + 0.16 * presence);
			c += vec3(0.5, 0.2, 0.7) * exp(-along * 22.0) * 0.04;
			c += vec3(0.8, 0.72, 1.0) * smoothstep(0.3, 0.9, along) * (0.06 + 0.22 * presence);
		}
	} else if (part < 0.6) {
		// Jaw prongs: black, with a cold light at the tips.
		c += vec3(0.5, 0.6, 1.0) * pow(clamp(UV.y, 0.0, 1.0), 10.0) * (0.04 + 0.25 * presence);
	} else {
		// Tendrils and fins: a faint line of light that travels along them.
		float run = pow(0.5 + 0.5 * sin(UV.y * 22.0 - TIME * 0.7 + UV2.y * 40.0), 14.0);
		c += vec3(0.3, 0.5, 0.9) * run * 0.12 * presence;
	}
	ALBEDO = c;
}
