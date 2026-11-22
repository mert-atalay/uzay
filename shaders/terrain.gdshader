// The ground near you: a disc of triangles centred under the player that grows with altitude,
// pushed up into hills and mountains. The height formula is the same one TerrainField runs on
// the CPU (src/sim/terrain_field.gd) so you stand exactly on what is drawn. Keep them in step.
//
// Object space: origin at the base-radius point directly below the player, +Y up, metres.
shader_type spatial;
render_mode unshaded, cull_disabled, fog_disabled;

const int LAYERS = 6;
const float TILE = 128.0;
const float SEGMENTS = 192.0;

uniform sampler2D tile : filter_linear, repeat_enable;
uniform float tile_mean = 0.5;
uniform vec2 layer_center[6];
uniform float layer_period[6];
// Cube-face bookkeeping for the point below the player: (a, b, major) components of the
// centre direction and of the two ground axes.
uniform vec3 face_c = vec3(0.0, 0.0, 1.0);
uniform vec3 face_e1 = vec3(1.0, 0.0, 0.0);
uniform vec3 face_e2 = vec3(0.0, 1.0, 0.0);
// The same three vectors in planet-fixed x, y, z (for latitude / longitude lookups).
uniform vec3 fixed_c = vec3(0.0, 0.0, 1.0);
uniform vec3 fixed_e1 = vec3(1.0, 0.0, 0.0);
uniform vec3 fixed_e2 = vec3(0.0, 1.0, 0.0);
uniform float radius = 6.371e6;
uniform float relief = 4500.0;
uniform float amp_scale = 1.0; // fades the terrain in as you come down from orbit
uniform float rho_min = 1.0;
uniform float rho_ratio = 1000.0;

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform bool use_texture = false;
uniform vec3 base_color : source_color = vec3(0.5);
uniform vec3 rock_color : source_color = vec3(0.32, 0.29, 0.27);
uniform bool has_ocean = false;
uniform sampler2D ocean_tex : filter_linear, repeat_enable;
uniform sampler2D cloud_tex : filter_linear_mipmap, repeat_enable;
uniform float cloud_shift = 0.0;
uniform float cloud_amount = 0.0;
uniform vec3 sun_dir_world = vec3(1.0, 0.0, 0.0);
uniform vec3 sun_color : source_color = vec3(1.0);
uniform float sun_energy = 1.0;
uniform vec3 haze_color : source_color = vec3(0.0);
uniform float haze_density = 0.0; // 1 / metres, already thinned for your altitude

varying vec2 ground_xy;
varying vec3 sun_obj;
varying float view_dist;

// Cubic B-spline lookup of the noise tile: value in x, and its slope along both tile axes
// (per unit of tile coordinate) in yz. Smooth to the second derivative, so lighting has no
// creases at texel edges, and exact (no filtering hardware involved) so the CPU copy matches.
vec3 tile_smooth(vec2 c) {
	vec2 p = c * TILE - 0.5;
	vec2 i = floor(p);
	vec2 f = p - i;
	vec2 f2 = f * f;
	vec2 g = 1.0 - f;
	vec2 w[4] = { g * g * g / 6.0, (3.0 * f2 * f - 6.0 * f2 + 4.0) / 6.0, (-3.0 * f2 * f + 3.0 * f2 + 3.0 * f + 1.0) / 6.0, f2 * f / 6.0 };
	vec2 dw[4] = { -0.5 * g * g, 1.5 * f2 - 2.0 * f, -1.5 * f2 + f + 0.5, 0.5 * f2 };
	ivec2 base = ivec2(i) - 1;
	int n = int(TILE);
	vec3 r = vec3(0.0);
	for (int y = 0; y < 4; y++) {
		for (int x = 0; x < 4; x++) {
			ivec2 q = ivec2((base.x + x) % n, (base.y + y) % n);
			q += n * ivec2(lessThan(q, ivec2(0)));
			float t = texelFetch(tile, q, 0).r;
			r += t * vec3(w[x].x * w[y].y, dw[x].x * w[y].y, w[x].x * dw[y].y);
		}
	}
	return vec3(r.x, r.yz * TILE);
}

vec3 fixed_dir(vec2 xy) {
	return normalize(fixed_c + (xy.x * fixed_e1 + xy.y * fixed_e2) / radius);
}

vec2 lat_long_uv(vec3 d) {
	return vec2(fract(atan(d.x, d.z) / 6.28318530718), acos(clamp(d.y, -1.0, 1.0)) / 3.14159265359);
}

float land_at(vec2 uv) {
	if (!has_ocean) {
		return 1.0;
	}
	return smoothstep(0.35, 0.65, 1.0 - textureLod(ocean_tex, uv, 0.0).r);
}

