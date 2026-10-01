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
  let pointerActiveUntil = 0;

  const setGaze = (x, y) => {
    botEyes.style.setProperty('--gaze-x', `${x}px`);
    botEyes.style.setProperty('--gaze-y', `${y}px`);
    document.querySelectorAll('.mini-eyes').forEach(eyes => {
      // Мини-аватар намного меньше основного персонажа: глаза всегда остаются в блобе.
      const miniX = Math.max(-2, Math.min(2, x * .035));
      const miniY = Math.max(-1.5, Math.min(1.5, y * .035));
      eyes.style.setProperty('--mini-gaze-x', `${miniX}px`);
      eyes.style.setProperty('--mini-gaze-y', `${miniY}px`);
    });
  };

  const scenarios = {
    reports: { question: 'Когда ждать отчёт?', answer: 'Утренний отчёт будет с 15:00 до 16:00, вечерний — с 21:00 до 22:00. Пожалуйста, дождитесь этого времени.\n\nХотите посмотреть отчёт?', mood: 'neutral', after: 'reportChoices' },
    reportDelay: { question: 'Почему до сих пор нет отчёта?', answer: 'Отчёт уже должен был прийти. Пожалуйста, перезагрузите приложение и попробуйте открыть его ещё раз. Если после этого виден старый отчёт, возникла техническая неполадка — команда уже решает этот вопрос.', mood: 'sad' },
    educators: { question: 'Почему воспитатели не отвечают?', answer: 'Воспитатели находятся с детьми и не могут отвечать в чате круглосуточно. Пожалуйста, наберитесь терпения: они ответят, как только смогут.' },
    delivery: {
      question: 'Что можно передать ребёнку?',
      icon: '1f4e6.svg',
      answer: 'Передать ребёнку можно еду, одежду и нужные вещи в безопасной упаковке.\n\nАдрес доставки: Гринвуд, с11, Путилково. В комментарии для курьера обязательно укажите: «доставка на 5 этаж» и имя ребёнка.\n\nНельзя передавать острые предметы, стекло, металлические банки, энергетики, табачные изделия и личную электронику. Если есть сомнения насчёт вещи или продукта, лучше заранее уточнить у воспитателей.',
      variants: {
        order: 'Доставку можно оформить по адресу: Гринвуд, с11, Путилково. В комментарии для курьера обязательно укажите: «доставка на 5 этаж» и имя ребёнка.\n\nМожно заказать еду, напитки, одежду и нужные вещи в безопасной упаковке.\n\nНельзя заказывать острые предметы, стекло, металлические банки, энергетики, табачные изделия и личную электронику. Если есть сомнения, лучше заранее уточнить у воспитателей.',
        bring: 'Передать вещи можно по адресу: Гринвуд, с11, Путилково. Для курьера обязательно укажите: «доставка на 5 этаж» и имя ребёнка.\n\nПодойдут еда, одежда и нужные вещи в безопасной упаковке.\n\nНе передавайте острые предметы, стекло, металлические банки, энергетики, табачные изделия и личную электронику. Если есть сомнения, лучше заранее уточнить у воспитателей.',
        food: 'Еду и вкусности можно передать или заказать по адресу: Гринвуд, с11, Путилково. В комментарии для курьера обязательно укажите: «доставка на 5 этаж» и имя ребёнка.\n\nЕду лучше передавать в безопасной упаковке.\n\nНельзя стеклянные ёмкости, металлические банки и энергетики. Если есть сомнения насчёт продукта, лучше заранее уточнить у воспитателей.'
      }
    },
    payment: { question: 'Как оплатить?', answer: 'По вопросам оплаты свяжитесь с лечащим врачом. Оплата производится на ресепшене клиники.' },
    meetings: { question: 'Как договориться о встрече или звонке?', answer: 'Встречи и звонки нужно согласовать с лечащим врачом. Он поможет выбрать время с учётом состояния ребёнка и расписания отделения.' },
    doctors: { question: 'Как связаться с лечащим врачом?', answer: 'Анастасия Михайловна\n+79253394090\n\nАнтон Геннадьевич\n+79859927884', icon: '1f4de.svg' },
    medical: { question: 'Вопрос о лечении', answer: 'Вопросы о лечении, препаратах, процедурах и анализах, пожалуйста, обсуждайте с лечащим врачом. У воспитателей и психологов этой информации может не быть.' },
    urgent: { question: 'У меня срочный вопрос', answer: 'Если вопрос срочный, пожалуйста, напишите его в чате с воспитателями. Они ответят, как только смогут.', after: 'educatorChat' },
    signIn: { question: 'Не получается войти', answer: 'По вопросам входа, кода подтверждения и доступа к системе, пожалуйста, напишите воспитателям в чате.', after: 'educatorChat' },
    therapy: { question: 'Где посмотреть психотерапию?', answer: '', after: 'therapy' },
    greeting: { question: 'Добрый день', answer: 'Добрый день', icon: '1f499.svg', iconPosition: 'after', after: 'greetingFollowup' },
    routine: { question: 'Где посмотреть режим дня?', answer: 'Режим дня находится на главном экране системы: нажмите карточку «Режим дня». Там указано расписание занятий, приёмов пищи, прогулок и сна.' },
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
    const bubble = element('div', 'message-bubble', text);
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

  function runScenario(intent, question) {
    const parsed = typeof intent === 'string' ? { key: intent } : intent;
    const scenario = scenarios[parsed && parsed.key];
    if (busy || !scenario) return;
    busy = true;
    message('user', question || scenario.question);
    setThinking(true);
    window.setTimeout(() => {
      const answer = scenario.variants && scenario.variants[parsed.variant] || scenario.answer;
      if (answer) message('bot', answer, scenario.mood || 'neutral', scenario.icon || '', scenario.iconPosition || 'before');
      if (scenario.after === 'reportChoices') offerReportChoices();
      if (scenario.after === 'educatorChat') offerEducatorChat();
      if (scenario.after === 'therapy') offerTherapy();
      if (scenario.after === 'greetingFollowup') window.setTimeout(() => message('bot', 'Как я могу вам помочь?'), 230);
      setThinking(false);
      busy = false;
    }, 380);
  }

  function classify(text) {
    const known = window.MedsiSmartBot && window.MedsiSmartBot.classify(text);
    if (known) return known;
    const simple = String(text || '').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^а-я]+/g, ' ').trim();
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
    const x = Math.max(-rect.width * .17, Math.min(rect.width * .17, dx / 4));
    const y = Math.max(-rect.height * .12, Math.min(rect.height * .12, dy / 4));
    setGaze(x, y);
    pointerActiveUntil = Date.now() + 1500;
  }

  window.addEventListener('pointermove', event => {
    if (event.pointerType === 'mouse') follow(event);
  }, { passive: true });
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.setInterval(() => {
      if (Date.now() < pointerActiveUntil) return;
      setGaze(bot.clientWidth * (.045 + (Math.random() - .5) * .13), bot.clientHeight * (-.06 + (Math.random() - .5) * .11));
    }, 2100);
  }
  setGaze(bot.clientWidth * .10, bot.clientHeight * -.08);
  window.setTimeout(() => {
    message('bot', 'Добрый день, я Медси Бот, отвечу на любые ваши вопросы.', 'neutral', '1f499.svg', 'after');
  }, 220);
})();
