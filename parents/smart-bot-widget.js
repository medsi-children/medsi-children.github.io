(() => {
  'use strict';

  // Change this one switch to hide the assistant without changing the parent panel.
  const ENABLED = true;
  if (!ENABLED || window.MedsiSmartBotWidget) return;

  const dock = document.createElement('div');
  dock.className = 'medsi-bot-dock';
  dock.hidden = true;
  const logoSlot = document.getElementById('medsiAssistantLogo');
  if (logoSlot) dock.classList.add('medsi-bot-dock--brand');
  (logoSlot || document.body).appendChild(dock);
  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'medsi-bot-launcher';
  launcher.setAttribute('aria-label', 'Открыть Медси Бота');
  launcher.setAttribute('title', 'Задать вопрос Медси Боту');
  launcher.setAttribute('aria-haspopup', 'dialog');
  launcher.hidden = true;
  launcher.innerHTML = '<span class="medsi-bot-scale"><span class="medsi-character" aria-hidden="true"><span class="medsi-character-glow"></span><img class="medsi-character-body" src="/new/blob.webp" fetchpriority="high" alt=""><span class="medsi-character-eyes"><i class="medsi-character-eye"></i><i class="medsi-character-eye"></i></span></span></span>';
  const character = launcher.querySelector('.medsi-character');
  const bodyImage = launcher.querySelector('img');
  let assetReady = false;
  dock.appendChild(launcher);
  const hint = document.createElement('button');
  hint.type = 'button';
  hint.className = 'medsi-bot-hint';
  const hintTexts = ['Чем могу помочь?', 'Ваш ИИ помощник', 'Нажмите на меня'];
  hint.textContent = hintTexts[Math.floor(Math.random() * hintTexts.length)];
  hint.addEventListener('click', open);
  hint.hidden = true;
  dock.appendChild(hint);

  let overlay = null;
  let frame = null;
  let chat = null;
  let chatRoot = null;
  let closing = false;
  let closeTimer = 0;
  let previousOverflow = '';
  let pointerActiveUntil = 0;
  let hintTimer = 0;
  let hintHideTimer = 0;
  let hintShown = false;

  function scheduleHint() {
    if (hintShown || launcher.hidden || hintTimer) return;
    hintTimer = window.setTimeout(() => {
      hintTimer = 0;
      if (launcher.hidden || overlay) return;
      hintShown = true;
      hint.hidden = false;
      hint.classList.add('is-visible');
      hintHideTimer = window.setTimeout(() => {
        hint.classList.remove('is-visible');
        hint.hidden = true;
      }, 10000);
    }, 5000);
  }

  function syncLauncher() {
    launcher.hidden = !assetReady || document.body.dataset.screen !== 'screenChoose' || Boolean(overlay);
    dock.hidden = launcher.hidden;
    if (!launcher.hidden) scheduleHint();
    if (launcher.hidden) {
      window.clearTimeout(hintTimer);
      hintTimer = 0;
      window.clearTimeout(hintHideTimer);
      hint.classList.remove('is-visible');
      hint.hidden = true;
    }
  }

  // Same gaze bounds and proportions as the large character in /new.
  function setGaze(x, y) {
    const size = 238;
    character.style.setProperty('--gaze-x', `${Math.max(-size * .055, Math.min(size * .055, x - size * .055))}px`);
    character.style.setProperty('--gaze-y', `${Math.max(-size * .065, Math.min(size * .055, y + size * .025))}px`);
  }
  launcher.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') return;
    const bounds = launcher.getBoundingClientRect();
    setGaze(Math.max(-23.8, Math.min(23.8, (event.clientX - bounds.left - bounds.width / 2) / bounds.width * 59.5)),
      Math.max(-19.04, Math.min(19.04, (event.clientY - bounds.top - bounds.height / 2) / bounds.height * 59.5)));
    pointerActiveUntil = Date.now() + 1600;
  }, { passive: true });
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.setInterval(() => {
      if (launcher.hidden || Date.now() < pointerActiveUntil) return;
      setGaze(238 * (.025 + (Math.random() - .5) * .09), 238 * (-.04 + (Math.random() - .5) * .07));
    }, 2200);
  }
  setGaze(238 * .10, 238 * -.08);

  function finishClose(openEducators = false) {
    if (!overlay) return;
    window.clearTimeout(closeTimer);
    chat?.destroy();
    chat = null;
    frame.hidden = true;
    document.body.appendChild(frame);
    overlay.remove();
    overlay = null;
    closing = false;
    document.body.style.overflow = previousOverflow;
    syncLauncher();
    if (openEducators && document.body.dataset.screen === 'screenChoose') {
      document.getElementById('btnChat')?.click();
    } else {
      launcher.focus({ preventScroll: true });
    }
  }

  async function requestClose() {
    if (!overlay || closing) return;
    closing = true;
    closeTimer = window.setTimeout(() => finishClose(), 1800);
    try { await chat?.flush(); } finally { finishClose(); }
  }

  let opening = false;
  async function open() {
    if (opening || overlay || !assetReady || document.body.dataset.screen !== 'screenChoose') return;
    opening = true;
    launcher.setAttribute('aria-busy', 'true');
    try { await chatReady; } catch (_) {
      chatReady = prepareChat();
      try { await chatReady; } catch (_) { opening = false; launcher.removeAttribute('aria-busy'); return; }
    }
    opening = false;
    launcher.removeAttribute('aria-busy');
    if (overlay || document.body.dataset.screen !== 'screenChoose') return;
    overlay = document.createElement('div');
    overlay.className = 'medsi-bot-overlay is-preparing';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Чат с Медси Ботом');
    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'medsi-bot-backdrop';
    backdrop.setAttribute('aria-label', 'Закрыть чат с Медси Ботом');
    backdrop.addEventListener('click', requestClose);
    chatRoot.querySelector('.assistant-lab')?.remove();
    const view = document.createElement('template');
    view.innerHTML = window.MedsiBotChatView;
    chatRoot.appendChild(view.content.cloneNode(true));
    overlay.append(backdrop, frame);
    syncOverlayViewport();
    document.body.appendChild(overlay);
    frame.hidden = false;
    chat = window.MedsiBotChat.mount(chatRoot, {
      close: () => finishClose(),
      openEducators: () => finishClose(true)
    });
    window.clearTimeout(hintHideTimer);
    hint.classList.remove('is-visible');
    hint.hidden = true;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    syncLauncher();
    frame.getBoundingClientRect();
    const openingOverlay = overlay;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (overlay !== openingOverlay) return;
      overlay.classList.remove('is-preparing');
      overlay.classList.add('is-open');
    }));
  }

  // iOS keeps the layout viewport tall when the keyboard opens. Fit the
  // dialog to the visible viewport so its composer stays above the keyboard.
  function syncOverlayViewport() {
    if (!overlay) return;
    const viewport = window.visualViewport;
    overlay.style.top = `${viewport?.offsetTop || 0}px`;
    overlay.style.left = `${viewport?.offsetLeft || 0}px`;
    overlay.style.right = 'auto';
    overlay.style.bottom = 'auto';
    overlay.style.width = `${viewport?.width || window.innerWidth}px`;
    overlay.style.height = `${viewport?.height || window.innerHeight}px`;
  }
  window.visualViewport?.addEventListener('resize', syncOverlayViewport);
  window.visualViewport?.addEventListener('scroll', syncOverlayViewport);
  window.addEventListener('resize', syncOverlayViewport);

  new MutationObserver(syncLauncher).observe(document.body, { attributes: true, attributeFilter: ['data-screen'] });
  launcher.addEventListener('click', open);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && overlay) { event.preventDefault(); requestClose(); }
  });
  window.setInterval(() => {
    if (overlay && document.body.dataset.screen !== 'screenChoose') requestClose();
    syncLauncher();
  }, 300);
  function script(src) {
    return new Promise((resolve, reject) => {
      const node = document.createElement('script');
      node.src = src; node.onload = resolve; node.onerror = () => { node.remove(); reject(new Error('BOT_ASSET_UNAVAILABLE')); };
      document.head.appendChild(node);
    });
  }
  async function prepareChat() {
    if (frame) frame.remove();
    await Promise.all([
      window.MedsiSmartBot ? Promise.resolve() : script('/parents/smart-bot.js?v=20261002-15'),
      window.MedsiPsychologyFormatter ? Promise.resolve() : script('/parents/psychology-format.js?v=20260909-leading-dot-1'),
      script('/parents/bot-chat-view.js?v=20261003-3'),
      script('/new/app.js?v=20261003-5')
    ]);
    frame = document.createElement('section');
    frame.className = 'medsi-bot-frame';
    frame.hidden = true;
    chatRoot = frame.attachShadow({ mode: 'open' });
    const styleReady = ['/new/style.css?v=20261002-16', '/parents/psychology-format.css?v=20260905-production', '/parents/bot-character.css?v=20261003-1'].map(href => new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = href; link.onload = resolve; link.onerror = reject;
      chatRoot.appendChild(link);
    }));
    const style = document.createElement('style');
    style.textContent = ':host{display:block;font:16px Manrope,system-ui,sans-serif;-webkit-text-size-adjust:100%;text-size-adjust:100%;color:#264d51;overflow:hidden} .assistant-lab{display:block;width:100%;height:100%;min-height:0;margin:0;padding:0}.bot-stage{display:none}.help-panel{width:100%;height:100%;min-height:0;max-height:none;border:0;border-radius:0;box-shadow:none;background:#fff;backdrop-filter:none}.conversation{min-height:0}.composer{margin-bottom:calc(16px + env(safe-area-inset-bottom))}.composer input{font-size:16px}';
    chatRoot.appendChild(style);
    const template = document.createElement('template');
    template.innerHTML = window.MedsiBotChatView;
    chatRoot.appendChild(template.content.cloneNode(true));
    document.body.appendChild(frame);
    await Promise.all(styleReady);
  }
  // Preload the chat independently; the menu logo only waits for image decoding.
  let chatReady = prepareChat();
  chatReady.catch(() => {});
  const visualReady = bodyImage.decode().then(() => { assetReady = true; syncLauncher(); }).catch(() => {});
  syncLauncher();
  window.MedsiSmartBotWidget = Object.freeze({ open, close: requestClose, ready: visualReady });
})();
