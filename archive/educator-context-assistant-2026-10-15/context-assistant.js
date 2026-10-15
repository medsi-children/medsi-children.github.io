// ARCHIVE ONLY — do not load in production.
// Extracted from chat-overlay/educator-chat.js at 482f290f6ced713f315b7ad0332966163b2b4bac.

  function tutorAssistantText(value){return String(value||'').toLocaleLowerCase('ru').replace(/ё/g,'е')}
  function tutorAssistantRisky(value){
    const text=tutorAssistantText(value);
    return /(?:срочн|экстренн|неотложн|немедленн|жалоб|претенз|возмущ|сколько можно|безобраз|ужас|игнор|почему вы|вы не отвеч|требую|угроз)/.test(text)
      || /(?:болит|температур|тошнит|рвот|рвет|плохо|слабост|обморок|кров|дыш|удуш|тревог|паник|плач|истерик|суицид|самоповреж|ухудш)/.test(text)
      || /(?:передайте|позовите|попросите|проверьте|ответьте|разбудите|подойдите|перезвоните|позвоните)\s/.test(text);
  }
  function tutorReportKind(text){return /утренн/.test(text)&&!/вечерн/.test(text)?'morning':/вечерн/.test(text)&&!/утренн/.test(text)?'evening':''}
  function tutorMoscowMinutes(now){
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
    return Number(parts.hour)*60+Number(parts.minute);
  }
  function tutorReportState(kind,now){
    const minutes=tutorMoscowMinutes(now);
    if(kind==='morning'){if(minutes<180)return'night';if(minutes<900)return'before';if(minutes<960)return'window';return'late'}
    if(minutes<180)return'late';if(minutes<1260)return'before';if(minutes<1320)return'window';return'late';
  }
  function tutorReportScheduleReply(kind){
    if(kind==='morning')return'💌 Дорогие родители!\n\n☀️ Утренний отчёт публикуется с 15:00 до 16:00. Пожалуйста, дождитесь окончания окна публикации.\n\n🩵 Спасибо за понимание!\nДетское Отделение Медси';
    if(kind==='evening')return'💌 Дорогие родители!\n\n🌙 Вечерний отчёт публикуется с 21:00 до 22:00. Пожалуйста, дождитесь окончания окна публикации.\n\n🩵 Спасибо за понимание!\nДетское Отделение Медси';
    return'💌 Дорогие родители!\n\n🔔 Расписание отчётов:\n☀️ Утренний — с 15:00 до 16:00.\n🌙 Вечерний — с 21:00 до 22:00.\n\n🩵 Спасибо за понимание!\nДетское Отделение Медси';
  }
  function tutorSuggestionPlan(raw,now=Date.now()){
    const text=tutorAssistantText(raw);
    if(!text.trim()||tutorAssistantRisky(text))return null;
    const reportTopic=/(?:отчет|сводк|утренн|вечерн)/.test(text);
    const deliveryTopic=/(?:достав|курьер|переда|привез|посыл|гринвуд)/.test(text);
    const medicalTopic=/(?:лекарств|таблет|препарат|медикамент|дозиров|лечен|процедур|анализ)/.test(text);
    const doctorContacts=/(?:телефон|номер|контакт|связаться|позвонить)[^.?!]*(?:врач|доктор|анастаси|антон)|(?:врач|доктор|анастаси|антон)[^.?!]*(?:телефон|номер|контакт|связаться)/.test(text);
    if(doctorContacts)return{key:'doctors',topic:'контактами врача',reply:QUICK_REPLIES.doctors};
    if([reportTopic,deliveryTopic,medicalTopic].filter(Boolean).length>1)return null;
    if(reportTopic){
      if(/(?:в отчет[а-я]*|в сводк[а-я]*)[^.?!]*(?:напис|указ|ошиб|невер|неправ|лекар|препарат|лечен|состояни)|почему[^.?!]*(?:в отчет|в сводк)/.test(text))return null;
      const kind=tutorReportKind(text);
      const asksTime=/(?:когда|во сколько|в какое время|к скольк|расписан)/.test(text);
      const missing=/(?:нет|нету|не приш|не появ|не виж|где|задерж|опазд|стар)/.test(text);
      if(asksTime&&!missing)return{key:'reportSchedule',topic:'сроками отчёта',reply:tutorReportScheduleReply(kind)};
      if(missing){
        if(!kind)return null;
        const state=tutorReportState(kind,now);
        if(state==='night')return null;
        if(state==='before'||state==='window')return{key:'reportSchedule',topic:'сроками отчёта',reply:tutorReportScheduleReply(kind)};
        return{key:'reportDelay',topic:'задержкой отчёта',reply:QUICK_REPLIES.reportDelay};
      }
      return null;
    }
    if(deliveryTopic){
      if(/(?:спасибо|уже|получ|приех|едет|опозд|не достав|отмен|не надо|потер|забрал|доех)/.test(text))return null;
      if(/[?]/.test(String(raw||''))||/(?:можно|нельзя|что|куда|адрес|этаж|как|разреш|допуст|привезти|передать|заказать|курьеру)/.test(text))return{key:'delivery',topic:'доставкой',reply:QUICK_REPLIES.delivery};
      return null;
    }
    if(medicalTopic){
      if(/[?]/.test(String(raw||''))||/(?:можно|нужно|как|какая|какие|сколько|кому|куда|кто|почему|по поводу)/.test(text))return{key:'medical',topic:'медицинским вопросом',reply:QUICK_REPLIES.therapy};
    }
    return null;
  }

