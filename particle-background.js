/**
 * Particle background: rain-like particles that fall slowly, land on
 * section tops and dividers, then slide off. Subtle, low-contrast look.
 */
(function () {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var canvas = document.getElementById('particle-canvas');
  if (!canvas) return;

  var ctx = canvas.getContext('2d');
  var particles = [];

  // Elements whose top edge acts as a "surface" (rain lands and slides).
  // Includes divs, text (headings, paragraphs), and other UI elements.
  var SURFACE_SELECTORS = [
    '.site-header', '.hero', '.section',
    'h1', 'h2', 'h3', 'p',
    '.logo', '.btn', '.nav-links a',
    '.project-item', '.link-list li'
  ];
  var GRAVITY = 0.018;
  var MAX_FALL_SPEED = 0.45;
  var SLIDE_SPEED = 0.25;
  var PARTICLE_COUNT = 100;
  var PARTICLE_RADIUS_MIN = 1;
  var PARTICLE_RADIUS_MAX = 2;
  // Visible but still soft; accent tint
  var PARTICLE_COLOR = 'rgba(180, 150, 110, 0.45)';

  function resize() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    canvas.width = w;
    canvas.height = h;
    if (particles.length === 0) initParticles();
  }

  function createParticle(w, h) {
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.15,
      vy: Math.random() * 0.1,
      r: PARTICLE_RADIUS_MIN + Math.random() * (PARTICLE_RADIUS_MAX - PARTICLE_RADIUS_MIN),
      state: 'falling',
      surfaceIndex: -1
    };
  }

  function respawnParticle(p, w, h) {
    p.x = Math.random() * w;
    p.y = Math.random() * h;
    p.vx = (Math.random() - 0.5) * 0.15;
    p.vy = Math.random() * 0.08;
    p.state = 'falling';
    p.surfaceIndex = -1;
  }

  function initParticles() {
    particles = [];
    var w = canvas.width;
    var h = canvas.height;
    for (var i = 0; i < PARTICLE_COUNT; i++) {
      particles.push(createParticle(w, h));
    }
  }

  /**
   * Get surfaces (top edge) using tight bounds: Range.getClientRects() gives
   * one rect per line of text (or per layout fragment), so surfaces follow
   * the actual text/shape instead of the element's full bounding box.
   */
  function getSurfaces() {
    var surfaces = [];
    SURFACE_SELECTORS.forEach(function (sel) {
      var els = document.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var rects = getTightRects(el);
        for (var j = 0; j < rects.length; j++) {
          var r = rects[j];
          if (r.width > 0 && r.height > 0) {
            surfaces.push({
              top: r.top,
              left: r.left,
              right: r.right
            });
          }
        }
      }
    });
    return surfaces;
  }

  /** One rect per line/fragment of content (tighter than element bounding box) */
  function getTightRects(el) {
    try {
      var range = document.createRange();
      range.selectNodeContents(el);
      var rects = range.getClientRects();
      if (rects && rects.length > 0) {
        return Array.prototype.slice.call(rects);
      }
    } catch (e) {
      /* selectNodeContents can throw on some nodes */
    }
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? [r] : [];
  }

  function update() {
    var w = canvas.width;
    var h = canvas.height;
    var surfaces = getSurfaces();

    particles.forEach(function (p) {
      if (p.state === 'falling') {
        p.vy += GRAVITY;
        if (p.vy > MAX_FALL_SPEED) p.vy = MAX_FALL_SPEED;
        p.x += p.vx;
        p.y += p.vy;

        // Hit a surface? (particle bottom touches or crosses surface top)
        var hitSurface = -1;
        for (var i = 0; i < surfaces.length; i++) {
          var s = surfaces[i];
          if (p.y + p.r >= s.top - 1 && p.y - p.r <= s.top + 4 &&
              p.x >= s.left - 2 && p.x <= s.right + 2) {
            hitSurface = i;
            break;
          }
        }
        if (hitSurface >= 0) {
          var s = surfaces[hitSurface];
          p.y = s.top - p.r;
          p.vy = 0;
          p.vx = Math.random() < 0.5 ? -SLIDE_SPEED : SLIDE_SPEED;
          p.state = 'sliding';
          p.surfaceIndex = hitSurface;
        }

        if (p.y - p.r > h || p.y + p.r < 0) {
          respawnParticle(p, w, h);
        }
        if (p.x < -p.r) p.x = w + p.r;
        if (p.x > w + p.r) p.x = -p.r;
      } else {
        // Sliding along surface
        if (p.surfaceIndex < 0 || p.surfaceIndex >= surfaces.length) {
          respawnParticle(p, w, h);
          return;
        }
        var s = surfaces[p.surfaceIndex];
        p.y = s.top - p.r;
        p.x += p.vx;

        if (p.y + p.r < 0 || p.y - p.r > h) {
          respawnParticle(p, w, h);
        } else if (p.x + p.r > s.right) {
          p.state = 'falling';
          p.surfaceIndex = -1;
          p.vy = 0;
          p.x = s.right + p.r + 2;
        } else if (p.x - p.r < s.left) {
          p.state = 'falling';
          p.surfaceIndex = -1;
          p.vy = 0;
          p.x = s.left - p.r - 2;
        }
      }
    });
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(function (p) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = PARTICLE_COLOR;
      ctx.fill();
    });
  }

  function tick() {
    update();
    draw();
    requestAnimationFrame(tick);
  }

  resize();
  window.addEventListener('resize', resize);
  tick();
})();
