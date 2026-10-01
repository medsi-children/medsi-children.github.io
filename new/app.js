(() => {
  'use strict';

  // Лаборатория помощника: она не читает данные ребёнка и не отправляет сообщения.
  const conversation = document.getElementById('conversation');
  const composer = document.getElementById('composer');
  const input = document.getElementById('messageInput');
  const bot = document.getElementById('bot');
  const botEyes = document.getElementById('botEyes');
  const EMOJI_BASE = '/chat-overlay/assets/twemoji/';
  let busy = false;
  let awaitingTherapyChoice = false;
  let pointerActiveUntil = 0;

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
    reportDelay: { question: 'Почему до сих пор нет отчёта?', answer: 'Отчёт уже должен был прийти. Пожалуйста, перезагрузите приложение и попробуйте открыть его ещё раз. Если после этого виден старый отчёт, возникла техническая неполадка — команда уже решает этот вопрос.', mood: 'sad' },
    educators: { question: 'Почему воспитатели не отвечают?', answer: 'Воспитатели находятся с детьми и не могут отвечать в чате круглосуточно. Пожалуйста, наберитесь терпения: они ответят, как только смогут.' },
    delivery: {
      question: 'Что можно передать ребёнку?',
      answer: 'Адрес: Гринвуд, с11, Путилково\nКомментарий: «на 5 этаж» и имя ребёнка\n\nВы можете привезти или оформить доставку любых продуктов, напитков, еды, одежды и других вещей — в рамках ограничений по безопасности.\n\n🚫 Что запрещено:\nКолюще-режущее, стекло, металл.\n\n✅ Что можно заказать:\nЛюбую еду, одежду, вещи, творческие наборы, книги.'
    },
    payment: { question: 'Как оплатить?', answer: 'По вопросам оплаты свяжитесь с лечащим врачом. Оплата производится на ресепшене клиники.' },
    meetings: { question: 'Как договориться о встрече?', answer: 'Встречу с ребёнком, пожалуйста, согласуйте с лечащим врачом. Он поможет выбрать время с учётом состояния ребёнка.' },
    meetTime: { question: 'Когда можно встретиться с ребёнком?', answer: 'Встречи с детьми проходят с 17:00 до 20:00. Пожалуйста, согласуйте встречу с лечащим врачом.' },
    calls: { question: 'Как договориться о звонке?', answer: 'Звонок ребёнку, пожалуйста, согласуйте с лечащим врачом. Он поможет выбрать подходящее время.' },
    doctors: { question: 'Как связаться с лечащим врачом?', answer: 'Анастасия Михайловна\n+79253394090\n\nАнтон Геннадьевич\n+79859927884' },
    medical: { question: 'Вопрос о лечении', answer: 'Вопросы о лечении, препаратах, процедурах и анализах, пожалуйста, обсуждайте с лечащим врачом. Воспитатели не владеют такой информацией.' },
    urgent: { question: 'У меня срочный вопрос', answer: 'Если вопрос срочный, пожалуйста, напишите его в чате с воспитателями. Они ответят, как только смогут.', after: 'educatorChat' },
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

  function avatarMarkup() {
    return '<img class="mini-body" src="/new/blob.png" alt=""><span class="mini-eyes"><i></i><i></i></span>';
  }

  function message(side, text, mood = 'neutral', iconFile = '', iconPosition = 'before') {
    const item = element('article', `message ${side}`);
    if (side === 'bot') {
      const avatar = element('span', `message-avatar mood-${mood}`);
      avatar.setAttribute('aria-hidden', 'true');
      avatar.innerHTML = avatarMarkup();
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
      window.location.assign('/?openChat=1');
    });
    actions.appendChild(open);
    conversation.appendChild(actions);
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
    scrollToEnd();
  }

  function requestReport(kind) {
    // В основной панели обработчик получит тот же защищённый актуальный отчёт,
    // который уже показывается родителю в её главном меню.
    if (typeof window.openMedsiCurrentReport === 'function') return window.openMedsiCurrentReport(kind);
    message('bot', 'В этой лаборатории нет доступа к данным ребёнка. В основной панели здесь будет показан последний доступный отчёт.', 'thinking');
  }

  function offerTherapy() {
    const actions = element('div', 'choices');
    const open = actionButton('Психотерапия', '1f9e0.svg', () => {
      if (typeof window.openMedsiTherapy === 'function') return window.openMedsiTherapy();
      window.location.assign('/?openTherapy=1');
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
    scrollToEnd();
  }

  function runScenario(intent, question) {
    const parsed = typeof intent === 'string' ? { key: intent } : intent;
    const scenario = scenarios[parsed && parsed.key];
    if (busy || !scenario) return;
    busy = true;
    awaitingTherapyChoice = false;
    message('user', question || scenario.question);
    setThinking(true);
    window.setTimeout(() => {
      const answer = scenario.variants && scenario.variants[parsed.variant] || scenario.answer;
      if (answer) message('bot', answer, scenario.mood || 'neutral', scenario.icon || '', scenario.iconPosition || 'before');
      if (scenario.after === 'reportChoices') offerReportChoices();
      if (scenario.after === 'educatorChat') offerEducatorChat();
      if (scenario.after === 'therapy') offerTherapy();
      if (scenario.after === 'therapyChoices') offerTherapyChoices();
      if (scenario.after === 'therapyChoices') awaitingTherapyChoice = true;
      if (scenario.after === 'greetingFollowup') window.setTimeout(() => message('bot', 'Как я могу вам помочь?'), 230);
      setThinking(false);
      busy = false;
    }, 380);
  }

  function classify(text) {
    const simple = String(text || '').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^а-я]+/g, ' ').trim();
    if (awaitingTherapyChoice) {
      if (/^(?:групп[а-я]*|групповая терапия|отчет по группе)$/.test(simple)) return 'groupTherapy';
      if (/^(?:индивидуал[а-я]*|занятия с психологом|психолог)$/.test(simple)) return 'individualTherapy';
    }
    const known = window.MedsiSmartBot && window.MedsiSmartBot.classify(text);
    if (known) return known;
    if (/^(?:привет|здравствуй|здравствуйте|добрый день|доброе утро|добрый вечер)(?: медси бот)?$/.test(simple)) return 'greeting';
    return null;
  }

  composer.addEventListener('submit', event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    const scenario = classify(text);
    if (scenario) return runScenario(scenario, text);
    awaitingTherapyChoice = false;
    message('user', text);
    setThinking(true);
    busy = true;
    window.setTimeout(() => {
      message('bot', 'Этот вопрос лучше задать в чате с воспитателями. Хотите открыть чат?', 'thinking');
      offerEducatorChat();
      setThinking(false);
      busy = false;
    }, 380);
  });

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
  window.setTimeout(() => {
    message('bot', 'Добрый день, я Медси Бот, отвечу на любые ваши вопросы.', 'neutral', '1f499.svg', 'after');
  }, 220);
})();
