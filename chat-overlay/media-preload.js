(function () {
  'use strict';

  // Tiny local Twemoji assets are part of the core UI, so warm them immediately
  // while the document is still in <head>. This keeps menu cards and reaction
  // pickers cache-hot before the user can see or open them.
  const EMOJI_BASE = '/chat-overlay/assets/twemoji/';
  const EMOJI_FILES = [
    '2764.svg','1f44d.svg','1f44c.svg','1f64f.svg','1f970.svg','1f601.svg','1f525.svg',
    '1f4ac.svg','2600.svg','1f319.svg','1f9e0.svg','1f558.svg','1f4de.svg'
  ];

  function warmEmojiAssets() {
    EMOJI_FILES.forEach(file => {
      const image = new Image();
      image.decoding = 'async';
      try { image.fetchPriority = 'high'; } catch (_) {}
      image.src = EMOJI_BASE + file;
    });
  }

  function startEmojiSkinEarly() {
    if (window.MedsiReactionIcons || document.querySelector('script[data-medsi-reaction-icons-early]')) return;
    const script = document.createElement('script');
    script.async = false;
    script.src = '/chat-overlay/reaction-icons.js?v=20260907-prewarm-1';
    script.dataset.medsiReactionIconsEarly = '1';
    document.head.appendChild(script);
  }

  warmEmojiAssets();
  startEmojiSkinEarly();

  // Preloads only a small number of full-size originals after their compact
  // chat previews have rendered. It never blocks the initial chat paint.
  const queued = new Set();
  const queue = [];
  let active = 0;
  let accepted = 0;
  const MAX_ACTIVE = 2;
  const MAX_PER_CHAT_PAINT = 3;

  function allowed() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const type = String(connection && connection.effectiveType || '').toLowerCase();
    return !(connection && connection.saveData) && type !== 'slow-2g' && type !== '2g' && type !== '3g';
  }

  function run() {
    while (active < MAX_ACTIVE && queue.length) {
      const url = queue.shift();
      active += 1;
      const image = new Image();
      const done = () => { active -= 1; run(); };
      image.onload = done;
      image.onerror = done;
      image.src = url;
    }
  }

  function queueOriginal(url) {
    if (!url || !allowed() || queued.has(url) || accepted >= MAX_PER_CHAT_PAINT) return;
    queued.add(url);
    accepted += 1;
    queue.push(url);
    const schedule = window.requestIdleCallback || (callback => setTimeout(callback, 180));
    schedule(run, { timeout: 900 });
  }

  function reset() {
    accepted = 0;
  }

  window.MedsiMediaPreload = { queueOriginal, reset };
})();
