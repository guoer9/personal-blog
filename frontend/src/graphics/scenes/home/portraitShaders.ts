/** Original shaders. All simulation targets are RGBA8, including signed fields. */
export const portraitFullscreenVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

// 128/255 represents exact rest in an unsigned byte target. Using 0.5 would
// introduce a persistent positive velocity on each quantized ping-pong pass.
const signedField = /* glsl */ `
const float NEUTRAL = 128.0 / 255.0;
const float SIGNED_SCALE = 127.0 / 255.0;
const float FIELD_RANGE = 8.0;
vec2 readVelocity(sampler2D source, vec2 uv) {
  return (texture2D(source, clamp(uv, vec2(0.0), vec2(1.0))).rg - NEUTRAL) * (FIELD_RANGE / SIGNED_SCALE);
}
float readScalar(sampler2D source, vec2 uv) {
  return (texture2D(source, clamp(uv, vec2(0.0), vec2(1.0))).r - NEUTRAL) * (FIELD_RANGE / SIGNED_SCALE);
}
vec2 encodeVelocity(vec2 velocity) {
  return clamp(velocity / FIELD_RANGE, vec2(-1.0), vec2(1.0)) * SIGNED_SCALE + NEUTRAL;
}
float encodeScalar(float value) {
  return clamp(value / FIELD_RANGE, -1.0, 1.0) * SIGNED_SCALE + NEUTRAL;
}
`

export const fluidClearFragment = /* glsl */ `
uniform float uSigned;
void main() { gl_FragColor = vec4(vec3(uSigned * (128.0 / 255.0)), 1.0); }
`

export const fluidAdvectionFragment = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uDelta;
uniform float uDissipation;
uniform float uIsDye;
${signedField}
void main() {
  vec2 velocity = readVelocity(uVelocity, vUv);
  vec2 traced = clamp(vUv - velocity * uTexel * uDelta * 60.0, uTexel * 0.5, vec2(1.0) - uTexel * 0.5);
  if (uIsDye > 0.5) {
    float density = texture2D(uSource, traced).r * uDissipation;
    gl_FragColor = vec4(density, density, density, 1.0);
  } else {
    gl_FragColor = vec4(encodeVelocity(readVelocity(uSource, traced) * uDissipation), 0.0, 1.0);
  }
}
`

export const fluidForceFragment = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uPointer;
uniform vec2 uForce;
uniform vec2 uSize;
uniform float uPointerActive;
uniform float uRadius;
uniform float uIsDye;
uniform float uDyeAmount;
${signedField}
void main() {
  vec2 relative = (vUv - uPointer) * uSize / min(uSize.x, uSize.y);
  float brush = exp(-dot(relative, relative) / max(0.0001, uRadius * uRadius)) * uPointerActive;
  if (uIsDye > 0.5) {
    float density = clamp(texture2D(uSource, vUv).r + brush * uDyeAmount, 0.0, 1.0);
    gl_FragColor = vec4(density, density, density, 1.0);
  } else {
    vec2 velocity = readVelocity(uSource, vUv) + uForce * brush;
    gl_FragColor = vec4(encodeVelocity(velocity), 0.0, 1.0);
  }
}
`

export const fluidDivergenceFragment = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
${signedField}
void main() {
  vec2 left = readVelocity(uVelocity, vUv - vec2(uTexel.x, 0.0));
  vec2 right = readVelocity(uVelocity, vUv + vec2(uTexel.x, 0.0));
  vec2 bottom = readVelocity(uVelocity, vUv - vec2(0.0, uTexel.y));
  vec2 top = readVelocity(uVelocity, vUv + vec2(0.0, uTexel.y));
  if (vUv.x < uTexel.x) left.x = -right.x;
  if (vUv.x > 1.0 - uTexel.x) right.x = -left.x;
  if (vUv.y < uTexel.y) bottom.y = -top.y;
  if (vUv.y > 1.0 - uTexel.y) top.y = -bottom.y;
  float divergence = 0.5 * (right.x - left.x + top.y - bottom.y);
  gl_FragColor = vec4(vec3(encodeScalar(divergence)), 1.0);
}
`

export const fluidPressureFragment = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uTexel;
${signedField}
void main() {
  float left = readScalar(uPressure, vUv - vec2(uTexel.x, 0.0));
  float right = readScalar(uPressure, vUv + vec2(uTexel.x, 0.0));
  float bottom = readScalar(uPressure, vUv - vec2(0.0, uTexel.y));
  float top = readScalar(uPressure, vUv + vec2(0.0, uTexel.y));
  float pressure = (left + right + bottom + top - readScalar(uDivergence, vUv)) * 0.25;
  gl_FragColor = vec4(vec3(encodeScalar(pressure)), 1.0);
}
`

