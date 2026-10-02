(() => {
  'use strict';
  const form = document.getElementById('accessForm');
  const keyInput = document.getElementById('accessKey');
  const status = document.getElementById('status');
  const view = document.getElementById('logView');
  const sessions = document.getElementById('sessions');
  const more = document.getElementById('loadMore');
  const refresh = document.getElementById('refresh');
  let key = '';
  let cursor = '';
  let records = [];
  let loading = false;
  const date = at => new Intl.DateTimeFormat('ru', {
    timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(new Date(at));

  if (location.origin !== new URL('https://медси-бот.рф').origin) {
    status.textContent = 'Журнал доступен только на основном адресе Медси Бота.';
    form.hidden = true;
    return;
  }

  function render() {
    sessions.replaceChildren();
    const groups = new Map();
    records.forEach(record => {
      if (!record || !Array.isArray(record.entries) || !record.sessionId) return;
      if (!groups.has(record.sessionId)) groups.set(record.sessionId, []);
      groups.get(record.sessionId).push(record);
    });
    const sorted = [...groups.values()].sort((a, b) => Math.max(...b.map(item => item.at)) - Math.max(...a.map(item => item.at)));
    sorted.forEach((events, index) => {
      events.sort((a, b) => a.at - b.at);
      const card = document.createElement('details');
      card.className = 'session-card';
      card.open = index === 0;
      const heading = document.createElement('summary');
      heading.textContent = `Диалог ${index + 1} · ${date(events[0].at)}`;
      const messages = document.createElement('div');
      messages.className = 'session-messages';
      events.forEach(event => event.entries.forEach(entry => {
        const item = document.createElement('div');
        item.className = `log-message ${entry.side === 'user' ? 'user' : 'bot'}`;
        const label = document.createElement('strong');
        label.textContent = entry.side === 'user' ? 'Родитель' : 'Медси Бот';
        item.appendChild(label);
        if (entry.text.length > 2000) {
          const folded = document.createElement('details');
          folded.className = 'long-text';
          const summary = document.createElement('summary');
          summary.textContent = `${entry.text.slice(0, 160)}… · Развернуть полный текст`;
          const full = document.createElement('p');
          full.textContent = entry.text;
          folded.append(summary, full);
          item.appendChild(folded);
        } else {
          const text = document.createElement('p');
          text.textContent = entry.text;
          item.appendChild(text);
        }
        messages.appendChild(item);
      }));
      card.append(heading, messages);
      sessions.appendChild(card);
    });
    if (!sorted.length) status.textContent = 'Диалогов пока нет.';
  }

  async function load(reset = false) {
    if (loading) return;
    loading = true;
    status.textContent = 'Загружаем диалоги…';
    if (reset) { cursor = ''; records = []; }
    try {
      const path = '/__bot-log-view' + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : '');
      const response = await fetch(path, { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' });
      if (response.status === 401) throw new Error('Неверный ключ доступа.');
      if (!response.ok) throw new Error('Не получилось загрузить журнал. Попробуйте позже.');
      const result = await response.json();
      const seen = new Set(records.map(record => record.eventId));
      (result.records || []).forEach(record => {
        if (!record.eventId || !seen.has(record.eventId)) records.push(record);
        if (record.eventId) seen.add(record.eventId);
      });
      cursor = result.cursor || '';
      more.hidden = !cursor;
      form.hidden = true;
      keyInput.value = '';
      view.hidden = false;
      status.textContent = '';
      render();
    } catch (error) {
      status.textContent = error.message || 'Не получилось загрузить журнал.';
      if (responseIsUnauthorized(error)) { key = ''; keyInput.value = ''; form.hidden = false; view.hidden = true; }
    } finally { loading = false; }
  }

  function responseIsUnauthorized(error) { return error && error.message === 'Неверный ключ доступа.'; }

  form.addEventListener('submit', event => {
    event.preventDefault();
    key = keyInput.value.trim();
    if (key) void load(true);
  });
  refresh.addEventListener('click', () => { void load(true); });
  more.addEventListener('click', () => { void load(); });
})();
