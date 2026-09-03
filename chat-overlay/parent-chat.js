(function () {
  function escapeText(value) {
    return String(value == null ? '' : value);
  }

  function formatTime(value) {
    const date = new Date(Number(value));
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  function createMessageNode(message) {
    const item = document.createElement('article');
    const own = message && message.side === 'parent';
    item.className = 'overlay-msg ' + (own ? 'overlay-msg--own' : 'overlay-msg--other');
    item.dataset.messageKey = String(message && message.messageKey || '');

    const bubble = document.createElement('div');
    bubble.className = 'overlay-msg__bubble';

    if (message && message.type !== 'text' && message.fileId) {
      const media = document.createElement(message.type === 'video' ? 'video' : 'img');
      media.className = 'overlay-msg__media';
      if (message.type === 'video') media.controls = true;
      const fileId = String(message.fileId || '');
      media.src = fileId.startsWith('kv:') || fileId.startsWith('r2:')
        ? window.MedsiOverlayTransport.baseUrl + '/media/' + encodeURIComponent(fileId.slice(3))
        : 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w1200';
      bubble.appendChild(media);
    }

    if (message && message.text) {
      const text = document.createElement('div');
      text.className = 'overlay-msg__text';
      text.textContent = escapeText(message.text);
      bubble.appendChild(text);
    }

    const meta = document.createElement('div');
    meta.className = 'overlay-msg__meta';
    meta.textContent = formatTime(message && message.timestamp);
    bubble.appendChild(meta);
    item.appendChild(bubble);
    return item;
  }

  function mount(overlay, state) {
    const transport = window.MedsiOverlayTransport;
    if (!overlay || !transport) throw new Error('Overlay transport is not ready.');

    const phone = String(state && state.phone || '');
    const session = state && state.session;
    if (!phone || !session || !session.token) {
      overlay.showError('Не удалось получить данные родительского чата.');
      return;
    }

    overlay.body.replaceChildren();

    const shell = document.createElement('div');
    shell.className = 'overlay-thread';
    const list = document.createElement('div');
    list.className = 'overlay-thread__messages';
    const loading = document.createElement('div');
    loading.className = 'overlay-thread__loading';
    loading.textContent = 'Загружаем сообщения…';
    list.appendChild(loading);

    const composer = document.createElement('form');
    composer.className = 'overlay-composer';
    const input = document.createElement('textarea');
    input.className = 'overlay-composer__input';
    input.rows = 1;
    input.placeholder = 'Сообщение…';
    input.maxLength = 4000;
    const send = document.createElement('button');
    send.type = 'submit';
    send.className = 'overlay-composer__send';
    send.textContent = '➤';
    send.setAttribute('aria-label', 'Отправить');
    composer.appendChild(input);
    composer.appendChild(send);

    shell.appendChild(list);
    shell.appendChild(composer);
    overlay.body.appendChild(shell);

    let latestMessages = [];
    let sending = false;

    function scrollBottom() {
      requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
    }

    function render(messages) {
      latestMessages = Array.isArray(messages) ? messages : [];
      list.replaceChildren();
      if (!latestMessages.length) {
        const empty = document.createElement('div');
        empty.className = 'overlay-thread__empty';
        empty.textContent = 'Здесь пока нет сообщений.';
        list.appendChild(empty);
      } else {
        latestMessages.forEach(message => list.appendChild(createMessageNode(message)));
      }
      scrollBottom();
    }

    async function refresh(options) {
      const preserveScroll = options && options.preserveScroll;
      const oldBottomGap = list.scrollHeight - list.scrollTop - list.clientHeight;
      try {
        const result = await transport.thread(session, phone, '', 100);
        render(result.messages || []);
        if (preserveScroll && oldBottomGap > 80) list.scrollTop = Math.max(0, list.scrollHeight - list.clientHeight - oldBottomGap);
        transport.markRead(session, 'parent', phone).catch(() => {});
      } catch (error) {
        overlay.showError((error && error.message) || 'Не удалось загрузить чат.');
      }
    }

    composer.addEventListener('submit', async event => {
      event.preventDefault();
      const text = String(input.value || '').trim();
      if (!text || sending) return;
      sending = true;
      send.disabled = true;
      input.disabled = true;
      try {
        await transport.sendMessage(session, 'parent', phone, { type: 'text', text });
        input.value = '';
        await refresh();
      } catch (error) {
        overlay.showError((error && error.message) || 'Не удалось отправить сообщение.');
      } finally {
        sending = false;
        send.disabled = false;
        input.disabled = false;
        input.focus();
      }
    });

    input.addEventListener('keydown', event => {
      const mobile = window.matchMedia('(max-width:560px),(hover:none) and (pointer:coarse)').matches;
      if (!mobile && event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        composer.requestSubmit();
      }
    });

    refresh();
    const refreshTimer = setInterval(() => {
      if (!overlay.getState()) return;
      refresh({ preserveScroll: true });
    }, 8000);

    return function cleanup() { clearInterval(refreshTimer); };
  }

  window.MedsiParentOverlayChat = { mount };
})();
