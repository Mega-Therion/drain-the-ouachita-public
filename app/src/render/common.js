import * as THREE from 'three';

// Global uniforms shared (by reference) across all custom materials.
export const RT = { type: THREE.HalfFloatType };

export const G = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uLightDir: { value: new THREE.Vector3(0, 1, 0) },
  uLightColor: { value: new THREE.Color(3, 3, 3) },
  uSkyUp: { value: new THREE.Color(0.3, 0.45, 0.7) },
  uSkyHorizon: { value: new THREE.Color(0.5, 0.6, 0.7) },
  uGroundBounce: { value: new THREE.Color(0.08, 0.08, 0.06) },
  uSkyLUT: { value: null },
  uFog: { value: new THREE.Vector4(0.00004, 1600, 0.0, 260) },
  uFogSun: { value: new THREE.Color(1, 0.9, 0.7) },
  uNight: { value: 0 },
  uCloud: { value: new THREE.Vector4(0.3, 0, 0, 0.6) },
  uWater: { value: new THREE.Vector4(176.17, 176.17, 0, 0) }, // level, full pool, cam underwater, surface at cam
  uExag: { value: new THREE.Vector2(1, 100) }, // vertical exaggeration, datum
  uNoiseTex: { value: null },
  uShadowMap0: { value: null },
  uShadowMat0: { value: new THREE.Matrix4() },
  uShadowMap1: { value: null },
  uShadowMat1: { value: new THREE.Matrix4() },
  uShadowOn: { value: new THREE.Vector4(0, 0, 1 / 2048, 1 / 1024) },
  uViewport: { value: new THREE.Vector2(1, 1) },
  uSonar: { value: 0 },
  uOldMap: { value: null },
  uOldMapOn: { value: 0 },
  uTrails: { value: null },
  uTrailOn: { value: new THREE.Vector3(0, 0, 0) },  // bike, hike, roads (0..1)
  uTrailDMax: { value: 64 },
  uAreas: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 0, 0)) }, // x, z, radius, strength
  uAreaOn: { value: 0 },
  uCanopy: { value: null },
  uCanopyOn: { value: 0 },
  uCanopyFade: { value: new THREE.Vector2(500, 900) },
  uRegionRect: { value: new THREE.Vector4(0, 0, 1, 1) },
  uDrainRate: { value: 0 },
  uPing: { value: new THREE.Vector4(0, 0, 0, 0) }, // x, z, radius (m), strength
  uContours: { value: 0 },
  uWaterTint: { value: new THREE.Color(0.012, 0.055, 0.06) },
  uDryTime: { value: null }, // 1D texture: hours since exposure per elevation
  uDryRange: { value: new THREE.Vector2(100, 190) },
};

