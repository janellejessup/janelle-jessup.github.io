/**
 * WebGPU ocean background (from three.js webgpu_ocean example).
 * Renders water + sky as full-viewport background.
 */
(function () {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  function showOceanDebug() {
    const q = new URLSearchParams(location.search);
    if (q.has('ocean-debug') || q.get('debug') === 'ocean') return false;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('oceanDebug')) return true;
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return true;
    return false;
  }

  const containerId = 'particle-canvas-container';
  const MAX_RIPPLES = 4;
  const OCEAN_PARAMS_KEY = 'oceanDebugParams';

  function applyParams(ctx, o) {
    if (!o || typeof o !== 'object') return;
    try {
      const w = ctx.water, s = ctx.sky, b = ctx.bloomPass, r = ctx.renderer, p = ctx.parameters;
      if (o.rippleA != null) w.rippleAmplitude.value = Number(o.rippleA);
      if (o.rippleW != null) w.rippleWavelength.value = Number(o.rippleW);
      if (o.rippleS != null) w.rippleSpeed.value = Number(o.rippleS);
      if (o.rippleD != null) w.rippleDecay.value = Number(o.rippleD);
      if (o.dist != null) w.distortionScale.value = Number(o.dist);
      if (o.size != null) w.size.value = Number(o.size);
      if (o.waveVel != null) w.waveTimeScale.value = Number(o.waveVel);
      if (o.elev != null) p.elevation = Number(o.elev);
      if (o.az != null) p.azimuth = Number(o.az);
      if (o.exp != null) { p.exposure = Number(o.exp); r.toneMappingExposure = p.exposure; }
      if (o.turb != null) s.turbidity.value = Number(o.turb);
      if (o.ray != null) s.rayleigh.value = Number(o.ray);
      if (o.cc != null) s.cloudCoverage.value = Number(o.cc);
      if (o.cd != null) s.cloudDensity.value = Number(o.cd);
      if (o.ce != null) s.cloudElevation.value = Number(o.ce);
      if (o.bloomS != null) b.strength.value = Number(o.bloomS);
      if (o.bloomR != null) b.radius.value = Number(o.bloomR);
      if (o.sunColor) {
        const hex = String(o.sunColor).replace(/^#/, '');
        if (/^[0-9a-fA-F]{6}$/.test(hex)) w.sunColor.value.setHex(parseInt(hex, 16));
      }
      if (o.waterColor) {
        const hex = String(o.waterColor).replace(/^#/, '');
        if (/^[0-9a-fA-F]{6}$/.test(hex)) w.waterColor.value.setHex(parseInt(hex, 16));
      }
      ctx.updateSun();
    } catch (e) { }
  }

  async function loadParamsForInit(ctx) {
    let config = {};
    try {
      const res = await fetch('./ocean-params.json');
      if (res.ok) config = await res.json();
    } catch (e) { }
    let local = {};
    try {
      const raw = localStorage.getItem(OCEAN_PARAMS_KEY);
      if (raw) local = JSON.parse(raw);
    } catch (e) { }
    const merged = { ...config, ...local };
    if (Object.keys(merged).length > 0) applyParams(ctx, merged);
  }

  let container, camera, scene, renderer, renderPipeline;
  let water, sun, sky, bloomPass;
  let raycaster, mouse;
  let rippleQueue = [];
  let rafId = null;

  async function init() {
    const adapter = await navigator.gpu?.requestAdapter?.();
    const device = await adapter?.requestDevice?.();
    if (!device) {
      console.warn('WebGPU not supported; ocean background disabled.');
      return;
    }

    const THREE = await import('three/webgpu');
    const { pass } = await import('three/tsl');
    const { bloom } = await import('three/addons/tsl/display/BloomNode.js');
    const { WaterMesh } = await import('three/addons/objects/WaterMesh.js');
    const { SkyMesh } = await import('three/addons/objects/SkyMesh.js');

    container = document.getElementById(containerId);
    if (!container) {
      const div = document.createElement('div');
      div.id = containerId;
      div.className = 'particle-canvas';
      div.setAttribute('aria-hidden', 'true');
      document.body.insertBefore(div, document.body.firstChild);
      container = div;
    }

    renderer = new THREE.WebGPURenderer();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setAnimationLoop(render);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.1;
    container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-hidden', 'true');

    // ✅ Force full-viewport canvas
    renderer.domElement.style.position = 'fixed';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    renderer.domElement.style.width = '100vw';
    renderer.domElement.style.height = '100vh';
    renderer.domElement.style.zIndex = '-1';

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 20000);
    camera.position.set(30, 30, 100);
    camera.lookAt(0, 0, 0);

    renderPipeline = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera);
    const scenePassColor = scenePass.getTextureNode('output');
    bloomPass = bloom(scenePassColor);
    bloomPass.threshold.value = 0;
    bloomPass.strength.value = 0.1;
    bloomPass.radius.value = 0;
    renderPipeline.outputNode = scenePassColor.add(bloomPass);

    sun = new THREE.Vector3();

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

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

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
        rippleQueue.length >= 2 ? rippleQueue[rippleQueue.length - 2] : null,
        rippleQueue.length >= 3 ? rippleQueue[rippleQueue.length - 3] : null,
        rippleQueue.length >= 4 ? rippleQueue[rippleQueue.length - 4] : null
      ];
      water.ripplePos0.value.set(positions[0]?.x ?? 0, positions[0]?.z ?? 0);
      water.rippleTime0.value = positions[0]?.time ?? -1000;
      water.ripplePos1.value.set(positions[1]?.x ?? 0, positions[1]?.z ?? 0);
      water.rippleTime1.value = positions[1]?.time ?? -1000;
      water.ripplePos2.value.set(positions[2]?.x ?? 0, positions[2]?.z ?? 0);
      water.rippleTime2.value = positions[2]?.time ?? -1000;
      water.ripplePos3.value.set(positions[3]?.x ?? 0, positions[3]?.z ?? 0);
      water.rippleTime3.value = positions[3]?.time ?? -1000;
    }

    document.addEventListener('pointerdown', onPointerDown);

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

    const parameters = { elevation: 2, azimuth: 180, exposure: 0.1 };

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const sceneEnv = new THREE.Scene();
    let renderTarget;

    function updateSun() {
      const phi = THREE.MathUtils.degToRad(90 - parameters.elevation);
      const theta = THREE.MathUtils.degToRad(parameters.azimuth);
      sun.setFromSphericalCoords(1, phi, theta);
      sky.sunPosition.value.copy(sun);
      water.sunDirection.value.copy(sun).normalize();
      if (renderTarget !== undefined) renderTarget.dispose();
      sceneEnv.add(sky);
      renderTarget = pmremGenerator.fromScene(sceneEnv);
      scene.add(sky);
      scene.environment = renderTarget.texture;
    }

    await renderer.init();
    updateSun();

    const ctx = { water, sky, bloomPass, renderer, parameters, updateSun, applyParams };
    await loadParamsForInit(ctx);

    if (showOceanDebug()) createDebugPanel({ ...ctx });

    window.addEventListener('resize', onWindowResize);
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

  init().catch((err) => { console.warn('WebGPU ocean failed to init:', err); });
})();
