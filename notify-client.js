(function () {
  const PUSH_MESSAGE_TYPE = 'medsi:push-subscription';
  const IDENTITY_KEY = 'medsi_push_identity';
  const VAPID_PUBLIC_KEY = 'BOP6j6f_c1Rw_Zi-vyL3c6NpjmEKYqiISsQtCl7v8F3iV-XyNUnIqUYrppQKRHi6jnhMKTuKuF4HkPKziL8-cXE';

  const state = {
    identity: loadIdentity(),
    button: null,
    status: null,
    frame: null
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
    updateButton();
  }

  function clearIdentity() {
    state.identity = null;
    try { localStorage.removeItem(IDENTITY_KEY); }
    catch (e) {}
    updateButton();
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
    updateButton();
  }

  function setStatus(text) {
    if (!state.status) return;
    state.status.textContent = text || '';
    state.status.classList.toggle('hidden', !text);
  }

  async function updateButton() {
    if (!state.button) return;

    if (!isSupported()) {
      state.button.classList.add('hidden');
      return;
    }

    if (!state.identity || !state.identity.role) {
      state.button.classList.add('hidden');
      return;
    }

    state.button.classList.remove('hidden');

    if (Notification.permission === 'granted') {
      state.button.textContent = 'Уведомления включены';
      state.button.disabled = true;

      try {
        const subscription = await getSubscription();
        if (subscription) sendSubscriptionToApp(subscription);
      } catch (e) {}

      return;
    }

    state.button.textContent = 'Включить уведомления';
    state.button.disabled = false;
  }

  function injectStyles() {
    if (document.getElementById('medsiPushStyles')) return;

    const style = document.createElement('style');
    style.id = 'medsiPushStyles';
    style.textContent = [
      '.medsi-push-panel{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:20;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none}',
      '.medsi-push-btn{pointer-events:auto;width:auto;min-width:0;max-width:240px;min-height:40px;padding:9px 14px;border-radius:999px;border:1px solid rgba(15,199,206,.34);background:rgba(255,255,255,.94);color:#0f8f98;font:700 14px/1.15 system-ui,-apple-system,Segoe UI,Roboto,Arial;box-shadow:0 12px 26px rgba(15,199,206,.18);backdrop-filter:blur(12px)}',
      '.medsi-push-btn:disabled{opacity:.82}',
      '.medsi-push-status{max-width:min(320px,calc(100vw - 32px));padding:7px 10px;border-radius:12px;background:rgba(17,66,74,.9);color:#fff;font:600 12px/1.25 system-ui,-apple-system,Segoe UI,Roboto,Arial;text-align:center;box-shadow:0 10px 20px rgba(17,66,74,.2)}',
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
      subscribe().catch(() => setStatus('Не удалось включить уведомления.'));
    });

    panel.appendChild(state.status);
    panel.appendChild(state.button);
    document.body.appendChild(panel);

    if (options && options.identity) saveIdentity(options.identity);
    updateButton();
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
