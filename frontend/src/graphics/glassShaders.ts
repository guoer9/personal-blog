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
  uniform float uUseNoise;
  uniform float uCurlScale;
  uniform float uCurlStrength;
  uniform float uTime;

  float hash(vec2 value) {
    return fract(sin(dot(value, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 value) {
    vec2 cell = floor(value);
    vec2 local = fract(value);
    local = local * local * (3.0 - 2.0 * local);
    float a = hash(cell);
    float b = hash(cell + vec2(1.0, 0.0));
    float c = hash(cell + vec2(0.0, 1.0));
    float d = hash(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
  }

  vec2 curl(vec2 value) {
    float delta = 0.02;
    float x0 = noise(value - vec2(delta, 0.0));
    float x1 = noise(value + vec2(delta, 0.0));
    float y0 = noise(value - vec2(0.0, delta));
    float y1 = noise(value + vec2(0.0, delta));
    return vec2(y1 - y0, x0 - x1) / (2.0 * delta);
  }

  void main() {
    vec4 lowData = texture2D(uLowPaint, vUv);
    vec4 previous = texture2D(uPrevPaint, vUv);
    vec2 velocity = (0.5 - lowData.xy) * 2.0 * uVelocityDissipation;
    vec2 backtraceUv = clamp(vUv - velocity * uTexelSize, vec2(0.0), vec2(1.0));
    vec4 data = texture2D(uPrevPaint, backtraceUv);
    if (uUseNoise > 0.5) {
      data.xy += curl(vUv / max(uCurlScale, 0.0001) + uTime * 0.02) * uCurlStrength * 0.0005;
    }
    data.xy = mix(vec2(0.5), data.xy, uVelocityDissipation);
    data.z *= uWeight1Dissipation;
    data.w *= uWeight2Dissipation;
    data = mix(data, previous, 0.08);
    gl_FragColor = clamp(data, 0.0, 1.0);
  }
`

export const velocitySplatFragmentShader = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uPrevPaint;
  uniform vec2 uPointer;
  uniform vec2 uPrevPointer;
  uniform vec2 uTexelSize;
  uniform float uPushStrength;
  uniform float uBrushRadius;
  uniform float uVelocityDissipation;

  void main() {
    vec4 data = texture2D(uPrevPaint, vUv);
    vec2 segment = uPointer - uPrevPointer;
    float segmentLength = max(length(segment), 0.0001);
    float projection = clamp(dot(vUv - uPrevPointer, segment) / (segmentLength * segmentLength), 0.0, 1.0);
    vec2 closest = uPrevPointer + segment * projection;
    float distanceToStroke = distance(vUv, closest);
    float brush = exp(-pow(distanceToStroke / max(uBrushRadius, 0.0001), 2.0) * 2.0);
    vec2 impulse = segment / segmentLength * brush * uPushStrength * 0.006;
    data.xy = clamp(data.xy + impulse, vec2(0.0), vec2(1.0));
    data.z = max(data.z, brush * uVelocityDissipation);
    data.w = max(data.w, brush);
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
  uniform vec2 uTexelSize;
  uniform vec2 uSceneResolution;
  uniform vec2 uScrollOffset;
  uniform float uAmount;
  uniform float uMultiplier;
  uniform float uRgbShift;
  uniform float uColorMultiplier;
  uniform float uOpacity;

  void main() {
    vec4 data = texture2D(uVelocityTexture, vUv);
    float weight = clamp((data.z + data.w) * 0.5, 0.0, 1.0);
    vec2 velocity = (0.5 - data.xy - 0.001) * 2.0 * weight;
    velocity *= uAmount * uMultiplier * uTexelSize;
    vec2 uv = clamp(vUv + uScrollOffset, vec2(0.0), vec2(1.0));
    vec3 color = vec3(0.0);
    for (int index = 0; index < 9; index += 1) {
      float ratio = float(index) / 8.0;
      vec2 sampleUv = clamp(uv + velocity * ratio, vec2(0.0), vec2(1.0));
      color += texture2D(uTexture, sampleUv).rgb;
    }
    color /= 9.0;
    float chroma = uRgbShift * length(velocity) * (0.35 + weight * 0.65);
    vec3 channelOffset = vec3(0.0, 2.0, 4.0) * chroma;
    color.r = mix(color.r, texture2D(uTexture, clamp(uv + velocity * channelOffset.r, vec2(0.0), vec2(1.0))).r, 0.75);
    color.g = mix(color.g, texture2D(uTexture, clamp(uv + velocity * channelOffset.g, vec2(0.0), vec2(1.0))).g, 0.75);
    color.b = mix(color.b, texture2D(uTexture, clamp(uv + velocity * channelOffset.b, vec2(0.0), vec2(1.0))).b, 0.75);
    color *= 1.0 + weight * uColorMultiplier * 0.018;
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
  uniform float uRefractionRatio;
  uniform float uThickness;
  uniform float uOpacity;
  uniform vec3 uEdgeColor;

  vec2 sceneUv(vec3 position) {
    vec4 clip = projectionMatrix * viewMatrix * vec4(position, 1.0);
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
  varying vec2 vUv;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = viewPosition.xyz;
    vUv = uv;
    gl_Position = projectionMatrix * viewPosition;
  }
`

export const glassFacetFragmentShader = /* glsl */ `
  varying vec3 vViewPosition;
  varying vec2 vUv;
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
    vec3 color = texture2D(uSceneTexture, clamp(vUv + uvOffset, vec2(0.0), vec2(1.0))).rgb;
    float edge = pow(1.0 - abs(dot(viewNormal, -viewDirection)), 2.0);
    color += uEdgeColor * edge * 0.8;
    gl_FragColor = vec4(color, clamp(uOpacity * (0.2 + edge * 0.8), 0.0, 1.0));
  }
`
