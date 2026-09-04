(function(){
  const SECTION_WORDS=[
    'тема','цель','возрастная категория','начало','вводная часть','разогрев','интерактивная часть',
    'основная часть','практическое упражнение','заключительная часть','выводы','рефлексия','в завершении','завершение'
  ];
  const markerRe=/(?:^|\n|\s)(?=(?:[1-9](?:️⃣|\.)\s*)?(?:➡️\s*)?(?:ТЕМА\b|ЦЕЛЬ\b|Возрастная категория\b|НАЧАЛО\b|Начало\b|Вводная часть\b|РАЗОГРЕВ\b|Разогрев\b|Интерактивная часть\b|Основная часть\b|Практическое упражнение\b|Заключительная часть\b|Выводы\b|Рефлексия\b|В завершении\b|Завершение\b))/giu;
  const numberedRe=/(?:^|\n|\s)(?=(?:[1-9]️⃣|[1-9]\.\s+)\s*[^\n]{0,70}(?:часть|начало|заверш|вывод|рефлекс))/giu;

  function cleanText(text){
    return String(text||'').replace(/\r\n?/g,'\n').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  }
  function addBoundaries(text,re){return text.replace(re,m=>m.indexOf('\n')>=0?m:'\n\n')}

  function splitArrowRuns(text){
    const parts=text.split(/(?=➡️)/u);
    if(parts.length<2)return [text];
    const out=[];
    for(const raw of parts){
      const part=raw.trim();if(!part)continue;
      const isShort=part.length<=110 && !/[.!?][\s\S]{45,}/u.test(part);
      if(isShort && out.length && out[out.length-1].kind==='mini')out[out.length-1].text+='\n'+part;
      else out.push({kind:isShort?'mini':'text',text:part});
    }
    return out.map(x=>x.text);
  }

  function sectionTitle(block){
    const s=block.trim();
    const stripped=s.replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s➡️📘🖌️📚🍂🍁🚻]+/gu,'').trim();
    const num=stripped.match(/^([1-9](?:️⃣|\.))\s*/u);
    const rest=(num?stripped.slice(num[0].length):stripped).trim();
    const lower=rest.toLocaleLowerCase('ru-RU');
    for(const word of SECTION_WORDS){
      if(lower.startsWith(word)){
        const colon=rest.indexOf(':');
        if(colon>=0 && colon<90)return {title:(num?num[1]+' ':'')+rest.slice(0,colon).trim(),body:rest.slice(colon+1).trim()};
        const paren=rest.indexOf('(');
        if(paren>0 && paren<90)return {title:(num?num[1]+' ':'')+rest.slice(0,paren).trim(),body:rest.slice(paren).trim()};
        if(rest.length<95)return {title:(num?num[1]+' ':'')+rest,body:''};
      }
    }
    if(num && rest.length){
      const colon=rest.indexOf(':');
      if(colon>0 && colon<90)return {title:num[1]+' '+rest.slice(0,colon).trim(),body:rest.slice(colon+1).trim()};
    }
    return null;
  }

  function parse(text){
    let s=cleanText(text);if(!s)return [];
    s=addBoundaries(s,markerRe);s=addBoundaries(s,numberedRe);
    const firstPass=s.split(/\n\s*\n+/u).map(x=>x.trim()).filter(Boolean);
    const blocks=[];
    for(const p of firstPass){
      const pieces=p.includes('➡️')?splitArrowRuns(p):[p];
      for(const piece of pieces){
        const t=piece.trim();if(!t)continue;
        const heading=sectionTitle(t);
        if(heading)blocks.push({type:'section',title:heading.title,body:heading.body,raw:t});
        else blocks.push({type:'paragraph',body:t,raw:t});
      }
    }
    return blocks;
  }

  function render(container,text){
    if(!container)return false;
    const raw=cleanText(text);if(!raw)return false;
    const blocks=parse(raw);
    if(blocks.length<2){container.textContent=raw;return false}
    const frag=document.createDocumentFragment();
    const root=document.createElement('div');root.className='psych-report';
    for(const b of blocks){
      const item=document.createElement('section');item.className='psych-report-block '+(b.type==='section'?'is-section':'is-paragraph');
      if(b.type==='section'){
        const h=document.createElement('div');h.className='psych-report-heading';h.textContent=b.title;item.appendChild(h);
      }
      if(b.body){const p=document.createElement('div');p.className='psych-report-text';p.textContent=b.body;item.appendChild(p)}
      root.appendChild(item);
    }
    frag.appendChild(root);container.replaceChildren(frag);return true;
  }

  function isPsychologyScreen(){
    const body=document.body,title=document.getElementById('title'),disclaimer=document.getElementById('reportDisclaimer');
    return body&&body.dataset.screen==='screenReport'&&title&&/психотерап/i.test(title.textContent||'')&&disclaimer&&disclaimer.classList.contains('hidden');
  }
  function tryFormat(){
    const box=document.getElementById('reportContent');if(!box||!isPsychologyScreen())return;
    if(box.dataset.psychFormatted==='1')return;
    if(box.querySelector('.report-loading'))return;
    const text=box.textContent||'';if(!text.trim())return;
    if(render(box,text))box.dataset.psychFormatted='1';
  }
  const observer=new MutationObserver(()=>{const box=document.getElementById('reportContent');if(box&&!isPsychologyScreen())delete box.dataset.psychFormatted;requestAnimationFrame(tryFormat)});
  function start(){observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','data-screen']});tryFormat()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  window.MedsiPsychologyFormatter={parse,render};
})();