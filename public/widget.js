/**
 * Feedback Widget — embeddable, self-hosted.
 *
 * Minimal embed:
 *   <script src="https://fb.mysite.co/widget.js" data-site-id="my-site"></script>
 *
 * Everything is isolated in a shadow DOM so the host page's CSS can't touch it
 * and vice-versa. Screenshots are produced client-side with html2canvas.
 */
(function () {
  'use strict';
  if (window.__feedbackWidgetLoaded) return;
  window.__feedbackWidgetLoaded = true;

  // ---- config ---------------------------------------------------------------
  var script = document.currentScript ||
    (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1]; })();
  var scriptOrigin = (function () {
    try { return new URL(script.src).origin; } catch (e) { return ''; }
  })();
  function attr(name, fallback) {
    var v = script.getAttribute('data-' + name);
    return (v === null || v === undefined) ? fallback : v;
  }
  var userCfg = window.FeedbackWidgetConfig || {};
  var cfg = {
    siteId:      userCfg.siteId      || attr('site-id', 'default'),
    api:         (userCfg.api        || attr('api', scriptOrigin)).replace(/\/$/, ''),
    color:       userCfg.color       || attr('color', '#2563eb'),
    position:    userCfg.position    || attr('position', 'bottom-right'),
    label:       userCfg.label       || attr('label', 'Feedback'),
    title:       userCfg.title       || attr('title', 'Send feedback'),
    autoCapture: String(userCfg.autoCapture !== undefined ? userCfg.autoCapture : attr('auto-capture', 'true')) !== 'false',
    showEmail:   String(userCfg.email !== undefined ? userCfg.email : attr('email', 'true')) !== 'false',
    showLauncher:String(userCfg.launcher !== undefined ? userCfg.launcher : attr('launcher', 'true')) !== 'false',
    categories:  (userCfg.categories || attr('categories', 'bug,idea,feedback,other')).split(',').map(function (s) { return s.trim(); }).filter(Boolean),
    helpUrl:     userCfg.helpUrl     || attr('help-url', '')
  };

  var CATEGORY_LABELS = { bug: 'Bug', idea: 'Idea', feedback: 'Feedback', other: 'Other' };
  var CATEGORY_ICONS = {
    bug: 'M8 2a3 3 0 0 1 3 3H5a3 3 0 0 1 3-3Zm6 6h-2V6.7A5 5 0 0 0 13 5h1a1 1 0 1 0 0-2h-1.3A5 5 0 0 0 3.3 3H2a1 1 0 0 0 0 2h1a5 5 0 0 0 1 1.7V8H2a1 1 0 0 0 0 2h2v1H2a1 1 0 0 0 0 2h2.1a5 5 0 0 0 7.8 0H14a1 1 0 1 0 0-2h-2v-1h2a1 1 0 1 0 0-2Z',
    idea: 'M8 1a5 5 0 0 0-3 9v1.5a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V10a5 5 0 0 0-3-9ZM6 14a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1H6Z',
    feedback: 'M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6l-3 3v-3H3a1 1 0 0 1-1-1V3Z',
    other: 'M3 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm5 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm5 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z'
  };

  // ---- lightweight error buffer (helps you reproduce bugs) -------------------
  var errorBuffer = [];
  function pushError(e) {
    errorBuffer.push({ t: new Date().toISOString(), msg: String(e).slice(0, 500) });
    if (errorBuffer.length > 30) errorBuffer.shift();
  }
  window.addEventListener('error', function (ev) {
    pushError((ev.message || 'error') + (ev.filename ? ' @ ' + ev.filename + ':' + ev.lineno : ''));
  });
  window.addEventListener('unhandledrejection', function (ev) {
    pushError('Unhandled promise rejection: ' + (ev.reason && (ev.reason.message || ev.reason)));
  });
  var origConsoleError = console.error;
  console.error = function () {
    try { pushError('console.error: ' + Array.prototype.join.call(arguments, ' ')); } catch (e) {}
    return origConsoleError.apply(console, arguments);
  };

  // ---- html2canvas loader ----------------------------------------------------
  var h2cPromise = null;
  function loadHtml2Canvas() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    if (h2cPromise) return h2cPromise;
    h2cPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = cfg.api + '/vendor/html2canvas.min.js';
      s.onload = function () { resolve(window.html2canvas); };
      s.onerror = function () { reject(new Error('Could not load screenshot library')); };
      document.head.appendChild(s);
    });
    return h2cPromise;
  }

  // ---- styles ----------------------------------------------------------------
  var STYLE = (function () {
    var pos = cfg.position;
    var vert = pos.indexOf('top') === 0 ? 'top: 20px;' : 'bottom: 20px;';
    var horiz = pos.indexOf('left') !== -1 ? 'left: 20px;' : 'right: 20px;';
    return [
      ':host{all:initial;}',
      "@font-face{font-family:'Open Sauce Sans';src:url('" + cfg.api + "/fonts/OpenSauceSans-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap;}",
      "@font-face{font-family:'Open Sauce Sans';src:url('" + cfg.api + "/fonts/OpenSauceSans-Medium.woff2') format('woff2');font-weight:500;font-style:normal;font-display:swap;}",
      "@font-face{font-family:'Open Sauce Sans';src:url('" + cfg.api + "/fonts/OpenSauceSans-SemiBold.woff2') format('woff2');font-weight:600;font-style:normal;font-display:swap;}",
      '*{box-sizing:border-box;font-family:"Open Sauce Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}',
      '.launcher{position:fixed;' + vert + horiz + 'z-index:2147483646;display:inline-flex;align-items:center;gap:8px;',
      'padding:10px 16px;border:none;border-radius:999px;background:' + cfg.color + ';color:#fff;font-size:14px;font-weight:600;',
      'cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.18);transition:transform .12s ease,box-shadow .12s ease;}',
      '.launcher:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(0,0,0,.22);}',
      '.launcher:active{transform:translateY(0);}',
      '.launcher svg{width:16px;height:16px;fill:currentColor;}',
      '.launcher[disabled]{opacity:.7;cursor:default;}',
      '.overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,.55);backdrop-filter:blur(2px);',
      'display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;transition:opacity .15s ease;}',
      '.overlay.show{opacity:1;}',
      '.modal{width:100%;max-width:520px;max-height:92vh;overflow:auto;background:#fff;border-radius:16px;',
      'box-shadow:0 24px 60px rgba(0,0,0,.3);transform:translateY(8px) scale(.98);transition:transform .15s ease;}',
      '.overlay.show .modal{transform:translateY(0) scale(1);}',
      '.head{display:flex;align-items:center;justify-content:center;position:relative;padding:18px 56px;border-bottom:1px solid #eef0f3;}',
      '.head h2{margin:0;font-size:17px;font-weight:700;color:#0f172a;}',
      '.icon-btn{position:absolute;top:50%;transform:translateY(-50%);width:34px;height:34px;border:none;border-radius:50%;',
      'background:#f1f3f5;color:#334155;cursor:pointer;display:flex;align-items:center;justify-content:center;}',
      '.icon-btn:hover{background:#e6e9ed;}',
      '.icon-btn.close{right:14px;}',
      '.icon-btn svg{width:16px;height:16px;fill:currentColor;}',
      '.body{padding:18px 20px;}',
      '.cats{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;}',
      '.cat{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border:1px solid #d8dce1;border-radius:999px;',
      'background:#fff;color:#334155;font-size:13px;font-weight:600;cursor:pointer;transition:all .1s ease;}',
      '.cat svg{width:14px;height:14px;fill:currentColor;}',
      '.cat:hover{border-color:#b9c0c8;}',
      '.cat.active{border-color:' + cfg.color + ';background:' + hexA(cfg.color, .08) + ';color:' + cfg.color + ';}',
      '.field{width:100%;border:1px solid #d8dce1;border-radius:10px;padding:11px 12px;font-size:14px;color:#0f172a;',
      'resize:vertical;outline:none;transition:border-color .1s ease,box-shadow .1s ease;}',
      '.field:focus{border-color:' + cfg.color + ';box-shadow:0 0 0 3px ' + hexA(cfg.color, .15) + ';}',
      'textarea.field{min-height:104px;}',
      '.hint{font-size:12px;color:#94a3b8;margin:6px 2px 12px;}',
      '.actions{display:flex;gap:10px;margin-bottom:8px;flex-wrap:wrap;}',
      '.ghost{display:inline-flex;align-items:center;gap:7px;padding:9px 13px;border:1px solid #d8dce1;border-radius:10px;',
      'background:#f6f7f9;color:#1f2937;font-size:13px;font-weight:600;cursor:pointer;}',
      '.ghost:hover{background:#eef0f3;}',
      '.ghost svg{width:15px;height:15px;fill:currentColor;}',
      '.ghost[disabled]{opacity:.55;cursor:default;}',
      '.shot{position:relative;margin-top:12px;border:1px solid #e3e6ea;border-radius:10px;overflow:hidden;background:#f8fafc;}',
      '.shot img{display:block;width:100%;max-height:240px;object-fit:contain;background:#f1f5f9;}',
      '.shot .remove{position:absolute;top:8px;right:8px;width:28px;height:28px;border:none;border-radius:50%;',
      'background:rgba(15,23,42,.7);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;}',
      '.shot .remove svg{width:13px;height:13px;fill:#fff;}',
      '.shot.loading{height:90px;display:flex;align-items:center;justify-content:center;color:#64748b;font-size:13px;gap:8px;}',
      '.spinner{width:16px;height:16px;border:2px solid #cbd5e1;border-top-color:' + cfg.color + ';border-radius:50%;animation:spin .7s linear infinite;}',
      '@keyframes spin{to{transform:rotate(360deg);}}',
      '.note{margin-top:14px;padding:12px 14px;background:#f6f7f9;border-radius:10px;font-size:13px;color:#475569;line-height:1.5;}',
      '.note a{color:' + cfg.color + ';font-weight:600;text-decoration:none;}',
      '.foot{display:flex;justify-content:flex-end;gap:10px;padding:16px 20px;border-top:1px solid #eef0f3;}',
      '.submit{padding:11px 22px;border:none;border-radius:10px;background:' + cfg.color + ';color:#fff;font-size:14px;',
      'font-weight:700;cursor:pointer;transition:filter .1s ease;}',
      '.submit:hover{filter:brightness(1.05);}',
      '.submit[disabled]{opacity:.6;cursor:default;}',
      '.success{padding:48px 24px;text-align:center;}',
      '.success .check{width:56px;height:56px;border-radius:50%;background:' + hexA(cfg.color, .12) + ';color:' + cfg.color + ';',
      'display:flex;align-items:center;justify-content:center;margin:0 auto 16px;}',
      '.success .check svg{width:28px;height:28px;fill:currentColor;}',
      '.success h3{margin:0 0 6px;font-size:18px;color:#0f172a;}',
      '.success p{margin:0;color:#64748b;font-size:14px;}',
      '.err{color:#dc2626;font-size:13px;margin-top:10px;text-align:right;}',
      '.hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0;}',
      '@media(max-width:560px){.launcher span{display:none;}.launcher{padding:12px;}}'
    ].join('');
  })();

  function hexA(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function svg(d) { return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="' + d + '"/></svg>'; }

  // ---- mount -----------------------------------------------------------------
  var host = document.createElement('div');
  host.id = 'feedback-widget-root';
  var shadow = host.attachShadow({ mode: 'open' });
  var styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  shadow.appendChild(styleEl);
  var mount = document.createElement('div');
  shadow.appendChild(mount);

  function ready(fn) {
    if (document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }
  ready(function () {
    document.body.appendChild(host);
    if (cfg.showLauncher) renderLauncher();
  });

  // ---- state -----------------------------------------------------------------
  var state = { category: cfg.categories[0] || 'bug', screenshot: null, capturing: false };

  function renderLauncher() {
    var b = document.createElement('button');
    b.className = 'launcher';
    b.type = 'button';
    b.innerHTML = svg('M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6l-3 3v-3H3a1 1 0 0 1-1-1V3Z') +
      '<span>' + escapeHtml(cfg.label) + '</span>';
    b.addEventListener('click', function () { openFlow(b); });
    mount.appendChild(b);
  }

  // launcher click → (optionally) capture page first, then open modal
  function openFlow(launcherBtn) {
    if (cfg.autoCapture) {
      if (launcherBtn) { launcherBtn.setAttribute('disabled', ''); launcherBtn.querySelector('span') && (launcherBtn.querySelector('span').textContent = 'Preparing…'); }
      captureViewport().then(function (dataUrl) {
        state.screenshot = dataUrl || null;
      }).catch(function () {}).then(function () {
        if (launcherBtn) { launcherBtn.removeAttribute('disabled'); launcherBtn.querySelector('span') && (launcherBtn.querySelector('span').textContent = cfg.label); }
        openModal();
      });
    } else {
      openModal();
    }
  }

  // ---- screenshot ------------------------------------------------------------
  function captureViewport() {
    return loadHtml2Canvas().then(function (html2canvas) {
      host.style.visibility = 'hidden';
      return html2canvas(document.documentElement, {
        x: window.scrollX, y: window.scrollY,
        width: window.innerWidth, height: window.innerHeight,
        windowWidth: document.documentElement.scrollWidth,
        windowHeight: document.documentElement.scrollHeight,
        scale: Math.min(window.devicePixelRatio || 1, 2),
        useCORS: true, allowTaint: false, logging: false,
        backgroundColor: '#ffffff'
      }).then(function (canvas) {
        host.style.visibility = '';
        return downscale(canvas, 1600);
      }).catch(function (e) {
        host.style.visibility = '';
        pushError('screenshot failed: ' + e);
        return null;
      });
    });
  }

  function downscale(canvas, maxW) {
    var w = canvas.width, h = canvas.height;
    if (w > maxW) { h = Math.round(h * (maxW / w)); w = maxW; }
    var out = document.createElement('canvas');
    out.width = w; out.height = h;
    out.getContext('2d').drawImage(canvas, 0, 0, w, h);
    return out.toDataURL('image/jpeg', 0.85);
  }

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // ---- modal -----------------------------------------------------------------
  var overlay = null;
  function openModal() {
    if (overlay) return;
    state.category = cfg.categories[0] || 'bug';
    overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = modalHtml();
    mount.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('show'); });

    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
    overlay.querySelector('.close').addEventListener('click', closeModal);
    overlay.querySelectorAll('.cat').forEach(function (el) {
      el.addEventListener('click', function () {
        state.category = el.getAttribute('data-cat');
        overlay.querySelectorAll('.cat').forEach(function (c) { c.classList.remove('active'); });
        el.classList.add('active');
      });
    });
    overlay.querySelector('#fbw-capture').addEventListener('click', manualCapture);
    overlay.querySelector('#fbw-file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) fileToDataUrl(f).then(function (d) { state.screenshot = d; renderShot(); });
    });
    overlay.querySelector('#fbw-upload').addEventListener('click', function () {
      overlay.querySelector('#fbw-file').click();
    });
    overlay.querySelector('.submit').addEventListener('click', submit);
    overlay.addEventListener('paste', onPaste);
    document.addEventListener('keydown', onKey);

    renderShot();
    var ta = overlay.querySelector('#fbw-msg');
    if (ta) ta.focus();
  }

  function modalHtml() {
    var cats = cfg.categories.map(function (c, i) {
      return '<button type="button" class="cat' + (i === 0 ? ' active' : '') + '" data-cat="' + c + '">' +
        (CATEGORY_ICONS[c] ? svg(CATEGORY_ICONS[c]) : '') +
        '<span>' + escapeHtml(CATEGORY_LABELS[c] || c) + '</span></button>';
    }).join('');
    var help = cfg.helpUrl
      ? ' If you need help with a specific problem, visit the <a href="' + escapeAttr(cfg.helpUrl) + '" target="_blank" rel="noopener">Help Centre</a>.'
      : '';
    return '' +
      '<div class="modal" role="dialog" aria-modal="true" aria-label="' + escapeAttr(cfg.title) + '">' +
        '<div class="head"><h2>' + escapeHtml(cfg.title) + '</h2>' +
          '<button class="icon-btn close" type="button" aria-label="Close">' + svg('M4.3 4.3a1 1 0 0 1 1.4 0L8 6.6l2.3-2.3a1 1 0 1 1 1.4 1.4L9.4 8l2.3 2.3a1 1 0 0 1-1.4 1.4L8 9.4l-2.3 2.3a1 1 0 0 1-1.4-1.4L6.6 8 4.3 5.7a1 1 0 0 1 0-1.4Z') + '</button>' +
        '</div>' +
        '<div class="body">' +
          (cfg.categories.length > 1 ? '<div class="cats">' + cats + '</div>' : '') +
          '<textarea id="fbw-msg" class="field" placeholder="Describe what happened, or what you\'d like to see…"></textarea>' +
          '<div class="hint">You can also paste an image here to add it as a screenshot.</div>' +
          (cfg.showEmail ? '<input id="fbw-email" class="field" type="email" placeholder="Your email (optional, so we can follow up)" />' : '') +
          '<div class="actions" style="margin-top:12px;">' +
            '<button id="fbw-capture" class="ghost" type="button">' + svg('M5 3 6 1.5h4L11 3h2a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h2Zm3 8.5A2.75 2.75 0 1 0 8 6a2.75 2.75 0 0 0 0 5.5Z') + 'Capture screen</button>' +
            '<button id="fbw-upload" class="ghost" type="button">' + svg('M8 1.5 11 5H9v4H7V5H5l3-3.5ZM3 12h10v2H3v-2Z') + 'Add a screenshot</button>' +
            '<input id="fbw-file" type="file" accept="image/*" style="display:none" />' +
          '</div>' +
          '<div id="fbw-shot"></div>' +
          '<div class="note">Let us know if you have ideas that can help make this site better.' + help + '</div>' +
          '<input class="hp" tabindex="-1" autocomplete="off" id="fbw-hp" placeholder="Leave blank" />' +
          '<div class="err" id="fbw-err" style="display:none"></div>' +
        '</div>' +
        '<div class="foot"><button class="submit" type="button">Submit report</button></div>' +
      '</div>';
  }

  function renderShot() {
    var c = overlay && overlay.querySelector('#fbw-shot');
    if (!c) return;
    if (state.capturing) {
      c.innerHTML = '<div class="shot loading"><span class="spinner"></span>Capturing screenshot…</div>';
      return;
    }
    if (state.screenshot) {
      c.innerHTML = '<div class="shot"><img src="' + state.screenshot + '" alt="screenshot preview" />' +
        '<button class="remove" type="button" aria-label="Remove screenshot">' +
        svg('M4.3 4.3a1 1 0 0 1 1.4 0L8 6.6l2.3-2.3a1 1 0 1 1 1.4 1.4L9.4 8l2.3 2.3a1 1 0 0 1-1.4 1.4L8 9.4l-2.3 2.3a1 1 0 0 1-1.4-1.4L6.6 8 4.3 5.7a1 1 0 0 1 0-1.4Z') +
        '</button></div>';
      c.querySelector('.remove').addEventListener('click', function () { state.screenshot = null; renderShot(); });
    } else {
      c.innerHTML = '';
    }
  }

  function manualCapture() {
    if (state.capturing) return;
    state.capturing = true; renderShot();
    // close overlay visually so it isn't in the shot, then restore
    var prevVis = overlay.style.visibility;
    overlay.style.visibility = 'hidden';
    captureViewport().then(function (d) {
      overlay.style.visibility = prevVis;
      state.capturing = false;
      if (d) state.screenshot = d;
      renderShot();
    }).catch(function () {
      overlay.style.visibility = prevVis;
      state.capturing = false; renderShot();
    });
  }

  function onPaste(e) {
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image') === 0) {
        var f = items[i].getAsFile();
        if (f) { fileToDataUrl(f).then(function (d) { state.screenshot = d; renderShot(); }); e.preventDefault(); }
      }
    }
  }

  function onKey(e) { if (e.key === 'Escape') closeModal(); }

  function closeModal() {
    if (!overlay) return;
    document.removeEventListener('keydown', onKey);
    overlay.classList.remove('show');
    var o = overlay; overlay = null;
    setTimeout(function () { o.remove(); }, 160);
    state.screenshot = null; state.capturing = false;
  }

  // ---- submit ----------------------------------------------------------------
  function submit() {
    var msgEl = overlay.querySelector('#fbw-msg');
    var emailEl = overlay.querySelector('#fbw-email');
    var errEl = overlay.querySelector('#fbw-err');
    var btn = overlay.querySelector('.submit');
    var hp = overlay.querySelector('#fbw-hp');
    var message = (msgEl.value || '').trim();

    if (!message && !state.screenshot) {
      errEl.style.display = 'block';
      errEl.textContent = 'Add a short description or a screenshot first.';
      msgEl.focus();
      return;
    }
    errEl.style.display = 'none';
    btn.setAttribute('disabled', ''); btn.textContent = 'Sending…';

    var payload = {
      siteId: cfg.siteId,
      category: state.category,
      message: message,
      email: emailEl ? (emailEl.value || '').trim() : '',
      screenshot: state.screenshot,
      pageUrl: location.href,
      viewport: window.innerWidth + 'x' + window.innerHeight,
      screen: (window.screen ? window.screen.width + 'x' + window.screen.height : ''),
      hp: hp ? hp.value : '',
      meta: {
        language: navigator.language,
        platform: navigator.platform,
        referrer: document.referrer || null,
        title: document.title,
        devicePixelRatio: window.devicePixelRatio || 1,
        errors: errorBuffer.slice(-15)
      }
    };

    fetch(cfg.api + '/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.j && res.j.error || 'Could not send report');
        showSuccess();
      })
      .catch(function (e) {
        btn.removeAttribute('disabled'); btn.textContent = 'Submit report';
        errEl.style.display = 'block';
        errEl.textContent = e.message || 'Something went wrong. Please try again.';
      });
  }

  function showSuccess() {
    var modal = overlay.querySelector('.modal');
    modal.innerHTML =
      '<div class="head"><h2>' + escapeHtml(cfg.title) + '</h2>' +
        '<button class="icon-btn close" type="button" aria-label="Close">' +
        svg('M4.3 4.3a1 1 0 0 1 1.4 0L8 6.6l2.3-2.3a1 1 0 1 1 1.4 1.4L9.4 8l2.3 2.3a1 1 0 0 1-1.4 1.4L8 9.4l-2.3 2.3a1 1 0 0 1-1.4-1.4L6.6 8 4.3 5.7a1 1 0 0 1 0-1.4Z') + '</button></div>' +
      '<div class="success"><div class="check">' +
        svg('M13.5 4.5a1 1 0 0 1 0 1.4l-6 6a1 1 0 0 1-1.4 0l-3-3a1 1 0 1 1 1.4-1.4L7 9.6l5.1-5.1a1 1 0 0 1 1.4 0Z') +
      '</div><h3>Thanks for the report</h3><p>We\'ve received it and will take a look.</p></div>';
    modal.querySelector('.close').addEventListener('click', closeModal);
    setTimeout(closeModal, 2600);
  }

  // ---- utils -----------------------------------------------------------------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // ---- public API ------------------------------------------------------------
  window.FeedbackWidget = {
    open: function () { ready(function () { openFlow(null); }); },
    close: closeModal,
    capture: captureViewport,
    config: cfg
  };
})();
