(function(){
  const META_HEADINGS={
    'тема':'Тема групповой психотерапии','тема групповой психотерапии':'Тема групповой психотерапии',
    'цель':'Цель групповой психотерапии','цель групповой психотерапии':'Цель групповой психотерапии',
    'возрастная категория':'Возрастная категория'
  };
  const SECTION_HEADINGS=['начало','вводная часть','разогрев','интерактивная часть','основная часть','практическое упражнение','заключительная часть','выводы','рефлексия','в завершении','завершение'];
  const CANONICAL={
    'начало':'Начало','вводная часть':'Вводная часть','разогрев':'Разогрев','интерактивная часть':'Интерактивная часть',
    'основная часть':'Основная часть','практическое упражнение':'Практическое упражнение','заключительная часть':'Заключительная часть',
    'выводы':'Выводы','рефлексия':'Рефлексия','в завершении':'В завершении','завершение':'Завершение'
  };
  const ARROW='⟦ARROW⟧';
  const META_ALT='ТЕМА(?: групповой психотерапии)?|ЦЕЛЬ(?: групповой психотерапии)?|Возрастная категория';
  const SECTION_ALT='НАЧАЛО|Начало|Вводная часть|РАЗОГРЕВ|Разогрев|Интерактивная часть|Основная часть|Практическое упражнение|Заключительная часть|Выводы|Рефлексия|В завершении|Завершение';

  function capitalize(text){
    const s=String(text||'').trim();if(!s)return s;
    const i=s.search(/[A-Za-zА-Яа-яЁё]/u);if(i<0)return s;
    return s.slice(0,i)+s[i].toLocaleUpperCase('ru-RU')+s.slice(i+1);
  }
  function stripEmoji(text){
    return String(text||'')
      .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu,'')
      .replace(/[ \t]{2,}/g,' ')
      .trim();
  }
  function normalizeText(text){
    return String(text||'')
      .replace(/\r\n?/g,'\n')
      .replace(/➡️?/gu,ARROW)
      .replace(/([1-9])️⃣/gu,'$1.')
      .replace(/[➀➊①]/gu,'1.').replace(/[➁➋②]/gu,'2.').replace(/[➂➌③]/gu,'3.')
      .replace(/[➃➍④]/gu,'4.').replace(/[➄➎⑤]/gu,'5.').replace(/[➅➏⑥]/gu,'6.')
      .replace(/[➆➐⑦]/gu,'7.').replace(/[➇➑⑧]/gu,'8.').replace(/[➈➒⑨]/gu,'9.')
      .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu,'')
      .replace(/[ \t]+\n/g,'\n')
      .replace(/[ \t]{2,}/g,' ')
      .replace(/\n{3,}/g,'\n\n')
      .trim();
  }
  function addBreaks(s){
    const meta=new RegExp('(?:^|\\s|\\n)(?=(?:'+META_ALT+')(?=\\s|:|$))','giu');
    const numbered=new RegExp('(?:^|\\s|\\n)(?=(?:[1-9]\\.\\s*)?(?:'+SECTION_ALT+')(?=\\s|:|\\(|$))','giu');
    return s.replace(meta,m=>m.includes('\n')?m:'\n\n').replace(numbered,m=>m.includes('\n')?m:'\n\n');
  }
  function parseHeading(block){
    const s=stripEmoji(block).trim();
    let m=s.match(new RegExp('^(?:('+META_ALT+'))\\s*:?\\s*([\\s\\S]*)$','iu'));
    if(m){
      const key=m[1].toLocaleLowerCase('ru-RU');
      return {type:'meta',title:META_HEADINGS[key]||capitalize(m[1]),body:capitalize(m[2])};
    }
    m=s.match(new RegExp('^(?:([1-9])\\.\\s*)?('+SECTION_ALT+')\\s*:?\\s*([\\s\\S]*)$','iu'));
    if(m){
      const key=m[2].toLocaleLowerCase('ru-RU');
      return {type:'section',number:m[1]||'',title:CANONICAL[key]||capitalize(m[2]),body:m[3]||''};
    }
    return null;
  }
  function splitBody(body){
    const clean=String(body||'').trim();if(!clean)return [];
    if(!clean.includes(ARROW))return [{type:'paragraph',text:capitalize(clean)}];
    const parts=clean.split(ARROW).map(x=>x.trim()).filter(Boolean);
    if(!parts.length)return [];
    const out=[];
    if(parts[0]&&!clean.startsWith(ARROW))out.push({type:'paragraph',text:capitalize(parts.shift())});
    const shortRun=parts.length>1&&parts.every(x=>x.length<=105&&!/[.!?].{45,}/u.test(x));
    if(shortRun){out.push({type:'list',items:parts.map(capitalize)});return out}
    for(const p of parts){
      const sub=p.match(/^(Выполнение техники|Практическое упражнение|Упражнение\s+[«“\"]?[^:]{0,70}|В завершении|Обратная связь)\s*:?\s*([\s\S]*)$/iu);
      if(sub&&sub[2].trim())out.push({type:'subsection',title:capitalize(sub[1]),text:capitalize(sub[2])});
      else out.push({type:'paragraph',text:capitalize(p)});
    }
    return out;
  }
  function parse(text){
    let s=addBreaks(normalizeText(text));if(!s)return {meta:[],sections:[],tail:[]};
    const chunks=s.split(/\n\s*\n+/u).map(x=>x.trim()).filter(Boolean);
    const meta=[],sections=[],tail=[];
    let current=null;
    for(const chunk of chunks){
      const h=parseHeading(chunk);
      if(h&&h.type==='meta'){meta.push({...h,body:stripEmoji(h.body)});current=null;continue}
      if(h&&h.type==='section'){
        current={number:h.number,title:h.title,parts:splitBody(h.body)};sections.push(current);continue
      }
      const body=splitBody(chunk);
      if(current)current.parts.push(...body);else tail.push(...body);
    }
    return {meta,sections,tail};
  }
  function appendParts(parent,parts){
    for(const part of parts){
      if(part.type==='list'){
        const ul=document.createElement('ul');ul.className='psych-list';
        for(const item of part.items){const li=document.createElement('li');li.textContent=stripEmoji(item);ul.appendChild(li)}
        parent.appendChild(ul);continue;
      }
      if(part.type==='subsection'){
        const box=document.createElement('div');box.className='psych-subsection';
        const h=document.createElement('div');h.className='psych-subheading';h.textContent=stripEmoji(part.title);
        const p=document.createElement('p');p.textContent=stripEmoji(part.text);box.append(h,p);parent.appendChild(box);continue;
      }
      const p=document.createElement('p');p.className='psych-paragraph';p.textContent=stripEmoji(part.text);parent.appendChild(p);
    }
  }
  function render(container,text){
    if(!container)return false;
    const data=parse(text);if(!data.meta.length&&!data.sections.length){container.textContent=stripEmoji(normalizeText(text).replaceAll(ARROW,' '));return false}
    const root=document.createElement('div');root.className='psych-report';
    if(data.meta.length){
      const intro=document.createElement('section');intro.className='psych-intro';
      for(const item of data.meta){
        const row=document.createElement('div');row.className='psych-intro-row';
        const label=document.createElement('div');label.className='psych-intro-label';label.textContent=item.title;
        const value=document.createElement('div');value.className='psych-intro-value';value.textContent=stripEmoji(item.body);
        row.append(label,value);intro.appendChild(row);
      }
      root.appendChild(intro);
    }
    if(data.sections.length){
      const flow=document.createElement('div');flow.className='psych-flow';
      data.sections.forEach((section,index)=>{
        const item=document.createElement('section');item.className='psych-step';
        const rail=document.createElement('div');rail.className='psych-step-rail';
        const badge=document.createElement('div');badge.className='psych-step-number';badge.textContent=section.number?section.number+'.':String(index+1)+'.';rail.appendChild(badge);
        const body=document.createElement('div');body.className='psych-step-body';
        const title=document.createElement('h3');title.className='psych-step-title';title.textContent=section.title;body.appendChild(title);appendParts(body,section.parts);
        item.append(rail,body);flow.appendChild(item);
      });
      root.appendChild(flow);
    }
    if(data.tail.length){const tail=document.createElement('section');tail.className='psych-tail';appendParts(tail,data.tail);root.appendChild(tail)}
    container.replaceChildren(root);return true;
  }
  function isPsychologyScreen(){
    const body=document.body,title=document.getElementById('title'),disclaimer=document.getElementById('reportDisclaimer');
    return body&&body.dataset.screen==='screenReport'&&title&&/психотерап/i.test(title.textContent||'')&&disclaimer&&disclaimer.classList.contains('hidden');
  }
  function tryFormat(){
    const box=document.getElementById('reportContent');if(!box||!isPsychologyScreen()||box.dataset.psychFormatted==='1'||box.querySelector('.report-loading'))return;
    const text=box.textContent||'';if(text.trim()&&render(box,text))box.dataset.psychFormatted='1';
  }
  const observer=new MutationObserver(()=>{const box=document.getElementById('reportContent');if(box&&!isPsychologyScreen())delete box.dataset.psychFormatted;requestAnimationFrame(tryFormat)});
  function start(){observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','data-screen']});tryFormat()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  window.MedsiPsychologyFormatter={parse,render};
})();