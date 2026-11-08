export const velocityAdvectVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

export const velocityAdvectFragmentShader = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uPrevPaint;
  uniform sampler2D uLowPaint;
  uniform vec2 uTexelSize;
  uniform float uVelocityDissipation;
  uniform float uWeight1Dissipation;
  uniform float uWeight2Dissipation;
  uniform float uPushStrength;
  uniform float uCurlScale;
  uniform float uCurlStrength;

  vec2 hash(vec2 value) {
    vec3 p = fract(vec3(value.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yzx + 33.33);
    return fract((p.xx + p.yz) * p.zy) * 2.0 - 1.0;
  }

  vec3 noised(vec2 value) {
    vec2 cell = floor(value);
    vec2 local = fract(value);
    vec2 blend = local * local * local * (local * (local * 6.0 - 15.0) + 10.0);
    vec2 derivative = 30.0 * local * local * (local * (local - 2.0) + 1.0);
    vec2 ga = hash(cell + vec2(0.0, 0.0));
    vec2 gb = hash(cell + vec2(1.0, 0.0));
    vec2 gc = hash(cell + vec2(0.0, 1.0));
    vec2 gd = hash(cell + vec2(1.0, 1.0));
    float va = dot(ga, local);
    float vb = dot(gb, local - vec2(1.0, 0.0));
    float vc = dot(gc, local - vec2(0.0, 1.0));
    float vd = dot(gd, local - vec2(1.0, 1.0));
    float valueNoise = va + blend.x * (vb - va) + blend.y * (vc - va)
      + blend.x * blend.y * (va - vb - vc + vd);
    vec2 gradient = ga + blend.x * (gb - ga) + blend.y * (gc - ga)
      + blend.x * blend.y * (ga - gb - gc + gd)
      + derivative * (blend.yx * (va - vb - vc + vd) + vec2(vb, vc) - va);
    return vec3(valueNoise, gradient);
  }

  void main() {
    vec4 lowData = texture2D(uLowPaint, vUv);
    vec2 velocity = (0.5 - lowData.xy) * uPushStrength;
    vec2 pixelPosition = vUv / max(uTexelSize, vec2(0.0001));
    vec3 noise3 = noised(pixelPosition * uCurlScale * (1.0 - lowData.xy));
    vec2 noise = noised(pixelPosition * uCurlScale * (2.0 - lowData.xy * (0.5 + noise3.x) + noise3.yz * 0.1)).yz;
    velocity += noise * (lowData.z + lowData.w) * uCurlStrength;
    vec2 backtraceUv = clamp(vUv + velocity * uTexelSize, vec2(0.0), vec2(1.0));
    vec4 data = texture2D(uPrevPaint, backtraceUv);
    data.xy = mix(vec2(0.5), data.xy, uVelocityDissipation);
    data.z *= uWeight1Dissipation;
    data.w *= uWeight2Dissipation;
    gl_FragColor = clamp(data, 0.0, 1.0);
  }
`

export const velocitySplatFragmentShader = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uPrevPaint;
  uniform vec2 uPointer;
  uniform vec2 uPrevPointer;
  uniform vec2 uVelocity;
  uniform vec2 uResolution;
  uniform float uPrevBrushRadius;
  uniform float uBrushRadius;

  void main() {
    vec4 data = texture2D(uPrevPaint, vUv);
    vec2 segment = (uPointer - uPrevPointer) * uResolution;
    float segmentLength = max(length(segment), 0.0001);
    vec2 pixelPosition = vUv * uResolution;
    vec2 previousPixel = uPrevPointer * uResolution;
    float projection = clamp(dot(pixelPosition - previousPixel, segment) / (segmentLength * segmentLength), 0.0, 1.0);
    vec2 closest = previousPixel + segment * projection;
    float distanceToStroke = distance(pixelPosition, closest);
    float radius = mix(uPrevBrushRadius, uBrushRadius, projection);
    float brush = 1.0 - smoothstep(-0.01, max(radius, 0.0), distanceToStroke);
    vec2 impulse = uVelocity * brush;
    data.xy = clamp(data.xy + impulse, vec2(0.0), vec2(1.0));
    data.zw = clamp(data.zw + vec2(brush), vec2(0.0), vec2(1.0));
    gl_FragColor = clamp(data, 0.0, 1.0);
  }
`

export const glassCompositeVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

export const glassCompositeFragmentShader = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uTexture;
  uniform sampler2D uVelocityTexture;
  uniform vec2 uFieldTexelSize;
  uniform vec2 uScrollOffset;
  uniform float uAmount;
  uniform float uMultiplier;
  uniform float uRgbShift;
  uniform float uColorMultiplier;
  uniform float uShade;
  uniform float uOpacity;

  void main() {
    vec4 data = texture2D(uVelocityTexture, vUv);
    float weight = clamp((data.z + data.w) * 0.5, 0.0, 1.0);
    vec2 vel = (0.5 - data.xy - 0.001) * 2.0 * weight;
    vec2 velocity = vel * uAmount / 4.0 * uFieldTexelSize * uMultiplier;
    vec2 uv = clamp(vUv + uScrollOffset, vec2(0.0), vec2(1.0));
    vec3 color = vec3(0.0);
    for (int index = 0; index < 9; index += 1) {
      vec2 sampleUv = clamp(uv + velocity * float(index), vec2(0.0), vec2(1.0));
      color += texture2D(uTexture, sampleUv).rgb;
    }
    color /= 9.0;
    color += sin(vec3(vel.x + vel.y) * 40.0 + vec3(0.0, 2.0, 4.0) * uRgbShift)
      * smoothstep(0.4, -0.9, weight) * uShade * max(abs(vel.x), abs(vel.y)) * uColorMultiplier;
    gl_FragColor = vec4(color, uOpacity);
  }
`

export const glassBlobVertexShader = /* glsl */ `
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vViewPosition;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 viewPosition = viewMatrix * worldPosition;
    vViewPosition = viewPosition.xyz;
    gl_Position = projectionMatrix * viewPosition;
  }
