(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const digits = value => String(value || '').replace(/\D+/g, '');
  const phone10 = value => digits(value).slice(-10);
  const formatPhone = value => {
    const p10 = phone10(value);
    return p10 ? '8' + p10 : '';
  };
  const safeGet = key => {
    try { return localStorage.getItem(key) || ''; } catch (_) { return ''; }
  };

  function registrationChildName() {
    const first = String($('childFirst') && $('childFirst').value || '').trim();
    const last = String($('childLast') && $('childLast').value || '').trim();
    return [first, last].filter(Boolean).join(' ');
  }

  function savedChildForPhone(phone) {
    const savedPhone = safeGet('medsi_parent_phone') || safeGet('medsi_phone');
    if (!savedPhone || phone10(savedPhone) !== phone10(phone)) return '';
    return String(safeGet('medsi_child') || '').trim();
  }

  function pendingData() {
    const screen = String(document.body && document.body.dataset.screen || '');
    if (screen === 'screenRegistrationPending') {
      return {
        child: registrationChildName(),
        phone: formatPhone($('phoneInputReg') && $('phoneInputReg').value)
      };
    }
    if (screen === 'screenAuthPending') {
      const phone = $('phoneInputAuth') && $('phoneInputAuth').value;
      return {
        child: savedChildForPhone(phone),
        phone: formatPhone(phone)
      };
    }
    return null;
  }

  function render() {
    const data = pendingData();
    if (!data) return;

    const chips = $('chips');
    const childChip = $('childChip');
    const phoneChip = $('phoneChip');
    if (!chips || !childChip || !phoneChip) return;

    childChip.textContent = data.child || '';
    childChip.classList.toggle('hidden', !data.child);
    phoneChip.textContent = data.phone || '';
    phoneChip.classList.toggle('hidden', !data.phone);

    chips.classList.remove('hidden');
    chips.style.display = 'flex';
  }

  function init() {
    render();
    if (document.body) {
      new MutationObserver(render).observe(document.body, {
        attributes: true,
        attributeFilter: ['data-screen']
      });
    }
    document.addEventListener('input', event => {
      const id = event.target && event.target.id;
      if (id === 'childFirst' || id === 'childLast' || id === 'phoneInputReg' || id === 'phoneInputAuth') render();
    }, { passive: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
