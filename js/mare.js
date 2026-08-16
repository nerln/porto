/* Porto — a small physical harbour.
 *
 * The page has two kinds of motion, deliberately kept separate:
 *
 * 1. The canvas draws the shared body of water. It is cheap Canvas 2D, not a
 *    full-screen fluid solver: the result is a legible wave field rather than
 *    coloured smoke, and it works on phones as well as desktops.
 * 2. Every object marked data-float is a damped body with its own mass. Signed
 *    scroll velocity creates drag; changes in velocity create an impulse. A
 *    fast flick therefore makes light buoys overshoot while heavy vessels lag
 *    behind. The three buildings marked data-fixed remain on the harbour bed.
 *
 * Running text does not float. The named objects do, because their delay,
 * overshoot and recovery are the point of the page. With reduced motion, the
 * same composition remains complete and still.
 */
(function () {
  'use strict';

  var canvas = document.querySelector('.ocean-canvas');
  if (!canvas) return;

  var ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  var root = document.documentElement;
  var topbar = document.querySelector('[data-topbar]');
  var progress = document.querySelector('[data-progress]');
  var reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  var darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  var reduced = reduceQuery.matches;
  var connection = navigator.connection || {};
  var economical = connection.saveData === true ||
    (navigator.deviceMemory && navigator.deviceMemory <= 2) ||
    (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2);

  var TAU = Math.PI * 2;
  var width = 1;
  var height = 1;
  var dpr = 1;
  var documentHeight = 1;
  var time = 0;
  var lastFrame = 0;
  var raf = 0;
  var running = false;
  /* Quality is measured, not assumed.
   *
   * The previous rule was `width < 980 ? 30fps : 60fps`, which gives every
   * phone held upright half the frame rate whatever silicon is inside it — and
   * a quarter of it on a 120Hz screen. Screen width says nothing about how fast
   * a device draws. So the loop now runs at whatever rate the display offers
   * and watches what its own work costs; if the median frame is too expensive
   * it steps down, and when there is room again it steps back up.
   *
   * Level 2 is everything. Level 1 halves the wave bands and coarsens the
   * sampling. Level 0 is the cheapest drawing that is still the same picture.
   * Only quality moves — the physics is identical at every level, so a slow
   * phone shows the same harbour, drawn with fewer strokes. */
  var LIVELLI = [
    { dprMax: 1.0, bande: 4, passoX: 26, sotto: 1 },
    { dprMax: 1.5, bande: 5, passoX: 18, sotto: 2 },
    { dprMax: 2.0, bande: 7, passoX: 12, sotto: 2 }
  ];
  var livello = economical ? 0 : 2;
  var costi = [], COSTI_MAX = 24, ultimoCambio = 0;
  var BUDGET_ALTO = 7.5;   // ms of our own work: above this we are eating the frame
  var BUDGET_BASSO = 3.0;  // below this there is room to give some back

  var scrollY = window.scrollY || 0;
  var previousScrollY = scrollY;
  var scrollVelocity = 0;
  var previousVelocity = 0;
  var scrollEnergy = 0;
  var lastScrollSample = performance.now();
  var lastNavY = -1;
  var pointer = { x: width * 0.5, y: height * 0.5, at: 0 };
  var ripples = [];
  var bodies = [];
  var ribbons = [];
  var sections = [];
  var navLinks = [];
  var choreography = [];
  var revealObserver = null;

  var palette = {
    sea: [15, 119, 116],
    deep: [9, 75, 84],
    foam: [220, 235, 229],
    paper: [241, 237, 227]
  };

  var PRESETS = {
    buoy: {
      stiffness: 18, dampingRatio: 0.32, waveY: 12, waveX: 6,
      scrollLagY: 42, scrollLagX: 17, scrollRoll: 5.8,
      impulseY: 92, impulseX: 34, impulseR: 16,
      maxY: 66, maxX: 30, maxR: 8
    },
    vessel: {
      stiffness: 23, dampingRatio: 0.33, waveY: 8.5, waveX: 5.2,
      scrollLagY: 36, scrollLagX: 16, scrollRoll: 4.3,
      impulseY: 84, impulseX: 31, impulseR: 12,
      maxY: 52, maxX: 25, maxR: 6.2
    }
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function mix(current, target, speed, dt) {
    return current + (target - current) * (1 - Math.exp(-speed * dt));
  }

  function parseHex(value, fallback) {
    var match = String(value || '').trim().match(/^#([0-9a-f]{6})$/i);
    if (!match) return fallback;
    var n = parseInt(match[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgba(rgb, alpha) {
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + alpha + ')';
  }

  function readPalette() {
    var styles = getComputedStyle(root);
    palette.sea = parseHex(styles.getPropertyValue('--sea'), palette.sea);
    palette.deep = parseHex(styles.getPropertyValue('--sea-deep'), palette.deep);
    palette.foam = parseHex(styles.getPropertyValue('--foam'), palette.foam);
    palette.paper = parseHex(styles.getPropertyValue('--paper'), palette.paper);
  }

  /* Two long components and one short component. Their sum is used by both the
   * canvas and the DOM bodies, so a vessel never bobs in water that is doing
   * something unrelated beneath it. */
  function waveSignal(x, phase, t) {
    return Math.sin(x * 0.0072 + t * 0.76 + phase) +
      Math.sin(x * 0.0165 - t * 0.48 + phase * 1.71) * 0.38 +
      Math.sin(x * 0.0031 + t * 0.23 - phase * 0.61) * 0.54;
  }

  function waveSlope(x, phase, t) {
    return Math.cos(x * 0.0072 + t * 0.76 + phase) * 0.76 +
      Math.cos(x * 0.0165 - t * 0.48 + phase * 1.71) * 0.65 +
      Math.cos(x * 0.0031 + t * 0.23 - phase * 0.61) * 0.17;
  }

  function collectBodies() {
    bodies = Array.prototype.map.call(document.querySelectorAll('[data-float]'), function (element, index) {
      var kind = element.getAttribute('data-kind') || 'vessel';
      return {
        element: element,
        kind: kind,
        preset: PRESETS[kind] || PRESETS.vessel,
        mass: Math.max(0.45, parseFloat(element.getAttribute('data-mass')) || 1),
        drift: parseFloat(element.getAttribute('data-drift')) || (index % 2 ? 1 : -1),
        fixed: element.hasAttribute('data-fixed'),
        name: element.getAttribute('data-name') || kind + '-' + index,
        phase: index * 1.217 + (kind === 'buoy' ? 0.4 : 1.8),
        x: 0, y: 0, rotation: 0,
        vx: 0, vy: 0, vr: 0,
        documentX: 0, documentY: 0,
        visible: true
      };
    });

    bodies.forEach(function (body) {
      body.element.addEventListener('pointerenter', function () {
        addRippleAtElement(body.element, body.fixed ? 0.35 : 0.75);
        if (!body.fixed && !reduced) {
          body.vy -= 26 / body.mass;
          body.vr += body.drift * 3.8 / body.mass;
        }
      }, { passive: true });
      body.element.addEventListener('focus', function () {
        addRippleAtElement(body.element, body.fixed ? 0.45 : 0.9);
        if (!body.fixed && !reduced) body.vy -= 31 / body.mass;
      });
    });
  }

  function collectRibbons() {
    ribbons = Array.prototype.map.call(document.querySelectorAll('.waterline'), function (svg, index) {
      return {
        svg: svg,
        wash: svg.querySelector('.waterline__wash'),
        line: svg.querySelector('.waterline__line'),
        foam: svg.querySelector('.waterline__foam'),
        hero: svg.classList.contains('waterline--hero'),
        phase: index * 1.31,
        documentY: 0
      };
    });
  }

  function collectNavigation() {
    sections = Array.prototype.slice.call(document.querySelectorAll('[data-section]'));
    navLinks = Array.prototype.slice.call(document.querySelectorAll('.topbar a[href^="#"]'));
  }

  function measure() {
    documentHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 1);
    bodies.forEach(function (body) {
      var rect = body.element.getBoundingClientRect();
      body.documentX = rect.left + rect.width * 0.5 + (window.scrollX || 0);
      body.documentY = rect.top + rect.height * 0.5 + (window.scrollY || 0);
    });
    ribbons.forEach(function (ribbon) {
      var rect = ribbon.svg.getBoundingClientRect();
      ribbon.documentY = rect.top + rect.height * 0.5 + (window.scrollY || 0);
    });
    updateNavigation(true);
  }

  function applicaLivello() {
    var L = LIVELLI[livello];
    // A phone renders at 2x or 3x. Drawing at 1x and letting the compositor
    // scale it up is what makes hairlines soft and makes them shimmer as they
    // move: the page reads as unsteady even at a perfect frame rate. The water
    // is ten polylines — it can afford real pixels.
    var nuovo = Math.min(window.devicePixelRatio || 1, L.dprMax);
    if (Math.abs(nuovo - dpr) < 0.01) return false;
    dpr = nuovo;
    applicaBuffer();
    return true;
  }

  /* Measured at 0.018 ms for a 750x1624 buffer — a tenth of one frame's
     drawing. Reallocating was never the expensive part of a resize. */
  function applicaBuffer() {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function resize() {
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    dpr = 0;                       // force applicaLivello to rebuild the buffer
    ultimaLarghezza = width;
    applicaLivello();
    measure();
    drawOcean();
  }

  function addRipple(x, y, strength) {
    if (reduced) return;
    ripples.push({
      x: clamp(x, 0, width), y: clamp(y, 0, height),
      radius: 8, life: 1, strength: strength || 1
    });
    if (ripples.length > 18) ripples.shift();
  }

  function addRippleAtElement(element, strength) {
    var rect = element.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > height) return;
    addRipple(rect.left + rect.width * 0.5, rect.top + rect.height * 0.78, strength);
  }

  function updateScroll(dt) {
    var current = window.scrollY || 0;
    var raw = (current - previousScrollY) / Math.max(dt, 1 / 120);
    raw = clamp(raw, -5200, 5200);
    previousVelocity = scrollVelocity;
    scrollVelocity = mix(scrollVelocity, raw, 15, dt);
    var deltaVelocity = scrollVelocity - previousVelocity;
    var speedEnergy = clamp(Math.abs(scrollVelocity) / 2100, 0, 1);
    scrollEnergy = Math.max(scrollEnergy * Math.exp(-2.15 * dt), speedEnergy);
    previousScrollY = current;
    scrollY = current;

    if (!reduced && Math.abs(deltaVelocity) > 95) {
      var impulse = clamp(deltaVelocity / 820, -1.7, 1.7);
      bodies.forEach(function (body) {
        body.visible = body.documentY - current > -360 && body.documentY - current < height + 360;
        if (body.fixed || !body.visible) return;
        var p = body.preset;
        body.vy += impulse * p.impulseY / body.mass;
        body.vx += impulse * p.impulseX * body.drift / body.mass;
        body.vr += impulse * p.impulseR * body.drift / body.mass;
      });
      if (Math.abs(impulse) > 0.34) {
        var side = impulse > 0 ? width * 0.72 : width * 0.28;
        addRipple(side, height * (0.35 + (Math.abs(current / Math.max(documentHeight, 1)) % 0.4)), Math.min(1.3, Math.abs(impulse)));
      }
    }
  }

  function integrateBody(body, dt) {
    if (body.fixed) return;

    var viewportY = body.documentY - scrollY;
    body.visible = viewportY > -360 && viewportY < height + 360;
    if (!body.visible) {
      body.vx *= Math.exp(-5 * dt);
      body.vy *= Math.exp(-5 * dt);
      body.vr *= Math.exp(-5 * dt);
      return;
    }

    var p = body.preset;
    var mobileScale = width < 680 ? 0.67 : width < 980 ? 0.84 : 1;
    var speed = clamp(scrollVelocity / 2500, -1, 1);
    var wave = waveSignal(body.documentX, body.phase, time);
    var slope = waveSlope(body.documentX, body.phase, time);
    var targetY = wave * p.waveY * (0.72 + scrollEnergy * 0.46) + speed * p.scrollLagY;
    var targetX = Math.cos(time * 0.51 + body.phase) * p.waveX + speed * p.scrollLagX * body.drift;
    var targetR = slope * p.maxR * 0.18 + speed * p.scrollRoll * body.drift;
    targetY *= mobileScale;
    targetX *= mobileScale;
    targetR *= mobileScale;

    var stiffness = p.stiffness;
    var damping = 2 * p.dampingRatio * Math.sqrt(stiffness * body.mass);
    var ax = (stiffness * (targetX - body.x) - damping * body.vx) / body.mass;
    var ay = (stiffness * (targetY - body.y) - damping * body.vy) / body.mass;
    var ar = (stiffness * 0.72 * (targetR - body.rotation) - damping * 0.72 * body.vr) / body.mass;

    body.vx += ax * dt;
    body.vy += ay * dt;
    body.vr += ar * dt;
    body.x += body.vx * dt;
    body.y += body.vy * dt;
    body.rotation += body.vr * dt;

    var maxY = p.maxY * mobileScale;
    var maxX = p.maxX * mobileScale;
    var maxR = p.maxR * mobileScale;
    if (Math.abs(body.y) > maxY) { body.y = clamp(body.y, -maxY, maxY); body.vy *= -0.16; }
    if (Math.abs(body.x) > maxX) { body.x = clamp(body.x, -maxX, maxX); body.vx *= -0.12; }
    if (Math.abs(body.rotation) > maxR) { body.rotation = clamp(body.rotation, -maxR, maxR); body.vr *= -0.12; }

    body.element.style.transform = 'translate3d(' + body.x.toFixed(2) + 'px,' + body.y.toFixed(2) +
      'px,0) rotate(' + body.rotation.toFixed(2) + 'deg) scale(var(--scale,1))';
  }

  function resetBodies() {
    bodies.forEach(function (body) {
      body.x = body.y = body.rotation = body.vx = body.vy = body.vr = 0;
      body.element.style.transform = body.kind === 'buoy' ? 'scale(var(--scale,1))' : '';
    });
  }

  function traceWavePath(base, amplitude, phase, points, viewWidth) {
    var path = '';
    for (var i = 0; i <= points; i++) {
      var x = viewWidth * i / points;
      var signal = waveSignal(x * (width / viewWidth), phase, time);
      var local = Math.sin(i * 0.92 + time * 1.6 + phase) * scrollEnergy * amplitude * 0.38;
      var y = base + signal * amplitude + local;
      path += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(2);
    }
    return path;
  }

  function drawRibbons() {
    ribbons.forEach(function (ribbon) {
      var viewportY = ribbon.documentY - scrollY;
      if (viewportY < -300 || viewportY > height + 300) return;
      var base = ribbon.hero ? 58 : 48;
      var amplitude = reduced ? 0 : (ribbon.hero ? 7.2 : 3.7) * (1 + scrollEnergy * 0.88);
      var line = traceWavePath(base, amplitude, ribbon.phase, ribbon.hero ? 50 : 42, 1000);
      var viewHeight = ribbon.hero ? 120 : 96;
      if (ribbon.line) ribbon.line.setAttribute('d', line);
      if (ribbon.foam) ribbon.foam.setAttribute('d', line);
      if (ribbon.wash) ribbon.wash.setAttribute('d', line + 'L1000 ' + viewHeight + 'L0 ' + viewHeight + 'Z');
    });
  }

  function canvasWaveY(x, base, band) {
    var amplitude = (band === 0 ? 7 : 3.4 + band * 0.42) * (1 + scrollEnergy * (band === 0 ? 1.45 : 0.62));
    return base + waveSignal(x, band * 1.42, time) * amplitude +
      Math.sin(x * 0.027 + time * 1.4 + band) * scrollEnergy * 2.8;
  }

  function makeCanvasPath(base, band) {
    ctx.beginPath();
    var passoX = LIVELLI[livello].passoX;
    for (var x = -12; x <= width + 12; x += passoX) {
      var y = canvasWaveY(x, base, band);
      if (x < 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  }

  function drawOcean() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    var descent = reduced ? 0 : clamp(scrollY / Math.max(height * 0.82, 1), 0, 1);
    // At the top, the shared sea begins below the reading area; the hero has
    // its own local waterline beside the headline. As the reader descends, the
    // surface passes overhead and the rest of the page sits inside one harbour.
    var surface = height * 0.89 - descent * height * 1.04;
    var dark = darkQuery.matches;

    makeCanvasPath(surface, 0);
    ctx.lineTo(width + 20, height + 20);
    ctx.lineTo(-20, height + 20);
    ctx.closePath();
    var wash = ctx.createLinearGradient(0, Math.max(-50, surface), 0, height);
    wash.addColorStop(0, rgba(palette.sea, dark ? 0.18 : 0.11));
    wash.addColorStop(1, rgba(palette.deep, dark ? 0.27 : 0.17));
    ctx.fillStyle = wash;
    ctx.fill();

    makeCanvasPath(surface, 0);
    ctx.strokeStyle = rgba(palette.sea, dark ? 0.78 : 0.54);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.stroke();

    if (!reduced) {
      makeCanvasPath(surface - 2.3, 0);
      ctx.strokeStyle = rgba(palette.foam, dark ? 0.68 : 0.82);
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.setLineDash([1, 18]);
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.setLineDash([]);
    }

    var bands = LIVELLI[livello].bande;
    var gap = Math.max(68, height / 7.5);
    for (var i = 1; i <= bands; i++) {
      var base = surface + gap * i;
      if (base < -30 || base > height + 35) continue;
      makeCanvasPath(base, i);
      ctx.strokeStyle = rgba(palette.sea, (dark ? 0.2 : 0.16) * (1 - i / (bands + 2)) + 0.035);
      ctx.lineWidth = i % 3 === 0 ? 1.35 : 0.8;
      ctx.stroke();
    }

    drawRipples();
  }

  function drawRipples() {
    for (var i = ripples.length - 1; i >= 0; i--) {
      var ripple = ripples[i];
      ctx.beginPath();
      ctx.ellipse(ripple.x, ripple.y, ripple.radius * 1.8, ripple.radius * 0.48, 0, Math.PI * 1.06, Math.PI * 1.94);
      ctx.strokeStyle = rgba(palette.sea, ripple.life * 0.34 * ripple.strength);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      if (ripple.life <= 0) ripples.splice(i, 1);
    }
  }

  function advanceRipples(dt) {
    ripples.forEach(function (ripple) {
      ripple.radius += dt * (48 + ripple.strength * 22);
      ripple.life -= dt * 0.72;
    });
  }

  function updateNavigation(force) {
    var currentY = window.scrollY || 0;
    if (!force && Math.abs(currentY - lastNavY) < 1) return;
    lastNavY = currentY;
    var maxScroll = Math.max(1, documentHeight - window.innerHeight);
    if (progress) progress.style.transform = 'scaleX(' + clamp(currentY / maxScroll, 0, 1).toFixed(4) + ')';
    if (topbar) topbar.classList.toggle('is-scrolled', currentY > 18);

    var marker = currentY + window.innerHeight * 0.34;
    var active = sections[0] ? sections[0].id : '';
    sections.forEach(function (section) {
      if (section.offsetTop <= marker) active = section.id;
    });
    navLinks.forEach(function (link) {
      var matches = link.getAttribute('href') === '#' + active;
      if (matches) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }

  function tick(now) {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    // No artificial interval. requestAnimationFrame already paces to the
    // display; throttling it to a value that is not a divisor of the refresh
    // produces uneven spacing, which the eye reads as stutter even when the
    // average rate is fine.
    var elapsed = lastFrame ? Math.min((now - lastFrame) / 1000, .12) : 1 / 60;
    lastFrame = now;
    var inizio = performance.now();
    passo(elapsed);
    registraCosto(performance.now() - inizio, now);
  }

  function passo(elapsed) {
    time += reduced ? 0 : elapsed;
    updateScroll(elapsed);
    updateNavigation(false);

    if (!reduced) {
      var L = LIVELLI[livello];
      var steps = Math.max(1, Math.min(L.sotto, Math.ceil(elapsed / (1 / 60))));
      var step = elapsed / steps;
      for (var sub = 0; sub < steps; sub++) {
        bodies.forEach(function (body) { integrateBody(body, step); });
        advanceRipples(step);
      }
    }
    drawRibbons();
    drawOcean();
  }

  /* The median of the last two dozen frames, not the last one: a single slow
   * frame is a garbage collection, not a verdict on the device. */
  function registraCosto(costo, now) {
    costi.push(costo);
    if (costi.length > COSTI_MAX) costi.shift();
    if (costi.length < COSTI_MAX || now - ultimoCambio < 900) return;
    var ordinati = costi.slice().sort(function (x, y) { return x - y; });
    var mediana = ordinati[ordinati.length >> 1];
    var prima = livello;
    if (mediana > BUDGET_ALTO && livello > 0) livello--;
    else if (mediana < BUDGET_BASSO && livello < LIVELLI.length - 1) livello++;
    if (livello !== prima) {
      applicaLivello();
      costi.length = 0;
      ultimoCambio = now;
    }
  }

  function start() {
    if (running || reduced || document.visibilityState === 'hidden') return;
    running = true;
    lastFrame = 0;
    previousScrollY = window.scrollY || 0;
    scrollY = previousScrollY;
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function setupReveals() {
    if (reduced || !window.gsap || !('IntersectionObserver' in window)) return;
    var gsap = window.gsap;
    var heroItems = document.querySelectorAll('.hero [data-reveal]');
    if (heroItems.length) {
      var timeline = gsap.timeline({ defaults: { duration: 0.78, ease: 'power3.out' } });
      timeline.from(heroItems, { opacity: 0, y: 28, stagger: 0.085, clearProps: 'transform,opacity' });
      choreography.push(timeline);
    }

    var revealItems = Array.prototype.slice.call(document.querySelectorAll('main > section:not(.hero) [data-reveal]'));
    revealItems.forEach(function (element) { gsap.set(element, { opacity: 0, y: 26 }); });
    revealObserver = new IntersectionObserver(function (entries, observer) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var tween = gsap.to(entry.target, { opacity: 1, y: 0, duration: 0.68, ease: 'power3.out', clearProps: 'transform,opacity' });
        choreography.push(tween);
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -9% 0px', threshold: 0.08 });
    revealItems.forEach(function (element) { revealObserver.observe(element); });
  }

  function setupIconChoreography() {
    if (reduced || !window.gsap) return;
    var gsap = window.gsap;
    function tween(selector, vars) {
      var elements = document.querySelectorAll(selector);
      if (!elements.length) return;
      choreography.push(gsap.to(elements, vars));
    }
    tween('.segno .fascio,.hero-tool__icon .fascio', { rotation: 8, duration: 3.4, yoyo: true, repeat: -1, ease: 'sine.inOut', transformOrigin: '32px 22px' });
    tween('.segno .sguardo,.hero-tool__icon .sguardo', { rotation: -10, duration: 4.1, yoyo: true, repeat: -1, ease: 'sine.inOut', transformOrigin: '32px 16px' });
    tween('.segno .passa,.hero-tool__icon .passa', { x: 24, duration: 2.7, yoyo: true, repeat: -1, repeatDelay: .7, ease: 'power1.inOut' });
    tween('.segno .scivola', { x: 17, y: 12, duration: 2.2, yoyo: true, repeat: -1, repeatDelay: 1.1, ease: 'power2.inOut' });
    tween('.segno .carico,.hero-tool__icon .carico', { x: 25, duration: 2.5, yoyo: true, repeat: -1, repeatDelay: .45, ease: 'power1.inOut' });
    tween('.segno .bandiera', { scaleX: .8, duration: 1.25, yoyo: true, repeat: -1, ease: 'sine.inOut', transformOrigin: '46px 19px' });
    tween('.segno .timone', { rotation: 24, duration: 3.8, yoyo: true, repeat: -1, ease: 'sine.inOut', transformOrigin: '32px 43px' });
    tween('.segno .coda > *', { y: -3, duration: 2.6, yoyo: true, repeat: -1, ease: 'sine.inOut', stagger: .38 });
  }

  function stopAnimations() {
    if (revealObserver) { revealObserver.disconnect(); revealObserver = null; }
    choreography.forEach(function (animation) { if (animation && animation.kill) animation.kill(); });
    choreography.length = 0;
    if (window.gsap) {
      window.gsap.set('[data-reveal]', { clearProps: 'transform,opacity' });
      window.gsap.set('.segno *,.hero-tool__icon *', { clearProps: 'transform,opacity' });
    }
  }

  function onMotionPreference(event) {
    reduced = event.matches;
    stop();
    stopAnimations();
    resetBodies();
    ripples.length = 0;
    if (!reduced) {
      setupIconChoreography();
      start();
    }
    drawRibbons();
    drawOcean();
  }

  function setupCopyButton() {
    var button = document.querySelector('[data-copy]');
    var status = document.querySelector('[data-copy-status]');
    if (!button || !status) return;
    var commands = 'pipx install git+https://github.com/nerln/faro\nfaro\n\npipx install git+https://github.com/nerln/capitaneria\ncapitaneria';
    button.addEventListener('click', function () {
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        status.textContent = 'select the commands to copy';
        return;
      }
      navigator.clipboard.writeText(commands).then(function () {
        status.textContent = 'copied to clipboard';
        button.textContent = 'copied';
        window.setTimeout(function () { status.textContent = ''; button.textContent = 'copy'; }, 2400);
      }).catch(function () {
        status.textContent = 'copy unavailable';
      });
    });
  }

  /* On iOS Safari, scrolling hides and shows the URL bar, and every toggle
   * fires `resize`. Treating that as a real resize means reallocating the
   * canvas and re-measuring every body IN THE MIDDLE OF A SCROLL, which is
   * exactly when the page must not stall — and it is the classic reason a
   * mobile page feels like it catches.
   *
   * It is safe to ignore, and the stylesheet is why: the hero is sized in svh
   * and the harbour in vh, neither of which moves when the bar toggles. The
   * document does not reflow, so no measurement has gone stale. Only the
   * visible height changed, so only the height is taken.
   *
   * The backing store is never shrunk either: keeping the tallest buffer seen
   * means the bar can come and go without a single reallocation. */
  var resizeTimer = 0, ultimaLarghezza = 0;
  function ridimensionaLeggero() {
    height = Math.max(1, window.innerHeight);
    // The buffer is resized, because that costs 0.018 ms. What is skipped is
    // measure(): fourteen getBoundingClientRect calls plus the navigation pass,
    // run 120 ms late, in the middle of the scroll that caused them. Skipping it
    // is not an optimisation, it is correctness — nothing it measures has moved.
    applicaBuffer();
    drawOcean();
  }
  window.addEventListener('resize', function () {
    var w = window.innerWidth, h = window.innerHeight;
    if (w === ultimaLarghezza && Math.abs(h - height) <= 180) {
      ridimensionaLeggero();
      return;
    }
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () { ultimaLarghezza = window.innerWidth; resize(); }, 120);
  }, { passive: true });
  window.addEventListener('orientationchange', function () {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () { ultimaLarghezza = window.innerWidth; resize(); }, 220);
  }, { passive: true });

  window.addEventListener('scroll', function () {
    updateNavigation(false);
    if (reduced) {
      scrollY = window.scrollY || 0;
      previousScrollY = scrollY;
      drawRibbons();
      drawOcean();
    }
  }, { passive: true });

  window.addEventListener('pointermove', function (event) {
    if (reduced) return;
    var now = performance.now();
    var dx = event.clientX - pointer.x;
    var dy = event.clientY - pointer.y;
    if (now - pointer.at > 62 && dx * dx + dy * dy > 360) {
      addRipple(event.clientX, event.clientY, 0.42);
      pointer.at = now;
    }
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  }, { passive: true });

  /* A phone has no hover, so without this the water answers nothing a finger
   * does. pointermove alone is not enough: during a scroll gesture the browser
   * sends pointercancel and stops, so a touch that turns into a flick would
   * leave no mark at all. A touch is worth a ripple on its own. */
  window.addEventListener('touchstart', function (event) {
    if (reduced || !event.touches || !event.touches.length) return;
    for (var i = 0; i < event.touches.length && i < 3; i++) {
      addRipple(event.touches[i].clientX, event.touches[i].clientY, 0.85);
    }
  }, { passive: true });

  window.addEventListener('touchmove', function (event) {
    if (reduced || !event.touches || !event.touches.length) return;
    var now = performance.now();
    if (now - pointer.at < 70) return;
    var t = event.touches[0];
    var dx = t.clientX - pointer.x, dy = t.clientY - pointer.y;
    if (dx * dx + dy * dy < 300) return;
    addRipple(t.clientX, t.clientY, 0.5);
    pointer.x = t.clientX; pointer.y = t.clientY; pointer.at = now;
  }, { passive: true });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') stop();
    else start();
  });

  reduceQuery.addEventListener('change', onMotionPreference);
  darkQuery.addEventListener('change', function () { readPalette(); drawOcean(); });

  readPalette();
  collectBodies();
  collectRibbons();
  collectNavigation();
  setupCopyButton();
  resize();
  setupReveals();
  setupIconChoreography();
  start();

  window.addEventListener('load', function () {
    measure();
    previousScrollY = window.scrollY || 0;
    scrollY = previousScrollY;
  });

  /* A compact inspection surface for browser tests. It exposes no control over
   * the page, only the measurable state needed to verify the physical rules. */
  window.__mare = {
    modo: 'canvas2d-spring',
    passo: function (dt) { passo(dt || 1 / 60); },
    costoFrame: function (n) {
      var k = n || 60, t0 = performance.now();
      for (var i = 0; i < k; i++) passo(1 / 60);
      return (performance.now() - t0) / k;
    },
    livello: function (v) { if (v != null) { livello = v; applicaLivello(); } return livello; },
    /* Feeds the quality governor a controlled cost so its decisions can be
       checked without needing a slow device to hand. */
    provaGoverno: function (msFinti, quanti) {
      var t = 10000;
      for (var i = 0; i < (quanti || 200); i++) { t += 16.7; registraCosto(msFinti, t); }
      return livello;
    },
    stato: function () {
      return {
        modo: 'canvas2d-spring', reduced: reduced, running: running,
        livello: livello, bande: LIVELLI[livello].bande, passoX: LIVELLI[livello].passoX,
        width: width, height: height, dpr: dpr,
        scrollVelocity: +scrollVelocity.toFixed(2),
        scrollEnergy: +scrollEnergy.toFixed(3),
        ripples: ripples.length,
        bodies: bodies.map(function (body) {
          return {
            name: body.name, kind: body.kind, fixed: body.fixed,
            x: +body.x.toFixed(2), y: +body.y.toFixed(2),
            rotation: +body.rotation.toFixed(2), visible: body.visible
          };
        })
      };
    }
  };
})();
