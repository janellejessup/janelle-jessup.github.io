/**
 * WebGPU ocean background (from three.js webgpu_ocean example).
 * Renders water + sky as full-viewport background. Falls back to no background if WebGPU is unavailable.
 * @see https://threejs.org/examples/?q=ocean#webgpu_ocean
 *
 * Debug panel is shown only when showOceanDebug() is true. Ways to enable:
 *   - URL: ?ocean-debug or ?debug=ocean  (e.g. https://yoursite.com/?ocean-debug)
 *   - localStorage: set oceanDebug to any truthy value (e.g. in console: localStorage.setItem('oceanDebug','1'))
 *   - Local dev: hostname is localhost or 127.0.0.1 (panel shown automatically)
 * To hide in production: don't use the URL param, don't set localStorage, and deploy to a non-localhost host.
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
    } catch (e) { /* ignore invalid params */ }
  }

  async function loadParamsForInit(ctx) {
    let config = {};
    try {
      const res = await fetch('./ocean-params.json');
      if (res.ok) config = await res.json();
    } catch (e) { /* config file optional */ }
    let local = {};
    try {
      const raw = localStorage.getItem(OCEAN_PARAMS_KEY);
      if (raw) local = JSON.parse(raw);
    } catch (e) { /* ignore */ }
    const merged = { ...config, ...local };
    if (Object.keys(merged).length > 0) applyParams(ctx, merged);
  }
  let container, camera, scene, renderer, renderPipeline;
  let water, sun, sky, bloomPass;
  let raycaster, mouse;
  let rippleQueue = []; // { x, z, time } in world coords, time in seconds
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

    const ctx = {
      water,
      sky,
      bloomPass,
      renderer,
      parameters,
      updateSun,
      applyParams
    };
    await loadParamsForInit(ctx);

    if (showOceanDebug()) {
      createDebugPanel({
        ...ctx
      });
    }

    window.addEventListener('resize', onWindowResize);
  }

  function createDebugPanel(ctx) {
    const { water, sky, bloomPass, renderer, parameters, updateSun } = ctx;
    window.__oceanDebug = ctx;

    const wrapper = document.createElement('div');
    wrapper.id = 'ocean-debug-panel';
    wrapper.style.cssText = 'position:fixed;top:4rem;right:0;z-index:100;';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.textContent = 'Ocean debug';
    toggleBtn.style.cssText = 'padding:8px 12px;cursor:pointer;background:#3a3a3a;color:#fff;border:1px solid #666;border-right:none;border-radius:6px 0 0 6px;font-size:13px;';

    const iframe = document.createElement('iframe');
    iframe.id = 'ocean-debug-iframe';
    iframe.style.cssText = 'display:none;width:300px;height:85vh;max-height:600px;border:1px solid #666;border-right:none;border-radius:6px 0 0 6px;background:#fff;';

    const srcdoc = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 12px; font: 13px system-ui, sans-serif; background: #2d2d2d; color: #e8e8e8; }
  .section { margin-bottom: 14px; }
  .section-title { font-weight: 600; margin-bottom: 6px; cursor: pointer; color: #fff; }
  .section-body { padding-left: 8px; }
  .row { margin: 8px 0; }
  .row label { display: inline-block; min-width: 110px; color: #ccc; }
  .val { color: #8cb4e8; font-weight: 600; margin-left: 6px; }
  input[type="range"] { width: 100%; margin-top: 2px; height: 18px; }
  input.hex { width: 80px; padding: 4px; background: #1a1a1a; color: #e8e8e8; border: 1px solid #555; border-radius: 4px; font-size: 12px; }
  h2 { font-size: 14px; margin: 0 0 10px; color: #fff; border-bottom: 1px solid #555; padding-bottom: 6px; }
  .param-btns { margin-bottom: 12px; display: flex; gap: 8px; }
  .param-btns button { padding: 6px 10px; font-size: 12px; cursor: pointer; background: #444; color: #e8e8e8; border: 1px solid #555; border-radius: 4px; }
  .param-btns button:hover { background: #555; }
</style>
</head>
<body>
<h2>Ocean debug</h2>
<div class="param-btns">
  <button type="button" id="btnExport">Export</button>
  <button type="button" id="btnImport">Import</button>
  <input type="file" id="fileImport" accept=".json" style="display:none">
</div>
<div class="section"><div class="section-title">Click ripples</div><div class="section-body">
  <div class="row"><label>Amplitude</label><span class="val" id="v-rippleA">8</span><br><input type="range" id="rippleA" min="0" max="40" step="1" value="8"></div>
  <div class="row"><label>Wavelength</label><span class="val" id="v-rippleW">0.08</span><br><input type="range" id="rippleW" min="0.01" max="0.3" step="0.01" value="0.08"></div>
  <div class="row"><label>Speed</label><span class="val" id="v-rippleS">2.5</span><br><input type="range" id="rippleS" min="0.5" max="8" step="0.1" value="2.5"></div>
  <div class="row"><label>Decay</label><span class="val" id="v-rippleD">0.4</span><br><input type="range" id="rippleD" min="0.1" max="2" step="0.05" value="0.4"></div>
</div></div>
<div class="section"><div class="section-title">Water surface</div><div class="section-body">
  <div class="row"><label>Distortion</label><span class="val" id="v-dist">3.7</span><br><input type="range" id="dist" min="0" max="10" step="0.1" value="3.7"></div>
  <div class="row"><label>Normal scale</label><span class="val" id="v-size">1</span><br><input type="range" id="size" min="0.1" max="5" step="0.1" value="1"></div>
  <div class="row"><label>Wave velocity</label><span class="val" id="v-waveVel">1</span><br><input type="range" id="waveVel" min="0.1" max="3" step="0.1" value="1"></div>
</div></div>
<div class="section"><div class="section-title">Sun & exposure</div><div class="section-body">
  <div class="row"><label>Elevation</label><span class="val" id="v-elev">2</span><br><input type="range" id="elev" min="0" max="90" step="0.5" value="2"></div>
  <div class="row"><label>Azimuth</label><span class="val" id="v-az">180</span><br><input type="range" id="az" min="-180" max="180" step="1" value="180"></div>
  <div class="row"><label>Exposure</label><span class="val" id="v-exp">0.1</span><br><input type="range" id="exp" min="0.01" max="1" step="0.01" value="0.1"></div>
</div></div>
<div class="section"><div class="section-title">Light & colors</div><div class="section-body">
  <div class="row"><label>Sun color</label><input type="text" id="sunColor" value="ffffff" class="hex" placeholder="ffffff"></div>
  <div class="row"><label>Water color</label><input type="text" id="waterColor" value="001e0f" class="hex" placeholder="001e0f"></div>
</div></div>
<div class="section"><div class="section-title">Sky</div><div class="section-body">
  <div class="row"><label>Turbidity</label><span class="val" id="v-turb">10</span><br><input type="range" id="turb" min="1" max="20" step="0.5" value="10"></div>
  <div class="row"><label>Rayleigh</label><span class="val" id="v-ray">2</span><br><input type="range" id="ray" min="0" max="4" step="0.1" value="2"></div>
  <div class="row"><label>Cloud coverage</label><span class="val" id="v-cc">0.4</span><br><input type="range" id="cc" min="0" max="1" step="0.01" value="0.4"></div>
  <div class="row"><label>Cloud density</label><span class="val" id="v-cd">0.5</span><br><input type="range" id="cd" min="0" max="1" step="0.01" value="0.5"></div>
  <div class="row"><label>Cloud elevation</label><span class="val" id="v-ce">0.5</span><br><input type="range" id="ce" min="0" max="1" step="0.01" value="0.5"></div>
</div></div>
<div class="section"><div class="section-title">Bloom</div><div class="section-body">
  <div class="row"><label>Strength</label><span class="val" id="v-bloomS">0.1</span><br><input type="range" id="bloomS" min="0" max="2" step="0.01" value="0.1"></div>
  <div class="row"><label>Radius</label><span class="val" id="v-bloomR">0</span><br><input type="range" id="bloomR" min="0" max="1" step="0.01" value="0"></div>
</div></div>
<script>
(function(){
  var KEY = 'oceanDebugParams';
  var d = window.parent.__oceanDebug;
  if (!d) return;
  var w = d.water, s = d.sky, b = d.bloomPass, r = d.renderer, p = d.parameters, sun = d.updateSun;
  var sliderIds = ['rippleA','rippleW','rippleS','rippleD','dist','size','waveVel','elev','az','exp','turb','ray','cc','cd','ce','bloomS','bloomR'];
  var hexIds = ['sunColor','waterColor'];
  function getParams() {
    var o = {};
    sliderIds.forEach(function(id){ var el = document.getElementById(id); if (el) o[id] = el.value; });
    hexIds.forEach(function(id){ var el = document.getElementById(id); if (el) o[id] = (el.value || '').replace(/^#/, ''); });
    return o;
  }
  function saveParams() {
    try { localStorage.setItem(KEY, JSON.stringify(getParams())); } catch (e) {}
  }
  function loadParams() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      sliderIds.forEach(function(id){ var el = document.getElementById(id), v = document.getElementById('v-' + id); if (el && o[id] != null) { el.value = o[id]; if (v) v.textContent = o[id]; } });
      hexIds.forEach(function(id){ var el = document.getElementById(id); if (el && o[id]) el.value = o[id]; });
    } catch (e) {}
  }
  loadParams();
  function bind(id, set) {
    var el = document.getElementById(id), v = document.getElementById('v-' + id);
    if (!el) return;
    el.addEventListener('input', function(){
      var n = Number(el.value);
      v.textContent = el.value;
      set(n);
      saveParams();
    });
  }
  bind('rippleA', function(n){ w.rippleAmplitude.value = n; });
  bind('rippleW', function(n){ w.rippleWavelength.value = n; });
  bind('rippleS', function(n){ w.rippleSpeed.value = n; });
  bind('rippleD', function(n){ w.rippleDecay.value = n; });
  bind('dist', function(n){ w.distortionScale.value = n; });
  bind('size', function(n){ w.size.value = n; });
  bind('waveVel', function(n){ w.waveTimeScale.value = n; });
  bind('elev', function(n){ p.elevation = n; sun(); });
  bind('az', function(n){ p.azimuth = n; sun(); });
  bind('exp', function(n){ p.exposure = n; r.toneMappingExposure = n; sun(); });
  bind('turb', function(n){ s.turbidity.value = n; });
  bind('ray', function(n){ s.rayleigh.value = n; });
  bind('cc', function(n){ s.cloudCoverage.value = n; });
  bind('cd', function(n){ s.cloudDensity.value = n; });
  bind('ce', function(n){ s.cloudElevation.value = n; });
  bind('bloomS', function(n){ b.strength.value = n; });
  bind('bloomR', function(n){ b.radius.value = n; });
  function setHex(id, setColor) {
    var el = document.getElementById(id);
    if (!el) return;
    function apply() {
      var hex = (el.value || '').replace(/^#/, '');
      if (/^[0-9a-fA-F]{6}$/.test(hex)) { setColor(parseInt(hex, 16)); saveParams(); }
    }
    el.addEventListener('input', apply);
    el.addEventListener('change', apply);
  }
  setHex('sunColor', function(hex){ w.sunColor.value.setHex(hex); });
  setHex('waterColor', function(hex){ w.waterColor.value.setHex(hex); });
  document.getElementById('btnExport').addEventListener('click', function(){
    var blob = new Blob([JSON.stringify(getParams(), null, 2)], {type: 'application/json'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ocean-params.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  var fileInput = document.getElementById('fileImport');
  document.getElementById('btnImport').addEventListener('click', function(){ fileInput.click(); });
  fileInput.addEventListener('change', function(){
    var f = fileInput.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function(){
      try {
        var o = JSON.parse(r.result);
        if (d.applyParams) d.applyParams(d, o);
        Object.keys(o).forEach(function(k){
          var el = document.getElementById(k), v = document.getElementById('v-' + k);
          if (el && o[k] != null) { el.value = o[k]; if (v) v.textContent = o[k]; }
        });
        saveParams();
      } catch (e) {}
    };
    r.readAsText(f);
    fileInput.value = '';
  });
})();
` + '</scr' + 'ipt>\n</body>\n</html>';

    iframe.srcdoc = srcdoc;

    toggleBtn.addEventListener('click', function () {
      iframe.style.display = iframe.style.display === 'none' ? 'block' : 'none';
    });

    wrapper.appendChild(toggleBtn);
    wrapper.appendChild(iframe);
    document.body.appendChild(wrapper);
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
