// Loose rocks and boulders on the ground (src/game/surface_rocks.gd). Lit like the terrain:
// one star, hard light, the same haze. Each rock takes the colour of the ground it sits on.
shader_type spatial;
render_mode unshaded, fog_disabled;

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform bool use_texture = false;
uniform vec3 base_color : source_color = vec3(0.5);
uniform vec3 rock_color : source_color = vec3(0.32, 0.29, 0.27);
uniform vec3 sun_dir_world = vec3(1.0, 0.0, 0.0);
uniform vec3 up_world = vec3(0.0, 1.0, 0.0);
uniform vec3 sun_color : source_color = vec3(1.0);
uniform float sun_energy = 1.0;
uniform vec3 haze_color : source_color = vec3(0.0);
uniform float haze_density = 0.0;

varying vec3 normal_world;
varying vec4 custom;
varying float view_dist;
varying float height;

void vertex() {
	custom = INSTANCE_CUSTOM;
	height = VERTEX.y;
	// Shrink into the ground at the edge of the range instead of popping.
	float d = length(MODELVIEW_MATRIX[3].xyz);
	VERTEX *= 1.0 - smoothstep(0.7 * custom.r, custom.r, d);
	normal_world = normalize(mat3(MODEL_MATRIX) * NORMAL);
	view_dist = d;
}

void fragment() {
	vec3 n = normalize(normal_world);
	vec3 l = normalize(sun_dir_world);
	float day = smoothstep(-0.05, 0.12, dot(up_world, l));
	float lit = max(dot(n, l), 0.0) * day;
	vec3 ground = use_texture ? textureLod(albedo_tex, custom.ba, 0.0).rgb : base_color;
	vec3 color = mix(ground, rock_color, 0.55) * (0.75 + 0.5 * custom.g);
	// Darker where it meets the ground.
	color *= mix(0.55, 1.0, smoothstep(-0.5, 0.3, height));
	color *= lit;
	float haze = 1.0 - exp(-view_dist * haze_density);
	color = mix(color, haze_color * (0.15 + 0.85 * day), haze);
	ALBEDO = color * sun_color * sun_energy;
}
