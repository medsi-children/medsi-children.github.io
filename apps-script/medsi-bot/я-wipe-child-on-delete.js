/* Tutor UI + REPORTS-row delete hooks: wipe MORNING/EVENING initials.
 * Filename starts with Cyrillic "я" so these redefinitions load after
 * chat-d1-migration.js and "Медси бот.js".
 */
function deleteReportChildByPhone(phoneRaw, tutorTokenRaw) {
  try {
    requireTutorSession_(tutorTokenRaw);
    const phone10 = last10_(phoneRaw);
    if (!phone10) return { ok: false, message: 'Не удалось определить номер родителя.' };

    return withChatWriteLock_(function() {
      const sh = getDataSheet_();
      const lastRow = sh ? sh.getLastRow() : 0;

      const values = lastRow >= 2
        ? sh.getRange(2, 1, lastRow - 1, 4).getValues()
        : [];
      const rowNumbers = [];
      const wipeIdentities = [];

      values.forEach((row, index) => {
        if (last10_(row[0]) !== phone10) return;
        rowNumbers.push(index + 2);
        const wipeIdentity = reportChildWipeIdentityFromRow_(row);
        if (wipeIdentity) wipeIdentities.push(wipeIdentity);
      });

      let cleanup = null;
      let d1Cleanup = null;
      const cleanupErrors = [];

      // First close the production chat. If Cloudflare is temporarily
      // unavailable, keep REPORTS intact so the whole operation can be retried.
      try {
        d1Cleanup = deleteD1ProfileWithS3Purge_(phone10);
      } catch (e) {
        return {
          ok: false,
          message: 'Не удалось закрыть чат родителя. Попробуйте удалить ещё раз: ' + String(e && e.message || e)
        };
      }

      // REPORTS remains the access authority. D1 access is already closed.
      for (let i = rowNumbers.length - 1; i >= 0; i -= 1) {
        sh.deleteRow(rowNumbers[i]);
      }

      function bestEffortDeleteCleanup_(label, fn) {
        try {
          return fn();
        } catch (e) {
          const message = String(e && e.message || e);
          cleanupErrors.push(label + ': ' + message);
          Logger.log(
            'Cleanup after parent deletion failed [' +
            label + '] for ' + phone10 + ': ' + message
          );
          return null;
        }
      }

      // Wipe child initials/blocks from current MORNING/EVENING raw reports.
      // Identities were collected while REPORTS rows still existed.
      const rawReportWipe = bestEffortDeleteCleanup_(
        'morning/evening wipe',
        function() { return wipeChildBlocksFromRawReportSheets_(wipeIdentities); }
      );

      // Legacy Sheets chat.
      cleanup = bestEffortDeleteCleanup_(
        'legacy chat',
        function() { return purgeLegacyChatMessagesForPhone_(phone10); }
      );

      bestEffortDeleteCleanup_(
        'report inactivity state',
        function() { return removeReportInactivityState_(phone10); }
      );

      bestEffortDeleteCleanup_(
        'educator pin',
        function() { return removeEducatorChatPin_(phone10); }
      );

      // purgeInactiveChatMessages_ already rebuilds the legacy index when
      // it deletes rows. This extra rebuild is only a safety cleanup and
      // must never turn a successful profile deletion into a failure.
      bestEffortDeleteCleanup_(
        'chat index',
        function() { return rebuildChatIndex_(); }
      );

      bestEffortDeleteCleanup_(
        'chat cache',
        function() { return clearGetChatMessagesCache(); }
      );

      bestEffortDeleteCleanup_(
        'parent contact',
        function() { return removeMedsiParentContactBestEffort_(phone10); }
      );

      return {
        ok: true,
        alreadyDeleted: rowNumbers.length === 0,
        deletedReportRows: rowNumbers.length,
        deletedChatRows: Number(cleanup && cleanup.deletedRows || 0),
        deletedD1Profiles: Number(d1Cleanup && d1Cleanup.deleted && 1 || 0),
        rawReportWipe: rawReportWipe || { morningRemoved: 0, eveningRemoved: 0 },
        cleanupComplete: cleanupErrors.length === 0,
        cleanupErrors: cleanupErrors
      };
    });
  } catch (e) {
    return { ok: false, message: 'Не удалось удалить ребёнка: ' + (e.message || e) };
  }
}

function reconcileReportsProfilesToD1_(reason) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok:true, skipped:true, message:'Profile sync is already running.' };
  try {
    const sheet = getDataSheet_();
    if (!sheet) throw new Error('Лист REPORTS не найден; удаление профилей остановлено.');
    // Capture previous REPORTS→D1 snapshot before nonDestructive overwrites it.
    // Stale phones are already gone from REPORTS, so wipe identity must come from here.
    const previous = loadReportsD1ProfilesSnapshot_() || {};
    const current = reportsD1ProfilesSnapshot_();
    const sync = reconcileReportsProfilesToD1NonDestructive_(reason);
    const inventory = d1AdminRequest_('/admin/profile-phones', 'get');
    const stale = (Array.isArray(inventory.phones) ? inventory.phones : []).filter(function(phone) {
      return !current[last10_(phone)];
    });
    const deleted = [];
    const failed = [];
    const cleanupErrors = [];
    const wipeByPhone = {};
    // Limit one pass so an unexpectedly empty sheet cannot erase every chat.
    stale.slice(0, 3).forEach(function(phone) {
      try {
        // A parent may have been registered again while the D1 inventory was read.
        if (getProfileByPhone_(phone)) return;
        const phone10 = last10_(phone);
        const wipeIdentity = reportChildWipeIdentityFromProfile_(previous[phone10] || null);
        const result = deleteD1ProfileWithS3Purge_(phone);
        deleted.push({ phone:phone, purgeComplete:!!(result.purge && result.purge.ok) });
        if (wipeIdentity && wipeIdentity.baseKey) wipeByPhone[phone10] = wipeIdentity;
      } catch (error) {
        failed.push({ phone:phone, message:String(error && error.message || error) });
      }
    });
    try { purgeInactiveChatMessages_(); }
    catch (error) { cleanupErrors.push('legacy chat: ' + String(error && error.message || error)); }
    deleted.forEach(function(item) {
      const phone = item.phone;
      [
        ['inactivity', removeReportInactivityState_],
        ['pin', removeEducatorChatPin_],
        ['cache', clearGetChatMessagesCache],
        ['contact', removeMedsiParentContactBestEffort_]
      ].forEach(function(step) {
        try { step[1](phone); }
        catch (error) { cleanupErrors.push(step[0] + ' ' + phone + ': ' + String(error && error.message || error)); }
      });
      const wipeIdentity = wipeByPhone[last10_(phone)];
      if (wipeIdentity) {
        try { wipeChildBlocksFromRawReportSheets_([wipeIdentity]); }
        catch (error) { cleanupErrors.push('morning/evening wipe ' + last10_(phone) + ': ' + String(error && error.message || error)); }
      }
    });
    const purge = flushReportsS3PurgeQueue_();
    const result = {
      ok:failed.length === 0 && purge.ok,
      reason:reason || '',
      sync:sync,
      staleFound:stale.length,
      deleted:deleted,
      failed:failed,
      cleanupErrors:cleanupErrors,
      purge:purge
    };
    Logger.log('REPORTS_D1_PROFILE_LIFECYCLE ' + JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}
