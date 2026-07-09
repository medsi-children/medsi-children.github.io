(function () {
  const DEFAULT_API_URL = 'https://medsi-push-worker.medsi-children.workers.dev/api';
  const API_URL = window.MEDSI_API_URL || DEFAULT_API_URL;

  function serializeError(error) {
    if (!error) return { message: 'Сервер недоступен.' };
    if (typeof error === 'string') return { message: error };
    return {
      message: error.message || String(error),
      stack: error.stack || ''
    };
  }

  async function callApi(method, args) {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
  window.MedsiApi = { call: callApi };

  try {
    document.documentElement.dataset.medsiApiClient = 'ready';
  } catch (e) {}
})();