// Height in metres at ground position xy (metres along the two ground axes from the centre),
// with its slope along both axes in yz. `spacing` is how far apart samples are here: layers
// finer than that are faded to their average so distant ground does not shimmer.
vec3 terrain_height(vec2 xy, float spacing, out float detail) {
	float pm = xy.x * face_e1.z + xy.y * face_e2.z;
	float denom = face_c.z + pm / radius;
	vec2 d = (xy.x * face_e1.xy + xy.y * face_e2.xy - (face_c.xy / face_c.z) * pm) / denom;
	// How the face coordinates change per metre along each ground axis.
	vec2 d_dx = (face_e1.xy - (face_c.xy / face_c.z) * face_e1.z - d * face_e1.z / radius) / denom;
	vec2 d_dy = (face_e2.xy - (face_c.xy / face_c.z) * face_e2.z - d * face_e2.z / radius) / denom;
	float n[6];
	vec2 grad[6];
	for (int l = 0; l < LAYERS; l++) {
		bool swap = l % 2 == 1;
		float w = smoothstep(0.5, 2.0, layer_period[l] / (12.0 * max(spacing, 1e-4)));
		vec3 t = tile_smooth(layer_center[l] + (swap ? d.yx : d.xy) / layer_period[l]);
		n[l] = mix(tile_mean, t.x, w);
		vec2 slope = (swap ? t.zy : t.yz) * (w / layer_period[l]); // per metre of face coordinate
		grad[l] = vec2(dot(slope, vec2(d_dx.x, d_dx.y)), dot(slope, vec2(d_dy.x, d_dy.y)));
	}
	detail = n[3] * 0.5 + n[4] * 0.3 + n[5] * 0.2;
	float mid = 0.32 * n[1] + 0.06 * n[2];
	float ramp = 0.3 + 1.4 * n[0];
	float k = relief * amp_scale;
	float h = n[0] * n[0] + ramp * mid + 0.004 * n[3] + 0.0004 * n[4] + 0.00004 * n[5];
	vec2 dh = (2.0 * n[0] + 1.4 * mid) * grad[0] + ramp * (0.32 * grad[1] + 0.06 * grad[2])
		+ 0.004 * grad[3] + 0.0004 * grad[4] + 0.00004 * grad[5];
	return vec3(h, dh) * k;
}

void vertex() {
	float rho = VERTEX.y > 0.5 ? 0.0 : rho_min * pow(rho_ratio, VERTEX.x);
	vec2 xy = rho * vec2(cos(VERTEX.z), sin(VERTEX.z));
	float spacing = max(rho * 6.28318530718 / SEGMENTS, rho_min * 0.25);
	float detail;
	float h = terrain_height(xy, spacing, detail).x * land_at(lat_long_uv(fixed_dir(xy)));
	// Wrap the flat disc onto the sphere, written so float32 keeps millimetres near the centre.
	float q = rho / radius;
	float root = sqrt(1.0 + q * q);
	float k = 1.0 / root;
	float km1 = -q * q / (root * (1.0 + root));
	float s = (1.0 + h / radius) * k;
	VERTEX = vec3(xy.x * s, h * k + radius * km1, xy.y * s);
	ground_xy = xy;
	mat3 rot = mat3(normalize(MODEL_MATRIX[0].xyz), normalize(MODEL_MATRIX[1].xyz), normalize(MODEL_MATRIX[2].xyz));
	sun_obj = transpose(rot) * sun_dir_world;
	view_dist = length((MODELVIEW_MATRIX * vec4(VERTEX, 1.0)).xyz) / length(MODEL_MATRIX[0].xyz);
}

void fragment() {
	vec2 xy = ground_xy;
	float e = clamp(0.7 * max(length(dFdx(xy)), length(dFdy(xy))), 0.02, 2.0e5);
	vec3 dirf = fixed_dir(xy);
	vec2 uv = lat_long_uv(dirf);
	// Texture lookups across the longitude seam would otherwise pick the smallest mip.
	vec2 uv_b = vec2(fract(uv.x + 0.5) - 0.5, uv.y);
	bool seam = fwidth(uv.x) > fwidth(uv_b.x);
	vec2 gx = seam ? dFdx(uv_b) : dFdx(uv);
	vec2 gy = seam ? dFdy(uv_b) : dFdy(uv);
	float land = land_at(uv);

	float detail;
	vec3 ground = terrain_height(xy, e, detail);
	vec3 up = normalize(vec3(xy.x, radius, xy.y));
	vec3 n = normalize(up - land * vec3(ground.y, 0.0, ground.z));
	vec3 l = normalize(sun_obj);
	float ndl = dot(n, l);
	// The curve of the planet shades whole regions at dusk; slopes add the relief on top.
	float day = smoothstep(-0.05, 0.12, dot(up, l));
	float lit = max(ndl, 0.0) * day;

	vec3 surface = use_texture ? textureGrad(albedo_tex, uv, gx, gy).rgb : base_color;
	float slope = 1.0 - dot(n, up);
	float near_fade = 1.0 - smoothstep(2.0e3, 6.0e4, view_dist);
	// Up close the map is a blur, so break it up: grain, and bare rock on steep ground.
	surface *= mix(1.0, 0.72 + 0.56 * detail, near_fade);
	surface = mix(surface, rock_color * (0.7 + 0.6 * detail), smoothstep(0.12, 0.45, slope) * 0.75 * near_fade * land);

	vec3 color = surface * lit;
	if (has_ocean && land < 0.5) {
		// Sun glint, taking straight up as the view direction (close enough from low down).
		vec3 hv = normalize(l + up);
		color += vec3(1.0, 0.95, 0.85) * pow(max(dot(up, hv), 0.0), 420.0) * 0.7 * day * (1.0 - land * 2.0) * cloud_amount;
	}
	if (cloud_amount > 0.001) {
		float cloud = smoothstep(0.08, 0.85, textureGrad(cloud_tex, uv + vec2(cloud_shift, 0.0), gx, gy).r);
		color = mix(color, vec3(max(dot(up, l), 0.0)), cloud * 0.92 * cloud_amount);
	}
	// Air between you and far ground.
	float haze = 1.0 - exp(-view_dist * haze_density);
	color = mix(color, haze_color * (0.15 + 0.85 * day), haze);
	ALBEDO = color * sun_color * sun_energy;
}
