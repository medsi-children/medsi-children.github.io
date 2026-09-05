(function () {
  const BASE_URL = 'https://medsi-chat-worker.medsi-children.workers.dev';
  const UPLOAD_URL = BASE_URL + '/lab/upload';

  function requireSession(session) {
    if (!session || !session.token) throw new Error('Нет активной сессии чата.');
    if (Number(session.expiresAt || 0) && Number(session.expiresAt) <= Date.now() + 3000) {
      throw new Error('Сессия чата истекла. Откройте чат заново.');
    }
    return session;
  }

  async function request(session, path, options) {
    const auth = requireSession(session);
    let response;
    try {
      response = await fetch(BASE_URL + path, {
        ...(options || {}),
        headers: {
          ...((options && options.headers) || {}),
          'X-Medsi-Chat-Session': auth.token
        }
      });
    } catch (error) {
      const wrapped = new Error((error && error.message) || 'Не удалось связаться с сервером чата.');
      wrapped.code = 'NETWORK';
      throw wrapped;
    }

    let payload;
    try { payload = await response.json(); }
    catch (_) {
      const error = new Error('Сервер чата вернул некорректный ответ.');
      error.code = 'BAD_RESPONSE';
      throw error;
    }

    if (!response.ok || !payload || !payload.ok) {
      const error = new Error((payload && payload.message) || 'Ошибка чата.');
      error.code = (payload && payload.code) || ('HTTP-' + response.status);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function thread(session, phone, beforeKey, limit) {
    const path = '/lab/threads/' + encodeURIComponent(String(phone || '')) +
      '?before=' + encodeURIComponent(String(beforeKey || '')) +
      '&limit=' + encodeURIComponent(String(limit || 50));
    return request(session, path);
  }

  function chats(session, bucket) {
    return request(session, '/lab/chats?bucket=' + encodeURIComponent(String(bucket || 'all')));
  }

  function parents(session) {
    return request(session, '/lab/parents');
  }

  function sendMessage(session, role, phone, message) {
    return request(session, '/lab/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...(message || {}), phone: String(phone || ''), side: String(role || '') })
    });
  }

  function markRead(session, role, phone) {
    const path = role === 'educator'
      ? '/lab/read/' + encodeURIComponent(String(phone || ''))
      : '/lab/read-parent/' + encodeURIComponent(String(phone || ''));
    return request(session, path, { method: 'POST' });
  }

  function markUnread(session, phone) {
    return request(session, '/lab/unread/' + encodeURIComponent(String(phone || '')), { method: 'POST' });
  }

  function react(session, key, reaction) {
    return request(session, '/lab/reaction/' + encodeURIComponent(String(key || '')), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reaction: String(reaction || '') })
    });
  }

  function edit(session, role, key, text) {
    return request(session, '/lab/edit/' + encodeURIComponent(String(key || '')), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actor: String(role || ''), text: String(text || '') })
    });
  }

  function remove(session, role, key) {
    return request(session, '/lab/delete/' + encodeURIComponent(String(key || '')), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actor: String(role || '') })
    });
  }

  function pin(session, phone, bucket) {
    return request(session, '/lab/pin/' + encodeURIComponent(String(phone || '')), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bucket: String(bucket || '') })
    });
  }

  function makeUploadId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2);
  }

  async function uploadAttempt(auth, phone, file, uploadId) {
    let response;
    try {
      response = await fetch(UPLOAD_URL, {
        method: 'POST',
        body: file,
        headers: {
          'X-Medsi-Upload-Id': uploadId,
          'X-Medsi-Chat-Session': auth.token,
          'X-Medsi-Phone': String(phone || ''),
          'X-File-Name': String((file && file.name) || 'attachment'),
          'content-type': String((file && file.type) || '')
        }
      });
    } catch (error) {
      const wrapped = new Error((error && error.message) || 'Не удалось загрузить файл.');
      wrapped.code = 'NETWORK';
      throw wrapped;
    }

    let payload;
    try { payload = await response.json(); }
    catch (_) {
      const error = new Error('Сервер загрузки вернул некорректный ответ.');
      error.code = 'BAD_RESPONSE';
      throw error;
    }

    if (!response.ok || !payload || !payload.ok) {
      const error = new Error((payload && payload.message) || 'Не удалось загрузить файл.');
      error.code = (payload && payload.code) || ('HTTP-' + response.status);
      error.status = response.status;
      throw error;
    }

    return { ...payload, url: BASE_URL + String(payload.url || '') };
  }

  async function upload(session, phone, file) {
    const auth = requireSession(session);
    const uploadId = makeUploadId();

    try {
      return await uploadAttempt(auth, phone, file, uploadId);
    } catch (error) {
      if (!error || error.code !== 'NETWORK') throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
      return uploadAttempt(auth, phone, file, uploadId);
    }
  }

  window.MedsiOverlayTransport = {
    baseUrl: BASE_URL,
    request,
    thread,
    chats,
    parents,
    sendMessage,
    markRead,
    markUnread,
    react,
    edit,
    remove,
    pin,
    upload
  };
})();