/**
 * Ocean background: Gerstner waves with light/surface simulation, fading into the background.
 * @see https://threejs.org/examples/?q=ocean#webgpu_ocean
 * @see https://sbcode.net/threejs/gerstnerwater/
 * @see https://discourse.threejs.org/t/make-high-performance-games-with-water-surface-simulations-with-water-bodies/74113
 */
import * as THREE from 'three';

(function () {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var scene, camera, renderer, oceanMesh, oceanMaterial, clock;
  var rafId = null;
  var particleContainer = null;

  var vertexShader = [
    'uniform float uTime;',
    'uniform float uWaveScale;',
    'varying vec3 vPosition;',
    'varying vec2 vUv;',
    'varying float vWaveHeight;',
    'void main() {',
    '  vUv = uv;',
    '  vec3 pos = position;',
    '  float waveHeight = 0.0;',
    '  float k = 0.08 * uWaveScale;',
    '  float amp = 12.0 * uWaveScale;',
    '  vec2 dir1 = normalize(vec2(1.0, 0.4));',
    '  vec2 dir2 = normalize(vec2(-0.7, 0.6));',
    '  vec2 dir3 = normalize(vec2(0.5, -0.5));',
    '  float p1 = dot(dir1, pos.xz) * k + uTime * 0.6;',
    '  float p2 = dot(dir2, pos.xz) * k * 0.9 + uTime * 0.5;',
    '  float p3 = dot(dir3, pos.xz) * k * 1.1 + uTime * 0.4;',
    '  waveHeight += amp * sin(p1);',
    '  waveHeight += amp * 0.7 * sin(p2);',
    '  waveHeight += amp * 0.5 * sin(p3);',
    '  pos.y += waveHeight;',
    '  pos.x += dir1.x * amp * 0.3 * cos(p1) + dir2.x * amp * 0.2 * cos(p2);',
    '  pos.z += dir1.y * amp * 0.3 * cos(p1) + dir2.y * amp * 0.2 * cos(p2);',
    '  vPosition = pos;',
    '  vWaveHeight = waveHeight;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);',
    '}'
  ].join('\n');

  var fragmentShader = [
    'uniform vec3 uColorDeep;',
    'uniform vec3 uColorMid;',
    'uniform float uFadeStart;',
    'uniform float uFadeEnd;',
    'varying vec3 vPosition;',
    'varying vec2 vUv;',
    'varying float vWaveHeight;',
    'void main() {',
    '  float t = (vUv.y - uFadeStart) / (uFadeEnd - uFadeStart);',
    '  t = clamp(t, 0.0, 1.0);',
    '  vec3 col = mix(uColorDeep, uColorMid, t);',
    '  float alpha = 0.95 - t * 0.9;',
    '  if (alpha < 0.01) discard;',
    '  gl_FragColor = vec4(col, alpha);',
    '}'
  ].join('\n');

  function initThree(container) {
    var w = window.innerWidth;
    var h = window.innerHeight;

    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(0, w, 0, -h, -10, 10);
    camera.position.z = 5;

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    if (container) {
      container.appendChild(renderer.domElement);
      if (container.className) renderer.domElement.className = container.className;
      renderer.domElement.setAttribute('aria-hidden', 'true');
    }

    var segmentsX = 80;
    var segmentsY = 48;
    var plane = new THREE.PlaneGeometry(w + 80, h + 80, segmentsX, segmentsY);
    oceanMaterial = new THREE.ShaderMaterial({
      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uWaveScale: { value: 1.0 },
        uColorDeep: { value: new THREE.Color(0x0d2137) },
        uColorMid: { value: new THREE.Color(0x1e4976) },
        uFadeStart: { value: 0.0 },
        uFadeEnd: { value: 0.75 }
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide
    });

    oceanMesh = new THREE.Mesh(plane, oceanMaterial);
    oceanMesh.position.set(w * 0.5, -h * 0.5, 0);
    scene.add(oceanMesh);

    clock = new THREE.Clock();
  }

  function resize(container) {
    var w = window.innerWidth;
    var h = window.innerHeight;
    if (!camera || !renderer) return;
    camera.left = 0;
    camera.right = w;
    camera.top = 0;
    camera.bottom = -h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    if (oceanMesh && oceanMesh.geometry) {
      var segX = 80;
      var segY = 48;
      oceanMesh.geometry.dispose();
      oceanMesh.geometry = new THREE.PlaneGeometry(w + 80, h + 80, segX, segY);
      oceanMesh.position.set(w * 0.5, -h * 0.5, 0);
    }
  }

  function tick() {
    if (!renderer || !scene || !camera) return;
    oceanMaterial.uniforms.uTime.value = clock.getElapsedTime();

    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(tick);
  }

  function start(container) {
    container = container || document.getElementById('particle-canvas-container');
    if (!container) {
      var div = document.createElement('div');
      div.id = 'particle-canvas-container';
      div.className = 'particle-canvas';
      div.setAttribute('aria-hidden', 'true');
      document.body.insertBefore(div, document.body.firstChild);
      container = div;
    }
    particleContainer = container;
    initThree(container);
    window.addEventListener('resize', function () { resize(container); });
    tick();
  }

  start();
})();
