import { Router } from 'express';
import { db } from '../db.ts';
import { findPartner, generateInviteCode, requireAuth } from '../auth.ts';
import { broadcast } from '../events.ts';

export const spaceRouter = Router();

spaceRouter.use(requireAuth);

/** 초대 코드 다시 만들기 — 기존 코드는 즉시 못 쓰게 된다. */
spaceRouter.post('/invite/regenerate', (req, res) => {
  const space = req.space!;
  const partner = req.partner;
  if (partner) {
    res.status(409).json({ error: '이미 두 사람이 함께 쓰고 있어 초대 코드가 필요 없습니다.' });
    return;
  }

  const code = generateInviteCode();
  db.prepare('UPDATE spaces SET invite_code = ? WHERE id = ?').run(code, space.id);
  res.json({ inviteCode: code });
});

/** 이미 가입한 사람이 코드로 상대 공간에 합류. */
spaceRouter.post('/join', (req, res) => {
  const user = req.user!;
  const current = req.space!;
  const code = String(req.body?.inviteCode ?? '').trim().toUpperCase();

  const target = db.prepare('SELECT id FROM spaces WHERE invite_code = ?').get(code) as
    | { id: number }
    | undefined;
  if (!target) {
    res.status(404).json({ error: '초대 코드를 찾을 수 없습니다.' });
    return;
  }
  if (target.id === current.id) {
    res.status(400).json({ error: '이미 이 공간에 있습니다.' });
    return;
  }

  const members = db
    .prepare('SELECT COUNT(*) AS n FROM memberships WHERE space_id = ?')
    .get(target.id) as { n: number };
  if (members.n >= 2) {
    res.status(409).json({ error: '이미 두 사람이 쓰고 있는 공간입니다.' });
    return;
  }

  const myTodos = db
    .prepare('SELECT COUNT(*) AS n FROM todos WHERE space_id = ? AND owner_id = ?')
    .get(current.id, user.id) as { n: number };

  db.exec('BEGIN');
  try {
    // 쓰던 할 일을 들고 옮긴다 — 합류한다고 기록이 사라지면 안 된다.
    db.prepare('UPDATE todos SET space_id = ? WHERE space_id = ? AND owner_id = ?').run(
      target.id,
      current.id,
      user.id,
    );
    db.prepare('DELETE FROM memberships WHERE space_id = ? AND user_id = ?').run(
      current.id,
      user.id,
    );
    db.prepare('INSERT INTO memberships (space_id, user_id) VALUES (?, ?)').run(
      target.id,
      user.id,
    );
    // 아무도 안 남은 빈 공간은 정리한다.
    const left = db
      .prepare('SELECT COUNT(*) AS n FROM memberships WHERE space_id = ?')
      .get(current.id) as { n: number };
    if (left.n === 0) db.prepare('DELETE FROM spaces WHERE id = ?').run(current.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  broadcast(target.id, 'space:joined', user.id);
  res.json({
    space: db
      .prepare('SELECT id, name, invite_code AS inviteCode FROM spaces WHERE id = ?')
      .get(target.id),
    partner: findPartner(target.id, user.id),
    movedTodos: myTodos.n,
  });
});
