(function () {
  const MESSAGE_TYPE = 'medsi:chat-overlay';

  function allowedAppsScriptOrigin(origin) {
    if (origin === 'null') return true;
    if (origin === 'https://script.google.com') return true;
    if (origin === 'https://script.googleusercontent.com') return true;
    try { return /(^|\.)googleusercontent\.com$/.test(new URL(origin).hostname); }
    catch (_) { return false; }
  }

  function makeElement(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function create(options) {
    const opts = options || {};
    const frame = document.getElementById(opts.frameId || 'appFrame');
    let state = null;

    const root = makeElement('section', 'medsi-chat-overlay hidden');
    root.id = opts.overlayId || 'medsiChatOverlay';
    root.setAttribute('aria-hidden', 'true');

    const header = makeElement('header', 'medsi-chat-overlay__header');
    const back = makeElement('button', 'medsi-chat-overlay__back', '‹');
    back.type = 'button';
    back.setAttribute('aria-label', 'Назад');

    const titleWrap = makeElement('div', 'medsi-chat-overlay__title-wrap');
    const title = makeElement('h1', 'medsi-chat-overlay__title', opts.defaultTitle || 'Чат');
    const subtitle = makeElement('p', 'medsi-chat-overlay__subtitle', '');
    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);

    const spacer = makeElement('div', 'medsi-chat-overlay__header-spacer');
    header.appendChild(back);
    header.appendChild(titleWrap);
    header.appendChild(spacer);

    const body = makeElement('div', 'medsi-chat-overlay__body');
    const status = makeElement('div', 'medsi-chat-overlay__status');
    const statusTitle = makeElement('h2', 'medsi-chat-overlay__status-title', 'Подключаем чат…');
    const statusText = makeElement('p', 'medsi-chat-overlay__status-text', 'Получаем безопасную сессию из Медси Бота.');
    status.appendChild(statusTitle);
    status.appendChild(statusText);
    body.appendChild(status);

    const error = makeElement('div', 'medsi-chat-overlay__error hidden');
    root.appendChild(header);
    root.appendChild(error);
    root.appendChild(body);
    document.body.appendChild(root);

    function setVisible(visible) {
      root.classList.toggle('hidden', !visible);
      root.setAttribute('aria-hidden', visible ? 'false' : 'true');
      document.body.classList.toggle('medsi-chat-overlay-open', !!visible);
      if (window.MedsiPush && typeof window.MedsiPush.setPanelVisible === 'function') {
        window.MedsiPush.setPanelVisible(!visible);
      }
    }

    function showError(message) {
      error.textContent = String(message || 'Не удалось открыть чат.');
      error.classList.remove('hidden');
    }

    function clearError() {
      error.textContent = '';
      error.classList.add('hidden');
    }

    function close() {
      setVisible(false);
      state = null;
      clearError();
      body.replaceChildren(status);
      if (frame && frame.contentWindow) {
        frame.contentWindow.postMessage({ type: MESSAGE_TYPE, action: 'closed' }, '*');
      }
      if (typeof opts.onClose === 'function') opts.onClose();
    }

    function open(payload) {
      state = payload || {};
      clearError();
      title.textContent = state.role === 'educator'
        ? 'Чат с родителями'
        : 'Чат с воспитателями и психологами';
      subtitle.textContent = [state.parentName, state.childName].filter(Boolean).join(' · ');
      statusTitle.textContent = 'Подключаем чат…';
      statusText.textContent = 'Загружаем сообщения из Cloudflare D1.';
      setVisible(true);
      if (typeof opts.onOpen === 'function') opts.onOpen(state, api);
    }

    function handleMessage(event) {
      if (!allowedAppsScriptOrigin(event.origin)) return;
      const data = event.data || {};
      if (data.type !== MESSAGE_TYPE || data.action !== 'open') return;
      if (!data.role || !data.session || !data.session.token) {
        state = null;
        title.textContent = data.role === 'educator' ? 'Чат с родителями' : 'Чат';
        subtitle.textContent = '';
        body.replaceChildren(status);
        statusTitle.textContent = 'Чат не открылся';
        statusText.textContent = 'Не удалось получить безопасную сессию.';
        setVisible(true);
        showError(data.message || 'Apps Script не передал безопасную D1-сессию.');
        return;
      }
      open(data);
    }

    back.addEventListener('click', close);
    window.addEventListener('message', handleMessage);

    const api = {
      root,
      body,
      open,
      close,
      showError,
      clearError,
      getState: function () { return state; },
      messageType: MESSAGE_TYPE
    };

    return api;
  }

  window.MedsiChatOverlay = { create, messageType: MESSAGE_TYPE };
})();
