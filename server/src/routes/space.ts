import { Router } from 'express';
import { db } from '../db.ts';
import { findPartner, generateInviteCode, requireAuth } from '../auth.ts';
import { bumpVersion } from '../events.ts';

export const spaceRouter = Router();

spaceRouter.use(requireAuth);

/** 초대 코드 다시 만들기 — 기존 코드는 즉시 못 쓰게 된다. */
spaceRouter.post('/invite/regenerate', async (req, res) => {
  const space = req.space!;
  if (req.partner) {
    res.status(409).json({ error: '이미 두 사람이 함께 쓰고 있어 초대 코드가 필요 없습니다.' });
    return;
  }

  const code = generateInviteCode();
  await db.run('UPDATE spaces SET invite_code = ? WHERE id = ?', [code, space.id]);
  res.json({ inviteCode: code });
});

/** 이미 가입한 사람이 코드로 상대 공간에 합류. */
spaceRouter.post('/join', async (req, res) => {
  const user = req.user!;
  const current = req.space!;
  const code = String(req.body?.inviteCode ?? '').trim().toUpperCase();

  const target = await db.get<{ id: number }>('SELECT id FROM spaces WHERE invite_code = ?', [
    code,
  ]);
  if (!target) {
    res.status(404).json({ error: '초대 코드를 찾을 수 없습니다.' });
    return;
  }
  if (target.id === current.id) {
    res.status(400).json({ error: '이미 이 공간에 있습니다.' });
    return;
  }

  const members = await db.get<{ n: number }>(
    'SELECT COUNT(*) AS n FROM memberships WHERE space_id = ?',
    [target.id],
  );
  if ((members?.n ?? 0) >= 2) {
    res.status(409).json({ error: '이미 두 사람이 쓰고 있는 공간입니다.' });
    return;
  }

  const myTodos = await db.get<{ n: number }>(
    'SELECT COUNT(*) AS n FROM todos WHERE space_id = ? AND owner_id = ?',
    [current.id, user.id],
  );

  // 쓰던 할 일을 들고 옮긴다 — 합류한다고 기록이 사라지면 안 된다.
  await db.batch([
    {
      sql: 'UPDATE todos SET space_id = ? WHERE space_id = ? AND owner_id = ?',
      params: [target.id, current.id, user.id],
    },
    {
      sql: 'DELETE FROM memberships WHERE space_id = ? AND user_id = ?',
      params: [current.id, user.id],
    },
    {
      sql: 'INSERT INTO memberships (space_id, user_id) VALUES (?, ?)',
      params: [target.id, user.id],
    },
    // 아무도 안 남은 빈 공간은 정리한다.
    {
      sql: `DELETE FROM spaces
             WHERE id = ?
               AND NOT EXISTS (SELECT 1 FROM memberships WHERE space_id = ?)`,
      params: [current.id, current.id],
    },
  ]);

  await bumpVersion(target.id, 'space:joined');
  res.json({
    space: await db.get('SELECT id, name, invite_code AS inviteCode FROM spaces WHERE id = ?', [
      target.id,
    ]),
    partner: await findPartner(target.id, user.id),
    movedTodos: myTodos?.n ?? 0,
  });
});
