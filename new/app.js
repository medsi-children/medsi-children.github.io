(() => {
  'use strict';

  function mount(root = document, callbacks = {}) {
  let destroyed = false;
  const lifecycle = new AbortController();
  const timers = new Set();
  const later = (fn, delay) => {
    if (destroyed) return 0;
    const id = window.setTimeout(() => { timers.delete(id); if (!destroyed) fn(); }, delay);
    timers.add(id); return id;
  };
  const every = (fn, delay) => { const id = window.setInterval(fn, delay); timers.add(id); return id; };
  const listen = (target, name, fn, options = {}) => target.addEventListener(name, fn, {...options, signal:lifecycle.signal});

  // Лаборатория не отправляет сообщения воспитателям. Отчёты читает только через
  // существующую защищённую родительскую сессию на основном домене.
  const conversation = root.getElementById('conversation');
  const composer = root.getElementById('composer');
  const backButton = root.getElementById('botBack');
  const promptStrip = root.getElementById('promptStrip');
  const input = root.getElementById('messageInput');
  const bot = root.getElementById('bot');
  const botEyes = root.getElementById('botEyes');
  const EMOJI_BASE = '/chat-overlay/assets/twemoji/';
  const logLink = root.getElementById('botLogLink');
  const embedded = document.documentElement.dataset.embedded === '1' && window.parent !== window;
  if (logLink && new URLSearchParams(location.search).has('logs')) logLink.hidden = false;
  const IS_PRIMARY_HOST = location.origin === new URL('https://медси-бот.рф').origin;
  const tellParent = type => { if (embedded) window.parent.postMessage({ type }, location.origin); };
  const createLogId = () => {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  const logSessionId = createLogId();
  const pendingLogEntries = [];
  let logTimer = null;
  let logBusy = false;
  let logFailures = 0;
  let hasUserLog = false;
  let busy = false;
  let awaitingTherapyChoice = false;
  let awaitingReportDelayChoice = false;
  let pendingChoice = '';
  let pointerActiveUntil = 0;
  let lastReportKind = '';
  let lastIntentKey = '';
  let typingItem = null;
  let contextUntil = 0;
  let moodTimer = null;
  const BLINK_CYCLE_MS = 5200;
  let blinkEpoch = 0;

  function syncBlinks() {
    const allEyes = [botEyes, ...conversation.querySelectorAll('.mini-eyes')];
    allEyes.forEach(eyes => eyes.style.setProperty('animation', 'none', 'important'));
    void botEyes.offsetWidth;
    blinkEpoch = performance.now();
    allEyes.forEach(eyes => {
      eyes.style.animationDelay = '0ms';
      eyes.style.removeProperty('animation');
    });
  }
  syncBlinks();
  listen(document, 'visibilitychange', () => {
    if (!document.hidden) syncBlinks();
  });

  const setGaze = (x, y) => {
    // У большого блоба правый верхний край сужается: держим глаза чуть глубже внутри формы.
    const safeX = Math.max(-bot.clientWidth * .055, Math.min(bot.clientWidth * .055, x - bot.clientWidth * .055));
    const safeY = Math.max(-bot.clientHeight * .065, Math.min(bot.clientHeight * .055, y + bot.clientHeight * .025));
    botEyes.style.setProperty('--gaze-x', `${safeX}px`);
    botEyes.style.setProperty('--gaze-y', `${safeY}px`);
    root.querySelectorAll('.mini-eyes').forEach(eyes => {
      // Мини-аватар намного меньше основного персонажа: глаза всегда остаются в блобе.
      const miniX = Math.max(-2, Math.min(2, x * .035));
      const miniY = Math.max(-1.5, Math.min(1.5, y * .035));
      eyes.style.setProperty('--mini-gaze-x', `${miniX}px`);
      eyes.style.setProperty('--mini-gaze-y', `${miniY}px`);
    });
  };

  const scenarios = {
    reports: { question: 'Когда ждать отчёт?', answer: 'Утренний отчёт с 15:00 до 16:00.\nВечерний — с 21:00 до 22:00.\n\nХотите посмотреть отчёт?', mood: 'neutral', after: 'reportChoices' },
    chooseReport: { question: 'Да', answer: 'Какой отчёт?', after: 'reportChoices' },
    noThanks: { question: 'Нет', answer: 'Хорошо. Если понадобится, я рядом.' },
    clarifyReportMedical: { question: 'Вопрос об отчёте и лечении', answer: 'Вы хотите посмотреть отчёт или задать вопрос о лечении?', after: 'clarifyReportMedical' },
    clarifyDoctorMeeting: { question: 'Встреча с врачом', answer: 'Вы спрашиваете о встрече с ребёнком или о связи с лечащим врачом?', after: 'clarifyDoctorMeeting' },
    clarifyDelivery: { question: 'Еда и вещи', answer: 'Вы спрашиваете, что можно передать ребёнку?', after: 'clarifyDelivery' },
    reportQuestion: { question: 'Вопрос по отчёту', answer: 'Если у вас вопрос по содержанию отчёта, напишите воспитателям в чате.', after: 'educatorChat' },
    childStatus: { question: 'Как ребёнок?', answer: 'Последние наблюдения о ребёнке есть в отчётах. Какой показать?', after: 'reportChoices' },
    educators: { question: 'Почему воспитатели не отвечают?', answer: 'Воспитатели находятся с детьми и не могут отвечать в чате круглосуточно. Пожалуйста, наберитесь терпения: они ответят, как только смогут.' },
    writeEducators: { question: 'Написать воспитателям', answer: 'Напишите воспитателям в чате — они ответят, как только смогут.', after: 'educatorChat' },
    openEducatorChat: { question: 'Да', answer: 'Открываю чат с воспитателями.', after: 'navigateChat' },
    delivery: {
      question: 'Что можно передать ребёнку?',
      answer: "🗺️ Адрес: Гринвуд, с11, Путилково\nДля курьера напишите «на 5 этаж» и имя ребёнка.\n\n✅ Что можно привезти или заказать:\nЛюбую еду и напитки в безопасной упаковке - пиццу, суши, сладости, фрукты, сок. Также можно передать одежду, книги, раскраски, творческие наборы, безопасную канцелярию.\n\n🚫 Что нельзя передавать:\nОстрые и колюще-режущие предметы (ножницы, лезвия, точилки), стекло, металлические банки, аэрозоли и столовые приборы. Также нельзя кофе, энергетики, табак, вейпы и личную электронику.\n\n💊 Лекарства — только после согласования с лечащим врачом.\n❓ Если сомневаетесь насчёт вещи, уточните у воспитателей.",
      variants: {
        "address": "🗺️ Адрес: Гринвуд, с11, Путилково\nДля курьера напишите «на 5 этаж» и имя ребёнка.",
        "allowed": "✅ Что можно привезти или заказать:\nЛюбую еду и напитки в безопасной упаковке - пиццу, суши, сладости, фрукты, сок. Также можно передать одежду, книги, раскраски, творческие наборы, безопасную канцелярию.",
        "restricted": "🚫 Что нельзя передавать:\nОстрые и колюще-режущие предметы (ножницы, лезвия, точилки), стекло, металлические банки, аэрозоли и столовые приборы. Также нельзя кофе, энергетики, табак, вейпы и личную электронику.\n\n❓ Если сомневаетесь насчёт вещи, уточните у воспитателей.",
        "medicine": "💊 Лекарства — только после согласования с лечащим врачом."
}
    },
    payment: { question: 'Как оплатить?', answer: 'По вопросам оплаты свяжитесь с лечащим врачом. Оплата производится на ресепшене клиники.' },
    meetings: { question: 'Как договориться о встрече?', answer: 'Встречу с ребёнком, пожалуйста, согласуйте с лечащим врачом. Он поможет выбрать время с учётом состояния ребёнка.' },
    meetTime: { question: 'Когда можно встретиться с ребёнком?', answer: 'Встречи с детьми проходят с 17:00 до 20:00. Пожалуйста, согласуйте встречу с лечащим врачом.' },
    calls: { question: 'Как договориться о звонке?', answer: 'Звонок ребёнку, пожалуйста, согласуйте с лечащим врачом. Он поможет выбрать подходящее время.' },
    doctors: { question: 'Как связаться с лечащим врачом?', answer: 'Анастасия Михайловна\n+79253394090\n\nАнтон Геннадьевич\n+79859927884' },
    medical: { question: 'Вопрос о лечении', answer: 'Вопросы о лечении, препаратах, процедурах и анализах, пожалуйста, обсуждайте с лечащим врачом. Воспитатели не владеют такой информацией.', variants: { medicine: 'Вопросы о лекарствах, назначениях и дозировках, пожалуйста, обсуждайте с лечащим врачом. Воспитатели не владеют такой информацией.' } },
    urgent: { question: 'У меня срочный вопрос', answer: 'Если вопрос срочный, пожалуйста, напишите его в чате с воспитателями. Они ответят, как только смогут.', after: 'educatorChat', variants: { medical: 'Если медицинский вопрос требует срочного решения, пожалуйста, позвоните лечащему врачу.\n\nАнастасия Михайловна: +79253394090\nАнтон Геннадьевич: +79859927884' } },
    signIn: { question: 'Не получается войти', answer: 'По вопросам входа, кода подтверждения и доступа к системе, пожалуйста, напишите воспитателям в чате.', after: 'educatorChat' },
    therapy: { question: 'Психотерапия', answer: 'Что вас интересует: занятия с психологом или групповая терапия?', after: 'therapyChoices' },
    groupTherapy: { question: 'Групповая психотерапия' },
    groupTherapyTime: { question: 'Когда групповая психотерапия?', answer: 'В режиме дня групповая психотерапия указана на 10:00. Отчёт по занятию могу показать здесь.', after: 'therapy' },
    individualTherapy: { question: 'Индивидуальные занятия с психологом', answer: 'По вопросам индивидуальной психотерапии, пожалуйста, связывайтесь напрямую с вашим психологом.' },
    greeting: { question: 'Добрый день', answer: 'Добрый день', icon: '1f499.svg', iconPosition: 'after', after: 'greetingFollowup' },
    routine: { question: 'Какой режим дня?', answer: '☀️ Утро\n8:00 — Подъём\n8:30 — Зарядка\n9:00 — Завтрак\n9:30 — Игры и творчество\n10:00 — Групповая психотерапия\n11:00 — Прогулка\n12:00 — Игры и творчество\n13:00 — Обед\n14:00 — Сон-час\n\n🌙 Вечер\n16:00 — Йога / Танцы\n16:30 — Полдник\n17:00 — Игры и творчество\n18:00 — Ужин\n18:15 — Киносеанс\n21:00 — Подготовка ко сну / медицинские процедуры\n22:00 — Отбой\n\nВстречи с детьми: 17:00–20:00.' },
    home: { question: 'Как добавить систему на экран «Домой»?', answer: 'На главном экране есть подсказка по добавлению Медси Бота на экран «Домой». После этого система будет открываться как обычное приложение.' },
    thanks: { question: 'Спасибо!', answer: 'Пожалуйста! Я рядом, если понадобится подсказка.', mood: 'happy' }
  };

  const clock = () => new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' }).format(new Date());
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const emoji = (file, label = '') => {
    const image = document.createElement('img');
    image.className = 'smart-emoji';
    image.src = EMOJI_BASE + file;
    image.alt = label;
    image.decoding = 'async';
    return image;
  };
  const appendMessageText = (bubble, text) => {
    // В сообщениях используем те же локальные Twemoji, что и в меню.
    const icons = { '🚫': '1f6ab.svg', '✅': '2705.svg', '☀️': '2600.svg', '🌙': '1f319.svg', '🗺️': '1f5fa.svg', '💊': '1f48a.svg', '❓': '2753.svg' };
    const parts = String(text).split(/(🚫|✅|☀️|🌙|🗺️|💊|❓)/);
    parts.forEach(part => bubble.append(icons[part] ? emoji(icons[part], part) : document.createTextNode(part)));
  };
  const scrollToEnd = () => { conversation.scrollTop = conversation.scrollHeight; };
  const moscowParts = date => Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  const moscowDate = date => {
    const part = moscowParts(date);
    return `${part.year}-${String(part.month).padStart(2, '0')}-${String(part.day).padStart(2, '0')}`;
  };
  const safeGet = key => { try { return localStorage.getItem(key) || ''; } catch (_) { return ''; } };

  function queueBotLog(side, text) {
    if (!IS_PRIMARY_HOST || !text) return;
    pendingLogEntries.push({ side, text: String(text) });
    if (side === 'user') hasUserLog = true;
    if (!hasUserLog) return;
    window.clearTimeout(logTimer);
    logTimer = later(() => { void flushBotLog(); }, 800);
  }

  async function flushBotLog() {
    window.clearTimeout(logTimer);
    if (!IS_PRIMARY_HOST || !hasUserLog || !pendingLogEntries.length) return;
    if (logBusy) { logTimer = later(() => { void flushBotLog(); }, 1000); return; }
    logBusy = true;
    const entries = [];
    const encoder = new TextEncoder();
    let bytes = 0;
    let characters = 0;
    while (pendingLogEntries.length && entries.length < 12
      && bytes + encoder.encode(pendingLogEntries[0].text).byteLength <= 80000
      && characters + pendingLogEntries[0].text.length <= 70000) {
      const entry = pendingLogEntries.shift();
      entries.push(entry);
      bytes += encoder.encode(entry.text).byteLength;
      characters += entry.text.length;
    }
    if (!entries.length) { pendingLogEntries.shift(); logBusy = false; return; }
    const payload = JSON.stringify({ sessionId: logSessionId, eventId: createLogId(), entries });
    try {
      let session = await parentSession();
      if (!session) return;
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await fetch('/lab/bot-log', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'X-Medsi-Chat-Session': session.token },
          body: payload,
          cache: 'no-store',
          keepalive: encoder.encode(payload).byteLength < 60000
        });
        if (response.status === 401 && attempt === 0) { session = await parentSession(true); continue; }
        if (!response.ok) throw new Error('BOT_LOG_UNAVAILABLE');
        logFailures = 0;
        return;
      }
    } catch (_) {
      if (++logFailures < 3) {
        pendingLogEntries.unshift(...entries);
        logTimer = later(() => { void flushBotLog(); }, 5000);
      }
    } finally {
      logBusy = false;
      if (pendingLogEntries.length && logFailures === 0) logTimer = later(() => { void flushBotLog(); }, 800);
    }
  }

  async function parentSession(force = false) {
    // На GitHub Pages нет родительской авторизации и защищённого шлюза.
    if (location.origin !== new URL('https://медси-бот.рф').origin) return null;
    const phone = (safeGet('medsi_parent_phone') || safeGet('medsi_phone')).replace(/\D/g, '');
    const auth = safeGet('medsi_parent_auth_session_v1');
    if (phone.length < 10 || !auth) return null;
    const phone10 = phone.slice(-10);
    if (!force) {
      try {
        const saved = JSON.parse(safeGet('medsi_d1_parent_session_v1'));
        if (saved && saved.phone === phone10 && saved.session && saved.session.token && Number(saved.session.expiresAt) > Date.now() + 30000) return saved.session;
      } catch (_) { /* ask the existing gateway for a fresh session */ }
    }
    const response = await fetch('/__session/apps-script', {
      method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8' }, cache: 'no-store',
      body: JSON.stringify({ action: 'api', method: 'getD1ChatSession', args: ['parent', phone, auth] })
    });
    const value = await response.json();
    const session = value && value.result && (value.result.session || value.result);
    if (!response.ok || !value.ok || !session || !session.token) throw new Error('SESSION_UNAVAILABLE');
    try { localStorage.setItem('medsi_d1_parent_session_v1', JSON.stringify({ phone: phone10, session })); } catch (_) { /* optional cache */ }
    return session;
  }

  async function readParent(path) {
    let session = await parentSession();
    if (!session) return null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(path, { headers: { 'X-Medsi-Chat-Session': session.token }, cache: 'no-store', signal: controller.signal });
        if (response.status === 401 && attempt === 0) { session = await parentSession(true); continue; }
        const value = await response.json();
        if (!response.ok || !value || !value.ok) throw new Error('REPORT_UNAVAILABLE');
        return value;
      } finally { clearTimeout(timeout); }
    }
    throw new Error('REPORT_UNAVAILABLE');
  }

  function reportStatus(kind) {
    const now = moscowParts(new Date());
    const minutes = now.hour * 60 + now.minute;
    if (kind === 'evening' && minutes < 3 * 60) return 'late';
    const start = kind === 'morning' ? 15 * 60 : 21 * 60;
    const end = kind === 'morning' ? 16 * 60 : 22 * 60;
    return minutes < start ? 'before' : minutes < end ? 'publishing' : minutes < end + 60 ? 'grace' : 'late';
  }

  function reportTitle(kind) { return kind === 'morning' ? 'Утренний отчёт' : 'Вечерний отчёт'; }
  function reportWindow(kind) { return kind === 'morning' ? 'с 15:00 до 16:00' : 'с 21:00 до 22:00'; }
  function reportAccessText() {
    return location.origin === new URL('https://медси-бот.рф').origin
      ? 'Чтобы я мог проверить отчёт, пожалуйста, войдите в Медси Бот.'
      : 'Чтобы я мог проверить отчёт, откройте Медси Бот на основном адресе и войдите в аккаунт.';
  }
  function reportDelayText(kind) {
    const status = reportStatus(kind);
    if (status === 'before') return `${reportTitle(kind)} обычно появляется ${reportWindow(kind)}. Пожалуйста, дождитесь этого времени.`;
    if (status === 'publishing' || status === 'grace') return 'Похоже, сегодня подготовка отчёта занимает немного больше времени. Пожалуйста, подождите ещё немного.';
    return 'Отчёт уже должен был появиться. Обновите страницу и проверьте ещё раз. Если отчёта всё ещё нет или показывается старый, вероятно, возникла ошибка. Пожалуйста, сообщите воспитателям в чате.';
  }
  function showReportDelay(kind, suffix = '') {
    const late = reportStatus(kind) === 'late';
    message('bot', reportDelayText(kind) + suffix, 'sad');
    if (late) offerEducatorChat();
  }
  function expectedReportDate(kind) {
    const now = new Date();
    if (kind === 'evening' && moscowParts(now).hour < 3) return moscowDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    return moscowDate(now);
  }

  function reportCard(kind, text, reportDate = '') {
    const item = element('article', 'message bot');
    const avatar = element('span', 'message-avatar');
    avatar.setAttribute('aria-hidden', 'true');
    avatar.innerHTML = avatarMarkup();
    syncMiniBlink(avatar);
    const content = element('div', 'message-content');
    const card = element('div', 'report-card');
    const heading = element('div', 'report-card-heading');
    heading.append(emoji(kind === 'morning' ? '2600.svg' : '1f319.svg', ''), element('strong', '', reportTitle(kind)));
    if (reportDate) heading.append(element('span', 'report-card-date', reportDate.split('-').reverse().join('.')));
    card.append(heading, element('div', 'report-card-text', text));
    content.append(card, element('time', 'message-time', clock()));
    item.append(avatar, content);
    conversation.appendChild(item);
    queueBotLog('bot', text);
    scrollToEnd();
  }

  function therapyReportCard(text) {
    const item = element('article', 'message bot therapy-message');
    const avatar = element('span', 'message-avatar');
    avatar.setAttribute('aria-hidden', 'true');
    avatar.innerHTML = avatarMarkup();
    syncMiniBlink(avatar);
    const content = element('div', 'message-content');
    const card = element('div', 'report-card therapy-report-card');
    const heading = element('div', 'report-card-heading');
    heading.append(emoji('1f9e0.svg', ''), element('strong', '', 'Групповая психотерапия'));
    const body = element('div', 'therapy-report-body');
    const formatter = window.MedsiPsychologyFormatter;
    if (formatter && typeof formatter.render === 'function') formatter.render(body, text);
    else body.textContent = text;
    card.append(heading, body);
    content.append(card, element('time', 'message-time', clock()));
    item.append(avatar, content);
    conversation.appendChild(item);
    queueBotLog('bot', text);
    scrollToEnd();
  }

  async function answerTherapyReport() {
    setThinking(true);
    showTyping();
    try {
      const current = await readParent('/lab/report-current');
      if (!current) {
        message('bot', 'Чтобы показать отчёт, откройте Медси Бот на основном адресе и войдите в аккаунт.');
        return;
      }
      const report = (current.reports || []).find(item => item.kind === 'psychology' && String(item.text || '').trim());
      if (report) therapyReportCard(report.text);
      else message('bot', 'Отчёта по групповой психотерапии пока нет. Пожалуйста, попробуйте позже.');
    } catch (_) {
      message('bot', 'Сейчас не получилось загрузить отчёт по групповой психотерапии. Пожалуйста, попробуйте ещё раз чуть позже.', 'sad');
    } finally { clearTyping(); setThinking(false); busy = false; }
  }

  function requestTherapyReport(question = 'Групповая психотерапия') {
    if (busy) return;
    busy = true;
    awaitingTherapyChoice = false;
    pendingChoice = '';
    lastIntentKey = 'groupTherapy';
    message('user', question);
    answerTherapyReport();
  }

  async function answerReport(kind, delayed) {
    setThinking(true);
    showTyping();
    try {
      const current = await readParent('/lab/report-current');
      if (!current) {
        message('bot', reportAccessText());
        return;
      }
      const currentReports = (current.reports || []).filter(item => ['morning', 'evening'].includes(item.kind) && String(item.text || '').trim());
      let history = [];
      let historyAvailable = true;
      if (delayed || !kind) {
        try { history = (await readParent('/lab/report-history')).reports || []; } catch (_) { historyAvailable = false; }
      }
      if (!kind) {
        const changed = currentReports.filter(item => {
          const previous = history.find(saved => saved.kind === item.kind && String(saved.text || '').trim());
          return previous && String(previous.text).trim() !== String(item.text).trim();
        });
        if (changed.length === 1) { reportCard(changed[0].kind, changed[0].text); lastReportKind = changed[0].kind; return; }
        const latest = history.find(item => ['morning', 'evening'].includes(item.kind) && String(item.text || '').trim());
        if (latest && changed.length === 0) { reportCard(latest.kind, latest.text, latest.reportDate); lastReportKind = latest.kind; return; }
        if (currentReports.length === 1) kind = currentReports[0].kind;
        else { message('bot', 'Какой отчёт показать — утренний или вечерний?'); offerReportChoices(); return; }
      }
      lastReportKind = kind;
      const found = currentReports.find(item => item.kind === kind);
      if (!delayed) {
        if (found) reportCard(kind, found.text);
        else message('bot', `Пока нет доступного ${kind === 'morning' ? 'утреннего' : 'вечернего'} отчёта. Обычно он появляется ${reportWindow(kind)}.`, 'sad');
        return;
      }
      const today = expectedReportDate(kind);
      const published = history.find(item => item.kind === kind && item.reportDate === today && String(item.text || '').trim());
      if (published) { reportCard(kind, published.text, published.reportDate); return; }
      const previous = history.find(item => item.kind === kind && String(item.text || '').trim());
      if (found && previous && String(found.text).trim() !== String(previous.text).trim()) {
        reportCard(kind, found.text);
        return;
      }
      if (found && (!historyAvailable || !previous)) {
        message('bot', 'Я вижу последний доступный отчёт, но сейчас не могу точно проверить дату публикации нового. Покажу доступный отчёт.');
        reportCard(kind, found.text);
        return;
      }
      if (!historyAvailable) {
        message('bot', 'Сейчас не получилось проверить, опубликован ли новый отчёт. Пожалуйста, попробуйте ещё раз чуть позже.', 'sad');
        return;
      }
      showReportDelay(kind);
    } catch (_) {
      message('bot', delayed
        ? 'Сейчас не получилось проверить, опубликован ли новый отчёт. Пожалуйста, попробуйте ещё раз чуть позже.'
        : 'Сейчас не получилось загрузить отчёт. Пожалуйста, попробуйте ещё раз чуть позже.', 'sad');
    } finally { clearTyping(); setThinking(false); busy = false; }
  }

  function avatarMarkup() {
    return '<img class="mini-body" src="/new/blob.webp" alt=""><span class="mini-eyes"><i></i><i></i></span>';
  }

  function syncMiniBlink(avatar) {
    const eyes = avatar.querySelector('.mini-eyes');
    if (eyes) eyes.style.animationDelay = `${-((performance.now() - blinkEpoch) % BLINK_CYCLE_MS)}ms`;
  }

  function clearTyping() {
    if (typingItem) typingItem.remove();
    typingItem = null;
  }

  function showTyping() {
    clearTyping();
    const item = element('article', 'message bot bot-typing');
    const avatar = element('span', 'message-avatar mood-thinking');
    avatar.setAttribute('aria-hidden', 'true');
    avatar.innerHTML = avatarMarkup();
    syncMiniBlink(avatar);
    const content = element('div', 'message-content');
    const bubble = element('div', 'message-bubble typing-bubble');
    bubble.setAttribute('aria-label', 'Медси Бот печатает');
    for (let dot = 0; dot < 3; dot++) bubble.appendChild(element('span', 'typing-dot'));
    content.appendChild(bubble);
    item.append(avatar, content);
    conversation.appendChild(item);
    typingItem = item;
    scrollToEnd();
  }

  function message(side, text, mood = 'neutral', iconFile = '', iconPosition = 'before') {
    if (side === 'bot') clearTyping();
    const item = element('article', `message ${side}`);
    if (side === 'bot') {
      const avatar = element('span', `message-avatar mood-${mood}`);
      avatar.setAttribute('aria-hidden', 'true');
      avatar.innerHTML = avatarMarkup();
      syncMiniBlink(avatar);
      item.appendChild(avatar);
    }
    const content = element('div', 'message-content');
    const bubble = element('div', 'message-bubble');
    appendMessageText(bubble, text);
    if (iconFile) {
      const image = emoji(iconFile, '');
      if (iconPosition === 'after') bubble.append(image);
      else bubble.prepend(image);
      bubble.classList.add('message-bubble-with-icon');
      bubble.classList.add(`message-bubble-icon-${iconPosition}`);
    }
    content.append(bubble, element('time', 'message-time', clock()));
    item.appendChild(content);
    conversation.appendChild(item);
    queueBotLog(side, text);
    scrollToEnd();
  }

  function setThinking(active) { bot.classList.toggle('thinking', active); }
  function setMood(mood, duration = 0) {
    window.clearTimeout(moodTimer);
    bot.classList.remove('is-listening', 'mood-happy', 'mood-sad');
    if (mood && mood !== 'neutral') bot.classList.add(mood === 'listening' ? 'is-listening' : `mood-${mood}`);
    if (duration) moodTimer = later(() => setMood(input.value.trim() ? 'listening' : 'neutral'), duration);
  }
  function questionMood(text) {
    const value = String(text).toLocaleLowerCase('ru').replace(/ё/g, 'е');
    if (/спасибо|благодар|отлично|здорово|супер|хорошие новости/.test(value)) return 'happy';
    if (/нету? отч[её]т|не приш[её]л отч[её]т|пережива|беспокоюсь|тревож|плачет|груст|плохо/.test(value)) return 'sad';
    return 'neutral';
  }

  function offerEducatorChat() {
    const actions = element('div', 'choices');
    const open = actionButton('Открыть чат с воспитателями', '1f4ac.svg', () => {
      // При встраивании в основную панель этот обработчик вызывает её openChat().
      openEducatorChat();
    });
    actions.appendChild(open);
    conversation.appendChild(actions);
    pendingChoice = 'educatorChat';
    scrollToEnd();
  }

  function actionButton(label, iconFile, click) {
    const button = element('button', 'smart-action', label);
    button.type = 'button';
    button.prepend(emoji(iconFile, ''));
    button.addEventListener('click', click);
    return button;
  }

  function offerReportChoices() {
    const actions = element('div', 'choices');
    [['morning', 'Утренний отчёт', '2600.svg'], ['evening', 'Вечерний отчёт', '1f319.svg']].forEach(([kind, label, iconFile]) => {
      actions.appendChild(actionButton(label, iconFile, () => requestReport(kind)));
    });
    conversation.appendChild(actions);
    pendingChoice = 'reports';
    scrollToEnd();
  }

  function requestReport(kind) {
    if (busy) return;
    busy = true;
    awaitingReportDelayChoice = false;
    pendingChoice = '';
    lastIntentKey = 'reportRequest';
    lastReportKind = kind;
    message('user', reportTitle(kind));
    answerReport(kind, false);
  }

  function offerTherapy() {
    const actions = element('div', 'choices');
    const open = actionButton('Психотерапия', '1f9e0.svg', () => requestTherapyReport());
    actions.appendChild(open);
    conversation.appendChild(actions);
    scrollToEnd();
  }

  function offerTherapyChoices() {
    const actions = element('div', 'choices');
    actions.appendChild(actionButton('Занятия с психологом', '1f9e0.svg', () => runScenario('individualTherapy')));
    actions.appendChild(actionButton('Групповая терапия', '1f9e0.svg', () => runScenario('groupTherapy')));
    conversation.appendChild(actions);
    pendingChoice = 'therapy';
    scrollToEnd();
  }

  function offerClarification(kind) {
    const actions = element('div', 'choices');
    const options = kind === 'clarifyReportMedical'
      ? [['Отчёт', '2600.svg', () => runScenario('reports')], ['Лечение', '1f4de.svg', () => runScenario('medical')]]
      : kind === 'clarifyDoctorMeeting'
        ? [['Встреча с ребёнком', '1f4ac.svg', () => runScenario('meetTime')], ['Связь с врачом', '1f4de.svg', () => runScenario('doctors')]]
        : [['Что можно передать', '1f4e6.svg', () => runScenario('delivery')], ['Другой вопрос', '1f4ac.svg', () => runScenario('writeEducators')]];
    options.forEach(([label, icon, action]) => actions.appendChild(actionButton(label, icon, action)));
    conversation.appendChild(actions);
    pendingChoice = kind;
    scrollToEnd();
  }

  function runScenario(intent, question) {
    const parsed = typeof intent === 'string' ? { key: intent } : intent;
    contextUntil = Date.now() + 4 * 60 * 1000;
    if (parsed && parsed.key === 'groupTherapy') {
      requestTherapyReport(question || scenarios.groupTherapy.question);
      return;
    }
    if (parsed && (parsed.key === 'reportRequest' || parsed.key === 'reportDelay')) {
      if (busy) return;
      busy = true;
      awaitingReportDelayChoice = false;
      pendingChoice = '';
      lastIntentKey = parsed.key;
      message('user', question || (parsed.key === 'reportDelay' ? 'Почему ещё нет отчёта?' : 'Покажи отчёт'));
      const kind = parsed.kind || '';
      if (parsed.key === 'reportDelay' && !kind) {
        awaitingReportDelayChoice = true;
        pendingChoice = 'reportDelay';
        message('bot', 'Вы про утренний отчёт или вечерний отчёт?');
        offerReportDelayChoices();
        busy = false;
      } else answerReport(kind, parsed.key === 'reportDelay');
      return;
    }
    const scenario = scenarios[parsed && parsed.key];
    if (busy || !scenario) return;
    busy = true;
    awaitingTherapyChoice = false;
    awaitingReportDelayChoice = false;
    pendingChoice = '';
    lastIntentKey = parsed.key;
    message('user', question || scenario.question);
    setThinking(true);
    showTyping();
    later(() => {
      const answer = scenario.variants && scenario.variants[parsed.variant] || scenario.answer;
      if (answer) message('bot', answer, questionMood(question || scenario.question) === 'sad' ? 'sad' : scenario.mood || questionMood(question || scenario.question), scenario.icon || '', scenario.iconPosition || 'before');
      const after = parsed.key === 'urgent' && parsed.variant === 'medical' ? '' : scenario.after;
      if (after === 'reportChoices') { offerReportChoices(); pendingChoice = 'reports'; }
      if (after === 'educatorChat') { offerEducatorChat(); pendingChoice = 'educatorChat'; }
      if (after === 'therapy') offerTherapy();
      if (after === 'therapyChoices') { offerTherapyChoices(); awaitingTherapyChoice = true; pendingChoice = 'therapy'; }
      if (after === 'clarifyReportMedical' || after === 'clarifyDoctorMeeting' || after === 'clarifyDelivery') offerClarification(after);
      if (after === 'navigateChat') later(openEducatorChat, 180);
      if (scenario.after === 'greetingFollowup') later(() => message('bot', 'Как я могу вам помочь?'), 230);
      clearTyping();
      setThinking(false);
      busy = false;
    }, Math.min(720, 320 + String(question || scenario.question).length * 6));
  }

  function offerReportDelayChoices() {
    const actions = element('div', 'choices');
    [['morning', 'Утренний отчёт', '2600.svg'], ['evening', 'Вечерний отчёт', '1f319.svg']].forEach(([kind, label, iconFile]) => {
      actions.appendChild(actionButton(label, iconFile, () => {
        if (busy) return;
        busy = true;
        awaitingReportDelayChoice = false;
        lastReportKind = kind;
        message('user', label);
        answerReport(kind, true);
      }));
    });
    conversation.appendChild(actions);
    scrollToEnd();
  }

  function classify(text) {
    const simple = String(text || '').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^а-яa-z]+/g, ' ').trim();
    const reportFollowupKey = lastIntentKey === 'reportDelay' ? 'reportDelay' : 'reportRequest';
    if (/(?:не утренн[а-я]* а вечерн[а-я]*|вместо утренн[а-я]* вечерн[а-я]*)/.test(simple)) return { key: reportFollowupKey, kind: 'evening' };
    if (/(?:не вечерн[а-я]* а утренн[а-я]*|вместо вечерн[а-я]* утренн[а-я]*)/.test(simple)) return { key: reportFollowupKey, kind: 'morning' };
    if (['reports', 'reportRequest', 'reportDelay'].includes(lastIntentKey) && /^нет а? ?вечерн[а-я]*$/.test(simple)) return { key: reportFollowupKey, kind: 'evening' };
    if (['reports', 'reportRequest', 'reportDelay'].includes(lastIntentKey) && /^нет а? ?утренн[а-я]*$/.test(simple)) return { key: reportFollowupKey, kind: 'morning' };
    if (/(?:не надо|не нужен|не нужно|не хочу) (?:мне )?(?:отчет|отчета)/.test(simple)) return 'noThanks';
    if (pendingChoice === 'clarifyReportMedical' && /^(?:первое|первый|отчет)$/.test(simple)) return 'reports';
    if (pendingChoice === 'clarifyReportMedical' && /^(?:второе|второй|лечение)$/.test(simple)) return 'medical';
    if (pendingChoice === 'clarifyDoctorMeeting' && /^(?:первое|первый|ребенком)$/.test(simple)) return 'meetTime';
    if (pendingChoice === 'clarifyDoctorMeeting' && /^(?:второе|второй|врачом)$/.test(simple)) return 'doctors';
    if (pendingChoice === 'clarifyDelivery' && /^(?:да|ага|угу|конечно)$/.test(simple)) return 'delivery';
    if (/^(?:да|ага|угу|конечно|давай|хочу|пожалуйста)$/.test(simple)) {
      if (pendingChoice === 'educatorChat') return 'openEducatorChat';
      if (pendingChoice === 'reports' || pendingChoice === 'reportDelay') return 'chooseReport';
      if (pendingChoice === 'therapy') return 'therapy';
    }
    if (/^(?:нет|не надо|не нужно|спасибо не надо|пока нет)$/.test(simple) && pendingChoice) return 'noThanks';
    if (awaitingReportDelayChoice) {
      if (/^(?:утренн[а-я]*|утренн[а-я]* отчет)$/.test(simple)) return { key: 'reportDelay', kind: 'morning' };
      if (/^(?:вечерн[а-я]*|вечерн[а-я]* отчет)$/.test(simple)) return { key: 'reportDelay', kind: 'evening' };
    }
    if ((pendingChoice === 'reports' || ['reports', 'reportRequest', 'reportDelay'].includes(lastIntentKey)) && /^(?:а )?(?:утренн[а-я]*|вечерн[а-я]*)(?: отчет)?$/.test(simple)) return { key: reportFollowupKey, kind: simple.includes('утренн') ? 'morning' : 'evening' };
    if (lastReportKind && ['reports', 'reportRequest', 'reportDelay'].includes(lastIntentKey) && /^(?:почему|а почему) (?:его |ее )?(?:нет|нету|не пришел|не появился)$/.test(simple)) return { key: 'reportDelay', kind: lastReportKind };
    if (lastReportKind && ['reports', 'reportRequest', 'reportDelay'].includes(lastIntentKey) && /^(?:покажи|отправь|скинь|пришли|дай)(?: его)?$/.test(simple)) return { key: 'reportRequest', kind: lastReportKind };
    if (['reports', 'reportRequest', 'reportDelay'].includes(lastIntentKey) && /^(?:а )?(?:когда|во сколько)$/.test(simple)) return 'reports';
    if (awaitingTherapyChoice) {
      if (/^(?:групп[а-я]*|групповая терапия|отчет по группе)$/.test(simple)) return 'groupTherapy';
      if (/^(?:индивидуал[а-я]*|занятия с психологом|психолог)$/.test(simple)) return 'individualTherapy';
    }
    if (window.MedsiSmartBot && window.MedsiSmartBot.isGreetingOnly(text)) return 'greeting';
    const analyzed = window.MedsiSmartBot && window.MedsiSmartBot.analyze(text);
    const known = analyzed && analyzed.confidence < .75 && analyzed.intent && analyzed.intent.key === 'delivery'
      ? { key: 'clarifyDelivery' } : analyzed && analyzed.intent;
    if (known) return known;
    return null;
  }

  function submitQuestion(text) {
    if (!text || busy) return;
    if (Date.now() > contextUntil) { pendingChoice = ''; lastIntentKey = ''; lastReportKind = ''; awaitingTherapyChoice = false; awaitingReportDelayChoice = false; }
    contextUntil = Date.now() + 4 * 60 * 1000;
    setMood(questionMood(text), 4800);
    input.value = '';
    const scenario = classify(text);
    if (scenario) return runScenario(scenario, text);
    awaitingTherapyChoice = false;
    pendingChoice = '';
    message('user', text);
    setThinking(true);
    showTyping();
    busy = true;
    later(() => {
      message('bot', 'Этот вопрос лучше задать в чате с воспитателями. Хотите открыть чат?', questionMood(text) === 'sad' ? 'sad' : 'thinking');
      offerEducatorChat();
      pendingChoice = 'educatorChat';
      lastIntentKey = '';
      clearTyping();
      setThinking(false);
      busy = false;
    }, 380);
  }

  composer.addEventListener('submit', event => {
    event.preventDefault();
    submitQuestion(input.value.trim());
  });
  input.addEventListener('input', () => {
    if (busy) return;
    setMood(input.value.trim() ? 'listening' : 'neutral');
    if (input.value.trim()) setGaze(bot.clientWidth * .10, bot.clientHeight * .05);
  });

  promptStrip.addEventListener('click', event => {
    const button = event.target.closest('button[data-prompt]');
    if (!button || busy) return;
    submitQuestion(button.dataset.prompt);
  });

  async function openEducatorChat() {
    await flushBotLog();
    if (callbacks.openEducators) return callbacks.openEducators();
    if (embedded) return tellParent('medsi-bot:open-educators');
    if (typeof window.openMedsiEducatorChat === 'function') return window.openMedsiEducatorChat();
    window.location.assign('https://медси-бот.рф/?openChat=1');
  }

  backButton.addEventListener('click', async () => {
    await flushBotLog();
    if (callbacks.close) return callbacks.close();
    if (embedded) return tellParent('medsi-bot:closed');
    window.location.assign('https://медси-бот.рф/');
  });
  if (embedded) listen(window, 'message', async event => {
    if (event.source !== window.parent || event.origin !== location.origin || event.data?.type !== 'medsi-bot:close-request') return;
    await flushBotLog();
    tellParent('medsi-bot:closed');
  });
  listen(window, 'pagehide', () => { void flushBotLog(); });

  function follow(point) {
    const rect = bot.getBoundingClientRect();
    const dx = point.clientX - (rect.left + rect.width / 2);
    const dy = point.clientY - (rect.top + rect.height / 2);
    const x = Math.max(-rect.width * .10, Math.min(rect.width * .10, dx / 4));
    const y = Math.max(-rect.height * .08, Math.min(rect.height * .08, dy / 4));
    setGaze(x, y);
    pointerActiveUntil = Date.now() + 1500;
  }

  listen(window, 'pointermove', event => {
    if (event.pointerType === 'mouse') follow(event);
  }, { passive: true });
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    every(() => {
      if (Date.now() < pointerActiveUntil) return;
      setGaze(bot.clientWidth * (.025 + (Math.random() - .5) * .09), bot.clientHeight * (-.04 + (Math.random() - .5) * .07));
    }, 2100);
  }
  setGaze(bot.clientWidth * .10, bot.clientHeight * -.08);
  message('bot', 'Добрый день, я Медси Бот, отвечу на любые ваши вопросы.', 'neutral', '1f499.svg', 'after');
  return { flush: flushBotLog, destroy() {
    destroyed = true; lifecycle.abort();
    timers.forEach(id => { window.clearTimeout(id); window.clearInterval(id); });
    timers.clear();
  } };
  }
  window.MedsiBotChat = Object.freeze({ mount });
  if (document.getElementById('conversation')) mount();
})();
