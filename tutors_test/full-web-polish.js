(function(){
  const APP_BASE='https://script.google.com/macros/s/AKfycbzRKRjjI7NoHx8rD5ifEdrcexGuYlMEB453sOC2UTZDeBaybZiNPIY0vDTMkmeHhebVpA/exec';
  const TUTOR_KEY='medsi_tutor_session_v1';
  const D1_KEY='medsi_d1_educator_session_v1';
  let phonesCache=[];

  const $=id=>document.getElementById(id);
  const phone10=v=>String(v||'').replace(/\D+/g,'').slice(-10);
  const displayPhone=v=>{const p=phone10(v);return p?'8'+p:''};
  const tutorToken=()=>{try{return String(localStorage.getItem(TUTOR_KEY)||'')}catch(_){return''}};
  const d1Session=()=>{try{const s=JSON.parse(localStorage.getItem(D1_KEY)||'null');return s&&s.token?s:null}catch(_){return null}};
  const phonesSignature=rows=>(rows||[]).map(r=>[phone10(r.phone),String(r.parentName||''),String(r.childName||'')].join('|')).sort().join('\n');

  async function appApi(method,args){
    const res=await fetch(APP_BASE,{method:'POST',headers:{'content-type':'text/plain;charset=UTF-8'},body:JSON.stringify({action:'api',method,args:args||[]}),cache:'no-store'});
    const p=await res.json();
    if(!p||p.ok!==true)throw new Error(p&&p.message||'Ошибка Apps Script API.');
    if(p.result&&p.result.ok===false)throw new Error(p.result.message||'Операция не выполнена.');
    return p.result;
  }

  function showPhonesScreen(){
    ['screenChoose','screenForm','screenDone','screenPhones'].forEach(id=>{const el=$(id);if(el)el.classList.toggle('hidden',id!=='screenPhones')});
    document.body.dataset.screen='screenPhones';
    if($('title'))$('title').textContent='Телефоны родителей';
    if($('meta'))$('meta').textContent='Здесь можно быстро скопировать номер или позвонить.';
    const screen=$('screenPhones');
    if(screen){screen.classList.remove('web-polish-enter');void screen.offsetWidth;screen.classList.add('web-polish-enter')}
    window.scrollTo(0,0);
  }

  async function copyPhone(phone,btn){
    const value=String(phone||'').trim();if(!value)return;
    try{await navigator.clipboard.writeText(value);const old=btn.textContent;btn.textContent='Скопировано';setTimeout(()=>btn.textContent=old,1000)}
    catch(_){const ta=document.createElement('textarea');ta.value=value;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();const old=btn.textContent;btn.textContent='Скопировано';setTimeout(()=>btn.textContent=old,1000)}
  }

  function removePhoneCardOptimistically(row,card){
    const snapshot=phonesCache.slice();
    phonesCache=phonesCache.filter(x=>phone10(x.phone)!==phone10(row.phone));
    if(card){
      card.classList.add('phone-card-deleting');
      requestAnimationFrame(()=>card.classList.add('phone-card-deleting-go'));
      setTimeout(()=>{if(card.isConnected)card.remove()},230);
    }
    return snapshot;
  }

  function restorePhoneAfterFailedDelete(snapshot,message){
    phonesCache=snapshot;
    if(document.body.dataset.screen==='screenPhones')renderPhones(phonesCache);
    alert(String(message||'Не удалось удалить ребёнка.'));
  }

  async function deleteParent(row,card){
    const child=String(row.childName||'ребёнка').trim();
    if(!confirm('Удалить ребёнка '+child+' из бота?\n\nВся история сообщений будет удалена.'))return;

    const deletePromise=appApi('deleteReportChildByPhone',[row.phone,tutorToken()]);
    const snapshot=removePhoneCardOptimistically(row,card);

    try{
      const res=await deletePromise;
      if(!res||!res.ok)throw new Error(res&&res.message||'Не удалось удалить.');
    }catch(e){
      restorePhoneAfterFailedDelete(snapshot,e&&e.message||e);
    }
  }

  function renderPhones(rows){
    const box=$('phonesList');if(!box)return;box.replaceChildren();
    if(!rows||!rows.length){const empty=document.createElement('div');empty.className='chat-empty';empty.textContent='Нет родителей.';box.appendChild(empty);return}
    rows.forEach((r,index)=>{
      const card=document.createElement('div');card.className='phone-card card-enter';card.style.animationDelay=Math.min(index*24,160)+'ms';
      const title=document.createElement('div');title.className='phone-card-title';title.textContent=r.childName||'Без имени ребёнка';
      const meta=document.createElement('div');meta.className='phone-card-meta';
      const parentLine=document.createElement('div');parentLine.textContent='Родитель: '+(r.parentName||'—');
      const phoneLine=document.createElement('div');phoneLine.append('Номер телефона: ');const strong=document.createElement('span');strong.className='phone-number-strong';strong.textContent=displayPhone(r.phone)||'—';phoneLine.appendChild(strong);meta.append(parentLine,phoneLine);
      const actions=document.createElement('div');actions.className='phone-card-actions';
      const copy=document.createElement('button');copy.type='button';copy.className='btn btn-teal phone-action-btn';copy.textContent='Скопировать';copy.onclick=()=>copyPhone(displayPhone(r.phone),copy);
      const call=document.createElement('a');call.className='btn btn-mint phone-action-btn';call.href='tel:'+String(r.phone||'').replace(/\D+/g,'');call.textContent='Позвонить';
      actions.append(copy,call);
      const del=document.createElement('button');del.type='button';del.className='phone-delete';del.setAttribute('aria-label','Удалить ребёнка');del.textContent='×';del.onclick=()=>deleteParent(r,card);
      card.append(title,del,meta,actions);box.appendChild(card);
    });
  }

  async function refreshPhonesFromD1(){
    const s=d1Session();if(!s||!window.MedsiOverlayTransport)return phonesCache;
    try{
      const res=await MedsiOverlayTransport.parents(s);
      const rows=Array.isArray(res&&res.parents)?res.parents:Array.isArray(res&&res.rows)?res.rows:[];
      if(rows.length)phonesCache=rows.map(r=>({phone:r.phone||r.phone10||'',parentName:r.parentName||r.parent_name||'',childName:r.childName||r.child_name||''}));
    }catch(_){}
    return phonesCache;
  }

  async function openPhonesFast(e){
    e.preventDefault();e.stopImmediatePropagation();showPhonesScreen();
    const box=$('phonesList');if(!box)return;
    if(phonesCache.length){
      renderPhones(phonesCache);
      const shownSignature=phonesSignature(phonesCache);
      refreshPhonesFromD1().then(rows=>{
        if(document.body.dataset.screen==='screenPhones'&&phonesSignature(rows)!==shownSignature)renderPhones(rows);
      });
      return;
    }
    box.innerHTML='<div class="phone-mini-loader" aria-label="Загрузка"></div>';
    const rows=await refreshPhonesFromD1();
    if(document.body.dataset.screen==='screenPhones')renderPhones(rows);
  }

  function fixImage(img){
    if(!img||img.dataset.medsiLoadBound==='1')return;img.dataset.medsiLoadBound='1';
    const wrap=img.closest('.msg-image-wrap');if(!wrap)return;
    const reveal=()=>{wrap.classList.add('loaded');img.classList.add('loaded')};
    if(img.complete&&img.naturalWidth>0){reveal();return}
    img.addEventListener('load',reveal,{once:true});img.addEventListener('error',reveal,{once:true});
  }

  function patchOverlay(root){
    if(!root)return;
    root.querySelectorAll('.msg-image-wrap img').forEach(fixImage);
    const back=root.querySelector('#btnThreadBack');
    if(back&&!back.dataset.medsiBackPatched){
      back.dataset.medsiBackPatched='1';
      back.addEventListener('click',e=>{
        e.preventDefault();e.stopImmediatePropagation();
        const thread=root.querySelector('#screenChatThread');const list=root.querySelector('#screenChats');
        if(thread)thread.classList.add('hidden');if(list){list.classList.remove('hidden');list.classList.remove('web-polish-enter');void list.offsetWidth;list.classList.add('web-polish-enter')}
        document.body.dataset.screen='screenChats';
        const title=root.querySelector('#title'),meta=root.querySelector('#meta');if(title)title.textContent='Чат с родителями';
        if(meta&&meta.textContent==='')meta.textContent='Выберите чат с нужным родителем.';
      },true);
    }
    root.querySelectorAll('#screenChats:not(.hidden),#screenNewChat:not(.hidden),#screenChatThread:not(.hidden)').forEach(el=>{
      if(el.dataset.medsiEnter==='1')return;el.dataset.medsiEnter='1';el.classList.add('web-polish-enter');
    });
  }

  const observer=new MutationObserver(()=>{
    document.querySelectorAll('.educator-exact-clone').forEach(patchOverlay);
    document.querySelectorAll('.educator-exact-clone .msg-image-wrap img').forEach(fixImage);
  });
  observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','src']});

  document.addEventListener('click',e=>{if(e.target&&e.target.closest&&e.target.closest('#btnParentPhones'))openPhonesFast(e)},true);
  refreshPhonesFromD1();
})();