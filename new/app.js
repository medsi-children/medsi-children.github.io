(() => {
  'use strict';

  // Лаборатория не отправляет сообщения воспитателям. Отчёты читает только через
  // существующую защищённую родительскую сессию на основном домене.
  const conversation = document.getElementById('conversation');
  const composer = document.getElementById('composer');
  const backButton = document.getElementById('botBack');
  const promptStrip = document.getElementById('promptStrip');
  const input = document.getElementById('messageInput');
  const bot = document.getElementById('bot');
  const botEyes = document.getElementById('botEyes');
  const EMOJI_BASE = '/chat-overlay/assets/twemoji/';
  let busy = false;
  let awaitingTherapyChoice = false;
  let awaitingReportDelayChoice = false;
  let pendingChoice = '';
  let pointerActiveUntil = 0;
  let lastReportKind = '';
  let lastIntentKey = '';
  let typingItem = null;
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
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncBlinks();
  });

  const setGaze = (x, y) => {
    // У большого блоба правый верхний край сужается: держим глаза чуть глубже внутри формы.
    const safeX = Math.max(-bot.clientWidth * .055, Math.min(bot.clientWidth * .055, x - bot.clientWidth * .055));
    const safeY = Math.max(-bot.clientHeight * .065, Math.min(bot.clientHeight * .055, y + bot.clientHeight * .025));
    botEyes.style.setProperty('--gaze-x', `${safeX}px`);
    botEyes.style.setProperty('--gaze-y', `${safeY}px`);
    document.querySelectorAll('.mini-eyes').forEach(eyes => {
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
    reportQuestion: { question: 'Вопрос по отчёту', answer: 'Если у вас вопрос по содержанию отчёта, напишите воспитателям в чате.', after: 'educatorChat' },
    childStatus: { question: 'Как ребёнок?', answer: 'Последние наблюдения о ребёнке есть в отчётах. Какой показать?', after: 'reportChoices' },
    educators: { question: 'Почему воспитатели не отвечают?', answer: 'Воспитатели находятся с детьми и не могут отвечать в чате круглосуточно. Пожалуйста, наберитесь терпения: они ответят, как только смогут.' },
    writeEducators: { question: 'Написать воспитателям', answer: 'Напишите воспитателям в чате — они ответят, как только смогут.', after: 'educatorChat' },
    openEducatorChat: { question: 'Да', answer: 'Открываю чат с воспитателями.', after: 'navigateChat' },
    delivery: {
      question: 'Что можно передать ребёнку?',
      answer: 'Адрес: Гринвуд, с11, Путилково\nКомментарий для курьера: «на 5 этаж» и имя ребёнка\n\n✅ Что можно привезти или заказать:\nЕду и напитки в безопасной упаковке: например, пиццу, суши, сладости, фрукты, сок. Также можно передать одежду, книги, раскраски, канцелярию и творческие наборы — без опасных деталей.\n\n🚫 Что нельзя передавать:\nОстрые и режущие предметы (ножницы, лезвия, точилки), стекло, металлические банки, аэрозоли и столовые приборы. Одежду — с ремнями, цепочками и металлическими подвесками; наборы — с металлическими деталями. Также нельзя кофе, энергетики, табак, вейпы и личную электронику. Жвачку лучше не передавать.\n\nЛекарства — только по назначению и после согласования с лечащим врачом. Ноутбук или планшет возможен только для онлайн-уроков. Если сомневаетесь насчёт вещи, уточните у воспитателей.',
      variants: {
        address: 'Адрес: Гринвуд, с11, Путилково\nКомментарий для курьера: «на 5 этаж» и имя ребёнка.',
        restricted: 'Нельзя передавать острые и режущие предметы, стекло, металлические банки и аэрозоли, столовые приборы, кофе, энергетики, табак, вейпы и личную электронику. На одежде и в творческих наборах не должно быть ремней, цепочек или опасных металлических деталей. Жвачку лучше не передавать.\n\nЕсли сомневаетесь насчёт конкретной вещи, уточните у воспитателей.',
        allowed: 'Можно привезти или заказать еду и напитки в безопасной упаковке: например, пиццу, суши, сладости, фрукты, сок. Также подходят одежда, книги, раскраски, канцелярия и творческие наборы — без острых, стеклянных и металлических деталей. Лекарства — только по назначению и после согласования с лечащим врачом; ноутбук или планшет — только для онлайн-уроков.\n\nАдрес: Гринвуд, с11, Путилково\nКомментарий для курьера: «на 5 этаж» и имя ребёнка.',
        medicine: 'Лекарства можно передать только по назначению и после предварительного согласования с лечащим врачом. Пожалуйста, сначала обсудите с ним препарат и способ передачи.'
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
    groupTherapy: { question: 'Групповая психотерапия', answer: 'Чтобы посмотреть отчёт по групповой психотерапии, нажмите кнопку ниже.', after: 'therapy' },
    groupTherapyTime: { question: 'Когда групповая психотерапия?', answer: 'В режиме дня групповая психотерапия указана на 10:00. Чтобы посмотреть отчёт по занятию, нажмите кнопку ниже.', after: 'therapy' },
    individualTherapy: { question: 'Индивидуальные занятия с психологом', answer: 'По вопросам индивидуальной психотерапии, пожалуйста, связывайтесь напрямую с вашим психологом.' },
    greeting: { question: 'Добрый день', answer: 'Добрый день', icon: '1f499.svg', iconPosition: 'after', after: 'greetingFollowup' },
    routine: { question: 'Какой режим дня?', answer: 'Утро\n8:00 — Подъём\n8:30 — Зарядка\n9:00 — Завтрак\n9:30 — Игры и творчество\n10:00 — Групповая психотерапия\n11:00 — Прогулка\n12:00 — Игры и творчество\n13:00 — Обед\n14:00 — Сон-час\n\nВечер\n16:00 — Йога / Танцы\n16:30 — Полдник\n17:00 — Игры и творчество\n18:00 — Ужин\n18:15 — Киносеанс\n21:00 — Подготовка ко сну / медицинские процедуры\n22:00 — Отбой\n\nВстречи с детьми: 17:00–20:00.' },
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
    // Значки в тексте доставок используют те же локальные Twemoji, что и кнопки.
    const parts = String(text).split(/(🚫|✅)/);
    parts.forEach(part => bubble.append(part === '🚫' ? emoji('1f6ab.svg', '') : part === '✅' ? emoji('2705.svg', '') : document.createTextNode(part)));
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
    return minutes < start ? 'before' : minutes < end ? 'publishing' : 'late';
  }

  function reportTitle(kind) { return kind === 'morning' ? 'Утренний отчёт' : 'Вечерний отчёт'; }
  function reportWindow(kind) { return kind === 'morning' ? 'с 15:00 до 16:00' : 'с 21:00 до 22:00'; }
  function reportDelayText(kind) {
    const status = reportStatus(kind);
    if (status === 'before') return `${reportTitle(kind)} обычно появляется ${reportWindow(kind)}. Пожалуйста, дождитесь этого времени.`;
    if (status === 'publishing') return `Сейчас время публикации: ${reportTitle(kind).toLowerCase()} появляется ${reportWindow(kind)}. Попробуйте посмотреть немного позже.`;
    return `${reportTitle(kind)} уже должен был появиться. Пожалуйста, обновите приложение и проверьте отчёт ещё раз. Если он по-прежнему старый, возможно, возникла техническая неполадка.`;
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
    scrollToEnd();
  }

  async function answerReport(kind, delayed) {
    setThinking(true);
    showTyping();
    try {
      const current = await readParent('/lab/report-current');
      if (!current) {
        if (delayed && kind) message('bot', reportDelayText(kind), reportStatus(kind) === 'late' ? 'sad' : 'neutral');
        else message('bot', kind ? `Сейчас не получилось загрузить ${kind === 'morning' ? 'утренний' : 'вечерний'} отчёт. Можно попробовать ещё раз.` : 'Какой отчёт хотите посмотреть — утренний или вечерний?');
        offerReportChoices();
        return;
      }
      const currentReports = (current.reports || []).filter(item => ['morning', 'evening'].includes(item.kind) && String(item.text || '').trim());
      let history = [];
      if (delayed || !kind) {
        try { history = (await readParent('/lab/report-history')).reports || []; } catch (_) { /* current report still remains available */ }
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
      message('bot', reportDelayText(kind), reportStatus(kind) === 'late' ? 'sad' : 'neutral');
    } catch (_) {
      if (delayed && kind) message('bot', `${reportDelayText(kind)}\n\nСейчас я не смог проверить, опубликован ли новый отчёт.`, reportStatus(kind) === 'late' ? 'sad' : 'neutral');
      else message('bot', 'Сейчас не получилось загрузить отчёт. Пожалуйста, попробуйте ещё раз чуть позже.', 'sad');
      offerReportChoices();
    } finally { clearTyping(); setThinking(false); busy = false; }
  }

  function avatarMarkup() {
    return '<img class="mini-body" src="/new/blob.png" alt=""><span class="mini-eyes"><i></i><i></i></span>';
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
    scrollToEnd();
  }

  function setThinking(active) { bot.classList.toggle('thinking', active); }

  function offerEducatorChat() {
    const actions = element('div', 'choices');
    const open = actionButton('Открыть чат с воспитателями', '1f4ac.svg', () => {
      // При встраивании в основную панель этот обработчик вызывает её openChat().
      if (typeof window.openMedsiEducatorChat === 'function') return window.openMedsiEducatorChat();
      window.location.assign('https://медси-бот.рф/?openChat=1');
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
    const open = actionButton('Психотерапия', '1f9e0.svg', () => {
      if (typeof window.openMedsiTherapy === 'function') return window.openMedsiTherapy();
      window.location.assign('https://медси-бот.рф/?openTherapy=1');
    });
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

  function runScenario(intent, question) {
    const parsed = typeof intent === 'string' ? { key: intent } : intent;
    if (parsed && (parsed.key === 'reportRequest' || parsed.key === 'reportDelay')) {
      if (busy) return;
      busy = true;
      awaitingReportDelayChoice = false;
      pendingChoice = '';
      lastIntentKey = parsed.key;
      message('user', question || (parsed.key === 'reportDelay' ? 'Почему ещё нет отчёта?' : 'Покажи отчёт'));
      const kind = parsed.kind || (parsed.key === 'reportDelay' ? lastReportKind : '');
      if (parsed.key === 'reportDelay' && !kind) {
        awaitingReportDelayChoice = true;
        pendingChoice = 'reportDelay';
        message('bot', 'Какой отчёт вы ожидаете — утренний или вечерний?');
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
    window.setTimeout(() => {
      const answer = scenario.variants && scenario.variants[parsed.variant] || scenario.answer;
      if (answer) message('bot', answer, scenario.mood || 'neutral', scenario.icon || '', scenario.iconPosition || 'before');
      const after = parsed.key === 'urgent' && parsed.variant === 'medical' ? '' : scenario.after;
      if (after === 'reportChoices') { offerReportChoices(); pendingChoice = 'reports'; }
      if (after === 'educatorChat') { offerEducatorChat(); pendingChoice = 'educatorChat'; }
      if (after === 'therapy') offerTherapy();
      if (after === 'therapyChoices') { offerTherapyChoices(); awaitingTherapyChoice = true; pendingChoice = 'therapy'; }
      if (after === 'navigateChat') window.setTimeout(() => window.location.assign('https://медси-бот.рф/?openChat=1'), 180);
      if (scenario.after === 'greetingFollowup') window.setTimeout(() => message('bot', 'Как я могу вам помочь?'), 230);
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
    const simple = String(text || '').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^а-я]+/g, ' ').trim();
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
    if (pendingChoice === 'reports' && /^(?:а )?(?:утренн[а-я]*|вечерн[а-я]*)(?: отчет)?$/.test(simple)) return { key: 'reportRequest', kind: simple.includes('утренн') ? 'morning' : 'evening' };
    if (lastReportKind && /^(?:почему|а почему) (?:его |ее )?(?:нет|не пришел|не появился)$/.test(simple)) return { key: 'reportDelay', kind: lastReportKind };
    if (lastReportKind && /^(?:покажи|отправь|скинь|пришли|дай)(?: его)?$/.test(simple)) return { key: 'reportRequest', kind: lastReportKind };
    if (['reports', 'reportRequest', 'reportDelay'].includes(lastIntentKey) && /^(?:а )?(?:когда|во сколько)$/.test(simple)) return 'reports';
    if (awaitingTherapyChoice) {
      if (/^(?:групп[а-я]*|групповая терапия|отчет по группе)$/.test(simple)) return 'groupTherapy';
      if (/^(?:индивидуал[а-я]*|занятия с психологом|психолог)$/.test(simple)) return 'individualTherapy';
    }
    const known = window.MedsiSmartBot && window.MedsiSmartBot.classify(text);
    if (known) return known;
    if (/^(?:привет|здравствуй|здравствуйте|добрый день|доброе утро|добрый вечер)(?: медси бот)?$/.test(simple)) return 'greeting';
    return null;
  }

  function submitQuestion(text) {
    if (!text || busy) return;
    input.value = '';
    const scenario = classify(text);
    if (scenario) return runScenario(scenario, text);
    awaitingTherapyChoice = false;
    pendingChoice = '';
    message('user', text);
    setThinking(true);
    showTyping();
    busy = true;
    window.setTimeout(() => {
      message('bot', 'Этот вопрос лучше задать в чате с воспитателями. Хотите открыть чат?', 'thinking');
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

  promptStrip.addEventListener('click', event => {
    const button = event.target.closest('button[data-prompt]');
    if (!button || busy) return;
    submitQuestion(button.dataset.prompt);
  });

  backButton.addEventListener('click', () => window.location.assign('https://медси-бот.рф/'));

  function follow(point) {
    const rect = bot.getBoundingClientRect();
    const dx = point.clientX - (rect.left + rect.width / 2);
    const dy = point.clientY - (rect.top + rect.height / 2);
    const x = Math.max(-rect.width * .10, Math.min(rect.width * .10, dx / 4));
    const y = Math.max(-rect.height * .08, Math.min(rect.height * .08, dy / 4));
    setGaze(x, y);
    pointerActiveUntil = Date.now() + 1500;
  }

  window.addEventListener('pointermove', event => {
    if (event.pointerType === 'mouse') follow(event);
  }, { passive: true });
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.setInterval(() => {
      if (Date.now() < pointerActiveUntil) return;
      setGaze(bot.clientWidth * (.025 + (Math.random() - .5) * .09), bot.clientHeight * (-.04 + (Math.random() - .5) * .07));
    }, 2100);
  }
  setGaze(bot.clientWidth * .10, bot.clientHeight * -.08);
  message('bot', 'Добрый день, я Медси Бот, отвечу на любые ваши вопросы.', 'neutral', '1f499.svg', 'after');
})();
