(function () {
  const MAX_AGE_MS = 30000;
  const parentThreadCache = new Map();
  let educatorUnreadCache = null;
  let parentInflight = null;
  let educatorInflight = null;

  function phone10(value) {
    return String(value || '').replace(/\D+/g, '').slice(-10);
  }

  function fresh(entry) {
    return !!(entry && Date.now() - Number(entry.at || 0) <= MAX_AGE_MS);
  }

  function hasMessages(result) {
    return !!(result && Array.isArray(result.messages) && result.messages.length);
  }

  function transport() {
    return window.MedsiOverlayTransport || null;
  }

  async function preloadParent(state) {
    const t = transport();
    const session = state && state.session;
    const phone = phone10(state && state.phone);
    if (!t || !session || !session.token || !phone) return;

    const existing = parentThreadCache.get(phone);
    if (fresh(existing) && hasMessages(existing.result)) return existing.result;
    if (parentInflight && parentInflight.phone === phone) return parentInflight.promise;

    const promise = t._preloadOriginalThread(session, phone, '', 100)
      .then(result => {
        if (hasMessages(result)) parentThreadCache.set(phone, { at: Date.now(), result });
        else parentThreadCache.delete(phone);
        return result;
      })
      .catch(() => null)
      .finally(() => {
        if (parentInflight && parentInflight.promise === promise) parentInflight = null;
      });

    parentInflight = { phone, promise };
    return promise;
  }

  async function preloadEducator(state) {
    const t = transport();
    const session = state && state.session;
    if (!t || !session || !session.token) return;
    if (fresh(educatorUnreadCache)) return educatorUnreadCache.result;
    if (educatorInflight) return educatorInflight;

    const promise = t._preloadOriginalChats(session, 'unread')
      .then(result => {
        educatorUnreadCache = { at: Date.now(), result };
        return result;
      })
      .catch(() => null)
      .finally(() => {
        if (educatorInflight === promise) educatorInflight = null;
      });

    educatorInflight = promise;
    return promise;
  }

  function install() {
    const t = transport();
    if (!t || t._preloadInstalled) return;
    t._preloadInstalled = true;
    t._preloadOriginalThread = t.thread.bind(t);
    t._preloadOriginalChats = t.chats.bind(t);

    t.thread = function (session, phone, beforeKey, limit) {
      const key = phone10(phone);
      const entry = !beforeKey ? parentThreadCache.get(key) : null;
      if (fresh(entry) && hasMessages(entry.result)) {
        parentThreadCache.delete(key);
        return Promise.resolve(entry.result);
      }
      if (entry) parentThreadCache.delete(key);
      return t._preloadOriginalThread(session, phone, beforeKey, limit);
    };

    t.chats = function (session, bucket) {
      if (String(bucket || 'all') === 'unread' && fresh(educatorUnreadCache)) {
        const result = educatorUnreadCache.result;
        educatorUnreadCache = null;
        return Promise.resolve(result);
      }
      return t._preloadOriginalChats(session, bucket);
    };
  }

  install();
  window.MedsiOverlayPreload = { parent: preloadParent, educator: preloadEducator };
})();
