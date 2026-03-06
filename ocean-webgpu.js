/**
 * WebGPU Ocean Background
 * Full-viewport animated ocean using Three.js WebGPU
 * Falls back gracefully if WebGPU unsupported
 */
(function () {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const containerId = 'particle-canvas-container';
  const MAX_RIPPLES = 4;
  const OCEAN_PARAMS_KEY = 'oceanDebugParams';

  let container, camera, scene, renderer, renderPipeline;
  let water, sun, sky, bloomPass;
  let raycaster, mouse;
  let rippleQueue = []; // { x, z, time }
  let rafId = null;

  async function init() {
    // WebGPU check
    const adapter = await navigator.gpu?.requestAdapter?.();
    const device = await adapter?.requestDevice?.();
    if (!device) {
      console.warn('WebGPU not supported; ocean background disabled.');
      return;
    }

    // Three.js WebGPU import
    const THREE = await import('three/webgpu');
    const { pass } = await import('three/tsl');
    const { bloom } = await import('three/addons/tsl/display/BloomNode.js');
    const { WaterMesh } = await import('three/addons/objects/WaterMesh.js');
    const { SkyMesh } = await import('three/addons/objects/SkyMesh.js');

    // Container
    container = document.getElementById(containerId);
    if (!container) {
      container = document.createElement('div');
      container.id = containerId;
      container.className = 'particle-canvas';
      document.body.insertBefore(container, document.body.firstChild);
    }

    // Renderer
    renderer = new THREE.WebGPURenderer();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setAnimationLoop(render);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.1;
    container.appendChild(renderer.domElement);

    // Scene & camera
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 20000);
    camera.position.set(30, 30, 100);
    camera.lookAt(0, 0, 0);

    // Render pipeline
    renderPipeline = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera);
    const scenePassColor = scenePass.getTextureNode('output');
    bloomPass = bloom(scenePassColor);
    bloomPass.threshold.value = 0;
    bloomPass.strength.value = 0.1;
    bloomPass.radius.value = 0;
    renderPipeline.outputNode = scenePassColor.add(bloomPass);

    sun = new THREE.Vector3();

    // Water
    const waterGeometry = new THREE.PlaneGeometry(10000, 10000);
    const loader = new THREE.TextureLoader();
    const waterNormals = loader.load('textures/waternormals.jpg');
    waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping;
    water = new WaterMesh(waterGeometry, {
      waterNormals,
      sunDirection: new THREE.Vector3(),
      sunColor: 0xffffff,
      waterColor: 0x001e0f,
      distortionScale: 3.7
    });
    water.rotation.x = -Math.PI / 2;
    scene.add(water);

    // Mouse ripple interaction
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    document.addEventListener('pointerdown', onPointerDown);

    // Sky
    sky = new SkyMesh();
    sky.scale.setScalar(10000);
    scene.add(sky);
    sky.turbidity.value = 10;
    sky.rayleigh.value = 2;
    sky.mieCoefficient.value = 0.005;
    sky.mieDirectionalG.value = 0.8;
    sky.cloudCoverage.value = 0.4;
    sky.cloudDensity.value = 0.5;
    sky.cloudElevation.value = 0.5;

    // Sun & environment
    const parameters = { elevation: 2, azimuth: 180, exposure: 0.1 };
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    function updateSun() {
      const phi = THREE.MathUtils.degToRad(90 - parameters.elevation);
      const theta = THREE.MathUtils.degToRad(parameters.azimuth);
      sun.setFromSphericalCoords(1, phi, theta);
      sky.sunPosition.value.copy(sun);
      water.sunDirection.value.copy(sun).normalize();
      scene.environment = pmremGenerator.fromScene(sky).texture;
    }
    updateSun();

    window.addEventListener('resize', onWindowResize);
  }

  function onPointerDown(event) {
    if (!water || !camera || !renderer.domElement) return;
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(water);
    if (hits.length > 0) {
      const p = hits[0].point;
      const t = performance.now() * 0.001;
      rippleQueue.push({ x: p.x, z: p.z, time: t });
      if (rippleQueue.length > MAX_RIPPLES) rippleQueue.shift();
      updateRippleUniforms();
    }
  }

  function updateRippleUniforms() {
    const positions = [
      rippleQueue[rippleQueue.length - 1],
      rippleQueue[rippleQueue.length - 2] || null,
      rippleQueue[rippleQueue.length - 3] || null,
      rippleQueue[rippleQueue.length - 4] || null
    ];
    water.ripplePos0.value.set(positions[0]?.x || 0, positions[0]?.z || 0);
    water.rippleTime0.value = positions[0]?.time || -1000;
    water.ripplePos1.value.set(positions[1]?.x || 0, positions[1]?.z || 0);
    water.rippleTime1.value = positions[1]?.time || -1000;
    water.ripplePos2.value.set(positions[2]?.x || 0, positions[2]?.z || 0);
    water.rippleTime2.value = positions[2]?.time || -1000;
    water.ripplePos3.value.set(positions[3]?.x || 0, positions[3]?.z || 0);
    water.rippleTime3.value = positions[3]?.time || -1000;
  }

  function onWindowResize() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function render() {
    if (renderPipeline) renderPipeline.render();
  }

  init().catch((err) => {
    console.warn('WebGPU ocean failed to init:', err);
  });
})();
