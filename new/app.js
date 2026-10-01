(() => {
  'use strict';

  // Лаборатория помощника: она не читает данные ребёнка и не отправляет сообщения.
  const conversation = document.getElementById('conversation');
  const composer = document.getElementById('composer');
  const input = document.getElementById('messageInput');
  const bot = document.getElementById('bot');
  const botEyes = document.getElementById('botEyes');
  let busy = false;

  const scenarios = {
    reports: { question: 'Когда ждать отчёт?', answer: 'Утренний отчёт появляется с 15:00 до 16:00, вечерний — с 21:00 до 22:00. Если отчёт ещё не появился, пожалуйста, подождите до окончания этого времени.' },
    educators: { question: 'Почему воспитатели не отвечают?', answer: 'Воспитатели находятся с детьми и не могут отвечать в чате круглосуточно. Пожалуйста, наберитесь терпения: вопросы и пожелания увидят, а ответ может прийти в следующем отчёте.' },
    delivery: { question: 'Что можно передать ребёнку?', answer: 'Можно передать еду, одежду и нужные вещи, если они безопасны. Нельзя острые предметы, стекло, металлические банки, табачные изделия, энергетики и личную электронику. Если сомневаетесь, лучше заранее уточнить у воспитателей.' },
    meetings: { question: 'Как договориться о встрече или звонке?', answer: 'Встречи и звонки нужно согласовать с лечащим врачом. Он поможет выбрать время с учётом состояния ребёнка и расписания отделения.' },
    medical: { question: 'Вопрос о лечении', answer: 'Вопросы о лечении, препаратах, процедурах и анализах, пожалуйста, обсуждайте с лечащим врачом. У воспитателей и психологов этой информации может не быть.' },
    routine: { question: 'Где посмотреть режим дня?', answer: 'Режим дня находится на главном экране системы: нажмите карточку «Режим дня». Там указано расписание занятий, приёмов пищи, прогулок и сна.' },
    home: { question: 'Как добавить систему на экран «Домой»?', answer: 'На главном экране есть подсказка по добавлению Медси Бота на экран «Домой». После этого система будет открываться как обычное приложение.' }
  };

  const clock = () => new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' }).format(new Date());
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const scrollToEnd = () => { conversation.scrollTop = conversation.scrollHeight; };

  function message(side, text) {
    const item = element('article', `message ${side}`);
    item.append(element('div', 'message-bubble', text), element('time', 'message-time', clock()));
    conversation.appendChild(item);
    scrollToEnd();
  }

  function showChoices() {
    const choices = element('div', 'choices');
    for (const [key, scenario] of Object.entries(scenarios)) {
      const button = element('button', '', scenario.question);
      button.type = 'button';
      button.addEventListener('click', () => runScenario(key));
      choices.appendChild(button);
    }
    conversation.appendChild(choices);
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

  function runScenario(key) {
    if (busy || !scenarios[key]) return;
    busy = true;
    message('user', scenarios[key].question);
    setThinking(true);
    window.setTimeout(() => {
      message('bot', scenarios[key].answer);
      setThinking(false);
      busy = false;
    }, 380);
  }

  function classify(text) {
    const query = ` ${text.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^а-яa-z0-9]+/g, ' ').trim()} `;
    const has = pattern => pattern.test(query);

    // Сначала темы, где ошибка маршрутизации особенно нежелательна.
    if (has(/ (?:врач|лечащ|лечение|лечить|препарат|таблет|лекарств|анализ|процедур|диагноз|терапи)/)) return 'medical';
    if (has(/ (?:встреч|увидет|повидат|навещ|звон|созвон|позвон|поговор|общен)/)) return 'meetings';
    if (has(/ (?:отчет|утренн|вечерн|наблюден)/)) return 'reports';
    if (has(/ (?:режим|расписан|распоряд|подьем|завтрак|обед|полдник|ужин|сон час|отбой|прогулк|занят)/)) return 'routine';

    const deliveryVerb = has(/ (?:достав|переда|привез|принес|заказ|отправ|полож|куп)/);
    const deliveryThing = has(/ (?:еда|еду|вкусн|сладост|фрукт|пицц|суш|напит|одежд|вещ|посыл|передач|игрушк|книг|продукт)/);
    if (deliveryVerb || deliveryThing) return 'delivery';

    if (has(/(?:не отвеч|нет ответ|долго молч|почему молч|когда ответ|воспитател|написат.*вопрос| чат )/)) return 'educators';
    if (has(/(?:экран домой| домой |приложен|установ|ярлык)/)) return 'home';
    return null;
  }

  composer.addEventListener('submit', event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    const scenario = classify(text);
    if (scenario) return runScenario(scenario);
    message('user', text);
    setThinking(true);
    busy = true;
    window.setTimeout(() => {
      message('bot', 'Этот вопрос лучше задать в чате с воспитателями. Хотите открыть чат?');
      offerEducatorChat();
      setThinking(false);
      busy = false;
    }, 380);
  });

  function follow(point) {
    const rect = bot.getBoundingClientRect();
    const dx = point.clientX - (rect.left + rect.width / 2);
    const dy = point.clientY - (rect.top + rect.height / 2);
    const x = Math.max(-5, Math.min(5, dx / 28));
    const y = Math.max(-4, Math.min(4, dy / 28));
    botEyes.style.setProperty('--gaze-x', `${x}px`);
    botEyes.style.setProperty('--gaze-y', `${y}px`);
  }

  window.addEventListener('pointermove', follow, { passive: true });
  window.addEventListener('pointerdown', follow, { passive: true });
  window.setTimeout(() => {
    message('bot', 'Я Медси Бот. Подскажу, где найти нужную информацию и как пользоваться системой.');
    showChoices();
  }, 220);
})();
