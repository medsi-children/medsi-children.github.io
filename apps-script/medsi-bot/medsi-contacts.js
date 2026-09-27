/**
 * Контакты родителей для iPhone.
 *
 * Создаются только контакты, записанные в скрытом листе MEDSI_CONTACT_SYNC.
 * Поэтому синхронизация никогда не удаляет личные контакты владельца аккаунта.
 * Перед первым запуском добавьте People API в Apps Script: Services -> + -> People API.
 */
const MEDSI_CONTACT_SYNC_SHEET_NAME_ = 'MEDSI_CONTACT_SYNC';
const MEDSI_CONTACT_SYNC_TRIGGER_HANDLER_ = 'syncMedsiParentContacts';

// Небольшой практический словарь: он нужен только для «Мама/Папа» и склонения.
// Незнакомое имя намеренно остаётся нейтральным и не склоняется.
const MEDSI_CONTACT_FEMALE_NAMES_ = new Set([
  'агния','авелина','александра','алина','алиса','алла','алёна','алена','анастасия','ангелина','анна','анфиса','аня','арина','асья','ася',
  'валентина','валерия','валя','варвара','варя','василиса','вера','вероника','вика','виктория','галя','галина','дарина','дарья','даша',
  'диана','евгения','ева','екатерина','елена','елизавета','жанна','женя','зариат','зарият','злата','инна','ира','ирина','карина','катя','кира',
  'ксения','ксеня','ксюша','лариса','лена','лера','лида','лидия','лиза','лилия','лия','люба','любовь','люда','людмила','маргарита','марго','марина',
  'мария','маша','мила','милана','милена','мира','мирослава','надежда','надя','настя','наталия','наталья','наташа','оксана','олеся','оля','ольга',
  'поля','полина','рита','рузалия','света','светлана','софия','софья','софа','соня','стефания','стефани','стеша','тая','таисия','тася','таня','татьяна',
  'саша','ульяна','хадижа','хадиджа','юлия','юля','яна','ярослава','яся'
]);
const MEDSI_CONTACT_MALE_NAMES_ = new Set([
  'александр','алексей','алёша','алеша','андрей','анатолий','антон','артем','артём','борис','боря','вадим','валерий','василий','вася',
  'ваня','виталий','витя','виктор','влад','владимир','владислав','володя','вова','всеволод','вячеслав','гамзат','герман','глеб','григорий','гриша',
  'данил','даниил','данила','данилла','даня','денис','дима','дмитрий','егор','евгений','елисей','иван','игорь','илья','иля','кирилл','коля','константин','костя',
  'лев','лева','лёва','леонид','лёня','леня','леша','лёша','лука','макар','макс','максим','марк','матвей','михаил','миша','мирон','никита','николай',
  'олег','павел','паша','роман','рома','руслан','саадула','савелий','саша','сема','семен','семён','сергей','сережа','серёжа','слава','станислав','стас','степа','стёпа','степан',
  'сева','тимофей','тимур','тёма','тема','федор','фёдор','федя','ян','яков','ярик','ярослав'
]);

const MEDSI_CONTACT_GENITIVE_EXCEPTIONS_ = {
  'любовь': 'Любы', 'лев': 'Льва', 'илья': 'Ильи', 'никита': 'Никиты', 'лука': 'Луки', 'фома': 'Фомы',
  'кузьма': 'Кузьмы', 'паша': 'Паши', 'саша': 'Саши', 'женя': 'Жени', 'даня': 'Дани',
  'ваня': 'Вани', 'валя': 'Вали', 'миша': 'Миши', 'костя': 'Кости', 'слава': 'Славы', 'федя': 'Феди', 'ярик': 'Ярика'
};

function ensureMedsiContactSyncSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(MEDSI_CONTACT_SYNC_SHEET_NAME_);
  if (!sh) {
    sh = ss.insertSheet(MEDSI_CONTACT_SYNC_SHEET_NAME_);
    sh.getRange(1, 1, 1, 4).setValues([['PHONE10', 'RESOURCE_NAME', 'LABEL', 'UPDATED_AT']]);
    sh.hideSheet();
  }
  return sh;
}

function getMedsiContactSyncState_() {
  const sh = ensureMedsiContactSyncSheet_();
  const count = Math.max(sh.getLastRow() - 1, 0);
  const rows = count ? sh.getRange(2, 1, count, 4).getValues() : [];
  const byPhone = {};
  rows.forEach((row, index) => {
    const phone = last10_(row[0]);
    if (phone) byPhone[phone] = { row: index + 2, resourceName: String(row[1] || ''), label: String(row[2] || '') };
  });
  return { sh, byPhone };
}

