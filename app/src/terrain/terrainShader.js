import { COMMON_GLSL } from '../render/common.js';

export const TERRAIN_VERT = /* glsl */`
${COMMON_GLSL}
uniform vec4 uNodeRect;   // x0, z0, size, gridRes
uniform vec2 uMorph;      // start, end distance
uniform vec3 uLodCam;
uniform vec4 uDataX;      // data uv offset.xy, scale, base height
uniform sampler2D uHeightTex;
uniform float uSkirt;
uniform sampler2D uCanopy;
uniform float uCanopyOn;
uniform vec2 uCanopyFade;
uniform vec4 uRegionRect;
uniform sampler2D uClassTex;
varying vec3 vWorld;
varying float vCanopy;
varying vec2 vUv;
varying vec2 vTc;
varying float vDist;

const float CORE_N = 257.0;
vec2 dataTc(vec2 uv) { vec2 d = uDataX.xy + uv * uDataX.z; return (d * (CORE_N - 1.0) + 0.5) / CORE_N; }
vec2 vTc0(vec2 uv) { return dataTc(uv); }
float heightAt(vec2 uv) { return textureLod(uHeightTex, dataTc(uv), 0.0).r + uDataX.w; }

void main() {
  float M = uNodeRect.w;
  vec2 g = position.xz;
  vec2 uv = g / M;
  vec3 wp = vec3(uNodeRect.x + uv.x * uNodeRect.z, 0.0, uNodeRect.y + uv.y * uNodeRect.z);
  wp.y = toY(heightAt(uv));
  float d = distance(wp, uLodCam);
  float morph = clamp((d - uMorph.x) / max(uMorph.y - uMorph.x, 1.0), 0.0, 1.0);
  vec2 f = fract(g * 0.5) * 2.0;
  g -= f * morph;
  uv = g / M;
  wp.xz = vec2(uNodeRect.x + uv.x * uNodeRect.z, uNodeRect.y + uv.y * uNodeRect.z);
  float h = heightAt(uv);
  wp.y = toY(h) - position.y * uSkirt;
  // distant forests: lift the surface to the measured canopy top so hills keep their tree volume
  vCanopy = 0.0;
  if (uCanopyOn > 0.5) {
    vec2 ruv = (wp.xz - uRegionRect.xy) / (uRegionRect.zw - uRegionRect.xy);
    if (all(greaterThan(ruv, vec2(0.0))) && all(lessThan(ruv, vec2(1.0)))) {
      float ch = textureLod(uCanopy, ruv, 0.0).r * 63.75;
      float basinV = textureLod(uClassTex, vTc0(uv), 0.0).r;
      float k = smoothstep(uCanopyFade.x, uCanopyFade.y, d) * (1.0 - basinV);
      vCanopy = ch * k;
      wp.y += vCanopy * 0.8 * uExag.x;
    }
  }
  vWorld = wp;
  vUv = uv;
  vTc = dataTc(uv);
  vDist = d;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

export const TERRAIN_FRAG = /* glsl */`
${COMMON_GLSL}
uniform vec4 uDataX;
uniform sampler2D uHeightTex;
uniform sampler2D uNormalTex;
uniform sampler2D uClassTex;
uniform sampler2D uImg;
uniform vec4 uImgX;       // offset.xy, scale, has image
uniform sampler2D uImgPrev;
uniform vec4 uImgPrevX;   // offset.xy, scale, fade (0 = show prev, 1 = show img)
uniform float uClipY;
uniform float uSonar;
uniform float uContours;
uniform sampler2D uDryTime;
uniform vec2 uDryRange;
uniform float uDetail;    // detail strength (quality)
uniform sampler2DArray uGround;   // 0 litter, 1 grass, 2 rock, 3 wet mud, 4 cracked mud, 5 gravel, 6 sand, 7 autumn litter
uniform sampler2DArray uGroundN;
uniform vec3 uGroundMean[8];
uniform float uLitter;    // 0 summer .. 1 autumn
uniform sampler2D uOldMap;
uniform float uOldMapOn;
uniform vec4 uRegionRect;
uniform sampler2D uTrails;
uniform vec3 uTrailOn;
uniform float uTrailDMax;
uniform vec4 uAreas[8];
uniform float uAreaOn;
varying float vCanopy;

