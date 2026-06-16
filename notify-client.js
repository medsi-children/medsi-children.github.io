(function () {
  const PUSH_MESSAGE_TYPE = 'medsi:push-subscription';
  const IDENTITY_KEY = 'medsi_push_identity';
  const VAPID_PUBLIC_KEY = 'BOP6j6f_c1Rw_Zi-vyL3c6NpjmEKYqiISsQtCl7v8F3iV-XyNUnIqUYrppQKRHi6jnhMKTuKuF4HkPKziL8-cXE';
  const INTRO_VISIBLE_MS = 15000;
  const ENABLED_VISIBLE_MS = 5000;
  const STATUS_VISIBLE_MS = 3600;

  const state = {
    identity: loadIdentity(),
    button: null,
    status: null,
    frame: null,
    hideButtonTimer: null,
    hideStatusTimer: null,
    hasShownIntro: false
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

    state.identity = next;
    try { localStorage.setItem(IDENTITY_KEY, JSON.stringify(next)); }
    catch (e) {}
    updateButton({ reveal: true });
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

  function sendSubscriptionToApp(subscription) {
    if (!state.frame || !state.frame.contentWindow || !state.identity) return;

    state.frame.contentWindow.postMessage({
      type: PUSH_MESSAGE_TYPE,
      action: 'save',
      role: state.identity.role,
      phone: state.identity.phone || '',
      subscription: subscription ? subscription.toJSON() : null,
      userAgent: navigator.userAgent || ''
    }, '*');
  }

  function deleteSubscriptionInApp(subscription) {
    if (!state.frame || !state.frame.contentWindow || !subscription) return;

    state.frame.contentWindow.postMessage({
      type: PUSH_MESSAGE_TYPE,
      action: 'delete',
      endpoint: subscription.endpoint || ''
    }, '*');
  }

  async function getSubscription() {
    if (!isSupported()) return null;
    const registration = await navigator.serviceWorker.register('/sw.js');
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

    const registration = await navigator.serviceWorker.register('/sw.js');
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

    if (!isSupported()) {
      hideButton();
      return;
    }

    if (!state.identity || !state.identity.role) {
      hideButton();
      return;
    }

    if (Notification.permission === 'granted') {
      state.button.textContent = 'Отключить уведомления';
      state.button.disabled = false;

      try {
        const subscription = await getSubscription();
        if (subscription) sendSubscriptionToApp(subscription);
      } catch (e) {}

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
      '.medsi-push-panel{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:20;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none}',
      '.medsi-push-btn{pointer-events:auto;width:auto;min-width:0;max-width:240px;min-height:40px;padding:9px 14px;border-radius:999px;border:1px solid rgba(15,199,206,.34);background:rgba(255,255,255,.94);color:#0f8f98;font:700 14px/1.15 system-ui,-apple-system,Segoe UI,Roboto,Arial;box-shadow:0 12px 26px rgba(15,199,206,.18);backdrop-filter:blur(12px)}',
      '.medsi-push-btn:disabled{opacity:.82}',
      '.medsi-push-status{max-width:min(320px,calc(100vw - 32px));padding:7px 10px;border-radius:12px;background:linear-gradient(135deg,rgba(36,211,218,.96),rgba(15,167,178,.96));color:#fff;font:700 12px/1.25 system-ui,-apple-system,Segoe UI,Roboto,Arial;text-align:center;box-shadow:0 10px 20px rgba(15,167,178,.24)}',
      '.medsi-push-status.hidden,.medsi-push-btn.hidden{display:none}'
    ].join('');

    document.head.appendChild(style);
  }

  function init(options) {
    state.frame = document.getElementById(options && options.frameId || 'appFrame');
    injectStyles();

    const panel = document.createElement('div');
    panel.className = 'medsi-push-panel';

    state.status = document.createElement('div');
    state.status.className = 'medsi-push-status hidden';

    state.button = document.createElement('button');
    state.button.type = 'button';
    state.button.className = 'medsi-push-btn hidden';
    state.button.textContent = 'Включить уведомления';
    state.button.addEventListener('click', () => {
      if (Notification.permission === 'granted') {
        unsubscribe().catch(() => setStatus('Не удалось отключить уведомления.'));
        return;
      }

      subscribe().catch(() => setStatus('Не удалось включить уведомления.'));
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
    sendCurrentSubscription: async function () {
      const subscription = await getSubscription();
      if (subscription) sendSubscriptionToApp(subscription);
    }
  };
})();