function getMedsiContactProfiles_() {
  const sh = getDataSheet_();
  const count = sh ? Math.max(sh.getLastRow() - 1, 0) : 0;
  if (!count) return {};
  const rows = sh.getRange(2, 1, count, 4).getValues();
  const byPhone = {};
  rows.forEach(row => {
    const phone10 = last10_(row[0]);
    if (!phone10 || byPhone[phone10]) return;
    byPhone[phone10] = {
      phone: normalizePhone_(row[0]),
      parentFirst: String(row[1] || '').trim().split(/\s+/)[0] || '',
      childRaw: String(row[2] || '').trim(),
      childFamily: String(row[3] || '').trim()
    };
  });
  return byPhone;
}

function medsiContactGender_(nameRaw) {
  const name = normRu(nameRaw).split(/\s+/)[0];
  const female = MEDSI_CONTACT_FEMALE_NAMES_.has(name);
  const male = MEDSI_CONTACT_MALE_NAMES_.has(name);
  if (female && male) return 'ambiguous';
  if (female) return 'female';
  if (male) return 'male';
  return '';
}

function medsiContactFamilyGenderHint_(familyRaw) {
  const family = normRu(familyRaw);
  if (/((ова|ева|ёва|ина|ына|ская|цкая|ая|яя))$/u.test(family)) return 'female';
  if (/((ов|ев|ёв|ин|ын|ский|цкий|ый|ий))$/u.test(family)) return 'male';
  return '';
}

function medsiContactCap_(value) {
  return String(value || '').split(/\s+/).filter(Boolean).map(capWord).join(' ');
}

function medsiContactPhoneE164_(phoneRaw) {
  const phone10 = last10_(phoneRaw);
  return phone10 ? '+7' + phone10 : normalizePhone_(phoneRaw);
}

function medsiContactGenitiveName_(nameRaw, gender) {
  const name = medsiContactCap_(nameRaw);
  const norm = normRu(name);
  if (!name || !gender) return name;
  if (MEDSI_CONTACT_GENITIVE_EXCEPTIONS_[norm]) return MEDSI_CONTACT_GENITIVE_EXCEPTIONS_[norm];
  if (gender === 'female') {
    if (/ия$/u.test(name)) return name.slice(0, -1) + 'и';
    if (/ья$/u.test(name)) return name.slice(0, -1) + 'и';
    if (/я$/u.test(name)) return name.slice(0, -1) + 'и';
    if (/ь$/u.test(name)) return name + 'и';
    if (/а$/u.test(name)) return name.slice(0, -1) + (/[гкхжчшщ]а$/iu.test(name) ? 'и' : 'ы');
    return name;
  }
  if (gender === 'ambiguous') return name;
  if (/й$/u.test(name) || /ь$/u.test(name)) return name.slice(0, -1) + 'я';
  if (/я$/u.test(name)) return name.slice(0, -1) + 'и';
  if (/а$/u.test(name)) return name.slice(0, -1) + 'ы';
  return name + 'а';
}

function medsiContactGenitiveFamily_(familyRaw, gender) {
  const family = medsiContactCap_(familyRaw);
  if (!family || !gender) return family;
  if (gender === 'female') {
    // Меняем именно окончание, а не отрезаем фиксированное число букв:
    // «Жураховская» → «Жураховской», «Устьянцева» → «Устьянцевой».
    if (/цкая$/iu.test(family) || /ская$/iu.test(family)) return family.replace(/ая$/iu, 'ой');
    if (/ова$/iu.test(family) || /ева$/iu.test(family) || /ёва$/iu.test(family) || /ина$/iu.test(family) || /ына$/iu.test(family)) return family.replace(/а$/iu, 'ой');
    if (/ая$/iu.test(family)) return family.replace(/ая$/iu, 'ой');
    if (/яя$/iu.test(family)) return family.replace(/яя$/iu, 'ей');
    return family;
  }
  if (/цкий$/iu.test(family)) return family.slice(0, -2) + 'ого';
  if (/ский$/iu.test(family)) return family.slice(0, -2) + 'ого';
  if (/ов$/iu.test(family) || /ев$/iu.test(family) || /ёв$/iu.test(family) || /ин$/iu.test(family) || /ын$/iu.test(family)) return family + 'а';
  if (/ый$/iu.test(family)) return family.slice(0, -2) + 'ого';
  if (/ий$/iu.test(family)) return family.slice(0, -2) + 'его';
  return family;
}