// Runtime portion originally inside mount():
    let tutorAssistantCard=null,tutorAssistantSourceKey='',tutorAssistantSeen=new Set();
    const THREAD_LOAD_TIMEOUT_MS=8000;

    function closeTutorAssistant(){if(tutorAssistantCard){tutorAssistantCard.remove();tutorAssistantCard=null}tutorAssistantSourceKey=''}
    function makeTutorSuggestion(message){
      if(!message||message.side!=='parent'||message.type!=='text')return false;
      const key=messageKey(message);
      if(!key||tutorAssistantSeen.has(key))return false;
      if(editorText()){tutorAssistantSeen.add(key);return false}
      const plan=tutorSuggestionPlan(message.text);
      if(!plan)return false;
      tutorAssistantSeen.add(key);closeTutorAssistant();tutorAssistantSourceKey=key;
      const card=document.createElement('section');card.className='tutor-assistant-suggestion is-compact';card.setAttribute('aria-live','polite');
      const close=document.createElement('button');close.type='button';close.className='tutor-assistant-close';close.setAttribute('aria-label','Закрыть подсказку');close.textContent='×';close.onclick=closeTutorAssistant;
      const mark=document.createElement('span');mark.className='tutor-assistant-mark';mark.setAttribute('aria-hidden','true');mark.innerHTML='<span class="medsi-character"><img class="medsi-character-body" src="/parents/blob.webp" alt=""><span class="medsi-character-eyes"><i class="medsi-character-eye"></i><i class="medsi-character-eye"></i></span></span>';
      const title=document.createElement('strong');title.textContent='Медси Бот';
      const body=document.createElement('div');body.className='tutor-assistant-copy';
      const actions=document.createElement('div');actions.className='tutor-assistant-actions';
      const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='secondary';dismiss.textContent='Нет';dismiss.onclick=closeTutorAssistant;
      const prepare=document.createElement('button');prepare.type='button';prepare.textContent='Да';
      function showPrompt(){card.classList.add('is-compact');card.classList.remove('is-expanded');body.textContent='Кажется, здесь могу помочь. Предложить ответ?';actions.replaceChildren(prepare,dismiss)}
      prepare.onclick=()=>{
        card.classList.remove('is-compact');card.classList.add('is-expanded');body.textContent=plan.reply;actions.replaceChildren();
        const sendReply=document.createElement('button');sendReply.type='button';sendReply.textContent='Отправить';sendReply.onclick=()=>{if(editorText()){closeTutorAssistant();return}closeTutorAssistant();editor.textContent=plan.reply;focusEditor();submit()};
        const back=document.createElement('button');back.type='button';back.className='secondary';back.textContent='Назад';back.onclick=showPrompt;
        actions.append(sendReply,back);
      };
      showPrompt();card.append(close,mark,title,body,actions);document.body.appendChild(card);tutorAssistantCard=card;return true;
    }
    function tutorMessageHasLaterReply(list,key){
      const index=list.findIndex(item=>messageKey(item)===key);
      return index>=0&&list.slice(index+1).some(item=>item&&item.side==='educator');
    }
    function detectTutorSuggestion(previous,next){
      if(!Array.isArray(next)||!Array.isArray(previous))return;
      if(tutorAssistantCard&&tutorAssistantSourceKey&&tutorMessageHasLaterReply(next,tutorAssistantSourceKey))closeTutorAssistant();
      const old=new Set(previous.map(messageKey));
      if(!initialMessagesRendered){
        for(let i=next.length-1;i>=0;i--){const row=next[i];if(!row||row.side!=='parent')continue;
          const key=messageKey(row),stamp=Number(row.timestamp),age=Date.now()-(stamp<1e12?stamp*1000:stamp);
          const hasLaterEducatorReply=next.slice(i+1).some(item=>item&&item.side==='educator');
          if(stamp&&(age<0||age>24*60*60*1000))return;
          if(hasLaterEducatorReply){tutorAssistantSeen.add(key);return}
          makeTutorSuggestion(row);return;
        }
        return;
      }
      for(let i=next.length-1;i>=0;i--){
        const row=next[i];if(!row||row.side!=='parent'||old.has(messageKey(row)))continue;
        const key=messageKey(row),stamp=Number(row.timestamp),age=Date.now()-(stamp<1e12?stamp*1000:stamp);
        if(stamp&&(age<0||age>24*60*60*1000)){tutorAssistantSeen.add(key);continue}
        if(next.slice(i+1).some(item=>item&&item.side==='educator')){tutorAssistantSeen.add(key);continue}
        if(makeTutorSuggestion(row))return;
      }
    }
