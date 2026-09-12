import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import terrainMetadata from "./assets/terrain/monongahela-terrain.json";

const heightAssetUrls = import.meta.glob("./assets/terrain/*.r16", {
  eager: true,
  query: "?url",
  import: "default",
});
const effectsAssetUrls = import.meta.glob("./assets/terrain/*-effects.png", {
  eager: true,
  query: "?url",
  import: "default",
});

const assetUrl = (assets, filename) => {
  const url = assets[`./assets/terrain/${filename}`];
  if (!url) throw new Error(`Terrain asset is missing from the bundle: ${filename}`);
  return url;
};

const vertexShader = /* glsl */ `
  uniform sampler2D uHeightMap;
  uniform vec2 uUvScale;
  uniform vec2 uUvOffset;
  uniform float uElevationMin;
  uniform float uElevationRange;
  uniform float uElevationOrigin;
  uniform float uMetersPerWorldUnit;
  uniform float uColorElevationMin;
  uniform float uColorElevationRange;
  varying vec2 vUv;
  varying float vHeight;
  varying vec3 vWorldPosition;

  vec2 tileUv(vec2 sampleUv) {
    return sampleUv * uUvScale + uUvOffset;
  }

  float readElevation(vec2 sampleUv) {
    vec2 packed = texture2D(uHeightMap, tileUv(sampleUv)).rg;
    float encoded = (packed.r * 65280.0 + packed.g * 255.0) / 65535.0;
    return uElevationMin + encoded * uElevationRange;
  }

  float elevationToWorld(float elevation) {
    return (elevation - uElevationOrigin) / uMetersPerWorldUnit;
  }

  void main() {
    vUv = uv;
    vec2 terrainUv = vec2(uv.x, 1.0 - uv.y);
    float elevation = readElevation(terrainUv);
    vHeight = clamp((elevation - uColorElevationMin) / uColorElevationRange, 0.0, 1.0);
    vec3 displaced = position;
    displaced.y += elevationToWorld(elevation);
    vec4 worldPosition = modelMatrix * vec4(displaced, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uHeightMap;
  uniform sampler2D uEffectsMap;
  uniform vec2 uUvScale;
  uniform vec2 uUvOffset;
  uniform vec2 uTexel;
  uniform float uElevationMin;
  uniform float uElevationRange;
  uniform float uElevationOrigin;
  uniform float uMetersPerWorldUnit;
  uniform float uTerrainSize;
  uniform float uTime;
  varying vec2 vUv;
  varying float vHeight;
  varying vec3 vWorldPosition;

  float hash(vec2 point) {
    return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 point) {
    vec2 cell = floor(point);
    vec2 offset = fract(point);
    offset = offset * offset * (3.0 - 2.0 * offset);
    return mix(
      mix(hash(cell), hash(cell + vec2(1.0, 0.0)), offset.x),
      mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0)), offset.x),
      offset.y
    );
  }

  vec2 tileUv(vec2 sampleUv) {
    return sampleUv * uUvScale + uUvOffset;
  }

  float readElevation(vec2 sampleUv) {
    vec2 packed = texture2D(uHeightMap, tileUv(sampleUv)).rg;
    float encoded = (packed.r * 65280.0 + packed.g * 255.0) / 65535.0;
    return uElevationMin + encoded * uElevationRange;
  }

  float elevationToWorld(float elevation) {
    return (elevation - uElevationOrigin) / uMetersPerWorldUnit;
  }

  void main() {
    vec2 terrainUv = vec2(vUv.x, 1.0 - vUv.y);
    float heightLeft = elevationToWorld(readElevation(terrainUv - vec2(uTexel.x, 0.0)));
    float heightRight = elevationToWorld(readElevation(terrainUv + vec2(uTexel.x, 0.0)));
    float heightDown = elevationToWorld(readElevation(terrainUv - vec2(0.0, uTexel.y)));
    float heightUp = elevationToWorld(readElevation(terrainUv + vec2(0.0, uTexel.y)));
    vec3 normal = normalize(vec3(
      (heightLeft - heightRight) * 75.0,
      2.0 * uTerrainSize * uTexel.x,
      (heightDown - heightUp) * 75.0
    ));

    vec3 effects = texture2D(uEffectsMap, tileUv(terrainUv)).rgb;
    vec3 lightDirection = normalize(vec3(-0.55, 0.72, 0.42));
    float diffuse = max(dot(normal, lightDirection), 0.0);
    float backLight = pow(max(dot(normal, normalize(vec3(0.55, 0.3, -0.35))), 0.0), 2.0);
    float slope = clamp(1.0 - normal.y, 0.0, 1.0);

    vec3 lowColor = vec3(0.012, 0.033, 0.047);
    vec3 middleColor = vec3(0.026, 0.083, 0.098);
    vec3 highColor = vec3(0.10, 0.16, 0.18);
    vec3 color = mix(lowColor, middleColor, smoothstep(0.08, 0.58, vHeight));
    color = mix(color, highColor, smoothstep(0.56, 1.0, vHeight));
    color *= 0.50 + diffuse * 0.82;
    color += vec3(0.06, 0.16, 0.18) * backLight * 0.34;
    color *= mix(1.0, 0.48, slope * 0.48);

    float elevationMeters = readElevation(terrainUv);
    float contourCoordinate = elevationMeters / 42.0;
    float contourDistance = min(fract(contourCoordinate), 1.0 - fract(contourCoordinate));
    float contour = 1.0 - smoothstep(0.0, fwidth(contourCoordinate) * 1.45, contourDistance);
    color += vec3(0.05, 0.34, 0.43) * contour * (0.13 + effects.r * 0.2);

    float water = smoothstep(0.07, 0.72, effects.r);
    float waterPulse = 0.82 + 0.18 * sin(uTime * 0.72 + terrainUv.y * 42.0);
    color = mix(color, vec3(0.015, 0.42, 0.58) * waterPulse, water * 0.76);
    color += vec3(0.08, 0.55, 0.72) * pow(water, 2.2) * 0.34;

    float routeNoise = noise((vWorldPosition.xz + vec2(18.0)) * 1.55 + vec2(uTime * 0.018, 0.0));
    float ridgeRoute = smoothstep(0.48, 0.88, effects.g) * smoothstep(0.55, 0.82, routeNoise);
    color += vec3(0.55, 0.025, 0.30) * ridgeRoute * (0.28 + 0.14 * sin(uTime * 1.2));

    float distanceHaze = smoothstep(18.0, 56.0, length(vWorldPosition.xz));
    float hazeNoise = noise(vWorldPosition.xz * 0.18 + vec2(uTime * 0.012, 0.0));
    color = mix(color, vec3(0.055, 0.105, 0.12), distanceHaze * (0.08 + hazeNoise * 0.12));
    gl_FragColor = vec4(color, 1.0);
  }
`;

const pointVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  attribute float seed;
  varying float vPulse;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vPulse = 0.72 + 0.28 * sin(uTime * (0.7 + seed * 0.9) + seed * 21.0);
    gl_PointSize = uPixelRatio * (1.7 + seed * 2.7) * (20.0 / max(5.0, -viewPosition.z));
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const pointFragmentShader = /* glsl */ `
  varying float vPulse;
  void main() {
    float distanceToCenter = length(gl_PointCoord - 0.5);
    float core = 1.0 - smoothstep(0.05, 0.48, distanceToCenter);
    float glow = 1.0 - smoothstep(0.12, 0.5, distanceToCenter);
    vec3 color = mix(vec3(1.0, 0.34, 0.08), vec3(1.0, 0.78, 0.38), core);
    gl_FragColor = vec4(color, (core + glow * 0.38) * vPulse);
  }
`;

const cloudVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  attribute float seed;
  varying float vAlpha;
  varying float vSeed;
  void main() {
    vec3 animated = position;
    animated.x += sin(uTime * 0.025 + seed * 11.0) * 0.28;
    vec4 viewPosition = modelViewMatrix * vec4(animated, 1.0);
    vAlpha = 0.09 + seed * 0.09;
    vSeed = seed;
    gl_PointSize = uPixelRatio * (22.0 + seed * 44.0) * (18.0 / max(8.0, -viewPosition.z));
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const cloudFragmentShader = /* glsl */ `
  varying float vAlpha;
  varying float vSeed;
  void main() {
    vec2 point = (gl_PointCoord - 0.5) * vec2(0.72, 1.65);
    float cloud = 1.0 - smoothstep(0.12, 0.48, length(point));
    float wisp = 0.66 + 0.34 * sin((point.x + point.y) * 18.0 + vSeed * 24.0);
    gl_FragColor = vec4(0.25, 0.36, 0.39, cloud * cloud * wisp * vAlpha);
  }
`;

const routeCoordinates = [
  [[0.52, 0.73], [0.60, 0.66], [0.68, 0.58], [0.76, 0.49], [0.88, 0.40]],
  [[0.58, 0.40], [0.66, 0.46], [0.76, 0.49], [0.84, 0.56], [0.92, 0.62]],
  [[0.68, 0.58], [0.73, 0.68], [0.80, 0.76], [0.89, 0.81]],
  [[0.63, 0.27], [0.70, 0.34], [0.76, 0.49], [0.85, 0.45]],
];

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function mulberry32(seed) {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function decodeHeightMap(buffer) {
  const expectedBytes = terrainMetadata.textureWidth * terrainMetadata.textureHeight * 2;
  if (buffer.byteLength !== expectedBytes) throw new Error(`Unexpected terrain byte length: ${buffer.byteLength}`);
  const littleEndian = new Uint16Array(new Uint8Array([1, 0]).buffer)[0] === 1;
  if (littleEndian) return new Uint16Array(buffer);
  const source = new DataView(buffer);
  const values = new Uint16Array(expectedBytes / 2);
  for (let index = 0; index < values.length; index += 1) values[index] = source.getUint16(index * 2, true);
  return values;
}

function makeHeightTexture(values) {
  const packed = new Uint8Array(values.length * 4);
  for (let index = 0; index < values.length; index += 1) {
    packed[index * 4] = values[index] >>> 8;
    packed[index * 4 + 1] = values[index] & 255;
    packed[index * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(
    packed,
    terrainMetadata.textureWidth,
    terrainMetadata.textureHeight,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function sampleElevation(values, u, row) {
  const gutter = terrainMetadata.textureGutter;
  const interior = terrainMetadata.tileInteriorSize;
  const x = gutter + clamp(Math.round(u * (interior - 1)), 0, interior - 1);
  const y = gutter + clamp(Math.round(row * (interior - 1)), 0, interior - 1);
  const encoded = values[y * terrainMetadata.textureWidth + x] / 65535;
  return terrainMetadata.minElevationM + encoded * (terrainMetadata.maxElevationM - terrainMetadata.minElevationM);
}

function terrainPoint(values, tile, u, row, lift = 0.04) {
  const size = terrainMetadata.tileWorldSize;
  const elevation = sampleElevation(values, u, row);
  const height = (elevation - terrainMetadata.elevationOriginM) / terrainMetadata.metersPerWorldUnit;
  return new THREE.Vector3(
    (u - 0.5 + tile.grid.column) * size,
    height + lift,
    (row - 0.5 + tile.grid.row) * size,
  );
}

function makeLights(values, tile, isMobile, pixelRatio) {
  const tileSeed = [...tile.id].reduce((total, character) => total + character.charCodeAt(0), 19780309);
  const random = mulberry32(tileSeed);
  const positions = [];
  const seeds = [];
  const targetCount = isMobile ? 85 : 190;
  let attempts = 0;
  while (seeds.length < targetCount && attempts < targetCount * 20) {
    attempts += 1;
    const u = tile.id === "c" ? 0.48 + random() * 0.5 : 0.05 + random() * 0.9;
    const row = 0.06 + random() * 0.88;
    const elevation = sampleElevation(values, u, row);
    const colorRange = terrainMetadata.colorElevationRangeM;
    const height = clamp((elevation - colorRange.min) / (colorRange.max - colorRange.min), 0, 1);
    const deltaX = Math.abs(sampleElevation(values, u + 0.004, row) - sampleElevation(values, u - 0.004, row));
    const deltaY = Math.abs(sampleElevation(values, u, row + 0.004) - sampleElevation(values, u, row - 0.004));
    if (height > 0.72 || deltaX + deltaY > 36 || random() < height * 0.72) continue;
    const point = terrainPoint(values, tile, u, row, 0.055 + random() * 0.055);
    positions.push(point.x, point.y, point.z);
    seeds.push(random());
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("seed", new THREE.Float32BufferAttribute(seeds, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio } },
    vertexShader: pointVertexShader,
    fragmentShader: pointFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geometry, material);
}

function makeRoutes(values, tile) {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: 0xff2a92,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const nodePositions = [];
  routeCoordinates.forEach((coordinates) => {
    const points = coordinates.map(([u, row]) => {
      const point = terrainPoint(values, tile, u, row, 0.095);
      nodePositions.push(point.x, point.y, point.z);
      return point;
    });
    group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 72, 0.012, 4, false), material));
  });
  const nodes = new THREE.BufferGeometry();
  nodes.setAttribute("position", new THREE.Float32BufferAttribute(nodePositions, 3));
  group.add(new THREE.Points(nodes, new THREE.PointsMaterial({
    color: 0xff54aa,
    size: 0.095,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })));
  return group;
}

function makeClouds(isMobile, pixelRatio) {
  const random = mulberry32(20260912);
  const positions = [];
  const seeds = [];
  for (let index = 0; index < (isMobile ? 48 : 104); index += 1) {
    positions.push(-29 + random() * 40, 2.2 + random() * 2.8, -29 + random() * 60);
    seeds.push(random());
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("seed", new THREE.Float32BufferAttribute(seeds, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio } },
    vertexShader: cloudVertexShader,
    fragmentShader: cloudFragmentShader,
    transparent: true,
    depthWrite: false,
  });
  return new THREE.Points(geometry, material);
}

async function loadEffectsTexture(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Effects texture failed with ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob(), { imageOrientation: "none" });
  const texture = new THREE.Texture(bitmap);
  texture.flipY = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export default function TerrainBackground({ fallbackSrc }) {
  const canvasRef = useRef(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    const canvas = canvasRef.current;
    const hero = canvas?.closest(".hero");
    if (!canvas || !hero) return undefined;

    const abortController = new AbortController();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mobileMedia = window.matchMedia("(max-width: 820px)");
    const resources = new Set();
    const animatedMaterials = new Set();
    const pointMaterials = new Set();
    const track = (resource) => {
      resources.add(resource);
      return resource;
    };
    let renderer, scene, camera, sharedGeometry;
    let frameId = 0;
    let disposed = false;
    let isIntersecting = true;
    let lastFrame = 0;
    let lastInput = -10000;
    let flightStartedAt = 0;

    const pointerTarget = new THREE.Vector2();
    const pointerCurrent = new THREE.Vector2();
    const basePosition = new THREE.Vector3(...terrainMetadata.flightPath.positions[0]);
    const baseLookAt = new THREE.Vector3(...terrainMetadata.flightPath.lookAt[0]);
    const cameraPosition = basePosition.clone();
    const lookAt = baseLookAt.clone();
    const flightPosition = basePosition.clone();
    const flightLookAt = baseLookAt.clone();
    const positionCurve = new THREE.CatmullRomCurve3(
      terrainMetadata.flightPath.positions.map((point) => new THREE.Vector3(...point)),
      false,
      "catmullrom",
      0.42,
    );
    const lookAtCurve = new THREE.CatmullRomCurve3(
      terrainMetadata.flightPath.lookAt.map((point) => new THREE.Vector3(...point)),
      false,
      "catmullrom",
      0.42,
    );

    const fail = (error) => {
      if (disposed || error?.name === "AbortError") return;
      console.warn("Terrain background fell back to the static artwork.", error);
      setStatus("fallback");
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
    };

    const resize = () => {
      if (!renderer || !camera) return;
      const bounds = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, mobileMedia.matches ? 1 : 1.5);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(Math.max(1, Math.round(bounds.width)), Math.max(1, Math.round(bounds.height)), false);
      camera.aspect = Math.max(1, bounds.width) / Math.max(1, bounds.height);
      camera.updateProjectionMatrix();
      pointMaterials.forEach((material) => { material.uniforms.uPixelRatio.value = pixelRatio; });
    };

    const renderFrame = (time = 0) => {
      if (!renderer || !scene || !camera) return;
      const seconds = time * 0.001;
      const hasRecentInput = time - lastInput < 2800;
      const targetX = reducedMotion.matches ? 0 : hasRecentInput ? pointerTarget.x : Math.sin(seconds * 0.075) * 0.16;
      const targetY = reducedMotion.matches ? 0 : hasRecentInput ? pointerTarget.y : Math.cos(seconds * 0.061) * 0.08;
      pointerCurrent.x += (targetX - pointerCurrent.x) * 0.045;
      pointerCurrent.y += (targetY - pointerCurrent.y) * 0.045;

      if (flightStartedAt && !reducedMotion.matches) {
        const cycle = ((time - flightStartedAt) / 1000) / terrainMetadata.flightPath.durationSeconds;
        const travel = 0.5 - Math.cos(cycle * Math.PI * 2) * 0.5;
        positionCurve.getPointAt(travel, flightPosition);
        lookAtCurve.getPointAt(travel, flightLookAt);
      } else {
        flightPosition.copy(basePosition);
        flightLookAt.copy(baseLookAt);
      }

      cameraPosition.copy(flightPosition);
      cameraPosition.x += pointerCurrent.x * 0.95;
      cameraPosition.y -= pointerCurrent.y * 0.48;
      cameraPosition.z += pointerCurrent.y * 0.34;
      lookAt.copy(flightLookAt);
      lookAt.x += pointerCurrent.x * 0.44;
      lookAt.y -= pointerCurrent.y * 0.2;
      camera.position.copy(cameraPosition);
      camera.lookAt(lookAt);
      animatedMaterials.forEach((material) => { material.uniforms.uTime.value = seconds; });
      renderer.render(scene, camera);
    };

    const animate = (time) => {
      frameId = 0;
      if (disposed || document.hidden || !isIntersecting || reducedMotion.matches) return;
      const minimumInterval = mobileMedia.matches ? 1000 / 30 : 0;
      if (!minimumInterval || time - lastFrame >= minimumInterval) {
        renderFrame(time);
        lastFrame = time;
      }
      frameId = requestAnimationFrame(animate);
    };

    const schedule = () => {
      if (!renderer || disposed) return;
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
      if (!document.hidden && isIntersecting && !reducedMotion.matches) frameId = requestAnimationFrame(animate);
      else renderFrame(0);
    };

    const onPointerMove = (event) => {
      if (reducedMotion.matches || !isIntersecting || !event.isPrimary) return;
      const bounds = hero.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return;
      pointerTarget.set(
        clamp(((event.clientX - bounds.left) / bounds.width - 0.5) * 2, -1, 1),
        clamp(((event.clientY - bounds.top) / bounds.height - 0.5) * 2, -1, 1),
      );
      lastInput = performance.now();
    };

    const onVisibilityChange = () => schedule();
    const onMotionChange = () => schedule();
    const onContextLost = (event) => {
      event.preventDefault();
      fail(new Error("WebGL context lost"));
    };
    const resizeObserver = new ResizeObserver(resize);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      isIntersecting = entry.isIntersecting;
      schedule();
    }, { threshold: 0.01 });

    const addTile = async (tile) => {
      const heightUrl = assetUrl(heightAssetUrls, tile.assets.height);
      const effectsUrl = assetUrl(effectsAssetUrls, tile.assets.effects);
      const [heightResponse, effectsTexture] = await Promise.all([
        fetch(heightUrl, { signal: abortController.signal }),
        loadEffectsTexture(effectsUrl, abortController.signal),
      ]);
      if (!heightResponse.ok) throw new Error(`${tile.id} height map failed with ${heightResponse.status}`);
      const heightValues = decodeHeightMap(await heightResponse.arrayBuffer());
      if (disposed) {
        effectsTexture.dispose();
        effectsTexture.image?.close?.();
        return;
      }

      const heightTexture = track(makeHeightTexture(heightValues));
      track(effectsTexture);
      const uvScale = terrainMetadata.tileInteriorSize / terrainMetadata.textureWidth;
      const uvOffset = terrainMetadata.textureGutter / terrainMetadata.textureWidth;
      const colorRange = terrainMetadata.colorElevationRangeM;
      const terrainMaterial = track(new THREE.ShaderMaterial({
        uniforms: {
          uHeightMap: { value: heightTexture },
          uEffectsMap: { value: effectsTexture },
          uUvScale: { value: new THREE.Vector2(uvScale, uvScale) },
          uUvOffset: { value: new THREE.Vector2(uvOffset, uvOffset) },
          uTexel: { value: new THREE.Vector2(1 / terrainMetadata.tileInteriorSize, 1 / terrainMetadata.tileInteriorSize) },
          uElevationMin: { value: terrainMetadata.minElevationM },
          uElevationRange: { value: terrainMetadata.maxElevationM - terrainMetadata.minElevationM },
          uElevationOrigin: { value: terrainMetadata.elevationOriginM },
          uMetersPerWorldUnit: { value: terrainMetadata.metersPerWorldUnit },
          uColorElevationMin: { value: colorRange.min },
          uColorElevationRange: { value: colorRange.max - colorRange.min },
          uTerrainSize: { value: terrainMetadata.tileWorldSize },
          uTime: { value: 0 },
        },
        vertexShader,
        fragmentShader,
      }));
      animatedMaterials.add(terrainMaterial);
      const mesh = new THREE.Mesh(sharedGeometry, terrainMaterial);
      mesh.position.set(
        tile.grid.column * terrainMetadata.tileWorldSize,
        0,
        tile.grid.row * terrainMetadata.tileWorldSize,
      );
      scene.add(mesh);

      const pixelRatio = Math.min(window.devicePixelRatio || 1, mobileMedia.matches ? 1 : 1.5);
      const lights = makeLights(heightValues, tile, mobileMedia.matches, pixelRatio);
      track(lights.geometry);
      track(lights.material);
      animatedMaterials.add(lights.material);
      pointMaterials.add(lights.material);
      scene.add(lights);

      if (tile.id === "c") {
        const routes = makeRoutes(heightValues, tile);
        routes.traverse((object) => {
          if (object.geometry) track(object.geometry);
          if (object.material) track(object.material);
        });
        scene.add(routes);
      }
    };

    const initialize = async () => {
      try {
        const context = canvas.getContext("webgl2", {
          alpha: false,
          antialias: !mobileMedia.matches,
          depth: true,
          powerPreference: "high-performance",
        });
        if (!context) throw new Error("WebGL2 is unavailable");
        renderer = new THREE.WebGLRenderer({ canvas, context, antialias: !mobileMedia.matches, alpha: false });
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.12;
        renderer.setClearColor(0x030c12, 1);

        scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x07131a, 0.022);
        camera = new THREE.PerspectiveCamera(43, 1, 0.1, 105);
        camera.position.copy(basePosition);
        camera.lookAt(baseLookAt);
        sharedGeometry = track(new THREE.PlaneGeometry(
          terrainMetadata.tileWorldSize,
          terrainMetadata.tileWorldSize,
          mobileMedia.matches ? 128 : 256,
          mobileMedia.matches ? 128 : 256,
        ));
        sharedGeometry.rotateX(-Math.PI / 2);

        const clouds = makeClouds(
          mobileMedia.matches,
          Math.min(window.devicePixelRatio || 1, mobileMedia.matches ? 1 : 1.5),
        );
        track(clouds.geometry);
        track(clouds.material);
        animatedMaterials.add(clouds.material);
        pointMaterials.add(clouds.material);
        scene.add(clouds);

        const centerTile = terrainMetadata.tiles.find((tile) => tile.id === "c");
        if (!centerTile) throw new Error("Center terrain tile is missing from the manifest");
        await addTile(centerTile);
        if (disposed) return;

        resizeObserver.observe(canvas);
        intersectionObserver.observe(hero);
        window.addEventListener("pointermove", onPointerMove, { passive: true });
        document.addEventListener("visibilitychange", onVisibilityChange);
        reducedMotion.addEventListener("change", onMotionChange);
        canvas.addEventListener("webglcontextlost", onContextLost);
        resize();
        renderFrame(0);
        setStatus("ready");
        schedule();

        let routeComplete = true;
        for (const tile of terrainMetadata.tiles) {
          if (tile.id === "c") continue;
          try {
            await addTile(tile);
          } catch (error) {
            if (error?.name === "AbortError") return;
            routeComplete = false;
            console.warn(`Optional terrain tile ${tile.id} could not be loaded.`, error);
          }
        }
        if (!disposed && routeComplete) flightStartedAt = performance.now();
      } catch (error) {
        fail(error);
      }
    };

    initialize();
    return () => {
      disposed = true;
      abortController.abort();
      if (frameId) cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reducedMotion.removeEventListener("change", onMotionChange);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      resources.forEach((resource) => {
        resource.dispose?.();
        resource.image?.close?.();
      });
      renderer?.dispose();
    };
  }, []);

  return (
    <div className={`terrain-background terrain-background--${status}`} aria-hidden="true">
      <img className="terrain-fallback" src={fallbackSrc} alt="" />
      <canvas ref={canvasRef} className="terrain-canvas" />
      <div className="terrain-survey">
        <i className="survey-mark survey-mark--nw" />
        <i className="survey-mark survey-mark--ne" />
        <i className="survey-mark survey-mark--sw" />
        <i className="survey-mark survey-mark--se" />
      </div>
    </div>
  );
}
