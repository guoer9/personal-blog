export const flowVertexShader = /* glsl */ `
#define MAX_RIPPLES 6
#define PRESS_DEPTH_MAX 0.18
  uniform float uTime;
  uniform float uPointerX;
  uniform float uPointerY;
  uniform float uScroll;
  uniform float uEnergy;
  uniform vec3 uRippleDirections[MAX_RIPPLES];
  uniform float uRippleAges[MAX_RIPPLES];
  uniform float uRippleStrengths[MAX_RIPPLES];
  uniform int uRippleCount;
  uniform int uRippleCapacity;
  uniform vec3 uHoverDirection;
  uniform float uHoverActive;
  uniform float uHoverStrength;
  uniform vec3 uPressDirection;
  uniform float uPressDepth;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying float vFlow;
  varying float vEnergy;
  varying float vRippleLight;

  float sphericalDistance(vec3 a, vec3 b) {
    return acos(clamp(dot(normalize(a), normalize(b)), -1.0, 1.0));
  }

  void main() {
    vec3 p = position;
    vec3 pointer = normalize(vec3(uPointerX, uPointerY, 0.82));
    float pointerDistance = distance(normalize(p), pointer);
    float pointerPull = (1.0 - smoothstep(0.0, 1.25, pointerDistance)) * (0.15 + uEnergy * 0.1);
    float formation = sin(p.y * 3.4 + uTime * 0.72 + uScroll * 4.0) * 0.055;
    formation += cos(p.x * 3.9 - uTime * 0.55 + uScroll * 2.0) * 0.045;
    float expansion = sin(uScroll * 14.0 + length(p) * 2.8) * smoothstep(0.12, 0.7, uScroll) * 0.09;
    float grid = sin(p.x * 11.0 + uTime * 0.24) * sin(p.y * 11.0 - uTime * 0.2);
    grid *= smoothstep(0.5, 0.95, uScroll) * 0.065;
    float rippleDisplacement = 0.0;
    float rippleLight = 0.0;
    for (int index = 0; index < MAX_RIPPLES; index += 1) {
      float slotActive = step(float(index), float(uRippleCount - 1));
      float distanceToRipple = sphericalDistance(normalize(p), uRippleDirections[index]);
      float waveFront = uRippleAges[index] * 1.55;
      float envelope = exp(-pow((distanceToRipple - waveFront) * 8.0, 2.0));
      envelope *= exp(-uRippleAges[index] * 1.75) * uRippleStrengths[index] * slotActive;
      rippleDisplacement += sin(distanceToRipple * 12.0 - uRippleAges[index] * 9.0) * envelope * 0.075;
      rippleLight += envelope;
    }
    rippleDisplacement = clamp(rippleDisplacement, -0.11, 0.11);
    rippleLight = clamp(rippleLight, 0.0, 1.0);

    float hoverDistance = sphericalDistance(normalize(p), uHoverDirection);
    float hoverEnvelope = exp(-pow(hoverDistance * 3.2, 2.0)) * uHoverActive * uHoverStrength;
    float hoverRipple = sin(hoverDistance * 10.0 - uTime * 2.0) * hoverEnvelope * 0.025;
    float pressDistance = sphericalDistance(normalize(p), uPressDirection);
    float pressEnvelope = exp(-pow(pressDistance * 3.4, 2.0));
    float pressDimple = pressEnvelope * min(uPressDepth, PRESS_DEPTH_MAX);

    float deformation = formation + expansion + grid + pointerPull + rippleDisplacement + hoverRipple - pressDimple;
    deformation *= 1.0 + uEnergy * 0.45;
    p += normal * deformation;

    vec4 worldPosition = modelMatrix * vec4(p, 1.0);
    vWorldPosition = worldPosition.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vFlow = formation * 8.0 + pointerPull + rippleDisplacement;
    vEnergy = abs(expansion) * 4.0 + pointerPull + rippleLight * 0.4;
    vRippleLight = rippleLight;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

export const flowFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uScroll;
  uniform float uEnergy;
  uniform float uHoverStrength;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying float vFlow;
  varying float vEnergy;
  varying float vRippleLight;

  vec3 palette(float t) {
    vec3 ink = vec3(0.035, 0.040, 0.045);
    vec3 lime = vec3(0.67, 1.0, 0.12);
    vec3 electric = vec3(0.08, 0.25, 1.0);
    vec3 pearl = vec3(0.89, 0.91, 0.90);
    t = fract(t + uScroll * 0.2);
    if (t < 0.42) return mix(ink, electric, smoothstep(0.0, 0.42, t));
    if (t < 0.72) return mix(electric, pearl, smoothstep(0.42, 0.72, t));
    return mix(pearl, lime, smoothstep(0.72, 1.0, t));
  }

  void main() {
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float fresnel = pow(1.0 - max(dot(viewDirection, vNormal), 0.0), 2.6);
    float bands = sin(vWorldPosition.y * 5.4 + uTime * 0.24 + vFlow) * 0.5 + 0.5;
    float facets = smoothstep(0.0, 0.6, abs(sin(vWorldPosition.x * 6.0 + vWorldPosition.z * 4.0)));
    vec3 color = palette(fresnel * 0.58 + bands * 0.25 + uTime * 0.018 + uScroll * 0.16);
    color = mix(color, vec3(0.95, 0.96, 0.9), fresnel * 0.22);
    color += vec3(0.84, 1.0, 0.36) * vEnergy * 0.24;
    color += vec3(0.67, 1.0, 0.12) * uEnergy * 0.12;
    color += vec3(0.55, 0.8, 1.0) * uHoverStrength * 0.12;
    color += vec3(0.86, 1.0, 0.3) * vRippleLight * 0.28;
    color *= mix(0.88, 1.0, facets * smoothstep(0.35, 0.8, uScroll));
    gl_FragColor = vec4(color, 0.96);
  }
`

export const particleVertexShader = /* glsl */ `
  attribute float aSeed;
  attribute float aSize;
  uniform float uTime;
  uniform float uScroll;
  uniform float uPixelRatio;
  uniform float uEnergy;
  varying float vAlpha;

  void main() {
    vec3 p = position;
    float travel = smoothstep(0.08, 0.85, uScroll);
    p *= 1.0 + travel * (0.22 + aSeed * 0.28) + uEnergy * (0.06 + aSeed * 0.1);
    p.y += sin(uTime * (0.35 + aSeed * 0.5) + aSeed * 17.0) * (0.08 + travel * 0.18);
    p.x += cos(uTime * (0.25 + aSeed * 0.36) + aSeed * 11.0) * (0.04 + travel * 0.1);
    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = aSize * uPixelRatio * (18.0 / max(1.0, -viewPosition.z)) * (1.0 + uEnergy * 0.9);
    vAlpha = smoothstep(0.02, 0.22, uScroll) * (0.45 + aSeed * 0.55) * (0.65 + uEnergy * 0.35);
  }
`

export const particleFragmentShader = /* glsl */ `
  varying float vAlpha;

  void main() {
    float distanceToCenter = distance(gl_PointCoord, vec2(0.5));
    if (distanceToCenter > 0.5) discard;
    float glow = smoothstep(0.5, 0.05, distanceToCenter);
    gl_FragColor = vec4(0.78, 1.0, 0.18, glow * vAlpha * 0.48);
  }
`
