export const flowVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uPointerX;
  uniform float uPointerY;
  uniform float uScroll;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying float vFlow;

  void main() {
    vec3 p = position;
    float wave = sin(p.y * 3.4 + uTime * 0.72 + uScroll * 4.0) * 0.055;
    wave += cos(p.x * 3.9 - uTime * 0.55) * 0.045;
    float pointerPull = 1.0 - smoothstep(0.0, 1.8, distance(normalize(p), vec3(uPointerX, uPointerY, 0.8)));
    p += normal * (wave + pointerPull * 0.07);

    vec4 worldPosition = modelMatrix * vec4(p, 1.0);
    vWorldPosition = worldPosition.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vFlow = wave * 8.0 + pointerPull;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

export const flowFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uScroll;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying float vFlow;

  vec3 palette(float t) {
    vec3 ink = vec3(0.035, 0.040, 0.045);
    vec3 lime = vec3(0.67, 1.0, 0.12);
    vec3 electric = vec3(0.08, 0.25, 1.0);
    vec3 pearl = vec3(0.89, 0.91, 0.90);
    t = fract(t + uScroll * 0.22);
    if (t < 0.42) return mix(ink, electric, smoothstep(0.0, 0.42, t));
    if (t < 0.72) return mix(electric, pearl, smoothstep(0.42, 0.72, t));
    return mix(pearl, lime, smoothstep(0.72, 1.0, t));
  }

  void main() {
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float fresnel = pow(1.0 - max(dot(viewDirection, vNormal), 0.0), 2.35);
    float bands = sin(vWorldPosition.y * 4.6 + uTime * 0.28 + vFlow) * 0.5 + 0.5;
    vec3 color = palette(fresnel * 0.7 + bands * 0.28 + uTime * 0.025);
    color += vec3(0.9) * pow(fresnel, 4.0) * 0.35;
    gl_FragColor = vec4(color, 1.0);
  }
`