`

export const glassBlobFragmentShader = /* glsl */ `
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vViewPosition;
  uniform sampler2D uSceneTexture;
  uniform sampler2D uBlurTexture;
  uniform vec2 uResolution;
  uniform mat4 uViewProjectionMatrix;
  uniform float uRefractionRatio;
  uniform float uThickness;
  uniform float uOpacity;
  uniform vec3 uEdgeColor;

  vec2 sceneUv(vec3 position) {
    vec4 clip = uViewProjectionMatrix * vec4(position, 1.0);
    return clip.xy / max(clip.w, 0.0001) * 0.5 + 0.5;
  }

  void main() {
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 surfaceNormal = normalize(vWorldNormal);
    float fresnel = pow(1.0 - max(dot(viewDirection, surfaceNormal), 0.0), 3.0);
    vec3 refractionVector = refract(-viewDirection, surfaceNormal, 1.0 / max(uRefractionRatio, 1.01));
    vec3 reflectionVector = reflect(-viewDirection, surfaceNormal);
    vec2 refractionCoords = sceneUv(vWorldPosition + refractionVector * (0.12 + uThickness * 0.24));
    vec2 reflectionCoords = sceneUv(vWorldPosition + reflectionVector * 0.06);
    vec3 refracted = texture2D(uBlurTexture, clamp(refractionCoords, vec2(0.0), vec2(1.0))).rgb;
    vec3 reflected = texture2D(uSceneTexture, clamp(reflectionCoords, vec2(0.0), vec2(1.0))).rgb;
    vec3 color = mix(refracted, reflected, fresnel * 0.72);
    color += uEdgeColor * fresnel * 0.65;
    color += vec3(1.0) * pow(fresnel, 5.0) * 0.35;
    gl_FragColor = vec4(color, clamp(uOpacity * (0.26 + fresnel * 0.72), 0.0, 1.0));
  }
`

export const glassFacetVertexShader = /* glsl */ `
  varying vec3 vViewPosition;
  varying vec2 vScreenUv;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = viewPosition.xyz;
    vec4 clipPosition = projectionMatrix * viewPosition;
    vScreenUv = clipPosition.xy / max(clipPosition.w, 0.0001) * 0.5 + 0.5;
    gl_Position = clipPosition;
  }
`

export const glassFacetFragmentShader = /* glsl */ `
  varying vec3 vViewPosition;
  varying vec2 vScreenUv;
  uniform sampler2D uSceneTexture;
  uniform vec2 uResolution;
  uniform vec3 uEdgeColor;
  uniform float uOpacity;
  uniform float uRefractionStrength;

  void main() {
    vec3 viewNormal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
    vec3 viewDirection = normalize(vViewPosition);
    vec3 refl = reflect(viewDirection, viewNormal);
    vec2 uvOffset = refl.xy * uRefractionStrength / max(uResolution, vec2(1.0));
    vec3 color = texture2D(uSceneTexture, clamp(vScreenUv + uvOffset, vec2(0.0), vec2(1.0))).rgb;
    float edge = pow(1.0 - abs(dot(viewNormal, -viewDirection)), 2.0);
    color += uEdgeColor * edge * 0.8;
    gl_FragColor = vec4(color, clamp(uOpacity * (0.2 + edge * 0.8), 0.0, 1.0));
  }
`
