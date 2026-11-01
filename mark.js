// Akrotiraki mark: the logo roofline as small squares that ripple from the pointer and spring back.
(function () {
  'use strict';
  var cv = document.querySelector('canvas.site-mark');
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext('2d');
  var dpr = Math.max(1, window.devicePixelRatio || 1);
  var BOX = 5, GAP = 1, P = BOX + GAP, PAD = 3;
  var REPEL = 260, RANGE = 4, RMIN = 1, SPRING = 0.08, DAMP = 0.76;
  var FIXED = Number(cv.getAttribute('data-width')) || 0;
  // roofline, 16 x 4 cells
  var PTS = [[0, 3], [3, 3], [3, 2], [4, 2], [4, 0], [6, 0], [6, 1], [10, 1], [10, 2], [12, 2], [12, 3], [15, 3]];
  var C = [], seen = {}, i, j, GW = 16, GH = 4;
  for (i = 1; i < PTS.length; i++) {
    var a = PTS[i - 1], b = PTS[i], n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    for (j = 0; j <= n; j++) {
      var x = a[0] + Math.sign(b[0] - a[0]) * j, y = a[1] + Math.sign(b[1] - a[1]) * j, k = x + ',' + y;
      if (!seen[k]) { seen[k] = 1; C.push([x, y]); }
    }
  }
  var W = (GW + 2 * PAD) * P, H = (GH + 2 * PAD) * P, nodes = [], col = '#1f2a33', alpha = 0.8, k = 1;
  var mouse = { x: 0, y: 0, on: false }, running = false;
  var dark = window.matchMedia('(prefers-color-scheme: dark)');
  function colour() {
    var s = getComputedStyle(document.documentElement);
    col = (s.getPropertyValue('--ink') || '').trim() || col;
    alpha = dark.matches ? 0.7 : 0.8;
  }
  function size() {
    var n = document.querySelector('.wordmark-name'), cap = 0;
    if (n && !FIXED) {   // grid height = cap height of the wordmark's "A"
      var f = getComputedStyle(n), c = document.createElement('canvas').getContext('2d');
      c.font = f.fontWeight + ' ' + f.fontSize + ' ' + f.fontFamily;
      cap = c.measureText('A').actualBoundingBoxAscent || parseFloat(f.fontSize) * 0.63;
    }
    k = cap ? cap / (GH * P - GAP) : (FIXED || 40) / (GW * P - GAP);
    cv.style.width = W * k + 'px'; cv.style.height = H * k + 'px';
    cv.style.margin = (-PAD * P * k) + 'px';
    cv.width = Math.round(W * k * dpr); cv.height = Math.round(H * k * dpr);
    ctx.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = col; ctx.globalAlpha = alpha;
    for (i = 0; i < nodes.length; i++) ctx.fillRect(nodes[i].x, nodes[i].y, BOX, BOX);
  }
  function step() {
    var moving = false, R = RANGE * P, m = RMIN * P;
    for (i = 0; i < nodes.length; i++) {
      var q = nodes[i], ax = (q.hx - q.x) * SPRING, ay = (q.hy - q.y) * SPRING;
      if (mouse.on) {
        var dx = q.x + BOX / 2 - mouse.x, dy = q.y + BOX / 2 - mouse.y, d = Math.sqrt(dx * dx + dy * dy) || 1e-4;
        if (d < R) { var dd = Math.max(d, m), f = REPEL / (dd * dd) * (1 - d / R); ax += dx / d * f; ay += dy / d * f; }
      }
      q.vx = (q.vx + ax) * DAMP; q.vy = (q.vy + ay) * DAMP; q.x += q.vx; q.y += q.vy;
      if (Math.abs(q.vx) + Math.abs(q.vy) > 0.02 || Math.abs(q.x - q.hx) + Math.abs(q.y - q.hy) > 0.02) moving = true;
    }
    if (!moving) for (i = 0; i < nodes.length; i++) { nodes[i].x = nodes[i].hx; nodes[i].y = nodes[i].hy; }
    draw();
    return moving;
  }
  function run() {
    if (running) return;
    running = true;
    requestAnimationFrame(function loop() { if (step() || mouse.on) requestAnimationFrame(loop); else running = false; });
  }
  function at(e) {
    var r = cv.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) * W / r.width; mouse.y = (e.clientY - r.top) * H / r.height;
  }
  for (i = 0; i < C.length; i++) {
    var hx = (C[i][0] + PAD) * P, hy = (C[i][1] + PAD) * P;
    nodes.push({ hx: hx, hy: hy, x: hx, y: hy, vx: 0, vy: 0 });
  }
  function align() {
    var name = document.querySelector('.wordmark-name');
    if (!name) return;
    cv.style.transform = '';
    var pr = name.appendChild(document.createElement('i')), base;
    pr.style.cssText = 'display:inline-block;height:0';
    base = pr.getBoundingClientRect().bottom; name.removeChild(pr);
    var bottom = cv.getBoundingClientRect().top + ((PAD + GH) * P - GAP) * k;
    cv.style.transform = 'translateY(' + (base - bottom).toFixed(2) + 'px)';
  }
  colour(); size(); draw(); align();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { size(); draw(); align(); });
  window.addEventListener('resize', function () { size(); draw(); align(); });
  if (dark.addEventListener) dark.addEventListener('change', function () { colour(); draw(); });
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var touch = false;
  cv.addEventListener('pointerdown', function (e) {
    touch = e.pointerType !== 'mouse';
    if (!touch) return;
    at(e); mouse.on = true; run();
    setTimeout(function () { mouse.on = false; }, 180);
  });
  cv.addEventListener('click', function (e) { if (touch) e.preventDefault(); });
  cv.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse') { at(e); mouse.on = true; run(); } });
  cv.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') { mouse.on = false; run(); } });
})();
