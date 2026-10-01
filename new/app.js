(() => {
  'use strict';

  // Лаборатория помощника: она не читает данные ребёнка и не отправляет сообщения.
  const conversation = document.getElementById('conversation');
  const composer = document.getElementById('composer');
  const input = document.getElementById('messageInput');
  const bot = document.getElementById('bot');
  const botEyes = document.getElementById('botEyes');
  let busy = false;
  let pointerActiveUntil = 0;

  const setGaze = (x, y) => {
    botEyes.style.setProperty('--gaze-x', `${x}px`);
    botEyes.style.setProperty('--gaze-y', `${y}px`);
    document.querySelectorAll('.mini-eyes').forEach(eyes => {
      eyes.style.setProperty('--mini-gaze-x', `${Math.round(x * .13)}px`);
      eyes.style.setProperty('--mini-gaze-y', `${Math.round(y * .13)}px`);
    });
  };

  const scenarios = {
    reports: { question: 'Когда ждать отчёт?', answer: 'Утренний отчёт будет с 15:00 до 16:00, вечерний — с 21:00 до 22:00. Пожалуйста, дождитесь этого времени.', mood: 'neutral' },
    reportDelay: { question: 'Почему до сих пор нет отчёта?', answer: 'Отчёт уже должен был прийти. Пожалуйста, перезагрузите приложение и попробуйте открыть его ещё раз. Если после этого виден старый отчёт, возникла техническая неполадка — команда уже решает этот вопрос.', mood: 'sad' },
    educators: { question: 'Почему воспитатели не отвечают?', answer: 'Воспитатели находятся с детьми и не могут отвечать в чате круглосуточно. Пожалуйста, наберитесь терпения: вопросы и пожелания увидят, а ответ может прийти в следующем отчёте.' },
    delivery: {
      question: 'Что можно передать ребёнку?',
      answer: 'Можно передать еду, одежду и нужные вещи, если они безопасны. Нельзя острые предметы, стекло, металлические банки, табачные изделия, энергетики и личную электронику. Если сомневаетесь, лучше заранее уточнить у воспитателей.',
      variants: {
        order: 'Доставку можно оформить по адресу: Гринвуд, с11, Путилково. В комментарии укажите: «доставка на 5 этаж» и имя ребёнка. Можно заказывать еду, напитки, одежду и нужные вещи, если они безопасны.',
        bring: 'Передать вещи можно по адресу: Гринвуд, с11, Путилково. Для курьера укажите: «доставка на 5 этаж» и имя ребёнка. Нельзя острые предметы, стекло, металлические банки, табачные изделия, энергетики и личную электронику.',
        food: 'Еду и вкусности можно передать или заказать по адресу: Гринвуд, с11, Путилково. В комментарии укажите: «доставка на 5 этаж» и имя ребёнка. Нельзя стекло, металлические банки и энергетики.'
      }
    },
    payment: { question: 'Как оплатить?', answer: 'По вопросам оплаты свяжитесь с лечащим врачом. Оплата производится на ресепшене клиники.' },
    meetings: { question: 'Как договориться о встрече или звонке?', answer: 'Встречи и звонки нужно согласовать с лечащим врачом. Он поможет выбрать время с учётом состояния ребёнка и расписания отделения.' },
    medical: { question: 'Вопрос о лечении', answer: 'Вопросы о лечении, препаратах, процедурах и анализах, пожалуйста, обсуждайте с лечащим врачом. У воспитателей и психологов этой информации может не быть.' },
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
  const scrollToEnd = () => { conversation.scrollTop = conversation.scrollHeight; };

  function avatarMarkup() {
    return '<svg viewBox="0 0 160 160" aria-hidden="true"><path d="M61 6C98 5 145 31 154 70C164 111 128 147 87 156C44 165 4 136 2 95C-1 55 25 8 61 6Z"/></svg><span class="mini-eyes"><i></i><i></i></span>';
  }

  function message(side, text, mood = 'neutral') {
    const item = element('article', `message ${side}`);
    if (side === 'bot') {
      const avatar = element('span', `message-avatar mood-${mood}`);
      avatar.setAttribute('aria-hidden', 'true');
      avatar.innerHTML = avatarMarkup();
      item.appendChild(avatar);
    }
    const content = element('div', 'message-content');
    content.append(element('div', 'message-bubble', text), element('time', 'message-time', clock()));
    item.appendChild(content);
    conversation.appendChild(item);
    scrollToEnd();
  }

  function setThinking(active) { bot.classList.toggle('thinking', active); }

  function offerEducatorChat() {
    const actions = element('div', 'choices');
    const open = element('button', '', 'Открыть чат с воспитателями');
    open.type = 'button';
    open.addEventListener('click', () => {
      // При встраивании в основную панель этот обработчик вызывает её openChat().
      if (typeof window.openMedsiEducatorChat === 'function') return window.openMedsiEducatorChat();
      window.location.assign('/?openChat=1');
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
      message('bot', scenario.variants && scenario.variants[parsed.variant] || scenario.answer, scenario.mood || 'neutral');
      setThinking(false);
      busy = false;
    }, 380);
  }

  function classify(text) {
    const query = ` ${text.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^а-яa-z0-9]+/g, ' ').trim()} `;
    const has = pattern => pattern.test(query);

    // Сначала темы, где ошибка маршрутизации особенно нежелательна.
    if (has(/ (?:оплат|стоимост|цена|платеж)/)) return 'payment';
    if (has(/ (?:врач|лечащ|лечение|лечить|препарат|таблет|лекарств|анализ|процедур|диагноз|терапи)/)) return 'medical';
    if (has(/ (?:встреч|увидет|повидат|навещ|звон|созвон|позвон|поговор|общен)/)) return 'meetings';
    if (has(/(?:до сих пор.*отчет|почему.*отчет|нет отчет|не приш.*отчет|жду.*отчет)/)) return 'reportDelay';
    if (has(/ (?:отчет|утренн|вечерн|наблюден)/)) return 'reports';
    if (has(/ (?:режим|расписан|распоряд|подьем|завтрак|обед|полдник|ужин|сон час|отбой|прогулк|занят)/)) return 'routine';

    const deliveryVerb = has(/ (?:достав|переда|привез|принес|заказ|отправ|полож|куп)/);
    const deliveryThing = has(/ (?:еда|еду|вкусн|сладост|фрукт|пицц|суш|напит|одежд|вещ|посыл|передач|игрушк|книг|продукт)/);
    if (deliveryVerb || deliveryThing) {
      if (has(/ (?:заказ|оформ|достав)/)) return { key: 'delivery', variant: 'order' };
      if (has(/ (?:привез|принес|переда|отправ)/)) return { key: 'delivery', variant: 'bring' };
      if (has(/ (?:еда|еду|вкусн|сладост|фрукт|пицц|суш|напит|продукт)/)) return { key: 'delivery', variant: 'food' };
      return 'delivery';
    }

    if (has(/(?:не отвеч|нет ответ|долго молч|почему молч|когда ответ|воспитател|написат.*вопрос| чат )/)) return 'educators';
    if (has(/(?:спасибо|благодар|супер|отлично|здорово)/)) return 'thanks';
    if (has(/(?:экран домой| домой |приложен|установ|ярлык)/)) return 'home';
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
    const x = Math.max(-rect.width * .24, Math.min(rect.width * .24, dx / 4));
    const y = Math.max(-rect.height * .19, Math.min(rect.height * .19, dy / 4));
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
  setGaze(bot.clientWidth * .14, bot.clientHeight * -.12);
  window.setTimeout(() => {
    message('bot', 'Добрый день, я Медси Бот, отвечу на любые ваши вопросы 🙂');
  }, 220);
})();