function buildMedsiContactLabel_(profile) {
  const parent = medsiContactCap_(profile.parentFirst) || 'Родитель';
  const childBase = canonizeChildName_(stripInitialFromName_(profile.childRaw)) || stripInitialFromName_(profile.childRaw);
  const childGender = medsiContactGender_(childBase);
  const parentGender = medsiContactGender_(parent);
  const role = parentGender === 'female' ? 'Мама' : (parentGender === 'male' ? 'Папа' : 'Родитель');
  const childName = childGender ? medsiContactGenitiveName_(childBase, childGender) : medsiContactCap_(childBase);
  const familyGender = childGender === 'ambiguous' ? medsiContactFamilyGenderHint_(profile.childFamily) : childGender;
  const family = familyGender ? medsiContactGenitiveFamily_(profile.childFamily, familyGender) : medsiContactCap_(profile.childFamily);
  return [parent, '—', role, [childName, family].filter(Boolean).join(' ')].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function medsiContactPerson_(profile, label) {
  return {
    names: [{ givenName: label }],
    phoneNumbers: [{ value: medsiContactPhoneE164_(profile.phone), type: 'mobile' }]
  };
}

function updateMedsiContact_(resourceName, profile, label) {
  const current = People.People.get(resourceName, { personFields: 'metadata' });
  const body = medsiContactPerson_(profile, label);
  body.resourceName = resourceName;
  body.etag = current.etag;
  return People.People.updateContact(body, resourceName, { updatePersonFields: 'names,phoneNumbers' });
}

function removeMedsiParentContactByPhone_(phoneRaw) {
  const phone = last10_(phoneRaw);
  if (!phone) return { ok: true, deleted: false };
  const state = getMedsiContactSyncState_();
  const entry = state.byPhone[phone];
  if (!entry) return { ok: true, deleted: false };
  if (entry.resourceName) {
    try { People.People.deleteContact(entry.resourceName); }
    catch (e) {
      // Контакт уже мог быть удалён вручную. В этом случае чистим только след в служебном листе.
      if (!/not found|404/i.test(String(e && e.message || e))) throw e;
    }
  }
  state.sh.deleteRow(entry.row);
  return { ok: true, deleted: true };
}

function removeMedsiParentContactBestEffort_(phoneRaw) {
  try { return removeMedsiParentContactByPhone_(phoneRaw); }
  catch (e) { Logger.log('⚠️ Не удалось удалить контакт родителя: ' + (e.message || e)); return { ok: false }; }
}

/** Ручной и часовой запуск: создаёт/обновляет/удаляет только контакты бота. */
function syncMedsiParentContacts() {
  const profiles = getMedsiContactProfiles_();
  const state = getMedsiContactSyncState_();
  const result = { ok: true, created: 0, updated: 0, deleted: 0, unchanged: 0, errors: [] };

  Object.keys(profiles).sort().forEach(phone => {
    const profile = profiles[phone];
    const label = buildMedsiContactLabel_(profile);
    const entry = state.byPhone[phone];
    try {
      if (entry && entry.resourceName && entry.label === label) { result.unchanged += 1; return; }
      const person = entry && entry.resourceName
        ? updateMedsiContact_(entry.resourceName, profile, label)
        : People.People.createContact(medsiContactPerson_(profile, label), { personFields: 'names,phoneNumbers,metadata' });
      if (entry) {
        state.sh.getRange(entry.row, 1, 1, 4).setValues([[phone, person.resourceName || entry.resourceName, label, new Date()]]);
        result.updated += 1;
      } else {
        state.sh.appendRow([phone, person.resourceName, label, new Date()]);
        result.created += 1;
      }
    } catch (e) { result.errors.push(phone + ': ' + (e.message || e)); }
  });

  Object.keys(state.byPhone).forEach(phone => {
    if (profiles[phone]) return;
    try { removeMedsiParentContactByPhone_(phone); result.deleted += 1; }
    catch (e) { result.errors.push(phone + ': ' + (e.message || e)); }
  });
  result.ok = result.errors.length === 0;
  return result;
}

/** Запускается после регистрации, но не ломает регистрацию, если Contacts ещё не подключены. */
function syncMedsiParentContactBestEffort_(phoneRaw) {
  try { return syncMedsiParentContacts(); }
  catch (e) { Logger.log('⚠️ Контакты пока не синхронизированы: ' + (e.message || e)); return { ok: false }; }
}

/** Один раз запускается вручную после добавления People API. */
function setupMedsiParentContacts() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === MEDSI_CONTACT_SYNC_TRIGGER_HANDLER_) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger(MEDSI_CONTACT_SYNC_TRIGGER_HANDLER_).timeBased().everyHours(1).create();
  return syncMedsiParentContacts();
}
