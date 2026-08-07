import { Router } from 'express';
import { db } from '../db.ts';
import {
  clearSessionCookie,
  findPartner,
  findSeat,
  findSpaceForUser,
  findUserById,
  generateInviteCode,
  hashPassword,
  requireAuth,
  setSessionCookie,
  verifyPassword,
} from '../auth.ts';
import { bumpVersion } from '../events.ts';

export const authRouter = Router();

type UserAuthRow = {
  id: number;
  password_hash: string;
  password_salt: string;
};

function firstGrapheme(name: string): string {
  return [...name.trim()][0] ?? '?';
}

/**
 * 가입.
 * inviteCode 를 주면 그 공간에 들어가고, 없으면 새 공간을 만든다.
 */
authRouter.post('/signup', async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const name = String(req.body?.name ?? '').trim();
  const password = String(req.body?.password ?? '');
  const inviteCode = String(req.body?.inviteCode ?? '').trim().toUpperCase();

  if (!email.includes('@')) {
    res.status(400).json({ error: '이메일 형식을 확인해 주세요.' });
    return;
  }
  if (name.length === 0) {
    res.status(400).json({ error: '이름을 입력해 주세요.' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다.' });
    return;
  }

  const taken = await db.get('SELECT id FROM users WHERE email = ?', [email]);
  if (taken) {
    res.status(409).json({ error: '이미 가입된 이메일입니다.' });
    return;
  }

  // 초대 코드를 줬다면 먼저 유효한지 본다 — 사용자를 만들어 놓고 실패하면 곤란하다.
  let targetSpaceId: number | null = null;
  if (inviteCode) {
    const space = await db.get<{ id: number }>('SELECT id FROM spaces WHERE invite_code = ?', [
      inviteCode,
    ]);
    if (!space) {
      res.status(404).json({ error: '초대 코드를 찾을 수 없습니다.' });
      return;
    }
    const members = await db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM memberships WHERE space_id = ?',
      [space.id],
    );
    if ((members?.n ?? 0) >= 2) {
      res.status(409).json({ error: '이미 두 사람이 쓰고 있는 공간입니다.' });
      return;
    }
    targetSpaceId = space.id;
  }

  const { hash, salt } = hashPassword(password);

  const inserted = await db.run(
    `INSERT INTO users (email, name, initial, password_hash, password_salt)
     VALUES (?, ?, ?, ?, ?)`,
    [email, name, firstGrapheme(name), hash, salt],
  );
  const userId = inserted.lastInsertRowid;

  // 뒤 단계에서 새로 만든 id 가 필요해 한 트랜잭션으로 묶을 수 없다.
  // 중간에 실패하면 공간 없는 사용자가 남으므로 직접 되돌린다.
  try {
    if (targetSpaceId === null) {
      const space = await db.run('INSERT INTO spaces (name, invite_code) VALUES (?, ?)', [
        `${name}의 하루`,
        generateInviteCode(),
      ]);
      targetSpaceId = space.lastInsertRowid;
    }

    await db.run('INSERT INTO memberships (space_id, user_id) VALUES (?, ?)', [
      targetSpaceId,
      userId,
    ]);
  } catch (err) {
    await db.run('DELETE FROM users WHERE id = ?', [userId]).catch(() => undefined);
    throw err;
  }

  setSessionCookie(res, userId);
  if (inviteCode) await bumpVersion(targetSpaceId, 'space:joined');
  res.status(201).json(await sessionPayload(userId));
});

authRouter.post('/login', async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');

  const row = await db.get<UserAuthRow>(
    'SELECT id, password_hash, password_salt FROM users WHERE email = ?',
    [email],
  );

  if (!row || !verifyPassword(password, row.password_hash, row.password_salt)) {
    res.status(401).json({ error: '이메일이나 비밀번호가 맞지 않습니다.' });
    return;
  }

  setSessionCookie(res, row.id);
  res.json(await sessionPayload(row.id));
});

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({
    user: req.user,
    space: req.space,
    partner: req.partner,
    seat: req.seat,
  });
});

async function sessionPayload(userId: number) {
  const user = await findUserById(userId);
  const space = await findSpaceForUser(userId);
  return {
    user,
    space,
    partner: space ? await findPartner(space.id, userId) : null,
    seat: space ? await findSeat(space.id, userId) : 'a',
  };
}
