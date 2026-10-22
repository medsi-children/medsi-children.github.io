// REPORTS!G2:G stores the manually editable relationship for each adult.
const PARENT_RELATIONSHIP_LABELS_ = ['Мама', 'Папа', 'Бабушка', 'Дедушка', 'Тётя', 'Дядя', 'Опекун', 'Родитель'];

function parentRelationshipLabel_(raw) {
  const key = String(raw || '').trim().toLowerCase().replace(/ё/g, 'е');
  return PARENT_RELATIONSHIP_LABELS_.filter(function(label) {
    return label.toLowerCase().replace(/ё/g, 'е') === key;
  })[0] || 'Родитель';
}

function defaultParentRelationship_(parentName) {
  const gender = medsiContactGender_(String(parentName || '').trim().split(/\s+/)[0]);
  return gender === 'female' ? 'Мама' : (gender === 'male' ? 'Папа' : 'Родитель');
}

function parentChildGenitive_(childName) {
  const words = String(childName || '').trim().split(/\s+/);
  const first = words.shift();
  let gender = medsiContactGender_(first);
  if (!first || !gender) return '';
  const family = words.join(' ');
  if (gender === 'ambiguous') gender = medsiContactFamilyGenderHint_(family) || 'ambiguous';
  return [medsiContactGenitiveName_(first, gender), medsiContactGenitiveFamily_(family, gender)].filter(Boolean).join(' ');
}

// Only used when an older registration form omitted the child's surname.
// Explicitly entered child surnames are never changed by this helper.
function inheritedChildFamily_(childFirst, parentFamily) {
  const family = String(parentFamily || '').trim();
  const gender = medsiContactGender_(childFirst);
  if (gender === 'male') {
    if (/(?:ова|ева|ёва|ина|ына)$/iu.test(family)) return family.slice(0, -1);
    if (/(?:ская|цкая)$/iu.test(family)) return family.slice(0, -2) + 'ий';
  }
  if (gender === 'female') {
    if (/(?:ов|ев|ёв|ин|ын)$/iu.test(family)) return family + 'а';
    if (/(?:ский|цкий)$/iu.test(family)) return family.slice(0, -2) + 'ая';
  }
  return family;
}

function parentRelationshipForPhone_(phoneRaw, parentName) {
  const rows = getReportRowsByPhone_(phoneRaw);
  if (rows.length && String(rows[0][6] || '').trim()) return parentRelationshipLabel_(rows[0][6]);
  return defaultParentRelationship_(parentName);
}

function enrichProfilesWithRelationships_(profiles, rowsRaw) {
  const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
  const byPhone = {};
  rows.forEach(function(row) {
    const phone = last10_(row[0]);
    if (!phone) return;
    const value = String(row[6] || '').trim();
    const relationship = value ? parentRelationshipLabel_(value) : defaultParentRelationship_(row[1]);
    if (!byPhone[phone]) byPhone[phone] = relationship;
  });
  profiles.forEach(function(profile) {
    profile.relationship = byPhone[last10_(profile.phone)] || defaultParentRelationship_(profile.parentName);
    profile.childGenitive = parentChildGenitive_(profile.childName);
  });
  return profiles;
}

// Explicit writer for inferred labels. Call only from an existing background
// lifecycle/sync path that already owns the ScriptLock; profile readers remain
// read-only. Re-read each blank cell just before writing so a manual value wins.
function fillMissingParentRelationships_(sheetRaw) {
  const sheet = sheetRaw || getDataSheet_();
  const count = sheet ? Math.max(0, sheet.getLastRow() - 1) : 0;
  if (!count) return { ok:true, filled:0 };
  const rows = sheet.getRange(2, 1, count, 7).getValues();
  let filled = 0;
  rows.forEach(function(row, index) {
    if (!last10_(row[0]) || String(row[6] || '').trim()) return;
    const relationship = defaultParentRelationship_(row[1]);
    const cell = sheet.getRange(index + 2, 7);
    if (String(cell.getValue() || '').trim()) return;
    cell.setValue(relationship);
    filled += 1;
  });
  return { ok:true, filled:filled };
}

function initializeParentRelationships() {
  const sheet = getDataSheet_();
  if (!sheet) throw new Error('Лист REPORTS не найден.');
  if (!String(sheet.getRange(1, 7).getValue() || '').trim()) sheet.getRange(1, 7).setValue('Статус родителя');
  sheet.getRange('G2:G').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(PARENT_RELATIONSHIP_LABELS_, true).setAllowInvalid(false).build());
  return syncD1ProfilesFromReports_(false);
}
