(function () {
  if (window.MedsiMessageEmoji) return;
  const icons = { '🗺️': '1f5fa.svg', '✅': '2705.svg', '🚫': '1f6ab.svg', '💊': '1f48a.svg', '❓': '2753.svg' };
  const selector = '#chatThreadBox .msg-body, #parentChatMessages .parent-chat-msg > div:not([class])';
  const pattern = /(🗺️|✅|🚫|💊|❓)/;
  const style = document.createElement('style');
  style.textContent = '.medsi-message-emoji{display:inline-block;width:1.15em;height:1.15em;vertical-align:-.18em;object-fit:contain}';
  document.head.appendChild(style);

  function paint(element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) if (pattern.test(walker.currentNode.nodeValue)) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const fragment = document.createDocumentFragment();
      for (const part of node.nodeValue.split(pattern)) {
        if (!icons[part]) { fragment.appendChild(document.createTextNode(part)); continue; }
        const image = document.createElement('img');
        image.className = 'medsi-message-emoji';
        image.src = '/chat-overlay/assets/twemoji/' + icons[part];
        image.alt = part;
        image.draggable = false;
        fragment.appendChild(image);
      }
      node.replaceWith(fragment);
    }
  }

  function scan(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      const message = root.parentElement?.closest(selector);
      if (message) paint(message);
      return;
    }
    if (root.matches?.(selector)) paint(root);
    root.querySelectorAll?.(selector).forEach(paint);
  }
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) scan(node);
  }).observe(document.documentElement, { childList: true, subtree: true });
  scan(document);
  window.MedsiMessageEmoji = { scan };
})();
