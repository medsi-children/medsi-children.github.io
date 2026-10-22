import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} from '@simplewebauthn/server';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'authorization,content-type,x-medsi-chat-session,x-medsi-phone'
    }
  });
}

async function body(request) {
  try { return await request.json(); } catch { return null; }
}

function randomToken(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return prefix + '_' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const bytes = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(bytes, char => char.charCodeAt(0));
}

function originConfig(env) {
  const rpID = String(env.PARENT_PASSKEY_RP_ID || '').trim().toLowerCase();
  const origin = String(env.PARENT_PASSKEY_ORIGIN || '').trim();
  if (!rpID || !origin || !/^https:\/\//i.test(origin)) throw new Error('Passkey origin is not configured.');
  return { rpID, origin };
}

async function issueChallenge(env, { purpose, phone10 = '', userHandle = '', generationId = '' }, challenge) {
  const now = Date.now();
  const challengeId = randomToken('pach');
  const expiresAt = now + CHALLENGE_TTL_MS;
  await env.CHAT_DB.prepare(`INSERT INTO parent_auth_challenges
    (challenge_id, challenge, purpose, user_handle, phone10, generation_id, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(challengeId, challenge, purpose, userHandle || null, phone10 || null, generationId || null, now, expiresAt).run();
  return { challengeId, expiresAt };
}

async function consumeChallenge(env, challengeId, purpose) {
  const now = Date.now();
  const result = await env.CHAT_DB.prepare(`UPDATE parent_auth_challenges
    SET consumed_at=? WHERE challenge_id=? AND purpose=? AND consumed_at IS NULL AND expires_at>?`)
    .bind(now, challengeId, purpose, now).run();
  return Number(result.meta && result.meta.changes || 0) === 1;
}

function credentialId(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9_-]{16,1024}$/.test(id) ? id : '';
}

function credentialTransports(value) {
  return Array.isArray(value) ? value.filter(item => ['ble', 'hybrid', 'internal', 'nfc', 'usb'].includes(item)).slice(0, 8) : [];
}

export async function parentPasskeyRegistrationOptions(request, env, auth) {
  if (!auth || auth.role !== 'parent' || !auth.phone10) return json({ ok: false, message: 'Unauthorized' }, 401);
  const { rpID } = originConfig(env);
  const profile = await env.CHAT_DB.prepare('SELECT phone10, parent_name FROM chat_profiles WHERE phone10=?').bind(auth.phone10).first();
  if (!profile) return json({ ok: false, message: 'Профиль уже не активен.' }, 410);

  const account = await env.CHAT_DB.prepare('SELECT user_handle, generation_id FROM parent_auth_profiles WHERE phone10=?').bind(auth.phone10).first();
  if (!account) return json({ ok: false, message: 'Профиль изменился. Обновите страницу и повторите.' }, 410);
  const existing = await env.CHAT_DB.prepare('SELECT credential_id, transports FROM parent_passkeys WHERE user_handle=? AND revoked_at IS NULL').bind(account.user_handle).all();
  const options = await generateRegistrationOptions({
    rpName: 'Медси Бот', rpID,
    userID: fromBase64url(account.user_handle),
    userName: 'parent-' + account.user_handle.slice(0, 12),
    userDisplayName: 'Медси Бот',
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials: (existing.results || []).map(row => ({
      id: row.credential_id,
      transports: credentialTransports(JSON.parse(row.transports || '[]'))
    }))
  });
  const challenge = await issueChallenge(env, { purpose: 'registration', phone10: auth.phone10,
    userHandle: account.user_handle, generationId: account.generation_id }, options.challenge);
  return json({ ok: true, ...challenge, options });
}

export async function parentPasskeyRegistrationVerify(request, env, auth, helpers) {
  if (!auth || auth.role !== 'parent' || !auth.phone10) return json({ ok: false, message: 'Unauthorized' }, 401);
  const payload = await body(request) || {};
  const challengeId = String(payload.challengeId || '');
  const credential = payload.credential;
  if (!/^pach_[A-Za-z0-9_-]{20,80}$/.test(challengeId) || !credential || typeof credential !== 'object') {
    return json({ ok: false, message: 'Некорректный запрос сохранения ключа.' }, 400);
  }
  const challenge = await env.CHAT_DB.prepare(`SELECT * FROM parent_auth_challenges
    WHERE challenge_id=? AND purpose='registration'`).bind(challengeId).first();
  if (!challenge || challenge.phone10 !== auth.phone10 || Number(challenge.expires_at) <= Date.now() || challenge.consumed_at) {
    return json({ ok: false, message: 'Запрос сохранения ключа истёк. Попробуйте ещё раз.' }, 410);
  }
  const { rpID, origin } = originConfig(env);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: credential, expectedChallenge: challenge.challenge, expectedOrigin: origin,
      expectedRPID: rpID, requireUserVerification: true
    });
  } catch (error) {
    return json({ ok: false, message: 'Не удалось проверить системный ключ.' }, 400);
  }
  if (!verification.verified || !verification.registrationInfo || !verification.registrationInfo.credential) {
    return json({ ok: false, message: 'Системный ключ не прошёл проверку.' }, 400);
  }
  const info = verification.registrationInfo;
  const id = credentialId(info.credential.id);
  if (!id || !info.userVerified) return json({ ok: false, message: 'Устройство не подтвердило пользователя.' }, 400);
  if (!await consumeChallenge(env, challengeId, 'registration')) return json({ ok: false, message: 'Запрос уже использован.' }, 409);
  const now = Date.now();
  const stored = await env.CHAT_DB.prepare(`INSERT INTO parent_passkeys
    (credential_id,user_handle,public_key,counter,transports,device_type,backed_up,created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM parent_auth_profiles WHERE phone10=? AND user_handle=? AND generation_id=? )
      AND EXISTS (SELECT 1 FROM chat_profiles WHERE phone10=?)
    ON CONFLICT(credential_id) DO NOTHING`)
    .bind(id, challenge.user_handle, info.credential.publicKey, Number(info.credential.counter || 0),
      JSON.stringify(credentialTransports(info.credential.transports)), String(info.credentialDeviceType || ''),
      info.credentialBackedUp ? 1 : 0, now, auth.phone10, challenge.user_handle, challenge.generation_id, auth.phone10).run();
  if (Number(stored.meta && stored.meta.changes || 0) !== 1) {
    return json({ ok: false, message: 'Профиль изменился или этот ключ уже сохранён. Обновите страницу и повторите.' }, 409);
  }
  return json({ ok: true, enabled: true });
}

export async function parentPasskeyAuthenticationOptions(request, env) {
  const { rpID } = originConfig(env);
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
  const challenge = await issueChallenge(env, { purpose: 'authentication' }, options.challenge);
  return json({ ok: true, ...challenge, options });
}

export async function parentPasskeyAuthenticationVerify(request, env, helpers) {
  const payload = await body(request) || {};
  const challengeId = String(payload.challengeId || '');
  const response = payload.credential;
  const id = credentialId(response && response.id);
  if (!/^pach_[A-Za-z0-9_-]{20,80}$/.test(challengeId) || !id || !response || typeof response !== 'object') {
    return json({ ok: false, message: 'Не удалось распознать системный ключ.' }, 400);
  }
  const challenge = await env.CHAT_DB.prepare(`SELECT * FROM parent_auth_challenges
    WHERE challenge_id=? AND purpose='authentication'`).bind(challengeId).first();
  if (!challenge || Number(challenge.expires_at) <= Date.now() || challenge.consumed_at) {
    return json({ ok: false, message: 'Запрос входа истёк. Нажмите «Войти» ещё раз.' }, 410);
  }
  const credential = await env.CHAT_DB.prepare(`SELECT c.*, a.phone10, a.generation_id
    FROM parent_passkeys c JOIN parent_auth_profiles a ON a.user_handle=c.user_handle
    WHERE c.credential_id=? AND c.revoked_at IS NULL`).bind(id).first();
  if (!credential) return json({ ok: false, code: 'PASSKEY_NOT_FOUND', message: 'Этот ключ доступа не найден. Выберите вход по номеру телефона.' }, 404);
  const { rpID, origin } = originConfig(env);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response, expectedChallenge: challenge.challenge, expectedOrigin: origin, expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: credential.credential_id, publicKey: new Uint8Array(credential.public_key),
        counter: Number(credential.counter || 0), transports: credentialTransports(JSON.parse(credential.transports || '[]'))
      }
    });
  } catch (error) {
    return json({ ok: false, message: 'Не удалось проверить системный ключ.' }, 400);
  }
  if (!verification.verified || !verification.authenticationInfo || !verification.authenticationInfo.userVerified) {
    return json({ ok: false, message: 'Системный ключ не прошёл проверку.' }, 400);
  }
  if (!await consumeChallenge(env, challengeId, 'authentication')) return json({ ok: false, message: 'Запрос уже использован.' }, 409);
  const profile = await env.CHAT_DB.prepare(`SELECT p.phone10, p.parent_name, p.child_name, p.relationship, p.child_genitive
    FROM chat_profiles p JOIN parent_auth_profiles a ON a.phone10=p.phone10
    WHERE p.phone10=? AND a.generation_id=?`).bind(credential.phone10, credential.generation_id).first();
  if (!profile) return json({ ok: false, code: 'PROFILE_INACTIVE', message: 'Профиль больше не активен. Обратитесь к воспитателю.' }, 410);
  await env.CHAT_DB.prepare(`UPDATE parent_passkeys SET counter=MAX(counter,?) WHERE credential_id=? AND revoked_at IS NULL`)
    .bind(Number(verification.authenticationInfo.newCounter || 0), id).run();
  if (!env.LAB_D1_SESSION_SECRET) return json({ ok: false, message: 'Сервис авторизации временно недоступен.' }, 503);
  const session = await helpers.issueParentSession(profile.phone10, env.LAB_D1_SESSION_SECRET);
  return json({ ok: true, status: 'APPROVED', phone: '8' + profile.phone10,
    parentName: profile.parent_name || '', childName: profile.child_name || '',
    parentSession: session.token, d1Session: { ok: true, ...session } });
}
