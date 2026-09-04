(function(){
  const META=[
    ['тема групповой психотерапии','Тема групповой психотерапии'],
    ['тема','Тема групповой психотерапии'],
    ['цель групповой психотерапии','Цель групповой психотерапии'],
    ['цель','Цель групповой психотерапии'],
    ['возрастная категория','Возрастная категория']
  ];
  const SECTIONS=[
    ['начало','Начало'],['вводная часть','Вводная часть'],['разогрев','Разогрев'],
    ['интерактивная часть','Интерактивная часть'],['основная часть','Основная часть'],
    ['практическое упражнение','Практическое упражнение'],['заключительная часть','Заключительная часть'],
    ['выводы','Выводы'],['рефлексия','Рефлексия'],['в завершении','В завершении'],['завершение','Завершение']
  ];
  const ARROW=' [[ARROW]] ';

  function cap(v){
    const s=String(v||'').trim();
    if(!s)return '';
    const m=s.match(/[A-Za-zА-Яа-яЁё]/);
    if(!m)return s;
    const i=m.index;
    return s.slice(0,i)+s[i].toLocaleUpperCase('ru-RU')+s.slice(i+1);
  }
  function stripEmoji(v){
    return String(v||'')
      .replace(/[\u2600-\u27BF]/g,'')
      .replace(/[\uD83C-\uDBFF][\uDC00-\uDFFF]/g,'')
      .replace(/[\uFE0F\u200D]/g,'')
      .replace(/[ \t]{2,}/g,' ')
      .trim();
  }
  function normalize(v){
    return stripEmoji(String(v||'')
      .replace(/\r\n?/g,'\n')
      .replace(/➡️?/g,ARROW)
      .replace(/([1-9])️⃣/g,'$1.')
      .replace(/[➀➊①]/g,'1.').replace(/[➁➋②]/g,'2.').replace(/[➂➌③]/g,'3.')
      .replace(/[➃➍④]/g,'4.').replace(/[➄➎⑤]/g,'5.').replace(/[➅➏⑥]/g,'6.')
      .replace(/[➆➐⑦]/g,'7.').replace(/[➇➑⑧]/g,'8.').replace(/[➈➒⑨]/g,'9.'))
      .replace(/[ \t]+\n/g,'\n')
      .replace(/\n{3,}/g,'\n\n')
      .trim();
  }
  function canonicalMeta(v){
    const low=String(v||'').trim().toLocaleLowerCase('ru-RU');
    for(const pair of META)if(low===pair[0])return pair[1];
    return '';
  }
  function canonicalSection(v){
    const low=String(v||'').trim().toLocaleLowerCase('ru-RU');
    for(const pair of SECTIONS)if(low===pair[0])return pair[1];
    return '';
  }
  function insertBreaks(v){
    let s=v;
    s=s.replace(/\s*(ТЕМА(?: групповой психотерапии)?|ЦЕЛЬ(?: групповой психотерапии)?|Возрастная категория)\s*:/gi,'\n\n$1:');
    s=s.replace(/\s*((?:[1-9]\.)\s*)?(НАЧАЛО|Начало|Вводная часть|РАЗОГРЕВ|Разогрев|Интерактивная часть|Основная часть|Практическое упражнение|Заключительная часть|Выводы|Рефлексия|В завершении|Завершение)\s*:/gi,'\n\n$1$2:');
    return s.replace(/^\s+/, '').replace(/\n{3,}/g,'\n\n');
  }
  function bodyParts(v){
    const text=String(v||'').trim();
    if(!text)return [];
    const raw=text.split('[[ARROW]]').map(x=>x.trim()).filter(Boolean);
    if(raw.length===1)return [{type:'p',text:cap(raw[0])}];
    const firstWasText=!text.trim().startsWith('[[ARROW]]');
    const out=[];
    if(firstWasText&&raw.length)out.push({type:'p',text:cap(raw.shift())});
    const short=raw.length>1&&raw.every(x=>x.length<=110&&!/[.!?][\s\S]{45,}/.test(x));
    if(short){out.push({type:'list',items:raw.map(cap)});return out}
    raw.forEach(x=>{
      const m=x.match(/^(Выполнение техники|Практическое упражнение|Упражнение\s+[^:]{1,70}|В завершении|Обратная связь)\s*:?\s*([\s\S]*)$/i);
      if(m&&m[2].trim())out.push({type:'sub',title:cap(m[1]),text:cap(m[2])});
      else out.push({type:'p',text:cap(x)});
    });
    return out;
  }
  function parse(v){
    const s=insertBreaks(normalize(v));
    const chunks=s.split(/\n\s*\n+/).map(x=>x.trim()).filter(Boolean);
    const meta=[],sections=[],tail=[];
    let current=null;
    chunks.forEach(chunk=>{
      let m=chunk.match(/^(ТЕМА(?: групповой психотерапии)?|ЦЕЛЬ(?: групповой психотерапии)?|Возрастная категория)\s*:\s*([\s\S]*)$/i);
      if(m){meta.push({title:canonicalMeta(m[1]),body:cap(m[2])});current=null;return}
      m=chunk.match(/^(?:([1-9])\.\s*)?(НАЧАЛО|Начало|Вводная часть|РАЗОГРЕВ|Разогрев|Интерактивная часть|Основная часть|Практическое упражнение|Заключительная часть|Выводы|Рефлексия|В завершении|Завершение)\s*:?\s*([\s\S]*)$/i);
      if(m){current={number:m[1]||'',title:canonicalSection(m[2]),parts:bodyParts(m[3])};sections.push(current);return}
      const parts=bodyParts(chunk);
      if(current)current.parts.push.apply(current.parts,parts);else tail.push.apply(tail,parts);
    });
    return {meta,sections,tail};
  }
  function appendParts(parent,parts){
    parts.forEach(part=>{
      if(part.type==='list'){
        const ul=document.createElement('ul');ul.className='psych-list';
        part.items.forEach(v=>{const li=document.createElement('li');li.textContent=v;ul.appendChild(li)});
        parent.appendChild(ul);return;
      }
      if(part.type==='sub'){
        const box=document.createElement('div');box.className='psych-subsection';
        const h=document.createElement('div');h.className='psych-subheading';h.textContent=part.title;
        const p=document.createElement('p');p.textContent=part.text;box.append(h,p);parent.appendChild(box);return;
      }
      const p=document.createElement('p');p.className='psych-paragraph';p.textContent=part.text;parent.appendChild(p);
    });
  }
  function render(container,v){
    if(!container)return false;
    const data=parse(v);
    if(!data.meta.length&&!data.sections.length){container.textContent=normalize(v).replace(/\[\[ARROW\]\]/g,' ');return false}
    const root=document.createElement('div');root.className='psych-report';
    if(data.meta.length){
      const intro=document.createElement('section');intro.className='psych-intro';
      data.meta.forEach(item=>{const row=document.createElement('div');row.className='psych-intro-row';const l=document.createElement('div');l.className='psych-intro-label';l.textContent=item.title;const val=document.createElement('div');val.className='psych-intro-value';val.textContent=item.body;row.append(l,val);intro.appendChild(row)});
      root.appendChild(intro);
    }
    if(data.sections.length){
      const flow=document.createElement('div');flow.className='psych-flow';
      data.sections.forEach((section,i)=>{const item=document.createElement('section');item.className='psych-step';const rail=document.createElement('div');rail.className='psych-step-rail';const n=document.createElement('div');n.className='psych-step-number';n.textContent=(section.number||String(i+1))+'.';rail.appendChild(n);const body=document.createElement('div');body.className='psych-step-body';const h=document.createElement('h3');h.className='psych-step-title';h.textContent=section.title;body.appendChild(h);appendParts(body,section.parts);item.append(rail,body);flow.appendChild(item)});
      root.appendChild(flow);
    }
    if(data.tail.length){const tail=document.createElement('section');tail.className='psych-tail';appendParts(tail,data.tail);root.appendChild(tail)}
    container.replaceChildren(root);
    return true;
  }
  window.MedsiPsychologyFormatter={parse,render};
})();