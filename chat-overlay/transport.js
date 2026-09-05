(function () {
  const BASE_URL = window.location.origin;
  const UPLOAD_URL = window.location.origin + '/chat-upload';
  const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

  function requireSession(session) {
    if (!session || !session.token) throw new Error('Нет активной сессии чата.');
    if (Number(session.expiresAt || 0) && Number(session.expiresAt) <= Date.now() + 3000) {
      throw new Error('Сессия чата истекла. Откройте чат заново.');
    }
    return session;
  }

  function mediaUrl(fileId, driveSize) {
    const id = String(fileId || '');
    if (!id) return '';
    if (id.startsWith('s3:')) return BASE_URL + '/media/s3/' + encodeURIComponent(id.slice(3));
    if (id.startsWith('kv:') || id.startsWith('r2:')) return BASE_URL + '/media/' + encodeURIComponent(id.slice(3));
    return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=' + encodeURIComponent(driveSize || 'w1600');
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
          'X-File-Name': encodeURIComponent(String((file && file.name) || 'attachment')),
          'content-type': String((file && file.type) || 'application/octet-stream')
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
    if (file && Number(file.size || 0) > MAX_UPLOAD_BYTES) {
      const error = new Error('Размер файла не должен превышать 100 МБ.');
      error.code = 'FILE_TOO_LARGE';
      throw error;
    }
    const uploadId = makeUploadId();

    try {
      return await uploadAttempt(auth, phone, file, uploadId);
    } catch (error) {
      if (!error || error.code !== 'NETWORK') throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
      return uploadAttempt(auth, phone, file, uploadId);
    }
  }

  function injectVideoStyles() {
    if (document.getElementById('medsi-video-ui-style')) return;
    const style = document.createElement('style');
    style.id = 'medsi-video-ui-style';
    style.textContent = `
      #btnVideo{display:none!important}
      .medsi-video-frame{position:relative!important;overflow:hidden}
      .medsi-video-frame video{display:block;width:100%;height:auto;background:#dfeff0}
      .medsi-video-play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:68px;height:68px;border:0;border-radius:50%;background:#16bfc5;box-shadow:0 8px 24px rgba(0,79,84,.22);display:grid;place-items:center;cursor:pointer;z-index:3;padding:0}
      .medsi-video-play::before{content:'';display:block;margin-left:5px;width:0;height:0;border-top:14px solid transparent;border-bottom:14px solid transparent;border-left:22px solid #fff}
      .medsi-video-frame.is-playing .medsi-video-play{opacity:0;pointer-events:none}
      .medsi-video-play:focus-visible{outline:3px solid rgba(22,191,197,.35);outline-offset:3px}
    `;
    document.head.appendChild(style);
  }

  function repairS3Source(media) {
    const src = String(media.getAttribute('src') || '');
    if (!src || !src.includes('drive.google.com/thumbnail')) return;
    try {
      const url = new URL(src);
      const id = url.searchParams.get('id') || '';
      if (id.startsWith('s3:')) media.src = mediaUrl(id);
    } catch (_) {}
  }

  function enhanceVideo(video) {
    if (!video || video.dataset.medsiVideoEnhanced === '1') return;
    video.dataset.medsiVideoEnhanced = '1';
    repairS3Source(video);
    video.playsInline = true;
    video.preload = 'metadata';
    const frame = video.parentElement;
    if (!frame) return;
    frame.classList.add('medsi-video-frame');
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'medsi-video-play';
    play.setAttribute('aria-label', 'Воспроизвести видео');
    frame.appendChild(play);
    const sync = () => frame.classList.toggle('is-playing', !video.paused && !video.ended);
    video.addEventListener('play', sync);
    video.addEventListener('playing', sync);
    video.addEventListener('pause', sync);
    video.addEventListener('ended', sync);
    video.addEventListener('loadedmetadata', () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.paused) return;
      const target = Math.min(1, Math.max(0, video.duration - 0.05));
      if (target > 0.05 && video.currentTime < 0.05) {
        try { video.currentTime = target; } catch (_) {}
      }
    }, { once: true });
    play.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      try { await video.play(); } catch (_) {}
    });
    sync();
  }

  function enhanceMediaNode(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.matches && node.matches('img,video')) repairS3Source(node);
    if (node.matches && node.matches('video')) enhanceVideo(node);
    if (node.querySelectorAll) {
      node.querySelectorAll('img,video').forEach(repairS3Source);
      node.querySelectorAll('video').forEach(enhanceVideo);
    }
  }

  function videoFramePreview(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'metadata';
      const done = value => { URL.revokeObjectURL(url); resolve(value); };
      video.onerror = () => { URL.revokeObjectURL(url); reject(new Error('preview')); };
      video.onloadedmetadata = () => {
        const target = Math.min(1, Math.max(0, Number(video.duration || 0) - 0.05));
        if (target <= 0.05) {
          video.currentTime = 0;
        } else {
          try { video.currentTime = target; } catch (_) {}
        }
      };
      video.onseeked = () => {
        try {
          const canvas = document.createElement('canvas');
          const scale = Math.min(1, 720 / Math.max(1, video.videoWidth));
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
          done(canvas.toDataURL('image/jpeg', 0.82));
        } catch (error) { URL.revokeObjectURL(url); reject(error); }
      };
      video.src = url;
    });
  }

  function installMediaUi() {
    injectVideoStyles();
    document.querySelectorAll('img,video').forEach(repairS3Source);
    document.querySelectorAll('video').forEach(enhanceVideo);
    const observer = new MutationObserver(records => {
      records.forEach(record => record.addedNodes.forEach(enhanceMediaNode));
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('change', event => {
      const input = event.target;
      if (!input || input.tagName !== 'INPUT' || input.type !== 'file') return;
      const file = input.files && input.files[0];
      if (!file || !/^video\//i.test(file.type)) return;
      videoFramePreview(file).then(dataUrl => {
        const preview = document.querySelector('#chatImagePreview img, .chat-image-preview img');
        if (preview && !preview.closest('.hidden')) preview.src = dataUrl;
      }).catch(() => {});
    }, true);
  }

  window.MedsiOverlayTransport = {
    baseUrl: BASE_URL,
    maxUploadBytes: MAX_UPLOAD_BYTES,
    mediaUrl,
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

  installMediaUi();
})();
