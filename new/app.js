(() => {
  'use strict';

  // Visual prototype only. No network calls, account access or message delivery.
  const conversation = document.getElementById('conversation');
  const composer = document.getElementById('composer');
  const input = document.getElementById('messageInput');
  const avatar = document.querySelector('.header-avatar');
  let busy = false;

  const clock = () => new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' }).format(new Date());
  const scrollToEnd = () => { conversation.scrollTop = conversation.scrollHeight; };
  const element = (tag, className, content) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  };
  const icons = {
    morning: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5"></circle><path d="M12 2v2.2M12 19.8V22M2 12h2.2M19.8 12H22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M19.1 4.9l-1.6 1.6M6.5 17.5l-1.6 1.6"></path></svg>',
    evening: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 15.1A8.2 8.2 0 0 1 8.9 4.6 8.2 8.2 0 1 0 19.4 15.1Z"></path></svg>',
    therapy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.2a3.1 3.1 0 0 1 5.2-1.4 3.1 3.1 0 0 1 3 4.8 3.4 3.4 0 0 1-1.5 6.2 3.2 3.2 0 0 1-5.4 3 3.1 3.1 0 0 1-5.8-1.1 3.3 3.3 0 0 1-3.7-4.9 3.2 3.2 0 0 1 1.3-5.8A3.1 3.1 0 0 1 12 5.2Z"></path><path d="M12 5v14M8.3 9.2h3.6M12 14.5h3.4"></path></svg>',
    schedule: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.2"></circle><path d="M12 7v5l3.4 2"></path></svg>',
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.4a7.2 7.2 0 0 1-7.4 7.1 8.6 8.6 0 0 1-3.3-.7L4 19.5l1.5-4.1A7 7 0 0 1 5 12.7a7.2 7.2 0 0 1 7.4-7.1A7.2 7.2 0 0 1 20 11.4Z"></path><path d="M8.9 11.7h.1M12.3 11.7h.1M15.7 11.7h.1"></path></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13m-5-5 5 5-5 5"></path></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H6m5-5-5 5 5 5"></path></svg>'
  };
  const iconElement = name => {
    const node = element('span', 'action-icon');
    node.setAttribute('aria-hidden', 'true');
    node.innerHTML = icons[name] || icons.chat;
    return node;
  };

  function message(side, text) {
    const row = element('div', `message-row ${side}`);
    if (side === 'bot') {
      const icon = element('div', 'mini-avatar');
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = '<span class="bot-face"><span class="bot-eye"></span><span class="bot-eye"></span><span class="bot-mouth"></span></span>';
      row.appendChild(icon);
    }
    const stack = element('div', 'message-stack');
    const bubble = element('div', 'bubble');
    bubble.textContent = text;
    stack.append(bubble, element('span', 'message-time', clock()));
    row.appendChild(stack);
    conversation.appendChild(row);
    scrollToEnd();
    return stack;
  }

  function actions(stack, choices) {
    const grid = element('div', 'action-grid');
    for (const choice of choices) {
      const button = element('button', `quick-action${choice.full ? ' full' : ''}`, '');
      button.type = 'button';
      button.append(iconElement(choice.icon), element('span', '', choice.label));
      button.addEventListener('click', () => {
        if (busy) return;
        message('user', choice.label);
        respond(choice.action);
      });
      grid.appendChild(button);
    }
    stack.insertBefore(grid, stack.lastChild);
    scrollToEnd();
  }

  function report(kind) {
    const types = {
      morning: { icon: 'morning', title: 'Утренний отчёт', className: 'morning' },
      evening: { icon: 'evening', title: 'Вечерний отчёт', className: 'evening' },
      therapy: { icon: 'therapy', title: 'Групповая психотерапия', className: 'therapy' }
    };
    const type = types[kind];
    const stack = message('bot', 'Последний отчёт:');
    const card = element('article', 'report-preview');
    const top = element('div', `report-top ${type.className}`);
    const heading = element('div');
    heading.append(element('strong', '', type.title), element('small', '', 'В карточке будет показан последний текст'));
    const reportIcon = element('span', 'report-icon');
    reportIcon.setAttribute('aria-hidden', 'true');
    reportIcon.innerHTML = icons[type.icon];
    top.append(reportIcon, heading);
    const body = element('div', 'report-body');
    body.append(element('p', '', 'Текст отчёта появится здесь после подключения учётной записи.'), element('div', 'demo-line'), element('div', 'demo-line short'));
    card.append(top, body);
    stack.insertBefore(card, stack.lastChild);
    actions(stack, [
      { icon: 'chat', label: 'Написать воспитателям', action: 'educators', full: true },
      { icon: 'morning', label: 'Утренний', action: 'morning' },
      { icon: 'evening', label: 'Вечерний', action: 'evening' }
    ]);
  }

  function schedule() {
    const stack = message('bot', 'Режим дня:');
    const card = element('article', 'report-preview');
    const top = element('div', 'report-top');
    const scheduleIcon = element('span', 'report-icon');
    scheduleIcon.setAttribute('aria-hidden', 'true');
    scheduleIcon.innerHTML = icons.schedule;
    top.append(scheduleIcon, element('strong', '', 'Режим дня'));
    const body = element('div', 'report-body');
    const list = element('ul', 'schedule-list');
    for (const [time, activity] of [['08:00', 'Подъём'], ['09:00', 'Завтрак'], ['10:00', 'Групповая психотерапия'], ['13:00', 'Обед'], ['17:00', 'Игры и творчество'], ['22:00', 'Отбой']]) {
      const item = element('li');
      item.append(element('time', '', time), element('span', '', activity));
      list.appendChild(item);
    }
    body.appendChild(list);
    card.append(top, body);
    stack.insertBefore(card, stack.lastChild);
  }

  function response(action) {
    if (action === 'morning' || action === 'evening' || action === 'therapy') return report(action);
    if (action === 'schedule') return schedule();
    if (action === 'report-choice') {
      const stack = message('bot', 'Какой отчёт показать?');
      actions(stack, [
        { icon: 'morning', label: 'Утренний отчёт', action: 'morning' },
        { icon: 'evening', label: 'Вечерний отчёт', action: 'evening' },
        { icon: 'therapy', label: 'Психотерапия', action: 'therapy', full: true }
      ]);
      return;
    }
    if (action === 'educators') {
      const stack = message('bot', 'Открою чат с воспитателями. В нём будут только ваши сообщения и их ответы.');
      actions(stack, [{ icon: 'arrow', label: 'Открыть чат с воспитателями', action: 'educator-preview', full: true }]);
      return;
    }
    if (action === 'educator-preview') {
      const stack = message('bot', 'Чат с воспитателями подключим после утверждения этого интерфейса.');
      actions(stack, [{ icon: 'back', label: 'Вернуться к помощнику', action: 'home', full: true }]);
      return;
    }
    if (action === 'home') {
      const stack = message('bot', 'Я рядом. Что посмотрим дальше?');
      homeActions(stack);
      return;
    }
    if (action === 'offer-educators') {
      const stack = message('bot', 'Похоже, этот вопрос лучше адресовать воспитателям. Открыть чат с ними?');
      actions(stack, [
        { icon: 'chat', label: 'Да, открыть чат', action: 'educators' },
        { icon: 'back', label: 'Нет, к возможностям', action: 'home' }
      ]);
    }
  }

  function homeActions(stack) {
    actions(stack, [
      { icon: 'morning', label: 'Утренний отчёт', action: 'morning' },
      { icon: 'evening', label: 'Вечерний отчёт', action: 'evening' },
      { icon: 'therapy', label: 'Психотерапия', action: 'therapy' },
      { icon: 'schedule', label: 'Режим дня', action: 'schedule' },
      { icon: 'chat', label: 'Написать воспитателям', action: 'educators', full: true }
    ]);
  }

  function respond(action) {
    busy = true;
    avatar.classList.add('thinking');
    const row = element('div', 'message-row bot');
    const icon = element('div', 'mini-avatar');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<span class="bot-face"><span class="bot-eye"></span><span class="bot-eye"></span><span class="bot-mouth"></span></span>';
    const typing = element('div', 'bubble typing');
    typing.innerHTML = '<i></i><i></i><i></i>';
    row.append(icon, typing);
    conversation.appendChild(row);
    scrollToEnd();
    setTimeout(() => {
      row.remove();
      avatar.classList.remove('thinking');
      response(action);
      busy = false;
    }, 480);
  }

  function classify(text) {
    const query = text.toLocaleLowerCase('ru').replace(/ё/g, 'е');
    if (/режим|расписан|распоряд|когда (сон|обед|завтрак)/.test(query)) return 'schedule';
    if (/воспитател|написать|сообщени|чат|связаться/.test(query)) return 'educators';
    if (/психотерап|психолог|группов|терап/.test(query)) return 'therapy';
    if (/утрен|утро/.test(query)) return 'morning';
    if (/вечерн|вечер/.test(query)) return 'evening';
    if (/отчет|наблюден/.test(query)) return 'report-choice';
    return 'offer-educators';
  }

  composer.addEventListener('submit', event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    message('user', text);
    respond(classify(text));
  });

  setTimeout(() => {
    const stack = message('bot', 'Здравствуйте! Что хотите посмотреть?');
    homeActions(stack);
  }, 350);
})();
