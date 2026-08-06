import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db.ts';
import type { PublicUser, Space } from './types.ts';

const SESSION_COOKIE = 'haru_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 60; // 60일

/**
 * 서명 키. 배포 시 HARU_SECRET 을 반드시 지정한다.
 * 지정하지 않으면 임시 키를 만들어 쓰고 경고하며, 재시작하면 모든 세션이 끊긴다.
 */
const SECRET = (() => {
  const fromEnv = process.env.HARU_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'HARU_SECRET 환경변수가 없습니다. 16자 이상의 임의 문자열을 지정하세요.',
    );
  }
  console.warn(
    '[haru] HARU_SECRET 이 없어 임시 키를 사용합니다 — 서버를 재시작하면 로그인이 풀립니다.',
  );
  return randomBytes(32).toString('hex');
})();

// ---------------------------------------------------------------- 비밀번호

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

// ---------------------------------------------------------------- 세션 쿠키

function sign(value: string): string {
  return createHmac('sha256', SECRET).update(value).digest('base64url');
}

function makeToken(userId: number): string {
  const body = `${userId}.${Date.now()}`;
  return `${body}.${sign(body)}`;
}

function readToken(token: string | undefined): number | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [rawId, rawTime, signature] = parts as [string, string, string];
  const body = `${rawId}.${rawTime}`;

  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  const issuedAt = Number(rawTime);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > SESSION_TTL_MS) return null;

  const userId = Number(rawId);
  return Number.isInteger(userId) ? userId : null;
}

export function setSessionCookie(res: Response, userId: number): void {
  res.cookie(SESSION_COOKIE, makeToken(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

// ---------------------------------------------------------------- 조회

type UserRow = {
  id: number;
  email: string;
  name: string;
  initial: string;
};

export async function findUserById(id: number): Promise<PublicUser | null> {
  const row = await db.get<UserRow>('SELECT id, email, name, initial FROM users WHERE id = ?', [
    id,
  ]);
  return row ? { ...row } : null;
}

/** 사용자가 속한 공간. 한 사람은 공간 하나만 갖는다(둘이 쓰는 앱이므로). */
export async function findSpaceForUser(userId: number): Promise<Space | null> {
  const row = await db.get<Space>(
    `SELECT s.id, s.name, s.invite_code AS inviteCode
       FROM spaces s
       JOIN memberships m ON m.space_id = s.id
      WHERE m.user_id = ?
      ORDER BY m.created_at
      LIMIT 1`,
    [userId],
  );
  return row ? { ...row } : null;
}

/** 같은 공간의 다른 한 사람. 아직 아무도 안 들어왔으면 null. */
export async function findPartner(
  spaceId: number,
  userId: number,
): Promise<PublicUser | null> {
  const row = await db.get<UserRow>(
    `SELECT u.id, u.email, u.name, u.initial
       FROM users u
       JOIN memberships m ON m.user_id = u.id
      WHERE m.space_id = ? AND u.id != ?
      ORDER BY m.created_at
      LIMIT 1`,
    [spaceId, userId],
  );
  return row ? { ...row } : null;
}

// ---------------------------------------------------------------- 미들웨어

declare module 'express-serve-static-core' {
  interface Request {
    user?: PublicUser;
    space?: Space;
    partner?: PublicUser | null;
  }
}

/** 로그인·공간 소속을 확인하고 req 에 붙인다. */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = readToken(req.cookies?.[SESSION_COOKIE]);
  if (userId === null) {
    res.status(401).json({ error: '로그인이 필요합니다.' });
    return;
  }

  const user = await findUserById(userId);
  if (!user) {
    clearSessionCookie(res);
    res.status(401).json({ error: '로그인이 필요합니다.' });
    return;
  }

  const space = await findSpaceForUser(user.id);
  if (!space) {
    res.status(403).json({ error: '아직 공간에 속해 있지 않습니다.' });
    return;
  }

  req.user = user;
  req.space = space;
  req.partner = await findPartner(space.id, user.id);
  next();
}

/** 사람이 읽고 옮겨 적을 수 있는 초대 코드. 헷갈리는 글자(0/O/1/I)는 뺐다. */
export function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += alphabet[bytes[i]! % alphabet.length];
    if (i === 3) code += '-';
  }
  return code;
}