export const fluidGradientFragment = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uPressure;
uniform vec2 uTexel;
${signedField}
void main() {
  float left = readScalar(uPressure, vUv - vec2(uTexel.x, 0.0));
  float right = readScalar(uPressure, vUv + vec2(uTexel.x, 0.0));
  float bottom = readScalar(uPressure, vUv - vec2(0.0, uTexel.y));
  float top = readScalar(uPressure, vUv + vec2(0.0, uTexel.y));
  vec2 velocity = readVelocity(uVelocity, vUv) - 0.5 * vec2(right - left, top - bottom);
  velocity *= step(uTexel, vUv) * step(uTexel, vec2(1.0) - vUv);
  gl_FragColor = vec4(encodeVelocity(velocity), 0.0, 1.0);
}
`

export const portraitCompositeFragment = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uFront;
uniform sampler2D uBass;
uniform sampler2D uDye;
uniform sampler2D uVelocity;
uniform vec2 uFluidTexel;
uniform vec2 uViewport;
uniform vec4 uBounds;
uniform float uTime;
uniform float uManualBass;
uniform float uBackdropOpacity;
uniform float uFilter;
uniform float uHandoff;
${signedField}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
void main() {
  vec2 pixel = vec2(vUv.x, 1.0 - vUv.y) * uViewport;
  vec2 local = vec2((pixel.x - uBounds.x) / uBounds.z, 1.0 - (pixel.y - uBounds.y) / uBounds.w);
  float inBounds = step(0.0, local.x) * step(local.x, 1.0) * step(0.0, local.y) * step(local.y, 1.0);
  vec2 uv = clamp(local, vec2(0.0), vec2(1.0));
  float density = texture2D(uDye, uv).r;
  float reveal = max(uManualBass, smoothstep(0.06, 0.48, density));
  vec2 drift = readVelocity(uVelocity, uv) * uFluidTexel * 0.045;
  vec4 front = texture2D(uFront, clamp(uv + drift * (1.0 - uManualBass), vec2(0.0), vec2(1.0)));
  vec4 bass = texture2D(uBass, clamp(uv - drift * 0.3 * (1.0 - uManualBass), vec2(0.0), vec2(1.0)));
  vec4 subject = mix(front, bass, reveal) * inBounds;
  float luminance = dot(subject.rgb, vec3(0.2126, 0.7152, 0.0722));
  subject.rgb = mix(subject.rgb, luminance * vec3(0.92, 1.0, 0.81), uFilter * 0.55);
  subject *= 1.0 - uHandoff;
  // Both photo targets contain premultiplied RGB from ordinary alpha blending.
  // Keep the subtle atmosphere behind the subject, then return straight alpha
  // for the final framebuffer blend; output transfer is applied exactly once.
  float grain = hash(floor(pixel * 0.65) + floor(uTime * 8.0)) - 0.5;
  float halo = exp(-dot((local - vec2(0.5, 0.5)) * vec2(1.25, 0.8), (local - vec2(0.5, 0.5)) * vec2(1.25, 0.8)) * 3.0) * inBounds;
  float atmosphereAlpha = (0.94 + halo * 0.03) * uBackdropOpacity * (1.0 - uHandoff);
  vec3 atmosphere = vec3(0.008, 0.013, 0.017) + grain * 0.0015 + vec3(0.016, 0.020, 0.017) * halo;
  float alpha = subject.a + atmosphereAlpha * (1.0 - subject.a);
  vec3 premultiplied = subject.rgb + atmosphere * atmosphereAlpha * (1.0 - subject.a);
  gl_FragColor = vec4(premultiplied / max(alpha, 0.00001), alpha);
  #include <colorspace_fragment>
}
`