vec3 gsamp(vec2 p, float layer) {
  vec3 a = texture(uGround, vec3(p, layer)).rgb;
  vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * p * 0.37 + 0.31;
  vec3 b = texture(uGround, vec3(q, layer)).rgb;
  return mix(a, b, 0.35);
}
vec3 gnorm(vec2 p, float layer) {
  vec3 a = texture(uGroundN, vec3(p, layer)).xyz * 2.0 - 1.0;
  vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * p * 0.37 + 0.31;
  vec3 b = texture(uGroundN, vec3(q, layer)).xyz * 2.0 - 1.0;
  return normalize(mix(a, b, 0.35));
}
vec3 perturb(vec3 N, vec3 nm, float k) {
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
  vec3 B = normalize(cross(N, T));
  return normalize(N + (T * nm.x - B * nm.y) * k);
}
varying vec3 vWorld;
varying vec2 vUv;
varying vec2 vTc;
varying float vDist;

// ---- procedural lake-bed materials ---------------------------------------
vec2 voronoi(vec2 p, float jitter) {
  vec2 g = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(x, y);
    vec2 r = o + 0.5 + jitter * (vec2(hash12(g + o), hash12(g + o + 19.7)) - 0.5) - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return vec2(sqrt(d1), sqrt(d2));
}

float crackMask(vec2 xz) {
  vec2 a = voronoi(xz * 0.9, 0.9);
  vec2 b = voronoi(xz * 0.25 + 3.7, 0.85);
  float c1 = smoothstep(0.035, 0.0, a.y - a.x);
  float c2 = smoothstep(0.05, 0.0, b.y - b.x);
  return max(c1 * 0.8, c2);
}

