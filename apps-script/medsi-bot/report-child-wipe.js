/* Wipe child name+initial blocks from MORNING/EVENING raw reports on delete. */

/**
 * Wipe identity for removing a child's block from MORNING/EVENING raw text.
 * baseKey + suffixKey must both match so "Саша И" does not wipe "Саша К".
 */
function reportChildWipeIdentityFromRow_(row) {
  const normalized = normalizeReportChildName_(row && row[2], row && row[3]);
  if (!normalized) return null;
  const parts = getReportHeaderParts_(normalized);
  if (!parts.baseKey) return null;
  return {
    baseKey: parts.baseKey,
    suffixKey: parts.suffixKey || '',
    baseRaw: parts.baseRaw,
    suffix: parts.suffix
  };
}

function reportChildWipeIdentityFromProfile_(profile) {
  const childName = String(profile && profile.childName || '').trim();
  if (!childName) return null;
  const base = stripInitialFromName_(childName) || childName;
  const familyOrSuffix = getSuffixToken_(childName) || '';
  const normalized = normalizeReportChildName_(base, familyOrSuffix);
  if (!normalized) return null;
  const parts = getReportHeaderParts_(normalized);
  if (!parts.baseKey) return null;
  return {
    baseKey: parts.baseKey,
    suffixKey: parts.suffixKey || '',
    baseRaw: parts.baseRaw,
    suffix: parts.suffix
  };
}

function reportBlockMatchesWipeIdentity_(blockOrHeader, identity) {
  if (!blockOrHeader || !identity || !identity.baseKey) return false;
  const header = (blockOrHeader.baseKey !== undefined)
    ? blockOrHeader
    : getReportHeaderParts_(blockOrHeader);
  if (!header || !header.baseKey) return false;
  if (header.baseKey !== identity.baseKey) return false;
  return String(header.suffixKey || '') === String(identity.suffixKey || '');
}

function dedupeWipeIdentities_(identities) {
  const out = [];
  const seen = {};
  (identities || []).forEach(function(identity) {
    if (!identity || !identity.baseKey) return;
    const key = identity.baseKey + '|' + String(identity.suffixKey || '');
    if (seen[key]) return;
    seen[key] = true;
    out.push(identity);
  });
  return out;
}

/**
 * Drop child report blocks whose header matches any wipe identity
 * (baseKey + suffixKey). Keeps other children and non-name service headers.
 */
function removeChildBlocksFromReportText_(text, identities) {
  const source = String(text || '');
  const identityList = dedupeWipeIdentities_(identities);
  if (!source || !identityList.length) {
    return { text: source, removed: 0 };
  }

  // Same header scanner as parseReportBlocks_.
  const headerRe = /(^|\n)\s*([^:\-–—\n]+?)\s*(?:\.?\s*[:\-–—])\s*/g;
  const matches = [];
  let m;
  while ((m = headerRe.exec(source)) !== null) {
    matches.push({
      start: m.index,
      headerEnd: headerRe.lastIndex,
      header: getReportHeaderParts_(String(m[2] || '').trim())
    });
  }
  if (!matches.length) return { text: source, removed: 0 };

  const removeFlags = matches.map(function(part) {
    return identityList.some(function(identity) {
      return reportBlockMatchesWipeIdentity_(part.header, identity);
    });
  });
  if (!removeFlags.some(Boolean)) return { text: source, removed: 0 };

  let result = '';
  let cursor = 0;
  let removed = 0;
  for (let i = 0; i < matches.length; i++) {
    const bodyEnd = (i + 1 < matches.length) ? matches[i + 1].start : source.length;
    if (!removeFlags[i]) continue;
    result += source.slice(cursor, matches[i].start);
    cursor = bodyEnd;
    removed += 1;
  }
  result += source.slice(cursor);
  result = result.replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '').trim();

  return { text: result, removed: removed };
}

function findLatestReportCell_(sheet, colIndex) {
  if (!sheet) return null;
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return null;
  const col = Number(colIndex || 1);
  const data = sheet.getRange(1, col, lastRow, 1).getValues();
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i][0] && String(data[i][0]).trim() !== '') {
      return { row: i + 1, col: col, value: data[i][0] };
    }
  }
  return null;
}

/**
 * Best-effort wipe of a child's initials/blocks from current MORNING and EVENING
 * raw report cells (latest non-empty column A, same as getLatestReport).
 */
function wipeChildBlocksFromRawReportSheets_(identities) {
  const summary = { morningRemoved: 0, eveningRemoved: 0, morningWrote: false, eveningWrote: false };
  const identityList = dedupeWipeIdentities_(identities);
  if (!identityList.length) return summary;

  function wipeOne_(sheetName, removedKey, wroteKey) {
    const sheet = getSheet_(sheetName);
    const cell = findLatestReportCell_(sheet, 1);
    if (!cell) return;
    const cleaned = removeChildBlocksFromReportText_(cell.value, identityList);
    if (!cleaned.removed) return;
    if (String(cleaned.text) === String(cell.value)) return;
    sheet.getRange(cell.row, cell.col).setValue(cleaned.text);
    summary[removedKey] = cleaned.removed;
    summary[wroteKey] = true;
  }

  wipeOne_(SHEET_MORNING, 'morningRemoved', 'morningWrote');
  wipeOne_(SHEET_EVENING, 'eveningRemoved', 'eveningWrote');
  return summary;
}
