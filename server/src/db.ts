import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 데이터베이스 어댑터.
 *
 * 백엔드가 둘이다. 인터페이스는 하나이므로 나머지 코드는 어느 쪽인지 모른다.
 *
 *   로컬·테스트 : Node 22 내장 node:sqlite — 설치할 것도, 인터넷도 필요 없다
 *   배포        : Turso (@libsql/client) — 서버리스에서도 데이터가 남는다
 *
 * Vercel 같은 서버리스에서는 요청이 끝나면 파일이 사라지므로 파일 SQLite 를 쓸 수 없다.
 * 그래서 배포용 백엔드가 따로 있는 것이고, 형식은 똑같은 SQLite 라서
 * 나중에 자기 서버로 옮기고 싶으면 파일을 그대로 내려받아 가면 된다.
 *
 * 원격 호출은 네트워크를 타므로 인터페이스 전체가 비동기다.
 */

export type Row = Record<string, unknown>;
export type Param = string | number | bigint | null;

export type Db = {
  all<T = Row>(sql: string, params?: Param[]): Promise<T[]>;
  get<T = Row>(sql: string, params?: Param[]): Promise<T | undefined>;
  run(sql: string, params?: Param[]): Promise<{ lastInsertRowid: number; changes: number }>;
  /** 여러 문장을 한 트랜잭션으로. 하나라도 실패하면 전부 되돌린다. */
  batch(statements: { sql: string; params?: Param[] }[]): Promise<void>;
  /** 세미콜론으로 이어진 DDL 실행 (마이그레이션 전용) */
  exec(sql: string): Promise<void>;
};

const here = dirname(fileURLToPath(import.meta.url));

/**
 * TURSO_DATABASE_URL 이 있으면 Turso, 없으면 로컬 파일.
 * 이 한 줄이 "어디에 저장되는가"를 가른다.
 */
const tursoUrl = process.env.TURSO_DATABASE_URL;

async function createLocalDb(): Promise<Db> {
  const { DatabaseSync } = await import('node:sqlite');

  const path = process.env.HARU_DB_PATH ?? resolve(here, '../../data/haru.db');
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');

  return {
    async all<T>(sql, params = []) {
      return raw.prepare(sql).all(...params) as T[];
    },
    async get<T>(sql, params = []) {
      return raw.prepare(sql).get(...params) as T | undefined;
    },
    async run(sql, params = []) {
      const result = raw.prepare(sql).run(...params);
      return { lastInsertRowid: Number(result.lastInsertRowid), changes: Number(result.changes) };
    },
    async batch(statements) {
      raw.exec('BEGIN');
      try {
        for (const statement of statements) {
          raw.prepare(statement.sql).run(...(statement.params ?? []));
        }
        raw.exec('COMMIT');
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },
    async exec(sql) {
      raw.exec(sql);
    },
  };
}

async function createTursoDb(url: string): Promise<Db> {
  const { createClient } = await import('@libsql/client/web');
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

  return {
    async all<T>(sql, params = []) {
      const result = await client.execute({ sql, args: params });
      return result.rows as unknown as T[];
    },
    async get<T>(sql, params = []) {
      const result = await client.execute({ sql, args: params });
      return result.rows[0] as unknown as T | undefined;
    },
    async run(sql, params = []) {
      const result = await client.execute({ sql, args: params });
      return {
        lastInsertRowid: Number(result.lastInsertRowid ?? 0),
        changes: Number(result.rowsAffected ?? 0),
      };
    },
    async batch(statements) {
      await client.batch(
        statements.map((statement) => ({ sql: statement.sql, args: statement.params ?? [] })),
        'write',
      );
    },
    async exec(sql) {
      // libSQL 은 한 번에 한 문장만 받는다. DDL 뭉치를 잘라서 순서대로 보낸다.
      for (const statement of splitStatements(sql)) {
        await client.execute(statement);
      }
    },
  };
}

/** 세미콜론으로 나누되 따옴표 안의 세미콜론은 건드리지 않는다. */
function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: string | null = null;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]!;
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === ';') {
      if (current.trim()) out.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

export const db: Db = await (tursoUrl ? createTursoDb(tursoUrl) : createLocalDb());

export const backend = tursoUrl ? 'turso' : 'local';

// ---------------------------------------------------------------- 마이그레이션

/**
 * user_version 을 보고 필요한 단계만 적용한다.
 * 기존 데이터가 있어도 안전하게 여러 번 실행할 수 있다.
 */
const MIGRATIONS: string[] = [
  // 1 — 최초 스키마
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    initial       TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE spaces (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE memberships (
    space_id   INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (space_id, user_id)
  );

  CREATE TABLE todos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    space_id     INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    owner_id     INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    lane         TEXT    NOT NULL CHECK (lane IN ('personal','work')),
    title        TEXT    NOT NULL,
    note         TEXT,
    date         TEXT,
    end_date     TEXT,
    position     REAL    NOT NULL DEFAULT 0,
    together     INTEGER NOT NULL DEFAULT 0,
    done         INTEGER NOT NULL DEFAULT 0,
    done_at      TEXT,
    done_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    carried_from TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX idx_todos_space_date  ON todos (space_id, date);
  CREATE INDEX idx_todos_space_owner ON todos (space_id, owner_id);

  CREATE TABLE subtasks (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    todo_id  INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    title    TEXT    NOT NULL,
    done     INTEGER NOT NULL DEFAULT 0,
    position REAL    NOT NULL DEFAULT 0
  );

  CREATE INDEX idx_subtasks_todo ON subtasks (todo_id);
  `,

  // 2 — 변경 감지용 버전. 쓰기가 일어날 때마다 1씩 올린다.
  //     화면은 이 숫자만 물어보고, 바뀌었을 때만 전체를 다시 불러온다.
  `
  ALTER TABLE spaces ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
  `,
];

export async function migrate(): Promise<void> {
  const row = await db.get<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;

  for (let i = version; i < MIGRATIONS.length; i++) {
    await db.exec(MIGRATIONS[i]!);
    await db.exec(`PRAGMA user_version = ${i + 1}`);
  }
}

await migrate();
