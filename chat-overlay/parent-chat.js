(function () {
  const REACTIONS = ['❤️','👍','👌','🙏','🥰','😁'];
  const threadCache = new Map();

  function cacheKey(phone) { return String(phone || '').replace(/\D+/g, '').slice(-10); }
  function getCachedThread(phone) { return threadCache.get(cacheKey(phone)) || null; }
  function setCachedThread(phone, rows) { threadCache.set(cacheKey(phone), { rows: Array.isArray(rows) ? rows : [], at: Date.now() }); }

  function formatTime(value) {
    const date = new Date(Number(value));
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
  }
  function mediaUrl(message) {
    const fileId = String(message && message.fileId || '');
    if (!fileId) return '';
    if (fileId.startsWith('kv:') || fileId.startsWith('r2:')) return window.MedsiOverlayTransport.baseUrl + '/media/' + encodeURIComponent(fileId.slice(3));
    return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w1200';
  }
  function replyLabel(reply) {
    if (!reply) return '';
    if (reply.text) return String(reply.text).slice(0, 120);
    if (reply.type === 'image') return 'Фотография';
    if (reply.type === 'video') return 'Видео';
    return 'Сообщение';
  }

  function mount(overlay, state) {
    const transport = window.MedsiOverlayTransport;
    const phone = String(state && state.phone || '');
    const session = state && state.session;
    if (!overlay || !transport || !phone || !session || !session.token) {
      if (overlay) overlay.showError('Не удалось получить данные родительского чата.');
      return;
    }

    overlay.body.replaceChildren();
    const shell = document.createElement('div'); shell.className = 'overlay-thread';
    const list = document.createElement('div'); list.className = 'overlay-thread__messages';

    const cached = getCachedThread(phone);
    const cachedHasMessages = !!(cached && Array.isArray(cached.rows) && cached.rows.length);
    if (!cachedHasMessages) {
      const loading = document.createElement('div'); loading.className = 'overlay-thread__loading'; loading.textContent = 'Загружаем сообщения…'; list.appendChild(loading);
    }

    const replyBar = document.createElement('div'); replyBar.className = 'overlay-reply-bar hidden';
    const replyText = document.createElement('span');
    const replyClose = document.createElement('button'); replyClose.type = 'button'; replyClose.textContent = '×';
    replyBar.append(replyText, replyClose);

    const composer = document.createElement('form'); composer.className = 'overlay-composer';
    const attach = document.createElement('button'); attach.type = 'button'; attach.className = 'overlay-composer__attach'; attach.textContent = '+'; attach.setAttribute('aria-label','Прикрепить фото или видео');
    const fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = 'image/*,video/*'; fileInput.hidden = true;
    const input = document.createElement('textarea'); input.className = 'overlay-composer__input'; input.rows = 1; input.placeholder = 'Сообщение…'; input.maxLength = 4000;
    const send = document.createElement('button'); send.type = 'submit'; send.className = 'overlay-composer__send'; send.textContent = '➤'; send.setAttribute('aria-label','Отправить');
    composer.append(attach, fileInput, input, send);
    shell.append(list, replyBar, composer); overlay.body.appendChild(shell);

    let messages = [];
    let sending = false;
    let replyTo = null;
    let disposed = false;

    function setReply(message) {
      replyTo = message || null;
      replyBar.classList.toggle('hidden', !replyTo);
      replyText.textContent = replyTo ? 'Ответ: ' + replyLabel(replyTo) : '';
      if (replyTo) input.focus();
    }
    replyClose.addEventListener('click', () => setReply(null));

    function actionButton(label, title, handler) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.title = title; button.addEventListener('click', event => { event.stopPropagation(); handler(); }); return button;
    }

    function createMessageNode(message) {
      const own = message && message.side === 'parent';
      const item = document.createElement('article'); item.className = 'overlay-msg ' + (own ? 'overlay-msg--own' : 'overlay-msg--other');
      const bubble = document.createElement('div'); bubble.className = 'overlay-msg__bubble';
      if (message && message.reply) {
        const quoted = document.createElement('div'); quoted.className = 'overlay-msg__reply'; quoted.textContent = replyLabel(message.reply); bubble.appendChild(quoted);
      }
      const url = mediaUrl(message);
      if (url) {
        const media = document.createElement(message.type === 'video' ? 'video' : 'img'); media.className = 'overlay-msg__media'; media.src = url; if (message.type === 'video') media.controls = true; bubble.appendChild(media);
      }
      if (message && message.text) { const body = document.createElement('div'); body.className = 'overlay-msg__text'; body.textContent = String(message.text); bubble.appendChild(body); }
      const meta = document.createElement('div'); meta.className = 'overlay-msg__meta'; meta.textContent = [message && message.reaction || '', formatTime(message && message.timestamp), message && message.editedAt ? 'изм.' : ''].filter(Boolean).join(' · '); bubble.appendChild(meta);
      item.appendChild(bubble);

      const actions = document.createElement('div'); actions.className = 'overlay-msg__actions';
      actions.appendChild(actionButton('↩', 'Ответить', () => setReply(message)));
      const reactions = document.createElement('span'); reactions.className = 'overlay-msg__reaction-set';
      REACTIONS.forEach(reaction => reactions.appendChild(actionButton(reaction, 'Реакция', async () => { try { await transport.react(session, message.messageKey, reaction); await refresh({preserveScroll:true}); } catch (error) { overlay.showError(error.message); } })));
      actions.appendChild(reactions);
      if (own && message.type === 'text') actions.appendChild(actionButton('✎','Редактировать', async () => {
        const next = window.prompt('Изменить сообщение', String(message.text || '')); if (next == null || !String(next).trim()) return;
        try { await transport.edit(session, 'parent', message.messageKey, String(next).trim()); await refresh({preserveScroll:true}); } catch (error) { overlay.showError(error.message); }
      }));
      if (own) actions.appendChild(actionButton('×','Удалить', async () => {
        if (!window.confirm('Удалить это сообщение?')) return;
        try { await transport.remove(session, 'parent', message.messageKey); await refresh({preserveScroll:true}); } catch (error) { overlay.showError(error.message); }
      }));
      item.appendChild(actions);
      return item;
    }

    function render(rows) {
      messages = Array.isArray(rows) ? rows : [];
      list.replaceChildren();
      if (!messages.length) { const empty = document.createElement('div'); empty.className = 'overlay-thread__empty'; empty.textContent = 'Здесь пока нет сообщений.'; list.appendChild(empty); }
      else messages.forEach(message => list.appendChild(createMessageNode(message)));
      requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
    }

    if (cachedHasMessages) render(cached.rows);

    async function refresh(options) {
      const preserveScroll = options && options.preserveScroll;
      const oldBottomGap = list.scrollHeight - list.scrollTop - list.clientHeight;
      try {
        const result = await transport.thread(session, phone, '', 100);
        if (disposed) return;
        const rows = result.messages || [];
        setCachedThread(phone, rows);
        render(rows);
        if (preserveScroll && oldBottomGap > 80) list.scrollTop = Math.max(0, list.scrollHeight - list.clientHeight - oldBottomGap);
        transport.markRead(session, 'parent', phone).catch(() => {});
      } catch (error) {
        if (!cachedHasMessages && !messages.length) overlay.showError((error && error.message) || 'Не удалось загрузить чат.');
      }
    }

    async function sendPayload(payload) {
      const result = await transport.sendMessage(session, 'parent', phone, payload);
      setReply(null);
      await refresh();
      return result;
    }

    composer.addEventListener('submit', async event => {
      event.preventDefault(); const value = String(input.value || '').trim(); if (!value || sending) return;
      sending = true; send.disabled = true; input.disabled = true; attach.disabled = true;
      try { await sendPayload({ type:'text', text:value, replyToKey:replyTo && replyTo.messageKey || '' }); input.value = ''; }
      catch (error) { overlay.showError((error && error.message) || 'Не удалось отправить сообщение.'); }
      finally { sending = false; send.disabled = false; input.disabled = false; attach.disabled = false; input.focus(); }
    });

    attach.addEventListener('click', () => { if (!sending) fileInput.click(); });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0]; fileInput.value = ''; if (!file || sending) return;
      sending = true; send.disabled = true; input.disabled = true; attach.disabled = true;
      try {
        const upload = await transport.upload(session, phone, file);
        await sendPayload({ type:upload.type || (file.type.startsWith('video/') ? 'video' : 'image'), text:String(input.value || '').trim(), fileId:upload.fileId, replyToKey:replyTo && replyTo.messageKey || '' });
        input.value = '';
      } catch (error) { overlay.showError((error && error.message) || 'Не удалось отправить файл.'); }
      finally { sending = false; send.disabled = false; input.disabled = false; attach.disabled = false; }
    });

    input.addEventListener('keydown', event => {
      const mobile = window.matchMedia('(max-width:560px),(hover:none) and (pointer:coarse)').matches;
      if (!mobile && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); composer.requestSubmit(); }
    });

    refresh({preserveScroll:cachedHasMessages});
    const timer = setInterval(() => { if (!disposed && overlay.getState()) refresh({preserveScroll:true}); }, 8000);
    return function cleanup() { disposed = true; clearInterval(timer); };
  }

  window.MedsiParentOverlayChat = { mount };
})();
