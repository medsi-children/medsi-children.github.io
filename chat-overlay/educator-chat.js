(function () {
  const listCache = new Map();
  const threadCache = new Map();

  function text(value) { return String(value == null ? '' : value); }
  function phone10(value) { return String(value || '').replace(/\D+/g, '').slice(-10); }
  function displayPhone(value) { const phone = phone10(value); return phone ? '8' + phone : ''; }
  function listKey(bucket) { return String(bucket || 'unread'); }
  function getCachedList(bucket) { return listCache.get(listKey(bucket)) || null; }
  function setCachedList(bucket, rows) { listCache.set(listKey(bucket), { rows: Array.isArray(rows) ? rows : [], at: Date.now() }); }
  function getCachedThread(phone) { return threadCache.get(phone10(phone)) || null; }
  function setCachedThread(phone, rows) { threadCache.set(phone10(phone), { rows: Array.isArray(rows) ? rows : [], at: Date.now() }); }

  function formatTime(value) {
    const date = new Date(Number(value));
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
  }
  function preview(chat) {
    if (!chat) return '';
    if (chat.lastType === 'image') return chat.lastText || 'Фотография';
    if (chat.lastType === 'video') return chat.lastText || 'Видео';
    return chat.lastText || 'Нет сообщений';
  }
  function mediaUrl(message) {
    const fileId = String(message && message.fileId || '');
    if (!fileId) return '';
    if (fileId.startsWith('kv:') || fileId.startsWith('r2:')) {
      return window.MedsiOverlayTransport.baseUrl + '/media/' + encodeURIComponent(fileId.slice(3));
    }
    return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w1200';
  }
  function messageNode(message) {
    const own = message && message.side === 'educator';
    const item = document.createElement('article');
    item.className = 'overlay-msg ' + (own ? 'overlay-msg--own' : 'overlay-msg--other');
    item.dataset.messageKey = text(message && message.messageKey);
    const bubble = document.createElement('div');
    bubble.className = 'overlay-msg__bubble';
    const url = mediaUrl(message);
    if (url) {
      const media = document.createElement(message.type === 'video' ? 'video' : 'img');
      media.className = 'overlay-msg__media';
      media.src = url;
      if (message.type === 'video') media.controls = true;
      bubble.appendChild(media);
    }
    if (message && message.text) {
      const body = document.createElement('div');
      body.className = 'overlay-msg__text';
      body.textContent = text(message.text);
      bubble.appendChild(body);
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
    const session = state && state.session;
    if (!overlay || !transport || !session || !session.token) {
      if (overlay) overlay.showError('Не удалось получить сессию воспитательского чата.');
      return;
    }

    overlay.body.replaceChildren();
    const shell = document.createElement('div'); shell.className = 'overlay-educator';
    const sidebar = document.createElement('section'); sidebar.className = 'overlay-chat-list';
    const tabs = document.createElement('div'); tabs.className = 'overlay-chat-list__tabs';
    const unreadBtn = document.createElement('button'); unreadBtn.type = 'button'; unreadBtn.textContent = 'Непрочитанные'; unreadBtn.className = 'active';
    const readBtn = document.createElement('button'); readBtn.type = 'button'; readBtn.textContent = 'Прочитанные';
    tabs.append(unreadBtn, readBtn);
    const list = document.createElement('div'); list.className = 'overlay-chat-list__items';
    sidebar.append(tabs, list);

    const threadPanel = document.createElement('section'); threadPanel.className = 'overlay-educator-thread empty';
    const threadHeader = document.createElement('div'); threadHeader.className = 'overlay-educator-thread__header';
    const mobileBack = document.createElement('button'); mobileBack.type = 'button'; mobileBack.className = 'overlay-educator-thread__back'; mobileBack.textContent = '‹';
    const threadNames = document.createElement('div');
    const threadTitle = document.createElement('strong');
    const threadSubtitle = document.createElement('span');
    threadNames.append(threadTitle, threadSubtitle);
    threadHeader.append(mobileBack, threadNames);
    const messages = document.createElement('div'); messages.className = 'overlay-thread__messages';
    const empty = document.createElement('div'); empty.className = 'overlay-thread__empty'; empty.textContent = 'Выберите чат с родителем.';
    messages.appendChild(empty);
    const composer = document.createElement('form'); composer.className = 'overlay-composer hidden';
    const input = document.createElement('textarea'); input.className = 'overlay-composer__input'; input.rows = 1; input.maxLength = 4000; input.placeholder = 'Сообщение…';
    const send = document.createElement('button'); send.className = 'overlay-composer__send'; send.type = 'submit'; send.textContent = '➤'; send.setAttribute('aria-label','Отправить');
    composer.append(input, send);
    threadPanel.append(threadHeader, messages, composer);
    shell.append(sidebar, threadPanel);
    overlay.body.appendChild(shell);

    let bucket = 'unread';
    let chats = [];
    let activeChat = null;
    let disposed = false;
    let loadingThread = false;
    let sending = false;

    function setSending(value) {
      sending = !!value;
      input.disabled = sending;
      send.disabled = sending;
      if (!sending) input.focus();
    }

    function showListLoading(label) {
      list.replaceChildren();
      const node = document.createElement('div'); node.className = 'overlay-chat-list__loading'; node.textContent = label || 'Загружаем чаты…'; list.appendChild(node);
    }
    function renderList() {
      list.replaceChildren();
      if (!chats.length) {
        const node = document.createElement('div'); node.className = 'overlay-chat-list__empty'; node.textContent = bucket === 'read' ? 'Прочитанных чатов пока нет.' : 'Непрочитанных чатов нет.'; list.appendChild(node); return;
      }
      chats.forEach(chat => {
        const card = document.createElement('button');
        card.type = 'button'; card.className = 'overlay-chat-card';
        if (activeChat && phone10(activeChat.phone) === phone10(chat.phone)) card.classList.add('active');
        const name = document.createElement('strong'); name.textContent = chat.childName || chat.parentName || displayPhone(chat.phone) || 'Родитель';
        const parent = document.createElement('span'); parent.className = 'overlay-chat-card__parent'; parent.textContent = chat.parentName || displayPhone(chat.phone) || '';
        const last = document.createElement('span'); last.className = 'overlay-chat-card__preview'; last.textContent = preview(chat);
        card.append(name, parent, last);
        card.addEventListener('click', () => openChat(chat));
        list.appendChild(card);
      });
    }
    async function loadChats(nextBucket, silent) {
      bucket = nextBucket || bucket;
      unreadBtn.classList.toggle('active', bucket === 'unread');
      readBtn.classList.toggle('active', bucket === 'read');

      const cached = getCachedList(bucket);
      if (cached && !silent) {
        chats = cached.rows;
        renderList();
      } else if (!silent) {
        showListLoading();
      }

      try {
        const result = await transport.chats(session, bucket);
        if (disposed) return;
        chats = Array.isArray(result.chats) ? result.chats : [];
        setCachedList(bucket, chats);
        renderList();
      } catch (error) {
        if (!cached && !silent) overlay.showError((error && error.message) || 'Не удалось загрузить список чатов.');
      }
    }
    function renderThread(result) {
      messages.replaceChildren();
      const rows = Array.isArray(result && result.messages) ? result.messages : [];
      if (!rows.length) {
        const node = document.createElement('div'); node.className = 'overlay-thread__empty'; node.textContent = 'Здесь пока нет сообщений.'; messages.appendChild(node);
      } else rows.forEach(row => messages.appendChild(messageNode(row)));
      requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; });
    }
    async function openChat(chat, silent) {
      if (!chat || !chat.phone || loadingThread) return;
      activeChat = chat;
      renderList();
      threadPanel.classList.remove('empty');
      shell.classList.add('thread-open');
      threadTitle.textContent = chat.childName || 'Чат с родителем';
      threadSubtitle.textContent = [chat.parentName, displayPhone(chat.phone)].filter(Boolean).join(' · ');
      composer.classList.remove('hidden');

      const cached = getCachedThread(chat.phone);
      if (cached && !silent) renderThread({messages:cached.rows});
      else if (!silent) {
        messages.replaceChildren(); const node = document.createElement('div'); node.className = 'overlay-thread__loading'; node.textContent = 'Загружаем сообщения…'; messages.appendChild(node);
      }

      loadingThread = true;
      try {
        const result = await transport.thread(session, chat.phone, '', 100);
        if (disposed || !activeChat || phone10(activeChat.phone) !== phone10(chat.phone)) return;
        setCachedThread(chat.phone, result.messages || []);
        renderThread(result);
        transport.markRead(session, 'educator', chat.phone).catch(() => {});
        if (bucket === 'unread') setTimeout(() => loadChats('unread', true), 250);
      } catch (error) {
        if (!cached) overlay.showError((error && error.message) || 'Не удалось открыть чат.');
      } finally { loadingThread = false; }
    }

    function refreshThreadInBackground(chat) {
      if (!chat || !chat.phone) return;
      const targetPhone = chat.phone;
      transport.thread(session, targetPhone, '', 100)
        .then(result => {
          if (disposed) return;
          const rows = Array.isArray(result && result.messages) ? result.messages : [];
          setCachedThread(targetPhone, rows);
          if (activeChat && phone10(activeChat.phone) === phone10(targetPhone)) renderThread({ messages: rows });
        })
        .catch(() => {});
    }

    composer.addEventListener('submit', async event => {
      event.preventDefault();
      if (!activeChat || sending) return;
      const value = String(input.value || '').trim();
      if (!value) return;

      const chatAtSend = activeChat;
      const cachedBefore = getCachedThread(chatAtSend.phone);
      const rowsBefore = cachedBefore && Array.isArray(cachedBefore.rows) ? cachedBefore.rows.slice() : [];
      const optimistic = {
        side:'educator',
        type:'text',
        text:value,
        timestamp:Date.now(),
        messageKey:'pending-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
      };

      setCachedThread(chatAtSend.phone, rowsBefore.concat(optimistic));
      renderThread({ messages: rowsBefore.concat(optimistic) });
      input.value = '';
      setSending(true);

      try {
        await transport.sendMessage(session, 'educator', chatAtSend.phone, { type:'text', text:value });

        // The server has now confirmed the write. From this point it is safe
        // to send another message or leave the app. Everything below is UI refresh only.
        setSending(false);
        refreshThreadInBackground(chatAtSend);
        loadChats(bucket, true);
      } catch (error) {
        setCachedThread(chatAtSend.phone, rowsBefore);
        if (activeChat && phone10(activeChat.phone) === phone10(chatAtSend.phone)) renderThread({ messages: rowsBefore });
        input.value = value;
        overlay.showError((error && error.message) || 'Не удалось отправить сообщение.');
        setSending(false);
      }
    });
    input.addEventListener('keydown', event => {
      const mobile = window.matchMedia('(max-width:560px),(hover:none) and (pointer:coarse)').matches;
      if (!mobile && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); composer.requestSubmit(); }
    });
    mobileBack.addEventListener('click', () => { shell.classList.remove('thread-open'); });
    unreadBtn.addEventListener('click', () => loadChats('unread'));
    readBtn.addEventListener('click', () => loadChats('read'));

    loadChats('unread');
    const timer = setInterval(() => {
      if (disposed || !overlay.getState()) return;
      loadChats(bucket, true);
      if (activeChat) openChat(activeChat, true);
    }, 9000);

    return function cleanup() { disposed = true; clearInterval(timer); };
  }

  window.MedsiEducatorOverlayChat = { mount };
})();
