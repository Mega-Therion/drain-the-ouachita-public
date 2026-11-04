import { COMMON_GLSL } from '../render/common.js';

export const WATER_VERT = /* glsl */`
${COMMON_GLSL}
uniform vec4 uNodeRect;
uniform vec4 uDataX;
uniform sampler2D uHeightTex;
uniform sampler2D uClassTex;
varying vec3 vWorld;
varying vec2 vTc;
varying float vSurf;

const float CORE_N = 257.0;
vec2 dataTc(vec2 uv) { vec2 d = uDataX.xy + clamp(uv, 0.0, 1.0) * uDataX.z; return (d * (CORE_N - 1.0) + 0.5) / CORE_N; }

void main() {
  float M = uNodeRect.w;
  vec2 uv = position.xz / M;
  float best = -1e4;
  float anyBasin = 0.0;
  for (int dy = -2; dy <= 2; dy++) for (int dx = -2; dx <= 2; dx++) {
    vec2 tc = dataTc(uv + vec2(dx, dy) * 0.5 / M);
    vec2 hs = textureLod(uHeightTex, tc, 0.0).rg + uDataX.w;
    vec4 c = textureLod(uClassTex, tc, 0.0);
    anyBasin = max(anyBasin, step(0.5, c.r));
    if (hs.g > -9000.0) best = max(best, hs.g);
  }
  // narrow arms can fall between coarse vertices: a vertex that sees neither basin nor fixed water
  // sits at the lake level anyway (per-pixel class tests in the fragment shader decide what is water)
  float surf = anyBasin > 0.5 ? max(uWater.x, best) : (best > -9000.0 ? best : uWater.x);
  vSurf = surf;
  vec3 wp = vec3(uNodeRect.x + uv.x * uNodeRect.z, toY(surf), uNodeRect.y + uv.y * uNodeRect.z);
  vWorld = wp;
  vTc = dataTc(uv);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

export const WATER_FRAG = /* glsl */`
${COMMON_GLSL}
uniform vec4 uDataX;
uniform sampler2D uHeightTex;
uniform sampler2D uNormalTex;
uniform sampler2D uClassTex;
uniform sampler2D uSceneTex;
uniform sampler2D uWaterNormal;
uniform sampler2D uReflTex;
uniform mat4 uReflMat;
uniform float uReflOn;
uniform vec2 uViewport;
uniform float uWind;       // 0 calm .. 1 choppy
uniform float uClarity;    // >1 clearer
varying vec3 vWorld;
varying vec2 vTc;
varying float vSurf;

vec3 waterNormal(vec2 p, vec2 flow, float t, float dist) {
  float w = 0.35 + uWind * 0.9;
  vec2 f = flow * t;
  vec3 n1 = texture(uWaterNormal, (p + f * 1.0) * 0.045 + vec2(t * 0.011, t * 0.007)).xyz * 2.0 - 1.0;
  vec3 n2 = texture(uWaterNormal, (p + f * 0.8) * 0.11 + vec2(-t * 0.017, t * 0.013)).xyz * 2.0 - 1.0;
  vec3 n3 = texture(uWaterNormal, p * 0.012 + vec2(t * 0.004, -t * 0.003)).xyz * 2.0 - 1.0;
  vec2 xy = (n1.xy * 0.55 + n2.xy * 0.35 + n3.xy * 0.6) * w;
  xy *= mix(1.0, 0.35, clamp(dist / 4000.0, 0.0, 1.0));   // calmer looking in the distance
  return normalize(vec3(xy.x, 1.0, xy.y));
}

