import { Router } from 'express';
import { db } from '../db.ts';
import {
  clearSessionCookie,
  findPartner,
  findSpaceForUser,
  findUserById,
  generateInviteCode,
  hashPassword,
  requireAuth,
  setSessionCookie,
  verifyPassword,
} from '../auth.ts';
import { broadcast } from '../events.ts';

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
authRouter.post('/signup', (req, res) => {
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

  const taken = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (taken) {
    res.status(409).json({ error: '이미 가입된 이메일입니다.' });
    return;
  }

  // 초대 코드를 줬다면 먼저 유효한지 본다 — 사용자를 만들어 놓고 실패하면 곤란하다.
  let targetSpaceId: number | null = null;
  if (inviteCode) {
    const space = db
      .prepare('SELECT id FROM spaces WHERE invite_code = ?')
      .get(inviteCode) as { id: number } | undefined;
    if (!space) {
      res.status(404).json({ error: '초대 코드를 찾을 수 없습니다.' });
      return;
    }
    const members = db
      .prepare('SELECT COUNT(*) AS n FROM memberships WHERE space_id = ?')
      .get(space.id) as { n: number };
    if (members.n >= 2) {
      res.status(409).json({ error: '이미 두 사람이 쓰고 있는 공간입니다.' });
      return;
    }
    targetSpaceId = space.id;
  }

  const { hash, salt } = hashPassword(password);

  db.exec('BEGIN');
  let userId: number;
  try {
    const inserted = db
      .prepare(
        `INSERT INTO users (email, name, initial, password_hash, password_salt)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(email, name, firstGrapheme(name), hash, salt);
    userId = Number(inserted.lastInsertRowid);

    if (targetSpaceId === null) {
      const space = db
        .prepare('INSERT INTO spaces (name, invite_code) VALUES (?, ?)')
        .run(`${name}의 하루`, generateInviteCode());
      targetSpaceId = Number(space.lastInsertRowid);
    }

    db.prepare('INSERT INTO memberships (space_id, user_id) VALUES (?, ?)').run(
      targetSpaceId,
      userId,
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  setSessionCookie(res, userId);
  if (inviteCode) broadcast(targetSpaceId, 'space:joined', userId);
  res.status(201).json(sessionPayload(userId));
});

authRouter.post('/login', (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');

  const row = db
    .prepare('SELECT id, password_hash, password_salt FROM users WHERE email = ?')
    .get(email) as UserAuthRow | undefined;

  if (!row || !verifyPassword(password, row.password_hash, row.password_salt)) {
    res.status(401).json({ error: '이메일이나 비밀번호가 맞지 않습니다.' });
    return;
  }

  setSessionCookie(res, row.id);
  res.json(sessionPayload(row.id));
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
  });
});

function sessionPayload(userId: number) {
  const user = findUserById(userId)!;
  const space = findSpaceForUser(userId)!;
  return { user, space, partner: findPartner(space.id, userId) };
}
