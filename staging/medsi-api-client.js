(function () {
  const DEFAULT_API_URL = 'https://medsi-push-worker.medsi-children.workers.dev/api';
  const API_URL = window.MEDSI_API_URL || DEFAULT_API_URL;
  const MAX_CONCURRENT_REQUESTS = 2;
  const REQUEST_TIMEOUT_MS = 45000;
  const RETRY_DELAY_MS = 900;
  const MAX_RETRIES = 1;
  const diagnostics = [];
  const queue = [];
  const activeMethods = [];
  let activeRequests = 0;
  let requestSeq = 0;
  let debugPanel = null;

  const METHOD_PRIORITY = {
    sendParentChatMessage: 10,
    sendEducatorChatMessage: 10,
    sendEducatorVideoMessage: 10,
    uploadParentChatImage: 10,
    uploadEducatorChatImage: 10,
    uploadEducatorVideoThumbnail: 10,
    deleteMessage: 9,
    updateMessage: 9,
    setChatMessageReaction: 9,
    markParentMessagesAsReadByEducator: 8,
    markEducatorMessagesAsRead: 8,
    getChatMessages: 7,
    getParentChatMessages: 7,
    getOlderChatMessages: 7,
    getOlderParentChatMessages: 7,
    listUnreadParentChats: 6,
    listReadParentChats: 5,
    listAvailableParentsForChat: 5,
    getParentBootstrap: 6,
    getParentUnreadState: 4,
    hasUnreadParentChats: 3
  };

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getMethodPriority(method) {
    return Object.prototype.hasOwnProperty.call(METHOD_PRIORITY, method)
      ? METHOD_PRIORITY[method]
      : 1;
  }

  function recordDiagnostic(entry) {
    try {
      diagnostics.push({
        at: new Date().toISOString(),
        ...entry
      });
      if (diagnostics.length > 120) diagnostics.splice(0, diagnostics.length - 120);
    } catch (e) {}
    updateDebugPanel();
  }

  function isDebugEnabled() {
    try {
      return /(?:^|[?&])debugApi=1(?:&|$)/.test(window.location.search || '') ||
        window.localStorage.getItem('medsi_api_debug') === '1';
    } catch (e) {
      return false;
    }
  }

  function updateDebugPanel() {
    if (!isDebugEnabled()) return;
    try {
      if (!debugPanel) {
        debugPanel = document.createElement('div');
        debugPanel.style.cssText = [
          'position:fixed',
          'left:8px',
          'right:8px',
          'bottom:8px',
          'z-index:99999',
          'padding:8px 10px',
          'border-radius:12px',
          'background:rgba(17,66,74,.92)',
          'color:#fff',
          'font:12px/1.35 system-ui,-apple-system,Segoe UI,Roboto,Arial',
          'box-shadow:0 8px 22px rgba(0,0,0,.18)',
          'white-space:pre-wrap',
          'pointer-events:none'
        ].join(';');
        document.addEventListener('DOMContentLoaded', () => {
          if (document.body && !debugPanel.isConnected) document.body.appendChild(debugPanel);
        });
        if (document.body) document.body.appendChild(debugPanel);
      }

      const recent = diagnostics.slice(-5).map(item => {
        const status = item.ok ? 'ok' : 'ERR';
        return `${item.method}: ${status} ${item.durationMs || 0}ms${item.message ? ' — ' + item.message : ''}`;
      }).join('\n');
      const activeText = activeMethods.length ? `active: ${activeMethods.join(', ')}` : '';
      const queuedText = queue.length ? `queued: ${queue.map(item => item.method).join(', ')}` : '';
      debugPanel.textContent = [
        `API active=${activeRequests} queued=${queue.length}`,
        activeText,
        queuedText,
        recent || 'waiting...'
      ].filter(Boolean).join('\n');
    } catch (e) {}
  }

  function runQueue() {
    while (activeRequests < MAX_CONCURRENT_REQUESTS && queue.length) {
      queue.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.seq - b.seq;
      });

      const item = queue.shift();
      activeRequests += 1;
      activeMethods.push(item.method);
      updateDebugPanel();

      runApiRequest(item.method, item.args)
        .then(item.resolve)
        .catch(item.reject)
        .finally(() => {
          activeRequests = Math.max(0, activeRequests - 1);
          const methodIndex = activeMethods.indexOf(item.method);
          if (methodIndex >= 0) activeMethods.splice(methodIndex, 1);
          updateDebugPanel();
          runQueue();
        });
    }
  }

  function enqueueApiCall(method, args) {
    return new Promise((resolve, reject) => {
      queue.push({
        method,
        args,
        priority: getMethodPriority(method),
        seq: ++requestSeq,
        resolve,
        reject
      });
      updateDebugPanel();
      runQueue();
    });
  }

  function serializeError(error) {
    if (!error) return { message: 'Сервер недоступен.' };
    if (typeof error === 'string') return { message: error };
    return {
      message: error.message || String(error),
      stack: error.stack || ''
    };
  }

  async function fetchApiOnce(method, args) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          method,
          args: Array.isArray(args) ? args : []
        })
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch (e) {
        payload = null;
      }

      if (!response.ok || !payload) {
        throw new Error((payload && payload.message) || 'Сервер недоступен.');
      }

      if (payload.ok === false && Object.prototype.hasOwnProperty.call(payload, 'result')) {
        return payload.result;
      }

      if (payload.ok === false) {
        throw new Error(payload.message || 'Ошибка API.');
      }

      return Object.prototype.hasOwnProperty.call(payload, 'result') ? payload.result : payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function runApiRequest(method, args) {
    const started = Date.now();
    let lastError = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const result = await fetchApiOnce(method, args);
        recordDiagnostic({
          method,
          ok: true,
          attempt,
          durationMs: Date.now() - started
        });
        return result;
      } catch (error) {
        lastError = error;
        recordDiagnostic({
          method,
          ok: false,
          attempt,
          durationMs: Date.now() - started,
          message: error && error.message ? error.message : String(error)
        });

        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS * (attempt + 1));
        }
      }
    }

    throw lastError || new Error('Сервер недоступен.');
  }

  function callApi(method, args) {
    return enqueueApiCall(method, Array.isArray(args) ? args : []);
  }

  function createRunner(successHandler, failureHandler) {
    const state = {
      successHandler: typeof successHandler === 'function' ? successHandler : null,
      failureHandler: typeof failureHandler === 'function' ? failureHandler : null
    };

    return new Proxy(function () {}, {
      get(target, prop) {
        if (prop === 'withSuccessHandler') {
          return handler => createRunner(handler, state.failureHandler);
        }

        if (prop === 'withFailureHandler') {
          return handler => createRunner(state.successHandler, handler);
        }

        if (prop === 'withUserObject') {
          return () => createRunner(state.successHandler, state.failureHandler);
        }

        if (prop === 'then' || prop === 'catch' || prop === 'finally') {
          return undefined;
        }

        return (...args) => {
          callApi(String(prop), args)
            .then(result => {
              if (state.successHandler) state.successHandler(result);
            })
            .catch(error => {
              if (state.failureHandler) {
                state.failureHandler(serializeError(error));
                return;
              }
              console.error('Medsi API error:', prop, error);
            });
        };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = createRunner();
  window.MedsiApi = {
    call: callApi,
    diagnostics: diagnostics,
    getQueueState: () => ({
      active: activeRequests,
      queued: queue.length,
      activeMethods: activeMethods.slice(),
      queuedMethods: queue.map(item => item.method),
      recent: diagnostics.slice(-20)
    })
  };

  try {
    document.documentElement.dataset.medsiApiClient = 'ready';
  } catch (e) {}
})();