void main() {
  vec4 cls = texture(uClassTex, vTc);
  vec2 hs = texture(uHeightTex, vTc).rg + uDataX.w;
  float bed = hs.r;
  bool allowed = cls.r > 0.5 || cls.a > 0.5 || hs.g > bed + 0.01;
  if (!allowed) discard;
  float surf = vSurf;
  float depth = surf - bed;
  if (depth <= 0.02) discard;
  if (cls.a > 0.5 && cls.r < 0.5) depth = max(depth, 7.0);   // fixed lakes: unknown depth

  vec3 V = cameraPosition - vWorld;
  float dist = length(V);
  V /= dist;
  bool under = !gl_FrontFacing || cameraPosition.y < vWorld.y;
  // flowing water along the old channel: downhill direction of the bed
  vec3 bn = texture(uNormalTex, vTc).xyz * 2.0 - 1.0;
  vec2 flow = normalize(bn.xz + 1e-4) * cls.g * smoothstep(0.0, 0.02, length(bn.xz)) * 1.8 * (1.0 - smoothstep(2.0, 5.0, depth));
  vec3 N = waterNormal(vWorld.xz, flow, uTime, dist);
  vec2 suv = gl_FragCoord.xy / uViewport;

  if (under) {
    // looking up at the surface from below: Snell's window
    vec3 Nu = -N;
    float cosT = dot(-V, vec3(0.0, 1.0, 0.0));
    vec3 col;
    vec3 refr = refract(-V, Nu, 1.33);
    if (dot(refr, refr) > 0.0 && refr.y > 0.0) {
      col = skyColor(refr) * 0.9 + uLightColor * pow(max(dot(refr, uSunDir), 0.0), 200.0) * 2.0;
    } else {
      col = uWaterTint * (uSkyUp + uLightColor * 0.2) * 1.2;
    }
    float T = exp(-dist * 0.06 / uClarity);
    col = col * T + uWaterTint * (uSkyUp * 0.6 + uLightColor * 0.25) * (1.0 - T);
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  // refraction: what is behind the surface (bed, timber), absorbed along the path
  float pathLen = depth / max(V.y, 0.12) + depth;
  vec2 dis = N.xz * 0.035 * clamp(depth, 0.0, 3.0) / (1.0 + dist * 0.01);
  vec3 behind = texture(uSceneTex, suv + dis).rgb;
  float pm = pingMask(vWorld);
  vec3 sigma = vec3(0.42, 0.10, 0.075) / uClarity * (1.0 - 0.85 * pm);
  vec3 Tr = exp(-sigma * pathLen);
  vec3 scat = uWaterTint * (ambientLight(vec3(0.0, 1.0, 0.0)) * 1.2 + uLightColor * max(uSunDir.y, 0.0) * 0.35);
  vec3 col = behind * Tr + scat * (1.0 - Tr);

  // reflection
  float cosV = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
  F *= mix(1.0, 0.75, clamp(dist / 8000.0, 0.0, 1.0));
  vec3 R = reflect(-V, N);
  // distant water: sub-pixel waves average the reflection over a lobe that sees higher sky
  float lobe = clamp(dist / 6000.0, 0.0, 1.0) * (0.06 + 0.12 * uWind);
  vec3 refl = skyColor(normalize(vec3(R.x, abs(R.y) + lobe, R.z)));
  if (uReflOn > 0.5 && abs(surf - uWater.x) < 0.3) {
    vec4 rp = uReflMat * vec4(vWorld, 1.0);
    vec2 ruv = rp.xy / rp.w + N.xz * 0.02;
    vec4 rc = texture(uReflTex, ruv);
    refl = mix(refl, rc.rgb, rc.a);
  }
  col = mix(col, refl, F);

  // sun glitter
  vec3 H = normalize(uLightDir + V);
  float nh = max(dot(N, H), 0.0);
  float spec = pow(nh, 900.0) * 18.0 + pow(nh, 120.0) * 0.6 * (0.3 + uWind);
  col += uLightColor * spec * cloudShadow(vWorld) * step(0.0, uLightDir.y);

  // shoreline foam / rapids
  float foamEdge = 1.0 - smoothstep(0.0, 0.45 + uWind * 0.6, depth);
  float steep = cls.g * smoothstep(0.22, 0.4, length(bn.xz)) * (1.0 - smoothstep(0.4, 1.2, depth));
  float fn = fbm2(vWorld.xz * 0.6 + flow * uTime * 2.0 + vec2(uTime * 0.2, 0.0));
  float foam = clamp(foamEdge * smoothstep(0.35, 0.75, fn + foamEdge * 0.4) + steep * smoothstep(0.4, 0.8, fn), 0.0, 1.0);
  foam *= clamp(1.0 - dist / 1500.0, 0.0, 1.0);
  col = mix(col, (uLightColor * max(uLightDir.y, 0.0) + ambientLight(vec3(0.0, 1.0, 0.0))) * 0.75, foam * 0.85);

  // draining: foam streaks run down the shallows toward deeper water
  if (uDrainRate > 0.02 && depth < 2.5) {
    vec2 down = normalize(bn.xz + 1e-4);
    float st = fbm2(vec2(dot(vWorld.xz, vec2(-down.y, down.x)) * 2.0, dot(vWorld.xz, down) * 0.3 - uTime * 3.0));
    col = mix(col, vec3(0.6) * (uLightColor * 0.3 + uSkyUp), smoothstep(0.6, 0.8, st) * uDrainRate * (1.0 - depth / 2.5) * 0.6);
  }
  col *= 1.0 - 0.25 * pm;
  col += vec3(0.2, 0.9, 1.0) * pingRing(vWorld) * 0.8;
  col = applyAerial(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;
