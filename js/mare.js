/* porto — one harbour, for the whole page.
 *
 * THE LAW
 *
 * There is one body of water and it has a surface, at the top of the document.
 * Scrolling is not scrolling: it is descending. Every element on the page has a
 * depth, which is simply where it sits in the document, and depth is the only
 * thing that decides how much it moves.
 *
 * The swell is three travelling components with wavelengths 540, 265 and 128
 * pixels. Airy's result for water waves is that orbital motion at depth z falls
 * off as exp(-k z), where k = 2*pi/L. Short waves have a large k, so they die
 * first. That is not a stylistic choice, it is the theory, and it gives the page
 * its shape: near the surface the water is choppy, and as the reader descends
 * the chop goes first while the long swell survives. The bottom of the page is
 * not merely calmer than the top. It is SMOOTHER — a different quality of
 * motion, not less of the same one.
 *
 * With K = 1.25 and depth measured as a fraction d of the document:
 *
 *            d=0.05 (hero)   d=0.23 (figures)  d=0.45 (fleet)  d=0.98 (footer)
 *   L=540      0.94              0.75              0.57            0.29
 *   L=265      0.88              0.56              0.32            0.08
 *   L=128      0.77              0.30              0.09            0.006
 *
 * The motion is elliptical, not vertical: in deep water a particle goes round,
 * and the horizontal component is a quarter period out of phase with the
 * vertical one. A page that only bobs is telling half the truth, so the marks
 * are moved on both axes — but only the marks. Nothing carrying running text is
 * ever transformed, because moving text is unreadable text.
 *
 * WHAT NEVER MOVES
 *
 * paratia, faro and capitaneria are a bulkhead, a tower and an office. They are
 * built on the harbour floor. They hold still while everything around them
 * rides, and that distinction is the argument the page has been making in prose
 * the whole time.
 *
 * WHAT IS ALWAYS TRUE
 *
 * Depth is a property of the document, not of the viewport, so it does not
 * change when the reader scrolls. Every position is measured once and cached.
 * Nothing reads layout on a scroll frame.
 *
 * The page is finished before any of this runs. JS off, WebGL missing, GSAP
 * missing, or reduced motion asked for: what is left is the still version of the
 * same picture, never a broken version of a different one.
 */
