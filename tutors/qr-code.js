(() => {
  'use strict';
  function init() {
    const modal = document.getElementById('tutorQrModal');
    const trigger = document.getElementById('tutorQrTrigger');
    const close = document.getElementById('tutorQrClose');
    if (!modal) return;
    const open = () => { modal.classList.remove('hidden'); document.body.classList.add('tutor-qr-open'); close?.focus({preventScroll:true}); };
    const hide = () => { modal.classList.add('hidden'); document.body.classList.remove('tutor-qr-open'); trigger?.focus({preventScroll:true}); };
    window.MedsiOpenQr = open;
    trigger?.addEventListener('click', open);
    close?.addEventListener('click', hide);
    modal.addEventListener('click', event => { if (event.target === modal) hide(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !modal.classList.contains('hidden')) hide(); });
    document.addEventListener('click', event => { if (event.target.closest('.message-qr')) open(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();