void main() {
  if (vWorld.y < uClipY) discard;
  float h = fromY(vWorld.y);
  vec4 nt = texture(uNormalTex, vTc);
  vec3 N = normalize(nt.xyz * 2.0 - 1.0);
  N = normalize(vec3(N.x * uExag.x, N.y, N.z * uExag.x));
  float concav = nt.a * 2.0 - 1.0;
  vec4 cls = texture(uClassTex, vTc);
  float basin = cls.r, chan = cls.g, rbed = cls.b, fixedW = cls.a;
  vec2 hs = texture(uHeightTex, vTc).rg + uDataX.w;
  float staticLevel = hs.g;
  float fullPool = uWater.y;
  float level = uWater.x;
  float detail = uDetail * clamp(1.0 - vDist / 900.0, 0.0, 1.0);

  // ---- satellite imagery (cross-faded from the parent while loading)
  vec3 img = vec3(0.16, 0.18, 0.12);
  if (uImgX.w > 0.5) {
    vec3 a = texture(uImg, uImgX.xy + vUv * uImgX.z).rgb;
    vec3 b = texture(uImgPrev, uImgPrevX.xy + vUv * uImgPrevX.z).rgb;
    img = mix(b, a, uImgPrevX.w);
  } else if (uImgPrevX.z > 0.0) {
    img = texture(uImgPrev, uImgPrevX.xy + vUv * uImgPrevX.z).rgb;
  }
  vec3 alb = srgbToLinear(img);
  float lum = dot(alb, vec3(0.299, 0.587, 0.114));
  alb = mix(vec3(lum), alb, 1.22) * 0.92;   // imagery is a little flat and bright
  float rough = 0.9;
  vec3 Nd = N;

  // near-camera ground detail on land: photo textures modulate the aerial imagery
  float slope0 = 1.0 - N.y;
  if (detail > 0.0) {
    vec2 uvg = vWorld.xz / 3.2;
    float g = alb.g / max(alb.r + alb.g + alb.b, 1e-3);
    float grassW = smoothstep(0.37, 0.43, g) * smoothstep(0.02, 0.06, lum);
    float rockW = smoothstep(0.38, 0.62, slope0 + (tnoise(vWorld.xz * 0.05) - 0.5) * 0.25);
    float litterL = mix(0.0, 7.0, step(0.5, uLitter));
    vec3 dA, dN; vec3 mean;
    vec3 litA = gsamp(uvg, litterL); vec3 litN = gnorm(uvg, litterL);
    vec3 grA = gsamp(uvg * 1.3, 1.0); vec3 grN = gnorm(uvg * 1.3, 1.0);
    vec3 rkA = gsamp(uvg * 0.5, 2.0); vec3 rkN = gnorm(uvg * 0.5, 2.0);
    dA = mix(litA, grA, grassW); dN = normalize(mix(litN, grN, grassW));
    mean = mix(uGroundMean[int(litterL)], uGroundMean[1], grassW);
    dA = mix(dA, rkA, rockW); dN = normalize(mix(dN, rkN, rockW)); mean = mix(mean, uGroundMean[2], rockW);
    vec3 ratio = srgbToLinear(dA) / max(srgbToLinear(mean), vec3(0.02));
    float close = clamp(1.0 - vDist / 60.0, 0.0, 1.0);
    vec3 detailed = mix(alb * ratio, srgbToLinear(dA) * 0.9, 0.3 * close);
    alb = mix(alb, detailed, detail);
    Nd = perturb(N, dN, 0.9 * detail);
  }

  // ---- reconstructed lake bed / exposed shore material
  float below = smoothstep(fullPool + 0.9, fullPool - 0.5, h);
  float bedW = clamp(max(basin * below, rbed), 0.0, 1.0);
  if (bedW > 0.001) {
    float slope = 1.0 - N.y;
    float dFull = fullPool - h;                 // depth at full pool
    vec2 xz = vWorld.xz;
    float m1 = fbm2(xz * 0.035), m2 = fbm2(xz * 0.22), m3 = tnoise(xz * 2.5);
    // silt: dark olive-grey wet, pale grey-tan dry
    float m0 = fbm2(xz * 0.006);
    vec3 siltDry = mix(vec3(0.17, 0.145, 0.11), vec3(0.245, 0.215, 0.17), m1);
    siltDry = mix(siltDry, vec3(0.16, 0.14, 0.10), smoothstep(0.55, 0.8, m0) * 0.6);   // organic-rich patches
    siltDry = mix(siltDry, vec3(0.34, 0.29, 0.20), smoothstep(0.62, 0.85, m2) * 0.35); // sandier streaks
    siltDry *= (0.8 + 0.4 * m2) * 0.78;
    vec3 siltWet = vec3(0.055, 0.045, 0.032) * (0.8 + 0.4 * m2);
    // hours since this elevation was exposed (from the drain history texture)
    float t = (h - uDryRange.x) / (uDryRange.y - uDryRange.x);
    vec4 dryS = texture(uDryTime, vec2(clamp(t, 0.0, 1.0), 0.5));
    float hrs = dryS.r;
    float above = h - level;
    float wet = above <= 0.0 ? 1.0 : exp(-hrs / 30.0);
    wet = max(wet, 1.0 - smoothstep(0.0, 1.2, above));
    wet = max(wet, chan * 0.6);
    wet = clamp(wet + concav * 0.2 * (1.0 - wet), 0.0, 1.0);
    vec3 bed = mix(siltDry, siltWet, wet);
    // mud cracks on long-dry flat silt
    float dry = clamp(1.0 - wet * 1.6, 0.0, 1.0) * smoothstep(0.25, 0.05, slope);
    if (detail > 0.0 && dry > 0.01) {
      float ck = crackMask(xz);
      bed *= 1.0 - 0.55 * ck * dry * detail;
      vec2 vo = voronoi(xz * 0.9, 0.9);
      float curl = smoothstep(0.0, 0.12, vo.y - vo.x);
      Nd = normalize(Nd + vec3((m3 - 0.5) * 0.25, 0.0, (tnoise(xz * 2.5 + 9.0) - 0.5) * 0.25) * dry * detail * curl);
    }
    // steep walls: banded shale / sandstone, iron stained
    float rockW = smoothstep(0.22, 0.45, slope + (m2 - 0.5) * 0.2);
    float strata = fract((h + m1 * 3.0) * 0.55);
    vec3 rock = mix(vec3(0.11, 0.10, 0.09), vec3(0.22, 0.19, 0.15), smoothstep(0.2, 0.8, strata));
    rock = mix(rock, vec3(0.28, 0.15, 0.08), 0.35 * smoothstep(0.55, 0.9, m2));
    rock = mix(rock, rock * 0.45, wet);
    bed = mix(bed, rock, rockW);
    // old river channel: gravel and cobbles, sand bars at the edges
    vec3 gravel = mix(vec3(0.33, 0.30, 0.26), vec3(0.20, 0.18, 0.15), m3) * mix(1.0, 0.5, wet);
    bed = mix(bed, gravel, chan * 0.85);
    // bathtub ring: bleached, mineral-stained band below full pool
    float ring = smoothstep(4.5, 1.0, dFull) * smoothstep(-0.6, 0.4, dFull);
    float streak = 0.75 + 0.25 * sin((h + m1 * 0.6) * 9.0);
    vec3 ringCol = vec3(0.34, 0.30, 0.25) * streak;
    bed = mix(bed, ringCol, ring * 0.6 * (1.0 - wet * 0.7));
    bed = mix(bed, vec3(0.13, 0.10, 0.07), smoothstep(0.35, 0.0, abs(dFull - 0.25)) * 0.6);
    // rest lines: every pause in the drain leaves a mineral stripe and a crust above it
    float tA = (h + 0.12 - uDryRange.x) / (uDryRange.y - uDryRange.x);
    float restUp = texture(uDryTime, vec2(clamp(tA, 0.0, 1.0), 0.5)).g;
    float rest = max(dryS.g, restUp * 0.6) * (above > 0.0 ? 1.0 : 0.0) * (1.0 - rockW * 0.4);
    bed = mix(bed, vec3(0.05, 0.04, 0.03), rest * 0.75);
    bed = mix(bed, vec3(0.42, 0.38, 0.31), restUp * (1.0 - dryS.g) * 0.35 * (above > 0.0 ? 1.0 : 0.0));
    // algae film where recently submerged and shallow
    bed = mix(bed, vec3(0.06, 0.08, 0.035), wet * 0.35 * smoothstep(20.0, 2.0, dFull));
    // weeds colonise flats that have been dry for months (cocklebur, willow seedlings)
    float weeds = smoothstep(900.0, 2600.0, hrs) * smoothstep(0.45, 0.75, fbm2(xz * 0.02 + 3.0)) * smoothstep(0.2, 0.05, slope) * (1.0 - chan);
    bed = mix(bed, vec3(0.07, 0.085, 0.035) * (0.8 + 0.4 * m3), weeds * 0.75);
    if (detail > 0.0) {
      vec2 uvb = xz / 4.0;
      vec3 mudW = srgbToLinear(gsamp(uvb, 3.0)) / srgbToLinear(uGroundMean[3]);
      vec3 mudD = srgbToLinear(gsamp(uvb * 0.8, 4.0)) / srgbToLinear(uGroundMean[4]);
      vec3 grv = srgbToLinear(gsamp(uvb * 1.6, 5.0)) / srgbToLinear(uGroundMean[5]);
      vec3 rk = srgbToLinear(gsamp(uvb * 0.5, 2.0)) / srgbToLinear(uGroundMean[2]);
      vec3 sand = srgbToLinear(gsamp(uvb * 1.4, 6.0)) / srgbToLinear(uGroundMean[6]);
      vec3 m = mix(mudD, mudW, wet);
      m = mix(m, rk, rockW);
      m = mix(m, grv, chan * 0.85);
      m = mix(m, sand, ring * 0.6);
      bed *= mix(vec3(1.0), m, detail);
      vec3 nm = normalize(mix(gnorm(uvb * 0.8, 4.0), gnorm(uvb, 3.0), wet));
      nm = normalize(mix(nm, gnorm(uvb * 0.5, 2.0), rockW));
      nm = normalize(mix(nm, gnorm(uvb * 1.6, 5.0), chan * 0.85));
      Nd = normalize(mix(Nd, perturb(N, nm, 1.1), detail * bedW));
    }
    float sheet = uDrainRate * (1.0 - smoothstep(0.0, 2.5, above)) * step(0.0, above);
    if (sheet > 0.01) {
      vec2 down = normalize(N.xz + 1e-4);
      float rv = fbm2(vec2(dot(xz, vec2(-down.y, down.x)) * 1.5, dot(xz, down) * 0.25 - uTime * 2.0));
      float riv = smoothstep(0.55, 0.75, rv) * sheet;
      wet = max(wet, sheet);
      bed = mix(bed, siltWet * 0.7, riv);
    }
    alb = mix(alb, bed, bedW);
    rough = mix(rough, mix(0.95, 0.22, wet), bedW);
  }

  // ---- 1890s USGS topographic map draped on the ground
  if (uOldMapOn > 0.001) {
    vec2 ruv = (vWorld.xz - uRegionRect.xy) / (uRegionRect.zw - uRegionRect.xy);
    if (all(greaterThan(ruv, vec2(0.0))) && all(lessThan(ruv, vec2(1.0)))) {
      vec3 mc = texture(uOldMap, ruv).rgb;
      float have = smoothstep(0.03, 0.08, dot(mc, vec3(0.333)));
      vec3 ml = srgbToLinear(mc) * 0.85;
      alb = mix(alb, ml, have * uOldMapOn);
      Nd = normalize(mix(Nd, N, have * uOldMapOn * 0.6));
    }
  }
  // ---- sonar sweep: bed edges light up inside the ping
  float pm = pingMask(vWorld) * basin;
  if (pm > 0.0 && h < level) {
    float e = length(vec2(dFdx(h), dFdy(h))) / max(length(vec2(dFdx(vWorld.x), dFdy(vWorld.x))), 0.01);
    float cl = abs(fract((level - h) / 0.3048 / 5.0 + 0.5) - 0.5);
    float line = 1.0 - smoothstep(0.0, 0.06, cl);
    alb = mix(alb, vec3(0.1, 0.6, 0.65), pm * (0.25 + 0.5 * line + 0.5 * smoothstep(0.2, 0.6, e)));
  }
  // ---- sonar / bathymetric chart overlay
  if (uSonar > 0.5 && basin > 0.5 && h < fullPool) {
    float dft = (fullPool - h) / 0.3048;
    float k = clamp(dft / 210.0, 0.0, 1.0);
    vec3 ramp = mix(vec3(0.70, 0.93, 0.98), vec3(0.10, 0.45, 0.85), smoothstep(0.0, 0.35, k));
    ramp = mix(ramp, vec3(0.05, 0.10, 0.45), smoothstep(0.35, 1.0, k));
    float cl = abs(fract(dft / 10.0 + 0.5) - 0.5) * 10.0;
    float w = fwidth(dft) * 0.9;
    float line = 1.0 - smoothstep(0.0, w + 0.02, cl);
    float major = abs(fract(dft / 50.0 + 0.5) - 0.5) * 50.0;
    line = max(line, 1.0 - smoothstep(0.0, fwidth(dft) * 1.6 + 0.03, major));
    alb = mix(ramp * 0.6, vec3(0.02, 0.05, 0.12), line * 0.85);
    rough = 1.0;
  }
  if (uContours > 0.5) {
    float hf = h / 0.3048;
    float cl = abs(fract(hf / 20.0 + 0.5) - 0.5) * 20.0;
    float line = 1.0 - smoothstep(0.0, fwidth(hf) * 1.2 + 0.05, cl);
    alb = mix(alb, vec3(0.9, 0.75, 0.4) * 0.5, line * 0.7 * clamp(1.0 - vDist / 8000.0, 0.0, 1.0));
  }

  // ---- lighting
  vec3 L = uLightDir;
  float ndl = max(dot(Nd, L), 0.0);
  float sh = (ndl > 0.0) ? sunShadow(vWorld, ndl) : 0.0;
  sh *= cloudShadow(vWorld);
  float ao = clamp(1.0 - max(concav, 0.0) * 0.6, 0.35, 1.0) * clamp(1.0 + min(concav, 0.0) * 0.3, 0.7, 1.2);
  vec3 col = alb * (uLightColor * ndl * sh + ambientLight(Nd) * ao);
  // wet specular sheen
  if (rough < 0.6) {
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 Hh = normalize(L + V);
    float sp = pow(max(dot(Nd, Hh), 0.0), mix(400.0, 30.0, rough)) * (1.0 - rough) * 0.6;
    float fr = 0.04 + 0.96 * pow(1.0 - max(dot(V, Nd), 0.0), 5.0);
    col += uLightColor * sp * sh + skyColor(reflect(-V, Nd)) * fr * (1.0 - rough) * 0.5;
  }

  // ---- under the current water surface: caustics
  float surf = -1e4;
  if (basin > 0.5) surf = max(level, staticLevel);
  else if (fixedW > 0.5 && staticLevel > -9000.0) surf = staticLevel;
  float wdepth = surf - h;
  if (wdepth > 0.0) {
    float ca = caustic(vWorld.xz, uTime * 1.3) * exp(-wdepth * 0.18) * smoothstep(0.0, 0.3, wdepth);
    col += alb * uLightColor * ndl * sh * ca * 1.6;
  }

  // ---- neon trail highlights: light emitted by the ground itself, so trees, hills and
  // water in front of it hide it like real light; bloom adds the soft glow
  if (uTrailOn.x + uTrailOn.y + uTrailOn.z > 0.001) {
    vec2 tuv = (vWorld.xz - uRegionRect.xy) / (uRegionRect.zw - uRegionRect.xy);
    if (all(greaterThan(tuv, vec2(0.0))) && all(lessThan(tuv, vec2(1.0)))) {
      vec3 d = (1.0 - texture(uTrails, tuv).rgb) * uTrailDMax;       // metres to each layer's nearest line
      float px = max(length(fwidth(vWorld.xz)), 0.05);                 // metres per screen pixel
      float wcore = min(max(1.4, px * 1.6), uTrailDMax * 0.45);
      vec3 near = 1.0 - step(vec3(uTrailDMax * 0.97), d);              // no line within range: nothing
      vec3 core = (1.0 - smoothstep(vec3(wcore * 0.35), vec3(wcore), d)) * near;
      vec3 halo = exp(-d / min(5.0 + px * 2.5, 18.0)) * (1.0 - smoothstep(vec3(uTrailDMax * 0.6), vec3(uTrailDMax * 0.95), d));
      float breathe = 0.85 + 0.15 * sin(uTime * 1.3);
      // close up the 18 m field can't resolve a 2 m trail, so the glow fades to a faint trace at walking height
      float closeK = smoothstep(0.25, 2.5, px);
      vec3 g = (core * mix(0.35, 2.6, closeK) + halo * mix(0.05, 0.32, closeK)) * uTrailOn * breathe;
      vec3 emit = vec3(1.0, 0.18, 0.85) * g.x + vec3(0.12, 0.95, 1.0) * g.y + vec3(1.0, 0.62, 0.16) * g.z;
      emit *= 1.0 - smoothstep(0.0, 0.6, wdepth);                       // drowned trails don't glow
      col += emit * mix(1.0, 2.2, 1.0 - clamp(dot(uLightColor, vec3(0.3)) / 3.0, 0.0, 1.0));
    }
  }

  // ---- general-area highlights (Native history): a soft warm wash with a faint rim, never a pin
  if (uAreaOn > 0.001) {
    float aw = 0.0;
    for (int k = 0; k < 8; k++) {
      vec4 A = uAreas[k];
      if (A.z <= 0.0) continue;
      float r = length(vWorld.xz - A.xy) / A.z;
      float rim = exp(-pow((r - 1.0) * 9.0, 2.0));
      aw += A.w * (0.035 * (1.0 - smoothstep(0.2, 1.0, r)) + 0.22 * rim);
    }
    col += vec3(1.0, 0.55, 0.22) * aw * uAreaOn * (0.8 + 0.2 * sin(uTime * 0.8));
  }

  col = applyAerial(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const DEPTH_FRAG = /* glsl */`
uniform float uClipY;
varying vec3 vWorld;
void main() { gl_FragColor = vec4(1.0); }
`;