(function () {
  'use strict';

  var tela = document.querySelector('canvas.mare');
  if (!tela) return;

  var mqFermo = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  // Asked for less motion? Then no water, no swell, no cycles. But the sounding
  // line stays and keeps working: knowing how deep you are is information, not
  // animation — it is a scroll position indicator, no more moving than the
  // scrollbar beside it. Taking it away would be removing help, not motion.
  var fermo = !!(mqFermo && mqFermo.matches);

  var rete = navigator.connection || {};
  var scarso = rete.saveData === true ||
               (navigator.deviceMemory && navigator.deviceMemory <= 2) ||
               (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2);

  // ====================================================================
  // 1. the swell, and how it dies with depth
  // ====================================================================
  var ONDE = [
    { A: 2.2, L: 540, T: 5.30, f: 0.0 },
    { A: 1.3, L: 265, T: 3.55, f: 2.1 },
    { A: 0.7, L: 128, T: 2.46, f: 4.7 }
  ];
  var TAU = Math.PI * 2;
  // The basin has a floor. H is its depth, half the middle wavelength, so the
  // swell feels the bed and the chop does not — which is what makes the three
  // components behave differently instead of just being three sizes of the same
  // thing. In deep water exp(-kz) is the right decay; in a basin it is not,
  // because water cannot flow through the bottom.
  var H_FONDO = 265 / 2;
  var kH = [], shkH = [];
  for (var _i = 0; _i < ONDE.length; _i++) {
    kH.push(TAU / ONDE[_i].L * H_FONDO);
    shkH.push(Math.sinh(kH[_i]));
  }

  // Finite-depth Airy. Vertical motion goes to exactly zero at the bed, because
  // nothing can move through it. Horizontal motion does NOT: at f=1 the three
  // components still sum to 1.10 px of surge. So the footer does not freeze —
  // it slides, slowly, along the bottom, which is what the bottom of a harbour
  // actually does and is a better ending than stillness.
  function smorzo(i, f) { return Math.sinh(kH[i] * (1 - f)) / shkH[i]; }
  function smorzoOrizz(i, f) { return Math.cosh(kH[i] * (1 - f)) / shkH[i]; }

  // The orbit. oy is the vertical component, ox the horizontal one a quarter
  // period ahead of it, and p the surface slope that tilts a floating hull.
  var _orb = { oy: 0, ox: 0, p: 0 };
  var DEC_SUP = [1, 1, 1];
  function orbita(x, dec, orz, t) {
    var oy = 0, ox = 0, p = 0;
    for (var i = 0; i < ONDE.length; i++) {
      var o = ONDE[i];
      var fase = TAU * x / o.L + TAU * t / o.T + o.f;
      var av = o.A * dec[i], ah = o.A * (orz ? orz[i] : dec[i]);
      oy += av * Math.sin(fase);
      // A quarter period ahead of the vertical: that offset is what makes the
      // orbit an orbit. Get its sign wrong and the whole thing reads as a
      // wobble instead of water.
      ox += ah * Math.cos(fase);
      p  += av * (TAU / o.L) * Math.cos(fase);
    }
    _orb.oy = oy; _orb.ox = ox; _orb.p = p;
    return _orb;
  }

  // ====================================================================
  // 2. everything that floats
  // ====================================================================
  // Structures standing on the bottom. They are named, not guessed.
  var FISSI = { paratia: 1, faro: 1, capitaneria: 1 };
  var PORTATA = {
    boa: 1.35, rada: 1.0, dogana: 0.55, vedetta: 0.75,
    varo: 0.5, plancia: 0.8, 'agent-switch': 0.45
  };
  // The natural period of each body, in seconds: how long one bob takes when
  // you push it and let go. A small light buoy answers fast; a loaded hull on a
  // slipway is slow to start and slow to stop. This is what makes ten objects
  // in the same water look like ten different objects instead of ten copies of
  // one animation — and it is why a thing in water reads as floating rather
  // than as following a line.
  var PERIODO = {
    boa: 1.6, dogana: 2.4, vedetta: 2.9, plancia: 3.0,
    rada: 3.4, 'agent-switch': 3.8, varo: 4.2, sonda: 2.1
  };
  var SMORZO_CORPO = 0.22;   // underdamped: it overshoots, then settles

  var galleggianti = [];   // { el, x, d, dec[], portata, ruota, fisso }
  var altezzaDoc = 1;

  function raccogli() {
    galleggianti.length = 0;

    // the ten harbour marks, one per tool
    var carte = document.querySelectorAll('.tool');
    for (var i = 0; i < carte.length; i++) {
      var svg = carte[i].querySelector('.segno');
      if (!svg) continue;
      var et = carte[i].querySelector('.n');
      var nome = et ? et.firstChild.textContent.trim() : '';
      galleggianti.push({
        nome: nome, el: svg.querySelector('.corpo') || svg, ancora: carte[i],
        portata: PORTATA[nome] || 0.7, fisso: !!FISSI[nome], ruota: true, svg: true,
        Tn: PERIODO[nome] || 2.8, y: 0, vy: 0, gx: 0, vgx: 0, r: 0, vr: 0
      });
    }
    // The four soundings. A sounding is a depth measurement, and the footer
    // already promises every figure here is a measurement, not an estimate.
    // What floats is the waterline drawn beside each figure — never the number.
    // Moving a numeral trades its subpixel antialiasing for a wobble of about a
    // pixel: the reader loses legibility and gains nothing they can see.
    var batt = document.querySelectorAll('.fig .battigia');
    for (var j = 0; j < batt.length; j++) {
      galleggianti.push({ nome: 'sonda', el: batt[j], ancora: batt[j].parentNode,
                          portata: 0.9, fisso: false, ruota: false, svg: false,
                          Tn: PERIODO.sonda + j * 0.28, y: 0, vy: 0, gx: 0, vgx: 0, r: 0, vr: 0 });
    }
  }

  // Measured once, then never on a scroll frame.
  function misura() {
    altezzaDoc = Math.max(1, document.documentElement.scrollHeight);
    for (var i = 0; i < galleggianti.length; i++) {
      var g = galleggianti[i];
      var r = g.ancora.getBoundingClientRect();
      g.x = r.left + r.width / 2 + (window.scrollX || 0);
      g.cy = r.top + r.height / 2 + (window.scrollY || 0);
      g.d = Math.min(1, Math.max(0, g.cy / altezzaDoc));
      g.dec = [smorzo(0, g.d), smorzo(1, g.d), smorzo(2, g.d)];
      g.orz = [smorzoOrizz(0, g.d), smorzoOrizz(1, g.d), smorzoOrizz(2, g.d)];
    }
    if (pelo) {
      var rp = pelo.getBoundingClientRect();
      altezzaPelo = rp.top + rp.height / 2 + (window.scrollY || 0);
    }
    aggiornaScandaglio();
  }

  // Each body is a mass on a spring: buoyancy is the spring, the water it
  // displaces is the damping, and the wave surface is what the spring is
  // attached to. It does not sit ON the wave, it CHASES it — so it arrives
  // late, goes too far, comes back, and settles. That lateness is the whole
  // difference between something floating and something following a sine.
  //
  //   a = w^2 (bersaglio - y) - 2 z w v          w = 2pi/Tn,  z = 0.22
  //
  // Semi-implicit Euler, dt already clamped upstream: with the slowest body at
  // Tn=1.6s, w*dt at 60fps is 0.065, nowhere near the stability limit.
  function muovi(t, dt, spinta) {
    var y0 = window.scrollY || 0, y1 = y0 + window.innerHeight + 240;
    for (var i = 0; i < galleggianti.length; i++) {
      var g = galleggianti[i];
      if (g.fisso) continue;
      // Off screen: no integration and no write. Depth is cached, so this test
      // is arithmetic and never touches layout.
      if (g.cy < y0 - 240 || g.cy > y1) { g.vy *= 0.9; continue; }

      var o = orbita(g.x, g.dec, g.orz, t);
      var w = TAU / g.Tn, w2 = w * w, sm = 2 * SMORZO_CORPO * w;

      // Scrolling hard is agitating the water. The energy goes into the bodies
      // as velocity, not as position: shoving a duck does not teleport it, and
      // each one answers on its own period, so they scatter instead of jumping
      // together.
      if (spinta) g.vy += spinta * (11 + 10 * g.portata) * (g.Tn / 3);

      var by = o.oy * g.portata;
      g.vy += (w2 * (by - g.y) - sm * g.vy) * dt;
      g.y += g.vy * dt;
      // The card clips its own overflow, so a body that rings too hard would
      // simply be cut in half. This is the tank wall: hit it and the energy is
      // absorbed, not reflected.
      if (g.y > 9) { g.y = 9; if (g.vy > 0) g.vy = 0; }
      else if (g.y < -9) { g.y = -9; if (g.vy < 0) g.vy = 0; }

      var bx = o.ox * g.portata * 0.55;
      g.vgx += (w2 * (bx - g.gx) - sm * g.vgx) * dt;
      g.gx += g.vgx * dt;

      if (g.svg) {
        // The roll answers slower than the heave: a hull rights itself on its
        // own period, not on the water's.
        var wr = TAU / (g.Tn * 1.35), wr2 = wr * wr, smr = 2 * 0.28 * wr;
        var br = Math.max(-7, Math.min(7, o.p * 90 * g.portata));
        g.vr += (wr2 * (br - g.r) - smr * g.vr) * dt;
        g.r += g.vr * dt;
        var rr = Math.max(-11, Math.min(11, g.r));
        g.el.setAttribute('transform',
          'translate(' + g.gx.toFixed(2) + ' ' + g.y.toFixed(2) + ') rotate(' + rr.toFixed(2) + ' 32 40)');
      } else {
        g.el.style.transform =
          'translate3d(' + g.gx.toFixed(2) + 'px,' + g.y.toFixed(2) + 'px,0)';
      }
    }
  }

  // ====================================================================
  // 3. the fluid, on the GPU
  // ====================================================================
  function creaFluido(canvas) {
    var par = {
      alpha: true, depth: false, stencil: false, antialias: false,
      preserveDrawingBuffer: false, powerPreference: 'low-power'
    };
    var gl = canvas.getContext('webgl2', par);
    var due = !!gl;
    if (!gl) gl = canvas.getContext('webgl', par) || canvas.getContext('experimental-webgl', par);
    if (!gl) return null;

    // The extension must be asked for on THIS context before a float render
    // target will ever be complete. Skipping it does not throw; it just gives
    // an incomplete framebuffer later, which is a much worse way to find out.
    var tipoHalf, lineare;
    if (due) {
      gl.getExtension('EXT_color_buffer_float');
      lineare = !!gl.getExtension('OES_texture_float_linear');
      tipoHalf = gl.HALF_FLOAT;
    } else {
      var hf = gl.getExtension('OES_texture_half_float');
      lineare = !!gl.getExtension('OES_texture_half_float_linear');
      tipoHalf = hf && hf.HALF_FLOAT_OES;
    }
    if (!tipoHalf) return null;
    // Advection samples between texels. Without linear filtering it would need
    // a hand-rolled bilinear fetch in every shader; the 2D fallback is both
    // cheaper and honest, so we go there instead.
    if (!lineare) return null;

    var interno = due ? gl.RGBA16F : gl.RGBA;
    if (!formatoRegge(gl, interno, gl.RGBA, tipoHalf)) return null;

    function formatoRegge(g, ii, ff, tt) {
      var tex = g.createTexture();
      g.bindTexture(g.TEXTURE_2D, tex);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
      g.texImage2D(g.TEXTURE_2D, 0, ii, 4, 4, 0, ff, tt, null);
      var fbo = g.createFramebuffer();
      g.bindFramebuffer(g.FRAMEBUFFER, fbo);
      g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0);
      var ok = g.checkFramebufferStatus(g.FRAMEBUFFER) === g.FRAMEBUFFER_COMPLETE;
      g.deleteFramebuffer(fbo); g.deleteTexture(tex);
      g.bindFramebuffer(g.FRAMEBUFFER, null);
      return ok;
    }

    var VERT =
      'precision highp float;attribute vec2 aPos;varying vec2 vUv,vL,vR,vT,vB;' +
      'uniform vec2 texel;void main(){vUv=aPos*0.5+0.5;' +
      'vL=vUv-vec2(texel.x,0.);vR=vUv+vec2(texel.x,0.);' +
      'vT=vUv+vec2(0.,texel.y);vB=vUv-vec2(0.,texel.y);' +
      'gl_Position=vec4(aPos,0.,1.);}';

    function prog(fonteF) {
      function sh(tipo, src) {
        var s = gl.createShader(tipo);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      }
      var p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fonteF));
      gl.bindAttribLocation(p, 0, 'aPos');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (var k = 0; k < n; k++) { var nm = gl.getActiveUniform(p, k).name; u[nm] = gl.getUniformLocation(p, nm); }
      return { p: p, u: u };
    }

    var P;
    try {
      P = {
        // a gaussian of force and ink, dropped into the field
        splat: prog('precision highp float;varying vec2 vUv;uniform sampler2D uT;' +
          'uniform float rapp;uniform vec3 col;uniform vec2 punto;uniform float raggio;' +
          'void main(){vec2 p=vUv-punto;p.x*=rapp;' +
          'vec3 s=exp(-dot(p,p)/raggio)*col;' +
          'gl_FragColor=vec4(texture2D(uT,vUv).xyz+s,1.);}'),
        // semi-lagrangian advection: look back along the velocity, take what was there
        avvez: prog('precision highp float;varying vec2 vUv;uniform sampler2D uVel,uSrc;' +
          'uniform vec2 texel;uniform float dt,perdita;' +
          'void main(){vec2 c=vUv-dt*texture2D(uVel,vUv).xy*texel;' +
          'gl_FragColor=texture2D(uSrc,c)/(1.+perdita*dt);}'),
        diverg: prog('precision highp float;varying vec2 vUv,vL,vR,vT,vB;uniform sampler2D uVel;' +
          'void main(){float L=texture2D(uVel,vL).x,R=texture2D(uVel,vR).x;' +
          'float T=texture2D(uVel,vT).y,B=texture2D(uVel,vB).y;vec2 C=texture2D(uVel,vUv).xy;' +
          'if(vL.x<0.)L=-C.x; if(vR.x>1.)R=-C.x; if(vT.y>1.)T=-C.y; if(vB.y<0.)B=-C.y;' +
          'gl_FragColor=vec4(0.5*(R-L+T-B),0.,0.,1.);}'),
        // one Jacobi sweep of the Poisson solve; run it a few times
        press: prog('precision highp float;varying vec2 vUv,vL,vR,vT,vB;uniform sampler2D uP,uDiv;' +
          'void main(){float L=texture2D(uP,vL).x,R=texture2D(uP,vR).x;' +
          'float T=texture2D(uP,vT).x,B=texture2D(uP,vB).x,d=texture2D(uDiv,vUv).x;' +
          'gl_FragColor=vec4((L+R+B+T-d)*0.25,0.,0.,1.);}'),
        // subtract the pressure gradient: this is what makes it incompressible
        grad: prog('precision highp float;varying vec2 vUv,vL,vR,vT,vB;uniform sampler2D uP,uVel;' +
          'void main(){float L=texture2D(uP,vL).x,R=texture2D(uP,vR).x;' +
          'float T=texture2D(uP,vT).x,B=texture2D(uP,vB).x;' +
          'vec2 v=texture2D(uVel,vUv).xy-vec2(R-L,T-B);' +
          'gl_FragColor=vec4(v,0.,1.);}'),
        pulisci: prog('precision highp float;varying vec2 vUv;uniform sampler2D uT;uniform float val;' +
          'void main(){gl_FragColor=val*texture2D(uT,vUv);}'),
        // ink on paper: one colour, varying only in how much of it there is
        mostra: prog('precision highp float;varying vec2 vUv;uniform sampler2D uT;' +
          'uniform vec3 inchiostro;uniform float forza;' +
          'void main(){float d=clamp(texture2D(uT,vUv).x*forza,0.,1.);' +
          'gl_FragColor=vec4(inchiostro*d,d);}')
      };
    } catch (e) { return null; }

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    function bersaglio(w, h) {
      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, interno, w, h, 0, gl.RGBA, tipoHalf, null);
      var fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      return { tex: tex, fbo: fbo, w: w, h: h, texel: [1 / w, 1 / h] };
    }
    function doppio(w, h) {
      var a = bersaglio(w, h), b = bersaglio(w, h);
      return { get uno() { return a; }, get due() { return b; }, scambia: function () { var t = a; a = b; b = t; } };
    }

    function disegna(dest) {
      if (dest) { gl.bindFramebuffer(gl.FRAMEBUFFER, dest.fbo); gl.viewport(0, 0, dest.w, dest.h); }
      else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight); }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    function lega(tex, unita) {
      gl.activeTexture(gl.TEXTURE0 + unita);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      return unita;
    }

    // Small on purpose. A harbour that is mostly out of frame does not need a
    // 512 grid, and a phone should not warm up for a background texture.
    var SIM = scarso ? 64 : 128;
    var TINTA = scarso ? 128 : 256;
    var vel = doppio(SIM, SIM), inc = doppio(TINTA, TINTA);
    var div = bersaglio(SIM, SIM), pre = doppio(SIM, SIM);
    var ITER = scarso ? 8 : 12;
    var perso = false;

    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); perso = true; }, false);

    return {
      perduto: function () { return perso; },
      schizza: function (nx, ny, dx, dy, quanto) {
        if (perso) return;
        var rapp = tela.width / tela.height;
        gl.useProgram(P.splat.p);
        gl.uniform1i(P.splat.u.uT, lega(vel.uno.tex, 0));
        gl.uniform1f(P.splat.u.rapp, rapp);
        gl.uniform2f(P.splat.u.punto, nx, ny);
        gl.uniform3f(P.splat.u.col, dx, dy, 0);
        gl.uniform1f(P.splat.u.raggio, 0.0004);
        disegna(vel.due); vel.scambia();

        gl.uniform1i(P.splat.u.uT, lega(inc.uno.tex, 0));
        gl.uniform3f(P.splat.u.col, quanto, quanto, quanto);
        gl.uniform1f(P.splat.u.raggio, 0.0030);
        disegna(inc.due); inc.scambia();
      },
      passo: function (dt) {
        if (perso) return;
        gl.disable(gl.BLEND);

        gl.useProgram(P.avvez.p);
        gl.uniform2f(P.avvez.u.texel, vel.uno.texel[0], vel.uno.texel[1]);
        gl.uniform1i(P.avvez.u.uVel, lega(vel.uno.tex, 0));
        gl.uniform1i(P.avvez.u.uSrc, lega(vel.uno.tex, 0));
        gl.uniform1f(P.avvez.u.dt, dt);
        gl.uniform1f(P.avvez.u.perdita, 0.18);
        disegna(vel.due); vel.scambia();

        gl.useProgram(P.diverg.p);
        gl.uniform2f(P.diverg.u.texel, vel.uno.texel[0], vel.uno.texel[1]);
        gl.uniform1i(P.diverg.u.uVel, lega(vel.uno.tex, 0));
        disegna(div);

        gl.useProgram(P.pulisci.p);
        gl.uniform1i(P.pulisci.u.uT, lega(pre.uno.tex, 0));
        gl.uniform1f(P.pulisci.u.val, 0.8);
        disegna(pre.due); pre.scambia();

        gl.useProgram(P.press.p);
        gl.uniform2f(P.press.u.texel, pre.uno.texel[0], pre.uno.texel[1]);
        gl.uniform1i(P.press.u.uDiv, lega(div.tex, 0));
        for (var k = 0; k < ITER; k++) {
          gl.uniform1i(P.press.u.uP, lega(pre.uno.tex, 1));
          disegna(pre.due); pre.scambia();
        }

        gl.useProgram(P.grad.p);
        gl.uniform2f(P.grad.u.texel, vel.uno.texel[0], vel.uno.texel[1]);
        gl.uniform1i(P.grad.u.uP, lega(pre.uno.tex, 0));
        gl.uniform1i(P.grad.u.uVel, lega(vel.uno.tex, 1));
        disegna(vel.due); vel.scambia();

        gl.useProgram(P.avvez.p);
        gl.uniform2f(P.avvez.u.texel, inc.uno.texel[0], inc.uno.texel[1]);
        gl.uniform1i(P.avvez.u.uVel, lega(vel.uno.tex, 0));
        gl.uniform1i(P.avvez.u.uSrc, lega(inc.uno.tex, 1));
        gl.uniform1f(P.avvez.u.dt, dt);
        gl.uniform1f(P.avvez.u.perdita, 0.55);
        disegna(inc.due); inc.scambia();
      },
      rendi: function (rgb, forza) {
        if (perso) return;
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(P.mostra.p);
        gl.uniform1i(P.mostra.u.uT, lega(inc.uno.tex, 0));
        gl.uniform3f(P.mostra.u.inchiostro, rgb[0], rgb[1], rgb[2]);
        gl.uniform1f(P.mostra.u.forza, forza);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    };
  }

  // ====================================================================
  // 4. the fallback water: the same swell, ruled like a chart
  // ====================================================================
  function creaDisegno(canvas) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    return {
      perduto: function () { return false; },
      schizza: function () {},
      passo: function () {},
      // Without a GPU there is no point imitating one. This rules the swell the
      // way a chart would, in the language the ten marks are drawn in, and it
      // obeys the same law: the lines lower down the viewport are deeper, so
      // they are flatter and fainter.
      rendi: function (rgb, forza, t, larg, alt, quotaAlto) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.scale(canvas.width / larg, canvas.height / alt);
        var col = 'rgba(' + Math.round(rgb[0] * 255) + ',' + Math.round(rgb[1] * 255) + ',' +
                  Math.round(rgb[2] * 255) + ',';
        var RIGHE = 16, passo = alt / (RIGHE + 1);
        for (var r = 0; r < RIGHE; r++) {
          var base = passo * (r + 1);
          var d = Math.min(1, Math.max(0, quotaAlto + base / Math.max(1, altezzaDoc)));
          var dec = [smorzo(0, d), smorzo(1, d), smorzo(2, d)];
          ctx.beginPath();
          for (var x = 0; x <= larg; x += 6) {
            var o = orbita(x, dec, dec, t);
            var y = base + o.oy * 1.35;
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          var f = 0.30 * (0.45 + 0.55 * dec[0]);
          ctx.strokeStyle = col + f.toFixed(3) + ')';
          ctx.lineWidth = 1.15;
          ctx.stroke();
        }
      }
    };
  }

  // ====================================================================
  // 4b. the surface
  // ====================================================================
  // The waterline at the foot of the hero, drawn from the same field at depth
  // zero — full amplitude, because this IS the surface. Scroll past it and it
  // is gone, which is the correct thing to happen when you go under.
  var pelo = document.querySelector('.pelo');
  var cresta = pelo && pelo.querySelector('.cresta');

  function disegnaPelo(t) {
    if (!cresta || !peloInVista) return;
    var d = 'M', N = 48, W = 1200;
    for (var i = 0; i <= N; i++) {
      var x = i * (W / N);
      // The viewBox is 1200 wide whatever the window is, so the field is
      // sampled in page pixels and mapped across, or the swell would stretch
      // with the window and stop being the same water as everything else.
      var o = orbita(x / W * larg, DEC_SUP, DEC_SUP, t);
      var y = 14 + o.oy * 1.15;
      d += (i ? 'L' : '') + x.toFixed(1) + ' ' + y.toFixed(2);
    }
    cresta.setAttribute('d', d);
  }

  // ====================================================================
  // 5. the sounding line
  // ====================================================================
  var peloInVista = true;
  var scandaglio = document.querySelector('.scandaglio');
  var piombo = null, quota = null, tacche = [];

  function aggiornaScandaglio() {
    if (!scandaglio) return;
    if (!piombo) {
      piombo = document.createElement('i'); piombo.className = 'piombo';
      quota = document.createElement('i'); quota.className = 'quota';
      var et = document.createElement('i'); et.className = 'etichetta';
      et.textContent = 'sounding';
      scandaglio.appendChild(et);
      scandaglio.appendChild(piombo); scandaglio.appendChild(quota);
    }
    // The marks are the page's own sections, at the depth they really sit at.
    for (var i = 0; i < tacche.length; i++) scandaglio.removeChild(tacche[i]);
    tacche.length = 0;
    var punti = [];
    var h2 = document.querySelectorAll('section > .wrap > h2');
    punti.push({ nome: 'surface', y: 0 });
    for (var j = 0; j < h2.length; j++) {
      var r = h2[j].getBoundingClientRect();
      punti.push({ nome: h2[j].textContent.trim(), y: r.top + (window.scrollY || 0) });
    }
    for (var k = 0; k < punti.length; k++) {
      var t = document.createElement('i');
      t.className = 'tacca';
      t.style.top = (100 * punti[k].y / altezzaDoc).toFixed(2) + '%';
      var s = document.createElement('span');
      s.textContent = punti[k].nome;
      t.appendChild(s);
      scandaglio.appendChild(t); tacche.push(t);
    }
  }

  function segnaProfondita() {
    if (!piombo) return;
    var y = (window.scrollY || 0) + window.innerHeight / 2;
    var d = Math.min(1, Math.max(0, y / altezzaDoc));
    piombo.style.top = (100 * d).toFixed(2) + '%';
    quota.style.top = (100 * d).toFixed(2) + '%';
    // Read as a fraction of the whole harbour. It is a real number about the
    // page, not a decorative counter: it is where the reader is.
    quota.textContent = (d * 100).toFixed(0) + '%';
  }

  // ====================================================================
  // 6. wiring
  // ====================================================================
  var motore = null, modo = 'niente';
  try { if (!fermo) { motore = creaFluido(tela); if (motore) modo = 'fluido'; } } catch (e) { motore = null; }
  if (!motore && !fermo) { try { motore = creaDisegno(tela); if (motore) modo = 'disegno'; } catch (e2) { motore = null; } }

  var larg = 0, alt = 0, dpr = 1;
  function ridimensiona() {
    larg = Math.max(1, window.innerWidth);
    alt = Math.max(1, window.innerHeight);
    var stretto = larg < 700;
    dpr = Math.min(window.devicePixelRatio || 1, scarso || stretto ? 1 : 1.6);
    var w = Math.round(larg * dpr), h = Math.round(alt * dpr);
    if (tela.width !== w || tela.height !== h) { tela.width = w; tela.height = h; }
    raccogli(); misura(); segnaProfondita();
  }

  var inchiostro = [0.04, 0.36, 0.36], forzaInk = 0.38;
  function leggiColore() {
    var c = getComputedStyle(document.body).getPropertyValue('--accent').trim();
    var m = c.match(/^#?([0-9a-f]{6})$/i);
    if (m) {
      var n = parseInt(m[1], 16);
      inchiostro = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }
    var scuro = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
    forzaInk = scuro ? 0.62 : 0.46;
  }

  // Where the ink enters. Down both sides, because the reading column runs down
  // the middle on its own paper and the open water is what is left.
  var SORGENTI = [
    { x: 0.030, y: 0.22, f: 0.061, g: 0.19, v: 150, a: 0.072, p: 0.0 },
    { x: 0.060, y: 0.62, f: 0.043, g: -0.23, v: 135, a: 0.072, p: 1.7 },
    { x: 0.970, y: 0.22, f: 0.055, g: -0.21, v: -145, a: 0.074, p: 0.9 },
    { x: 0.940, y: 0.68, f: 0.067, g: 0.25, v: -130, a: 0.070, p: 2.6 }
  ];
  // Four sources, not eight. Every source is two draw calls, and on a
  // tile-based GPU each draw is a whole render pass with a load and a store of
  // the target. Passes are the cost, not pixels: halving them halved the frame.

  var t = 0, ultimo = 0, vivo = false, acceso = false, altezzaPelo = 0;
  var yPrec = 0, scia = 0;

  function fotogramma(ora) {
    if (!vivo) return;
    var dt = ultimo ? Math.min((ora - ultimo) / 1000, 1 / 24) : 1 / 60;
    ultimo = ora; t += dt;
    avanza(dt);
    if (!acceso) { tela.classList.add('viva'); acceso = true; }
    requestAnimationFrame(fotogramma);
  }

  function avanza(dt) {
    var y = window.scrollY || 0;
    // A body moving through water leaves a wake. Scrolling fast is moving fast,
    // so the harbour churns and then settles, which is the only feedback on
    // this page that answers the reader's own hand.
    var passi = Math.abs(y - yPrec);
    var vel = Math.min(1, passi / 90);
    scia = scia * 0.88 + vel * 0.12;
    // The impulse is the SUDDEN part of the scroll, not the steady part: a
    // reader gliding down at constant speed is a boat under way and leaves a
    // wake; a reader flinging the page is a hand in the bath.
    var spinta = Math.min(1, passi / 260) * Math.min(1, dt * 60);
    yPrec = y;
    // The surface is at the top of the document: the fraction of the harbour
    // that is above the top of the viewport.
    var quotaAlto = Math.min(1, Math.max(0, y / altezzaDoc));

    if (motore && modo === 'fluido') {
      for (var s = 0; s < SORGENTI.length; s++) {
        var o = SORGENTI[s];
        // The sources obey the law too: one near the top of the harbour is in
        // lively water, one near the bottom is in slack water.
        var dSorg = Math.min(1, quotaAlto + (1 - o.y) * (alt / Math.max(1, altezzaDoc)));
        var calma = 0.30 + 0.70 * smorzo(0, dSorg);
        var puls = 0.5 + 0.5 * Math.sin(TAU * t * o.f + o.p);
        var ang = t * o.g + o.p;
        motore.schizza(
          o.x + 0.018 * Math.sin(t * 0.21 + o.p),
          o.y + 0.012 * Math.cos(t * 0.27 + o.p),
          o.v * Math.cos(ang) * calma * (1 + 2.2 * scia),
          o.v * 0.35 * Math.sin(ang) * calma,
          o.a * puls * calma * (1 + 1.4 * scia));
      }
      motore.passo(Math.min(dt, 1 / 30));
      motore.rendi(inchiostro, forzaInk);
    } else if (motore) {
      motore.rendi(inchiostro, forzaInk, t, larg, alt, quotaAlto);
    }
    // The surface only exists while it is on screen; below it there is nothing
    // to draw and no reason to spend a frame on it.
    if (pelo) {
      var pr = altezzaPelo - (window.scrollY || 0);
      peloInVista = pr > -60 && pr < alt + 60;
      disegnaPelo(t);
    }
    muovi(t, Math.min(dt, 1 / 30), spinta);
    segnaProfondita();
  }

  // The pointer stirs the water, never the marks: a reader cannot drag a hull
  // out of the sea it lives in.
  var ultimoP = null;
  function daPuntatore(e) {
    if (!motore || modo !== 'fluido' || motore.perduto()) return;
    var nx = e.clientX / larg, ny = 1 - e.clientY / alt;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) { ultimoP = null; return; }
    if (ultimoP) {
      var dx = (nx - ultimoP[0]) * 900, dy = (ny - ultimoP[1]) * 900;
      if (dx * dx + dy * dy > 0.2) motore.schizza(nx, ny, dx, dy, 0.16);
    }
    ultimoP = [nx, ny];
  }

  // A card taking focus or hover displaces the water at that exact point. It is
  // the same event a keyboard gives, so tabbing through the fleet stirs the
  // harbour just as a mouse does — the one interaction on this page that a
  // keyboard reader would otherwise never get.
  function tocca(el, quanto) {
    if (!motore || modo !== 'fluido' || motore.perduto()) return;
    var r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > alt) return;
    var nx = (r.left + r.width / 2) / larg, ny = 1 - (r.top + r.height / 2) / alt;
    motore.schizza(nx, ny, 0, 120 * quanto, 0.22 * quanto);
  }


  // ====================================================================
  // 7. GSAP: the cycles that are not the swell
  // ====================================================================
  function coreografia() {
    if (!window.gsap) return;
    var g = window.gsap;
    function q(sel) { return document.querySelector(sel); }
    var fascio = q('.segno .fascio');
    if (fascio) g.to(fascio, { rotation: 8, duration: 3.4, yoyo: true, repeat: -1,
                               ease: 'sine.inOut', transformOrigin: '32px 22px' });
    var sguardo = q('.segno .sguardo');
    if (sguardo) g.to(sguardo, { rotation: -10, duration: 4.1, yoyo: true, repeat: -1,
                                 ease: 'sine.inOut', transformOrigin: '32px 16px' });
    var passa = q('.segno .passa');
    if (passa) g.fromTo(passa, { x: -14, opacity: 0 },
      { x: 26, opacity: 1, duration: 2.6, ease: 'none', repeat: -1, repeatDelay: 1.1,
        onRepeat: function () { g.set(passa, { opacity: 0 }); } });
    var scivola = q('.segno .scivola');
    if (scivola) g.fromTo(scivola, { x: -13, y: -9 },
      { x: 6, y: 4, duration: 2.2, ease: 'power2.in', repeat: -1, repeatDelay: 1.6 });
    var carico = q('.segno .carico');
    if (carico) g.to(carico, { x: 26, duration: 2.4, ease: 'power1.inOut',
                               yoyo: true, repeat: -1, repeatDelay: 0.5 });
    var bandiera = q('.segno .bandiera');
    if (bandiera) g.to(bandiera, { scaleX: 0.82, duration: 1.15, yoyo: true, repeat: -1,
                                   ease: 'sine.inOut', transformOrigin: '46px 19px' });
    var timone = q('.segno .timone');
    if (timone) g.to(timone, { rotation: 26, duration: 3.9, yoyo: true, repeat: -1,
                               ease: 'sine.inOut', transformOrigin: '32px 43px' });
    var alta = q('.segno .acqua.alta'), bassa = q('.segno .acqua.bassa');
    if (alta) g.to(alta, { y: -1.6, duration: 4.3, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    if (bassa) g.to(bassa, { y: 1.6, duration: 4.3, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    var coda = document.querySelectorAll('.segno .coda > *');
    if (coda.length) g.to(coda, { y: -3.2, duration: 2.7, yoyo: true, repeat: -1,
                                  ease: 'sine.inOut', stagger: { each: 0.42, from: 'start' } });
  }

  // ====================================================================
  // 8. start, stop, and the ways out
  // ====================================================================
  // The gate. A position:fixed inset:0 canvas intersects the viewport by
  // construction, so an IntersectionObserver would never switch anything off.
  // The real conditions are: the tab is in front, and there is open water to
  // see. Below about 1100px the reading column plus its halo covers the whole
  // window and the harbour is zero visible pixels — running a fluid nobody can
  // see is the most expensive kind of nothing.
  var LARGHEZZA_MINIMA = 1100;
  function vale() {
    return !fermo && document.visibilityState === 'visible' &&
           window.innerWidth >= LARGHEZZA_MINIMA;
  }
  function accendi() {
    if (vivo || !motore || !vale()) return;
    vivo = true; ultimo = 0; requestAnimationFrame(fotogramma);
  }
  function spegni() {
    vivo = false;
    if (acceso) { tela.classList.remove('viva'); acceso = false; }
  }

  // Nothing to run: the CSS wash, the ten marks and the sounding line are the
  // whole picture, and they are already correct.
  if (!motore || fermo) {
    raccogli(); misura(); segnaProfondita();
    addEventListener('scroll', segnaProfondita, { passive: true });
    addEventListener('resize', function () { misura(); segnaProfondita(); }, { passive: true });
    addEventListener('load', function () { misura(); segnaProfondita(); });
    window.__mare = { modo: fermo ? 'fermo' : 'niente', stato: function () {
      return { modo: fermo ? 'fermo' : 'niente', altezzaDoc: altezzaDoc, galleggianti: [] }; } };
    return;
  }

  leggiColore();
  ridimensiona();
  coreografia();
  accendi();

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { ultimo = 0; accendi(); } else spegni();
  });

  var attesa;
  addEventListener('resize', function () {
    clearTimeout(attesa);
    attesa = setTimeout(function () {
      ridimensiona();
      if (vale()) accendi(); else spegni();
    }, 160);
  }, { passive: true });
  // Measured at parse time is measured too early: a webfont landing after first
  // paint moves every depth on the page.
  addEventListener('load', ridimensiona);

  addEventListener('pointermove', daPuntatore, { passive: true });
  document.querySelectorAll('.tool').forEach(function (c) {
    c.addEventListener('pointerenter', function () { tocca(c, 1); }, { passive: true });
    c.addEventListener('focus', function () { tocca(c, 1.4); });
  });

  if (mqFermo && mqFermo.addEventListener) {
    mqFermo.addEventListener('change', function (e) {
      if (e.matches) {
        spegni(); tela.classList.remove('viva'); acceso = false;
        // put every mark back where it belongs before stopping
        for (var i = 0; i < galleggianti.length; i++) {
          var g = galleggianti[i];
          if (g.svg) g.el.removeAttribute('transform'); else g.el.style.transform = '';
        }
        if (cresta) cresta.setAttribute('d', 'M0 14H1200');
        if (window.gsap) gsap.globalTimeline.clear();
      } else accendi();
    });
  }
  if (window.matchMedia) {
    var mqScuro = matchMedia('(prefers-color-scheme: dark)');
    if (mqScuro.addEventListener) mqScuro.addEventListener('change', leggiColore);
  }

  // Driveable by hand: frames only arrive in a visible tab, and an animation
  // that can only be checked by watching it cannot be checked at all.
  window.__mare = {
    modo: modo,
    passo: function (dt) { t += (dt || 1 / 60); avanza(dt || 1 / 60); },
    smorzo: smorzo, orbita: orbita,
    stato: function () {
      return {
        modo: modo, tempo: t, vivo: vivo, larg: larg, alt: alt, dpr: dpr,
        altezzaDoc: altezzaDoc, scia: scia, inchiostro: inchiostro, forza: forzaInk,
        galleggianti: galleggianti.map(function (g) {
          return { nome: g.nome, d: +g.d.toFixed(3), x: Math.round(g.x), fisso: g.fisso,
                   dec: g.dec.map(function (v) { return +v.toFixed(3); }),
                   trasf: g.svg ? (g.el.getAttribute('transform') || '') : (g.el.style.transform || '') };
        })
      };
    }
  };
})();
