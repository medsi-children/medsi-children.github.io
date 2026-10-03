(() => {
  'use strict';

  // Change this one switch to hide the assistant without changing the parent panel.
  const ENABLED = true;
  if (!ENABLED || window.MedsiSmartBotWidget) return;

  const dock = document.createElement('div');
  dock.className = 'medsi-bot-dock';
  dock.hidden = true;
  document.body.appendChild(dock);
  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'medsi-bot-launcher';
  launcher.setAttribute('aria-label', 'Открыть Медси Бота');
  launcher.setAttribute('title', 'Задать вопрос Медси Боту');
  launcher.setAttribute('aria-haspopup', 'dialog');
  launcher.hidden = true;
  launcher.innerHTML = '<span class="medsi-bot-scale"><span class="medsi-character" aria-hidden="true"><span class="medsi-character-glow"></span><img class="medsi-character-body" src="/new/blob.png" alt=""><span class="medsi-character-eyes"><i class="medsi-character-eye"></i><i class="medsi-character-eye"></i></span></span></span>';
  const character = launcher.querySelector('.medsi-character');
  dock.appendChild(launcher);
  const hint = document.createElement('button');
  hint.type = 'button';
  hint.className = 'medsi-bot-hint';
  hint.textContent = 'Чем могу помочь?';
  hint.addEventListener('click', open);
  hint.hidden = true;
  dock.appendChild(hint);

  let overlay = null;
  let frame = null;
  let closing = false;
  let closeTimer = 0;
  let previousOverflow = '';
  let pointerActiveUntil = 0;
  let hintTimer = 0;
  let hintHideTimer = 0;
  let hintShown = false;

  function scheduleHint() {
    let alreadyShown = false;
    try { alreadyShown = sessionStorage.getItem('medsi-bot-hint-shown') === '1'; } catch (_) {}
    if (hintShown || alreadyShown || launcher.hidden || hintTimer) return;
    hintTimer = window.setTimeout(() => {
      hintTimer = 0;
      if (launcher.hidden || overlay) return;
      hintShown = true;
      try { sessionStorage.setItem('medsi-bot-hint-shown', '1'); } catch (_) {}
      hint.hidden = false;
      hint.classList.add('is-visible');
      hintHideTimer = window.setTimeout(() => {
        hint.classList.remove('is-visible');
        hint.hidden = true;
      }, 10000);
    }, 5000);
  }

  function syncLauncher() {
    launcher.hidden = document.body.dataset.screen !== 'screenChoose' || Boolean(overlay);
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
    overlay.remove();
    overlay = null;
    frame = null;
    closing = false;
    document.body.style.overflow = previousOverflow;
    syncLauncher();
    if (openEducators && document.body.dataset.screen === 'screenChoose') {
      document.getElementById('btnChat')?.click();
    } else {
      launcher.focus({ preventScroll: true });
    }
  }

  function requestClose() {
    if (!overlay || closing) return;
    closing = true;
    if (frame?.contentWindow) {
      frame.contentWindow.postMessage({ type: 'medsi-bot:close-request' }, location.origin);
    }
    closeTimer = window.setTimeout(() => finishClose(), 1800);
  }

  function open() {
    if (overlay || document.body.dataset.screen !== 'screenChoose') return;
    overlay = document.createElement('div');
    overlay.className = 'medsi-bot-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Чат с Медси Ботом');
    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'medsi-bot-backdrop';
    backdrop.setAttribute('aria-label', 'Закрыть чат с Медси Ботом');
    backdrop.addEventListener('click', requestClose);
    frame = document.createElement('iframe');
    frame.className = 'medsi-bot-frame';
    frame.title = 'Чат с Медси Ботом';
    frame.src = '/new.html?embedded=1';
    frame.addEventListener('load', () => frame?.focus());
    overlay.append(backdrop, frame);
    document.body.appendChild(overlay);
    window.clearTimeout(hintHideTimer);
    hint.classList.remove('is-visible');
    hint.hidden = true;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    syncLauncher();
  }

  launcher.addEventListener('click', open);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && overlay) { event.preventDefault(); requestClose(); }
  });
  window.addEventListener('message', event => {
    if (!frame || event.source !== frame.contentWindow || event.origin !== location.origin) return;
    if (event.data?.type === 'medsi-bot:closed') finishClose();
    if (event.data?.type === 'medsi-bot:open-educators') finishClose(true);
  });
  window.setInterval(() => {
    if (overlay && document.body.dataset.screen !== 'screenChoose') requestClose();
    syncLauncher();
  }, 300);
  syncLauncher();
  window.MedsiSmartBotWidget = Object.freeze({ open, close: requestClose });
})();
