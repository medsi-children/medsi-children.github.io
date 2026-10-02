(() => {
  'use strict';

  // Change this one switch to hide the assistant without changing the parent panel.
  const ENABLED = true;
  if (!ENABLED || window.MedsiSmartBotWidget) return;

  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'medsi-bot-launcher';
  launcher.setAttribute('aria-label', 'Открыть Медси Бота');
  launcher.setAttribute('title', 'Задать вопрос Медси Боту');
  launcher.setAttribute('aria-haspopup', 'dialog');
  launcher.hidden = true;
  launcher.innerHTML = '<img src="/new/blob.png" alt=""><span class="medsi-bot-launcher-eyes" aria-hidden="true"><i></i><i></i></span>';
  document.body.appendChild(launcher);
  const hint = document.createElement('button');
  hint.type = 'button';
  hint.className = 'medsi-bot-hint';
  hint.textContent = 'Чем могу помочь?';
  hint.addEventListener('click', open);
  document.body.appendChild(hint);
  launcher.dataset.phase = 'created';

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
    if (!launcher.hidden) scheduleHint();
    if (launcher.hidden) {
      window.clearTimeout(hintTimer);
      hintTimer = 0;
      window.clearTimeout(hintHideTimer);
      hint.classList.remove('is-visible');
      hint.hidden = true;
    }
  }

  function setGaze(x, y) {
    launcher.style.setProperty('--bot-look-x', `${Math.max(-5, Math.min(5, x))}px`);
    launcher.style.setProperty('--bot-look-y', `${Math.max(-3, Math.min(3, y))}px`);
  }

  launcher.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') return;
    const bounds = launcher.getBoundingClientRect();
    setGaze((event.clientX - bounds.left - bounds.width / 2) * .18,
      (event.clientY - bounds.top - bounds.height / 2) * .13);
    pointerActiveUntil = Date.now() + 1600;
  }, { passive: true });
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.setInterval(() => {
      if (launcher.hidden || Date.now() < pointerActiveUntil) return;
      setGaze((Math.random() - .5) * 5, (Math.random() - .5) * 3);
    }, 2200);
  }
  launcher.dataset.phase = 'gaze';

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
    launcher.dataset.phase = 'clicked';
    if (overlay || document.body.dataset.screen !== 'screenChoose') return;
    launcher.dataset.phase = 'opening';
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
    launcher.dataset.phase = 'open';
    window.clearTimeout(hintHideTimer);
    hint.classList.remove('is-visible');
    hint.hidden = true;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    syncLauncher();
  }

  launcher.addEventListener('click', open);
  launcher.dataset.phase = 'click';
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
  launcher.dataset.phase = 'ready';
  window.MedsiSmartBotWidget = Object.freeze({ open, close: requestClose });
})();
