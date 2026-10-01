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
      const icon = element('span', 'action-icon', choice.icon);
      icon.setAttribute('aria-hidden', 'true');
      button.append(icon, element('span', '', choice.label));
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
      morning: { icon: '☀️', title: 'Утренний отчёт', className: 'morning' },
      evening: { icon: '☾', title: 'Вечерний отчёт', className: 'evening' },
      therapy: { icon: '✿', title: 'Групповая психотерапия', className: 'therapy' }
    };
    const type = types[kind];
    const stack = message('bot', 'Вот как последний актуальный отчёт будет появляться прямо в беседе.');
    const card = element('article', 'report-preview');
    const top = element('div', `report-top ${type.className}`);
    const heading = element('div');
    heading.append(element('strong', '', type.title), element('small', '', 'Карточка будущего отчёта'));
    top.append(element('span', 'report-icon', type.icon), heading);
    const body = element('div', 'report-body');
    body.append(element('p', '', 'Здесь появится последний настоящий отчёт после подключения защищённого входа.'), element('div', 'demo-line'), element('div', 'demo-line short'));
    card.append(top, body, element('div', 'report-foot', 'Демонстрация оформления · без данных ребёнка'));
    stack.insertBefore(card, stack.lastChild);
    actions(stack, [
      { icon: '💬', label: 'Написать воспитателям', action: 'educators', full: true },
      { icon: '☀️', label: 'Утренний', action: 'morning' },
      { icon: '☾', label: 'Вечерний', action: 'evening' }
    ]);
  }

  function schedule() {
    const stack = message('bot', 'Пример того, как будет выглядеть режим дня.');
    const card = element('article', 'report-preview');
    const top = element('div', 'report-top');
    top.append(element('span', 'report-icon', '◷'), element('strong', '', 'Режим дня'));
    const body = element('div', 'report-body');
    const list = element('ul', 'schedule-list');
    for (const [time, activity] of [['08:00', 'Подъём'], ['09:00', 'Завтрак'], ['10:00', 'Групповая психотерапия'], ['13:00', 'Обед'], ['17:00', 'Игры и творчество'], ['22:00', 'Отбой']]) {
      const item = element('li');
      item.append(element('time', '', time), element('span', '', activity));
      list.appendChild(item);
    }
    body.appendChild(list);
    card.append(top, body, element('div', 'report-foot', 'Пример расписания · уточняется в рабочей версии'));
    stack.insertBefore(card, stack.lastChild);
  }

  function response(action) {
    if (action === 'morning' || action === 'evening' || action === 'therapy') return report(action);
    if (action === 'schedule') return schedule();
    if (action === 'report-choice') {
      const stack = message('bot', 'Какой отчёт показать?');
      actions(stack, [
        { icon: '☀️', label: 'Утренний отчёт', action: 'morning' },
        { icon: '☾', label: 'Вечерний отчёт', action: 'evening' },
        { icon: '✿', label: 'Психотерапия', action: 'therapy', full: true }
      ]);
      return;
    }
    if (action === 'educators') {
      const stack = message('bot', 'Переход к воспитателям будет открывать обычную переписку с ними. Мои подсказки и отчёты в их панели не появятся. Сейчас это только пример интерфейса — сообщение никому не отправляется.');
      actions(stack, [{ icon: '↗', label: 'Посмотреть будущий чат', action: 'educator-preview', full: true }]);
      return;
    }
    if (action === 'educator-preview') {
      const stack = message('bot', 'Так может выглядеть переход: отдельный чат с воспитателями, где будут только ваши и их сообщения. Подключение настоящей переписки сделаем после утверждения дизайна.');
      actions(stack, [{ icon: '←', label: 'Вернуться к помощнику', action: 'home', full: true }]);
      return;
    }
    if (action === 'home') {
      const stack = message('bot', 'Я рядом. Что посмотрим дальше?');
      homeActions(stack);
      return;
    }
    if (action === 'offer-educators') {
      const stack = message('bot', 'Похоже, этот вопрос лучше адресовать воспитателям. Хотите открыть чат с ними? Ваш текст пока остаётся только в этой пробной беседе.');
      actions(stack, [
        { icon: '💬', label: 'Да, открыть чат', action: 'educators' },
        { icon: '✳', label: 'Нет, к возможностям', action: 'home' }
      ]);
    }
  }

  function homeActions(stack) {
    actions(stack, [
      { icon: '☀️', label: 'Утренний отчёт', action: 'morning' },
      { icon: '☾', label: 'Вечерний отчёт', action: 'evening' },
      { icon: '✿', label: 'Психотерапия', action: 'therapy' },
      { icon: '◷', label: 'Режим дня', action: 'schedule' },
      { icon: '💬', label: 'Написать воспитателям', action: 'educators', full: true }
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
    const stack = message('bot', 'Здравствуйте! Я Медси Бот ✳\n\nЗдесь можно быстро получить нужный отчёт, посмотреть режим дня или перейти к разговору с воспитателями. С чего начнём?');
    homeActions(stack);
  }, 350);
})();