export const COMMON_GLSL = /* glsl */`
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uSkyUp;
uniform vec3 uSkyHorizon;
uniform vec3 uGroundBounce;
uniform sampler2D uSkyLUT;
uniform vec4 uFog;
uniform vec3 uFogSun;
uniform float uNight;
uniform vec4 uCloud;
uniform vec4 uWater;
uniform vec2 uExag;
uniform sampler2D uNoiseTex;
uniform sampler2DShadow uShadowMap0;
uniform mat4 uShadowMat0;
uniform sampler2DShadow uShadowMap1;
uniform mat4 uShadowMat1;
uniform vec4 uShadowOn;
uniform vec3 uWaterTint;
uniform float uDrainRate;
uniform vec4 uPing;

float pingMask(vec3 wp) {
  if (uPing.w <= 0.0) return 0.0;
  float d = length(wp.xz - uPing.xy);
  return (1.0 - smoothstep(uPing.z * 0.85, uPing.z, d)) * uPing.w;
}
float pingRing(vec3 wp) {
  if (uPing.w <= 0.0) return 0.0;
  float d = length(wp.xz - uPing.xy);
  return exp(-pow((d - uPing.z) / max(uPing.z * 0.04, 2.0), 2.0)) * uPing.w;
}

#define PI 3.14159265

float toY(float h) { return uExag.y + (h - uExag.y) * uExag.x; }
float fromY(float y) { return uExag.y + (y - uExag.y) / uExag.x; }

vec3 srgbToLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// tiling value noise from a 256^2 RGBA noise texture
float tnoise(vec2 p) { return texture(uNoiseTex, p / 256.0).r; }
float fbm2(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * texture(uNoiseTex, p / 256.0).g; p = p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.9375;
}

vec2 skyUV(vec3 d) {
  float el = asin(clamp(d.y, -1.0, 1.0));
  float v = 0.5 + 0.5 * sign(el) * sqrt(abs(el) / (PI * 0.5));
  vec2 a = normalize(d.xz + 1e-5);
  vec2 s = normalize(uSunDir.xz + 1e-5);
  float az = acos(clamp(dot(a, s), -1.0, 1.0)) / PI;
  return vec2(az, v);
}
vec3 skyColor(vec3 d) { return texture(uSkyLUT, skyUV(d)).rgb; }

float hgPhase(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * c, 1.5));
}

// Haze + valley fog along the camera ray to wp. Returns (transmittance, inscatter).
vec3 applyUnderwater(vec3 col, vec3 wp) {
  float d = length(wp - cameraPosition);
  float surfY = toY(uWater.w);
  vec3 sig = vec3(0.42, 0.10, 0.075);
  col *= exp(-sig * max(surfY - wp.y, 0.0) * 0.7);
  vec3 fogC = uWaterTint * (uSkyUp * 1.4 + uLightColor * 0.35) * exp(-sig * max(surfY - cameraPosition.y, 0.0) * 0.5);
  vec3 T = exp(-(sig * 0.35 + 0.075) * d);
  return col * T + fogC * (1.0 - T);
}

vec3 applyAerial(vec3 col, vec3 wp) {
  if (uWater.z > 0.5) return applyUnderwater(col, wp);
  vec3 v = wp - cameraPosition;
  float dist = length(v);
  vec3 dir = v / max(dist, 1e-3);
  float hz = uFog.y;
  float h0 = fromY(cameraPosition.y), h1 = fromY(wp.y);
  float dh = h1 - h0;
  float e0 = exp(-h0 / hz), e1 = exp(-h1 / hz);
  float od = abs(dh) < 1.0 ? uFog.x * e0 * dist : uFog.x * hz * dist / dh * (e0 - e1);
  // valley fog layer below uFog.w with a soft top
  float fogTop = uFog.w;
  float lo = min(h0, h1), hi = max(h0, h1);
  float inLayer = hi <= lo + 0.01 ? (lo < fogTop ? 1.0 : 0.0) : clamp((fogTop + 25.0 - lo) / (hi - lo), 0.0, 1.0);
  od += uFog.z * dist * inLayer;
  float T = exp(-od);
  vec3 sky = skyColor(normalize(vec3(dir.x, max(dir.y, 0.015), dir.z)));
  float mie = hgPhase(dot(dir, uSunDir), 0.72);
  vec3 ins = sky * 0.85 + uFogSun * mie * 0.3;
  return col * T + ins * (1.0 - T);
}

float cloudCoverAt(vec2 xz) {
  vec2 p = xz * 0.0004 + uCloud.yz;
  float n = fbm2(p * 6.0);
  return smoothstep(1.0 - uCloud.x, 1.0 - uCloud.x + 0.25, n);
}
float cloudShadow(vec3 wp) {
  if (uCloud.w <= 0.0 || uCloud.x <= 0.01) return 1.0;
  float hc = 1700.0;
  vec3 L = uSunDir;
  vec2 xz = wp.xz + L.xz / max(L.y, 0.08) * (hc - wp.y);
  return 1.0 - uCloud.w * cloudCoverAt(xz);
}

float shadowTap(sampler2DShadow m, vec3 c) { return texture(m, c); }
float sunShadow(vec3 wp, float ndl) {
  float s = 1.0;
  if (uShadowOn.y > 0.5) {
    vec4 c = uShadowMat1 * vec4(wp, 1.0);
    vec3 p = c.xyz / c.w;
    if (all(greaterThan(p.xy, vec2(0.0))) && all(lessThan(p.xy, vec2(1.0))) && p.z < 1.0) {
      float t = uShadowOn.w;
      float b = 0.0015;
      float r = shadowTap(uShadowMap1, vec3(p.xy + vec2(-t, -t) * 0.7, p.z - b))
              + shadowTap(uShadowMap1, vec3(p.xy + vec2(t, -t) * 0.7, p.z - b))
              + shadowTap(uShadowMap1, vec3(p.xy + vec2(-t, t) * 0.7, p.z - b))
              + shadowTap(uShadowMap1, vec3(p.xy + vec2(t, t) * 0.7, p.z - b));
      s = r * 0.25;
    }
  }
  if (uShadowOn.x > 0.5) {
    vec4 c = uShadowMat0 * vec4(wp, 1.0);
    vec3 p = c.xyz / c.w;
    vec2 edge = min(p.xy, 1.0 - p.xy);
    if (edge.x > 0.0 && edge.y > 0.0 && p.z < 1.0) {
      float t = uShadowOn.z;
      float b = 0.0004 + 0.0012 * (1.0 - ndl);
      float r = 0.0;
      r += shadowTap(uShadowMap0, vec3(p.xy + vec2(-1.5, -0.5) * t, p.z - b));
      r += shadowTap(uShadowMap0, vec3(p.xy + vec2(0.5, -1.5) * t, p.z - b));
      r += shadowTap(uShadowMap0, vec3(p.xy + vec2(1.5, 0.5) * t, p.z - b));
      r += shadowTap(uShadowMap0, vec3(p.xy + vec2(-0.5, 1.5) * t, p.z - b));
      float near = r * 0.25;
      float fadeOut = smoothstep(0.0, 0.08, min(edge.x, edge.y));
      s = min(s, mix(1.0, near, fadeOut));
    }
  }
  return s;
}

vec3 ambientLight(vec3 n) {
  float up = n.y * 0.5 + 0.5;
  vec3 sky = mix(uSkyHorizon, uSkyUp, smoothstep(0.35, 1.0, up));
  return mix(uGroundBounce, sky, smoothstep(0.0, 0.6, up));
}

// Animated water caustics (two warped cell layers)
float caustic(vec2 p, float t) {
  vec2 q = p * 0.28;
  float c = 0.0;
  for (int i = 0; i < 2; i++) {
    vec2 w = q + vec2(sin(t * 0.7 + q.y * 1.7), cos(t * 0.6 + q.x * 1.3)) * 0.35;
    vec2 g = floor(w), f = fract(w);
    float md = 8.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(x, y);
      vec2 r = o + 0.5 + 0.45 * sin(t * 0.9 + 6.2831 * vec2(hash12(g + o), hash12(g + o + 7.3))) - f;
      md = min(md, dot(r, r));
    }
    c += pow(clamp(1.0 - sqrt(md) * 1.25, 0.0, 1.0), 5.0);
    q = q * 1.7 + 3.1;
    t *= 1.21;
  }
  return c;
}
`;
