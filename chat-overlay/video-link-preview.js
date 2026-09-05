(function(){
  const STYLE_ID='medsiVideoPreviewStyles';

  function addStyles(){
    if(document.getElementById(STYLE_ID))return;
    const style=document.createElement('style');
    style.id=STYLE_ID;
    style.textContent=`
      .medsi-video-composer-preview-block{margin:2px 0 18px;padding:14px;border:1px solid rgba(36,211,218,.18);border-radius:16px;background:linear-gradient(180deg,#fbffff,#f4fbfb)}
      .medsi-video-composer-preview-label{margin:0 0 10px;color:#285a62;font-size:.88rem;font-weight:800}
      .medsi-video-composer-preview-card{width:100%;overflow:hidden;border:1px solid rgba(36,211,218,.18);border-radius:14px;background:#fff;box-shadow:0 8px 22px rgba(15,135,144,.10)}
      .medsi-video-composer-preview-cover{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;background:linear-gradient(135deg,#eafafa,#d9f4f1)}
      .medsi-video-composer-preview-img{display:block;width:100%;height:100%;object-fit:cover;object-position:center;opacity:0;transition:opacity .18s ease,transform .18s ease;transform:scale(1.01)}
      .medsi-video-composer-preview-img.has-image{opacity:1;transform:scale(1)}
      .medsi-video-composer-preview-placeholder{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#7aaeb1;font-size:.9rem;font-weight:800;letter-spacing:.01em}
      .medsi-video-composer-preview-cover.has-image .medsi-video-composer-preview-placeholder{display:none}
      .medsi-video-composer-preview-play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 34% 28%,#fff,#e9fcfa 58%,#d4f7f3);border:1px solid rgba(36,211,218,.42);box-shadow:0 10px 24px rgba(15,135,144,.20),inset 0 1px 0 rgba(255,255,255,.95)}
      .medsi-video-composer-preview-play svg{width:30px;height:30px;margin-left:3px;color:#24d3da;filter:drop-shadow(0 2px 4px rgba(36,211,218,.32))}
      .medsi-video-composer-preview-title{padding:11px 12px 12px;color:#11424a;font-size:.95rem;font-weight:800;line-height:1.3;border-top:1px solid rgba(36,211,218,.10);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .medsi-video-composer-preview-title.is-empty{color:#8aa7ab;font-weight:700}
      .medsi-video-link-thumb-preview{display:none!important}
      @media(max-width:560px){.medsi-video-composer-preview-block{padding:12px}.medsi-video-composer-preview-play{width:58px;height:58px}.medsi-video-composer-preview-play svg{width:27px;height:27px}}
    `;
    document.head.appendChild(style);
  }

  function upgrade(modal){
    if(!modal||modal.dataset.videoPreviewUpgraded==='1')return;
    const card=modal.querySelector('.medsi-video-link-card');
    const actions=modal.querySelector('.medsi-video-link-actions');
    const titleInput=modal.querySelector('#medsiVideoLinkName');
    const thumbInput=modal.querySelector('#medsiVideoLinkThumbInput');
    if(!card||!actions||!titleInput||!thumbInput)return;

    modal.dataset.videoPreviewUpgraded='1';

    const block=document.createElement('div');
    block.className='medsi-video-composer-preview-block';
    block.innerHTML=`
      <div class="medsi-video-composer-preview-label">Предпросмотр в чате</div>
      <div class="medsi-video-composer-preview-card">
        <div class="medsi-video-composer-preview-cover">
          <img class="medsi-video-composer-preview-img" alt="Предпросмотр обложки видео">
          <div class="medsi-video-composer-preview-placeholder">Обложка видео 16:9</div>
          <div class="medsi-video-composer-preview-play" aria-hidden="true">
            <svg viewBox="0 0 48 48"><path d="M17 12.5v23L37 24 17 12.5z" fill="currentColor"></path></svg>
          </div>
        </div>
        <div class="medsi-video-composer-preview-title is-empty">Название видео</div>
      </div>`;
    card.insertBefore(block,actions);

    const cover=block.querySelector('.medsi-video-composer-preview-cover');
    const img=block.querySelector('.medsi-video-composer-preview-img');
    const previewTitle=block.querySelector('.medsi-video-composer-preview-title');

    function syncTitle(){
      const value=String(titleInput.value||'').trim();
      previewTitle.textContent=value||'Название видео';
      previewTitle.classList.toggle('is-empty',!value);
    }

    function showImage(src){
      if(!src){img.removeAttribute('src');img.classList.remove('has-image');cover.classList.remove('has-image');return}
      img.src=src;
      img.classList.add('has-image');
      cover.classList.add('has-image');
    }

    titleInput.addEventListener('input',syncTitle);
    thumbInput.addEventListener('change',function(){
      const file=thumbInput.files&&thumbInput.files[0];
      if(!file)return showImage('');
      const reader=new FileReader();
      reader.onload=function(){showImage(String(reader.result||''))};
      reader.readAsDataURL(file);
    });

    const originalPreview=modal.querySelector('#medsiVideoLinkThumbPreview');
    if(originalPreview){
      new MutationObserver(function(){
        const src=originalPreview.getAttribute('src')||'';
        if(src)showImage(src);
      }).observe(originalPreview,{attributes:true,attributeFilter:['src']});
    }

    syncTitle();
  }

  addStyles();
  const existing=document.getElementById('medsiVideoLinkModal');
  if(existing)upgrade(existing);
  new MutationObserver(function(mutations){
    mutations.forEach(function(m){
      m.addedNodes.forEach(function(node){
        if(node.nodeType!==1)return;
        if(node.id==='medsiVideoLinkModal')upgrade(node);
        const modal=node.querySelector&&node.querySelector('#medsiVideoLinkModal');
        if(modal)upgrade(modal);
      });
    });
  }).observe(document.body,{childList:true,subtree:true});
})();
