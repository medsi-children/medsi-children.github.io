(function(){
  if(window.MedsiVideoLink)return;
  const t=window.MedsiOverlayTransport;
  if(!t)return;

  const STATE={session:null,phone:'',busy:false,thumb:null};
  const PAYLOAD_MARKER='medsiVideoLink';

  function injectStyles(){
    if(document.getElementById('medsiVideoLinkStyles'))return;
    const s=document.createElement('style');s.id='medsiVideoLinkStyles';s.textContent=`
.medsi-video-link-modal{position:fixed;inset:0;z-index:9000;background:rgba(17,66,74,.28);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);display:flex;align-items:center;justify-content:center;padding:18px;opacity:1;transition:opacity .18s ease}
.medsi-video-link-modal.hidden{display:flex!important;opacity:0;pointer-events:none}
.medsi-video-link-card{width:min(430px,100%);max-height:min(720px,calc(100dvh - 36px));overflow:auto;background:#fff;border:1px solid rgba(36,211,218,.34);border-radius:20px;box-shadow:0 24px 60px rgba(17,66,74,.24);padding:22px;transform:translateY(0) scale(1);transition:transform .18s ease}
.medsi-video-link-modal.hidden .medsi-video-link-card{transform:translateY(8px) scale(.985)}
.medsi-video-link-title{margin:0 0 18px;font-size:1.35rem;line-height:1.15;color:#11424a;font-weight:850}
.medsi-video-link-field{display:grid;gap:7px;margin-bottom:15px}.medsi-video-link-field label{font-weight:800;color:#285a62}.medsi-video-link-field input{width:100%;min-height:52px;border:1.5px solid rgba(36,211,218,.38);border-radius:14px;padding:10px 13px;font:inherit;color:#11424a;background:#fff;outline:none}.medsi-video-link-field input:focus{border-color:#24d3da;box-shadow:0 0 0 4px rgba(36,211,218,.10)}
.medsi-video-link-thumb-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.medsi-video-link-thumb-btn{appearance:none;border:1.5px solid rgba(36,211,218,.32);background:#f2fcfd;color:#16b8c0;border-radius:13px;min-height:46px;padding:9px 14px;font:inherit;font-weight:800}.medsi-video-link-thumb-preview{width:108px;height:76px;border-radius:10px;object-fit:cover;border:1px solid rgba(36,211,218,.20);display:none}
.medsi-video-link-error{margin:2px 0 12px;color:#c94f4f;font-weight:700;font-size:.9rem}.medsi-video-link-actions{display:grid;grid-template-columns:1fr;gap:10px}.medsi-video-link-send,.medsi-video-link-cancel{appearance:none;border:0;border-radius:14px;min-height:52px;font:inherit;font-weight:850}.medsi-video-link-send{background:linear-gradient(135deg,#4dd4e6,#1bb8c9);color:#fff}.medsi-video-link-send:disabled{opacity:.6}.medsi-video-link-cancel{background:#eaf7f8;color:#285a62}
.medsi-video-link-view{display:block;width:min(320px,72vw);max-width:100%;border-radius:12px;overflow:hidden;background:#effbfb;border:1px solid rgba(36,211,218,.18);box-shadow:0 6px 18px rgba(15,135,144,.10);cursor:pointer;text-decoration:none;color:inherit;white-space:normal}
.medsi-video-link-cover{position:relative;display:block;width:100%;aspect-ratio:16/9;background:linear-gradient(135deg,#e9faf9,#d7f4f2);overflow:hidden}.medsi-video-link-cover img{display:block;width:100%;height:100%;object-fit:cover}.medsi-video-link-placeholder{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#79aeb0;font-weight:800}
.medsi-video-link-play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:68px;height:68px;border-radius:50%;background:radial-gradient(circle at 34% 28%,rgba(255,255,255,.99),rgba(229,252,250,.9) 58%,rgba(203,247,241,.82));border:1px solid rgba(36,211,218,.42);box-shadow:0 12px 28px rgba(15,135,144,.20),inset 0 1px 0 rgba(255,255,255,.9);display:flex;align-items:center;justify-content:center}.medsi-video-link-play svg{width:32px;height:32px;margin-left:3px;color:#24d3da;filter:drop-shadow(0 2px 4px rgba(36,211,218,.34))}
.medsi-video-link-caption{display:block;padding:10px 12px;background:#fff;color:#11424a;font-size:.96rem;line-height:1.3;font-weight:750;border-top:1px solid rgba(36,211,218,.10)}
.parent-chat-msg .medsi-video-link-view{width:min(310px,76vw)}
`;
    document.head.appendChild(s);
  }

  function ensureTransportCapture(){
    if(t.__medsiVideoLinkWrapped)return;
    t.__medsiVideoLinkWrapped=true;
    const wrap=(name)=>{const orig=t[name];if(typeof orig!=='function')return;t[name]=function(session,phone){STATE.session=session||STATE.session;STATE.phone=String(phone||STATE.phone||'');return orig.apply(this,arguments)}};
    ['thread','sendMessage','upload','markRead'].forEach(wrap);
  }

  function parsePayload(raw){
    const text=String(raw||'').trim();if(!text||text[0]!=='{')return null;
    try{const p=JSON.parse(text);if(!p||!p.videoUrl)return null;if(p[PAYLOAD_MARKER]!==1&&p.videoUrl===undefined)return null;return{videoUrl:String(p.videoUrl||'').trim(),videoTitle:String(p.videoTitle||'').trim(),caption:String(p.caption||'').trim()}}catch(_){return null}
  }

  function makeVideoCard(data,coverUrl){
    const a=document.createElement('a');a.className='medsi-video-link-view';a.href=data.videoUrl;a.target='_blank';a.rel='noopener noreferrer';a.setAttribute('aria-label','Открыть видео '+(data.videoTitle||''));
    const cover=document.createElement('span');cover.className='medsi-video-link-cover';
    if(coverUrl){const img=document.createElement('img');img.src=coverUrl;img.alt=data.videoTitle||'Обложка видео';cover.appendChild(img)}else{const ph=document.createElement('span');ph.className='medsi-video-link-placeholder';ph.textContent='Видео';cover.appendChild(ph)}
    const play=document.createElement('span');play.className='medsi-video-link-play';play.innerHTML='<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M17 12.5v23L37 24 17 12.5z" fill="currentColor"></path></svg>';cover.appendChild(play);a.appendChild(cover);
    if(data.videoTitle){const title=document.createElement('span');title.className='medsi-video-link-caption';title.textContent=data.videoTitle;a.appendChild(title)}
    a.addEventListener('click',e=>e.stopPropagation());return a;
  }

  function enhanceEducatorMessage(el){
    if(!el||el.dataset.medsiVideoLink==='1')return;
    const body=el.querySelector('.msg-body');if(!body)return;
    const data=parsePayload(body.textContent);if(!data)return;
    const media=el.querySelector('.msg-image-wrap');let cover='';if(media){const m=media.querySelector('img,video');cover=m&&m.src||'';media.remove()}
    const card=makeVideoCard(data,cover);body.before(card);
    if(data.caption)body.textContent=data.caption;else body.remove();
    el.dataset.medsiVideoLink='1';
  }

  function enhanceParentMessage(el){
    if(!el||el.dataset.medsiVideoLink==='1')return;
    let body=null;Array.from(el.children).forEach(ch=>{if(!body&&ch.tagName==='DIV'&&!ch.classList.contains('parent-chat-author')&&!ch.classList.contains('parent-chat-media-frame'))body=ch});
    if(!body)return;const data=parsePayload(body.textContent);if(!data)return;
    const media=el.querySelector('.parent-chat-media-frame');let cover='';if(media){const m=media.querySelector('img,video');cover=m&&m.src||'';media.remove()}
    const card=makeVideoCard(data,cover);body.before(card);
    if(data.caption)body.textContent=data.caption;else body.remove();
    el.dataset.medsiVideoLink='1';
  }

  function enhance(root){
    const scope=root&&root.querySelectorAll?root:document;
    scope.querySelectorAll('.educator-exact-clone .msg').forEach(enhanceEducatorMessage);
    scope.querySelectorAll('.parent-chat-msg').forEach(enhanceParentMessage);
  }

  function mountObserver(){
    enhance(document);
    new MutationObserver(muts=>{muts.forEach(m=>m.addedNodes.forEach(n=>{if(n.nodeType===1){if(n.matches&&n.matches('.educator-exact-clone .msg'))enhanceEducatorMessage(n);if(n.matches&&n.matches('.parent-chat-msg'))enhanceParentMessage(n);enhance(n)}}))}).observe(document.body,{childList:true,subtree:true});
  }

  function ensureModal(){
    let modal=document.getElementById('medsiVideoLinkModal');if(modal)return modal;
    modal=document.createElement('div');modal.id='medsiVideoLinkModal';modal.className='medsi-video-link-modal hidden';modal.innerHTML='<div class="medsi-video-link-card" role="dialog" aria-modal="true" aria-labelledby="medsiVideoLinkTitle"><h3 id="medsiVideoLinkTitle" class="medsi-video-link-title">Прикрепить видео</h3><div class="medsi-video-link-field"><label for="medsiVideoLinkUrl">Ссылка на видео Google Drive *</label><input id="medsiVideoLinkUrl" type="url" placeholder="Ссылка"></div><div class="medsi-video-link-field"><label for="medsiVideoLinkName">Название видео</label><input id="medsiVideoLinkName" type="text" maxlength="120" placeholder="Введите название"></div><div class="medsi-video-link-field"><label>Обложка видео</label><div class="medsi-video-link-thumb-row"><button id="medsiVideoLinkThumbBtn" class="medsi-video-link-thumb-btn" type="button">Выбрать изображение</button><img id="medsiVideoLinkThumbPreview" class="medsi-video-link-thumb-preview" alt="Обложка"><input id="medsiVideoLinkThumbInput" type="file" accept="image/*" hidden></div></div><p id="medsiVideoLinkError" class="medsi-video-link-error" hidden></p><div class="medsi-video-link-actions"><button id="medsiVideoLinkSend" class="medsi-video-link-send" type="button">Отправить</button><button id="medsiVideoLinkCancel" class="medsi-video-link-cancel" type="button">Отмена</button></div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click',e=>{if(e.target===modal)closeModal()});
    modal.querySelector('#medsiVideoLinkCancel').onclick=closeModal;
    modal.querySelector('#medsiVideoLinkThumbBtn').onclick=()=>modal.querySelector('#medsiVideoLinkThumbInput').click();
    modal.querySelector('#medsiVideoLinkThumbInput').onchange=onThumb;
    modal.querySelector('#medsiVideoLinkSend').onclick=send;
    return modal;
  }

  function error(text){const e=ensureModal().querySelector('#medsiVideoLinkError');e.textContent=String(text||'');e.hidden=!text}
  function openModal(){
    if(!STATE.session||!STATE.phone){error('Сначала откройте нужный чат.');return}
    STATE.thumb=null;const m=ensureModal();m.querySelector('#medsiVideoLinkUrl').value='';m.querySelector('#medsiVideoLinkName').value='';const p=m.querySelector('#medsiVideoLinkThumbPreview');p.src='';p.style.display='none';m.querySelector('#medsiVideoLinkThumbInput').value='';error('');m.classList.remove('hidden');setTimeout(()=>m.querySelector('#medsiVideoLinkUrl').focus(),30)
  }
  function closeModal(){const m=ensureModal();m.classList.add('hidden');error('')}

  function onThumb(e){
    const f=e.target.files&&e.target.files[0];if(!f)return;if(!/^image\//i.test(f.type)){error('Обложка видео должна быть изображением.');return}if(f.size>20*1024*1024){error('Размер изображения не должен превышать 20 МБ.');return}
    STATE.thumb=f;const r=new FileReader();r.onload=()=>{const p=ensureModal().querySelector('#medsiVideoLinkThumbPreview');p.src=String(r.result||'');p.style.display='block'};r.readAsDataURL(f);error('');
  }

  function validVideoUrl(url){return /^https?:\/\//i.test(url)&&(/drive\.google/i.test(url)||/youtu(?:\.be|be\.com)/i.test(url))}
  async function send(){
    if(STATE.busy)return;const m=ensureModal(),url=String(m.querySelector('#medsiVideoLinkUrl').value||'').trim(),title=String(m.querySelector('#medsiVideoLinkName').value||'').trim();
    if(!url){error('Введите ссылку на видео Google Drive.');return}if(!validVideoUrl(url)){error('Ссылка должна быть на Google Drive или YouTube.');return}
    STATE.busy=true;const btn=m.querySelector('#medsiVideoLinkSend');btn.disabled=true;btn.textContent='Отправляем…';error('');
    try{
      let fileId='';if(STATE.thumb){const up=await t.upload(STATE.session,STATE.phone,STATE.thumb);fileId=String(up&&up.fileId||'')}
      const payload=JSON.stringify({[PAYLOAD_MARKER]:1,videoUrl:url,videoTitle:title,caption:''});
      await t.sendMessage(STATE.session,'educator',STATE.phone,{type:'video',text:payload,fileId});
      closeModal();
      if(window.MedsiVideoLink&&typeof window.MedsiVideoLink.onSent==='function')window.MedsiVideoLink.onSent();
      const refresh=document.querySelector('.educator-exact-clone #btnRefreshThread');if(refresh)refresh.click();
    }catch(err){error(err&&err.message||'Не удалось отправить видео.')}finally{STATE.busy=false;btn.disabled=false;btn.textContent='Отправить'}
  }

  function interceptVideoButton(){
    document.addEventListener('click',e=>{const b=e.target&&e.target.closest?e.target.closest('#btnVideo'):null;if(!b)return;e.preventDefault();e.stopImmediatePropagation();openModal()},true);
  }

  injectStyles();ensureTransportCapture();mountObserver();interceptVideoButton();
  window.MedsiVideoLink={enhance,open:openModal,onSent:null};
})();
