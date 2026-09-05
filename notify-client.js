(function () {
  const PUSH_MESSAGE_TYPE = 'medsi:push-subscription';
  const IDENTITY_KEY = 'medsi_push_identity';
  const VAPID_PUBLIC_KEY = 'BOP6j6f_c1Rw_Zi-vyL3c6NpjmEKYqiISsQtCl7v8F3iV-XyNUnIqUYrppQKRHi6jnhMKTuKuF4HkPKziL8-cXE';
  const SERVICE_WORKER_URL = '/sw.js?v=20260629-panel2';
  const INTRO_VISIBLE_MS = 5000;
  const ENABLED_VISIBLE_MS = 5000;
  const STATUS_VISIBLE_MS = 3600;

  const state = {
    identity: loadIdentity(),
    button: null,
    status: null,
    frame: null,
    appEndpointUrl: '',
    pushServiceUrl: '',
    hideButtonTimer: null,
    hideStatusTimer: null,
    hasShownIntro: false,
    panelVisible: true
  };

  function onlyDigits(value) {
    return String(value || '').replace(/\D+/g, '');
  }

  function loadIdentity() {
    try {
      const raw = localStorage.getItem(IDENTITY_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveIdentity(identity) {
    const next = {
      role: String(identity && identity.role || '').trim(),
      phone: onlyDigits(identity && identity.phone || '')
    };

    if (!next.role) return;

    const hasChanged = !state.identity ||
      state.identity.role !== next.role ||
      state.identity.phone !== next.phone;

    state.identity = next;
    try { localStorage.setItem(IDENTITY_KEY, JSON.stringify(next)); }
    catch (e) {}

    // При каждом сообщении из вложенной панели раньше заново запускался
    // пятисекундный показ. Один и тот же пользователь получал второй всплывающий
    // контрол уже поверх открытого чата. Обновляем кнопку лишь при смене роли
    // или номера; первичная инициализация сама выполнит один показ ниже.
    if (hasChanged) updateButton({ reveal: true });
  }

  function clearIdentity() {
    state.identity = null;
    try { localStorage.removeItem(IDENTITY_KEY); }
    catch (e) {}
    hideButton();
  }

  function isSupported() {
    return !!(
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  }

  function isConfigured() {
    return !!VAPID_PUBLIC_KEY && VAPID_PUBLIC_KEY.indexOf('REPLACE_WITH_') !== 0;
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; i += 1) {
      outputArray[i] = rawData.charCodeAt(i);
    }

    return outputArray;
  }

  function sendSubscriptionToApp(subscription, targetWindow) {
    const target = targetWindow || (state.frame && state.frame.contentWindow);
    if (!state.identity) return;

    const message = {
      type: PUSH_MESSAGE_TYPE,
      action: 'save',
      role: state.identity.role,
      phone: state.identity.phone || '',
      subscription: subscription ? subscription.toJSON() : null,
      userAgent: navigator.userAgent || ''
    };

    if (target) target.postMessage(message, '*');
    sendPushRequestToServer(message);
  }

  function deleteSubscriptionInApp(subscription) {
    if (!subscription) return;

    const message = {
      type: PUSH_MESSAGE_TYPE,
      action: 'delete',
      endpoint: subscription.endpoint || ''
    };

    if (state.frame && state.frame.contentWindow) {
      state.frame.contentWindow.postMessage(message, '*');
    }
    sendPushRequestToServer(message);
  }

  function sendPushRequestToServer(message) {
    if (!message) return;

    if (state.pushServiceUrl && message.action === 'save') {
      sendPushRequest(state.pushServiceUrl + '/subscribe', {
        role: message.role,
        phone: message.phone,
        subscription: message.subscription,
        userAgent: message.userAgent
      });
    }

    if (state.pushServiceUrl && message.action === 'delete') {
      sendPushRequest(state.pushServiceUrl + '/unsubscribe', {
        endpoint: message.endpoint
      });
    }
  }

  function sendPushRequest(url, body) {
    try {
      fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'content-type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body || {}),
      }).catch(() => {});
    } catch (e) {}
  }

  async function getSubscription() {
    if (!isSupported()) return null;
    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL);
    return registration.pushManager.getSubscription();
  }

  async function subscribe() {
    if (!isSupported()) {
      setStatus('На этом устройстве уведомления недоступны.');
      return;
    }

    if (!isConfigured()) {
      setStatus('Уведомления подготовлены. Осталось добавить ключ Cloudflare.');
      return;
    }

    if (!state.identity || !state.identity.role) {
      setStatus('Сначала войдите в приложение.');
      return;
    }

    setStatus('Подключаем уведомления...');

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setStatus('Уведомления не включены.');
      updateButton();
      return;
    }

    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL);
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });

    sendSubscriptionToApp(subscription);
    setStatus('Уведомления включены.');
    updateButton({ reveal: true });
  }

  async function unsubscribe() {
    const subscription = await getSubscription();
    if (subscription) {
      deleteSubscriptionInApp(subscription);
      await subscription.unsubscribe();
    }

    setStatus('Уведомления отключены.');
    updateButton({ reveal: true });
  }

  function setStatus(text) {
    if (!state.status) return;
    if (state.hideStatusTimer) {
      clearTimeout(state.hideStatusTimer);
      state.hideStatusTimer = null;
    }

    state.status.textContent = text || '';
    state.status.classList.toggle('hidden', !text);

    if (text) {
      state.hideStatusTimer = setTimeout(() => {
        state.status.classList.add('hidden');
        state.hideStatusTimer = null;
      }, STATUS_VISIBLE_MS);
    }
  }

  function hideButton() {
    if (state.hideButtonTimer) {
      clearTimeout(state.hideButtonTimer);
      state.hideButtonTimer = null;
    }
    if (state.button) state.button.classList.add('hidden');
  }

  function revealButtonFor(ms) {
    if (!state.button) return;

    if (!state.panelVisible) {
      hideButton();
      return;
    }

    if (state.hideButtonTimer) {
      clearTimeout(state.hideButtonTimer);
      state.hideButtonTimer = null;
    }

    state.button.classList.remove('hidden');
    state.hideButtonTimer = setTimeout(() => {
      hideButton();
    }, ms);
  }

  async function updateButton(options) {
    if (!state.button) return;

    if (!state.panelVisible) {
      hideButton();
      return;
    }

    if (!isSupported()) {
      hideButton();
      return;
    }

    if (!state.identity || !state.identity.role) {
      hideButton();
      return;
    }

    let subscription = null;
    if (Notification.permission === 'granted') {
      try {
        subscription = await getSubscription();
      } catch (e) {
        subscription = null;
      }
    }

    if (subscription) {
      state.button.textContent = 'Отключить уведомления';
      state.button.disabled = false;

      sendSubscriptionToApp(subscription);

      if (options && options.reveal) revealButtonFor(ENABLED_VISIBLE_MS);
      return;
    }

    state.button.textContent = 'Включить уведомления';
    state.button.disabled = false;

    if ((options && options.reveal) || !state.hasShownIntro) {
      state.hasShownIntro = true;
      revealButtonFor(INTRO_VISIBLE_MS);
    }
  }

  function injectStyles() {
    if (document.getElementById('medsiPushStyles')) return;

    const style = document.createElement('style');
    style.id = 'medsiPushStyles';
    style.textContent = [
      '.medsi-push-panel{position:fixed;left:12px;right:12px;bottom:calc(5px + env(safe-area-inset-bottom));z-index:20;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none}',
      '.medsi-push-btn{pointer-events:auto;width:auto;min-width:0;max-width:240px;min-height:40px;padding:9px 14px;border-radius:999px;border:1px solid rgba(15,199,206,.34);background:rgba(255,255,255,.94);color:#0f8f98;font:700 14px/1.15 system-ui,-apple-system,Segoe UI,Roboto,Arial;box-shadow:0 12px 26px rgba(15,199,206,.18);backdrop-filter:blur(12px);opacity:1;transform:translateY(0);visibility:visible;transition:opacity .26s ease,transform .26s ease,visibility 0s linear 0s}',
      '.medsi-push-btn:disabled{opacity:.82}',
      '.medsi-push-status{max-width:min(320px,calc(100vw - 32px));padding:7px 10px;border-radius:12px;background:linear-gradient(135deg,rgba(36,211,218,.96),rgba(15,167,178,.96));color:#fff;font:700 12px/1.25 system-ui,-apple-system,Segoe UI,Roboto,Arial;text-align:center;box-shadow:0 10px 20px rgba(15,167,178,.24);opacity:1;transform:translateY(0);visibility:visible;transition:opacity .26s ease,transform .26s ease,visibility 0s linear 0s}',
      '.medsi-push-status.hidden,.medsi-push-btn.hidden{opacity:0;transform:translateY(8px);visibility:hidden;pointer-events:none;transition:opacity .26s ease,transform .26s ease,visibility 0s linear .26s}'
    ].join('');

    document.head.appendChild(style);
  }

  function parentFullName() {
    try {
      return String(localStorage.getItem('medsi_parent') || '').trim();
    } catch (e) {
      return '';
    }
  }

  function educatorThreadParentFirstName() {
    const header = document.getElementById('chatThreadHeader');
    const line = header && header.firstElementChild ? String(header.firstElementChild.textContent || '') : '';
    const full = line.replace(/^Родитель:\s*/i, '').trim();
    if (!full || full === '—') return '';
    return full.split(/\s+/)[0] || '';
  }

  function ensureAuthor(message, className, text) {
    if (!message) return;
    let author = message.querySelector(':scope > .' + className);
    if (!author) {
      author = document.createElement('div');
      author.className = className;
      message.insertBefore(author, message.firstChild);
    }
    author.textContent = text;
  }

  function refreshChatAuthorLabels() {
    const parentName = parentFullName() || 'Родитель';
    document.querySelectorAll('.parent-chat-msg.parent').forEach(message => {
      ensureAuthor(message, 'parent-chat-author', parentName);
    });
    document.querySelectorAll('.parent-chat-msg.educator').forEach(message => {
      ensureAuthor(message, 'parent-chat-author', 'Детское Отделение Медси');
    });

    const firstName = educatorThreadParentFirstName();
    document.querySelectorAll('.educator-exact-clone .msg.parent').forEach(message => {
      ensureAuthor(message, 'msg-author', firstName ? 'Родитель ' + firstName : 'Родитель');
    });
    document.querySelectorAll('.educator-exact-clone .msg.educator').forEach(message => {
      ensureAuthor(message, 'msg-author', 'Детское Отделение Медси');
    });
  }

  const authorLabelObserver = new MutationObserver(() => refreshChatAuthorLabels());
  authorLabelObserver.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refreshChatAuthorLabels, { once: true });
  } else {
    refreshChatAuthorLabels();
  }

  window.addEventListener('message', event => {
    const data = event.data || {};
    if (data.type !== PUSH_MESSAGE_TYPE || data.action !== 'get') return;

    getSubscription()
      .then(subscription => {
        if (subscription) sendSubscriptionToApp(subscription, event.source);
      })
      .catch(() => {});
  });

  function init(options) {
    state.frame = document.getElementById(options && options.frameId || 'appFrame');
    state.appEndpointUrl = String(options && options.appEndpointUrl || '').trim();
    state.pushServiceUrl = String(options && options.pushServiceUrl || '').replace(/\/+$/, '');
    injectStyles();

    const panel = document.createElement('div');
    panel.className = 'medsi-push-panel';

    state.status = document.createElement('div');
    state.status.className = 'medsi-push-status hidden';

    state.button = document.createElement('button');
    state.button.type = 'button';
    state.button.className = 'medsi-push-btn hidden';
    state.button.textContent = 'Включить уведомления';
    state.button.addEventListener('click', async () => {
      try {
        const subscription = await getSubscription();
        if (subscription) {
          await unsubscribe();
          return;
        }

        await subscribe();
      } catch (e) {
        setStatus('Не удалось изменить уведомления.');
      }
    });

    panel.appendChild(state.status);
    panel.appendChild(state.button);
    document.body.appendChild(panel);

    if (options && options.identity) saveIdentity(options.identity);
    updateButton({ reveal: true });
  }

  window.MedsiPush = {
    init,
    setIdentity: saveIdentity,
    clearIdentity,
    setPanelVisible: function (visible) {
      state.panelVisible = !!visible;
      if (!state.panelVisible) {
        setStatus('');
        hideButton();
        return;
      }
      updateButton({ reveal: true });
    },
    sendCurrentSubscription: async function () {
      const subscription = await getSubscription();
      if (subscription) sendSubscriptionToApp(subscription);
    }
  };
})();