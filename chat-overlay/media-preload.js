(function () {
  'use strict';

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
