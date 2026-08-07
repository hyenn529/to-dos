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
 * 배포 화면에 붙여넣은 값에는 앞뒤 공백, 줄바꿈, 감싸는 따옴표가 섞여 들어오기 쉽다.
 * 눈에는 안 보이는데 `new URL()` 은 그걸로 바로 실패한다 ("Invalid URL").
 * 사람이 못 찾을 실수이므로 코드가 다듬는다.
 */
function env(name: string): string | undefined {
  const value = process.env[name]?.trim().replace(/^['"]|['"]$/g, '');
  return value ? value : undefined;
}

/**
 * TURSO_DATABASE_URL 이 있으면 Turso, 없으면 로컬 파일.
 * 이 한 줄이 "어디에 저장되는가"를 가른다.
 */
const tursoUrl = env('TURSO_DATABASE_URL');

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
  const client = createClient({ url, authToken: env('TURSO_AUTH_TOKEN') });

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

export const backend = tursoUrl ? 'turso' : 'local';

/**
 * 연결과 마이그레이션은 **첫 요청 때** 한 번만 한다.
 *
 * 예전에는 모듈을 읽는 순간에 했는데, 그러면 설정이 틀렸을 때 함수 자체가 죽어서
 * 브라우저에는 원인을 알 수 없는 500 만 보였다. 지금은 실패해도 이유가 응답에 담긴다.
 */
let ready: Promise<Db> | null = null;

/** 화면에 그대로 보여줘도 되는(= 비밀이 없는) 설정 오류. */
function configError(message: string): Error {
  return Object.assign(new Error(message), { expose: true });
}

async function connect(): Promise<Db> {
  if (tursoUrl) {
    if (!env('TURSO_AUTH_TOKEN')) {
      throw configError('TURSO_DATABASE_URL 은 있는데 TURSO_AUTH_TOKEN 이 없습니다.');
    }
    // 왜 틀렸는지 보이게 한다. 주소는 비밀이 아니므로 그대로 보여줘도 된다.
    if (!/^(libsql|https?|wss?):\/\/[^\s/]+$/.test(tursoUrl)) {
      throw configError(
        `TURSO_DATABASE_URL 형식이 이상합니다 — 받은 값: "${tursoUrl}". ` +
          'libsql://이름-계정.turso.io 처럼 한 줄이어야 하고, 공백이나 경로가 붙으면 안 됩니다.',
      );
    }
    return createTursoDb(tursoUrl);
  }
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    throw configError(
      'TURSO_DATABASE_URL 이 설정되지 않았습니다. ' +
        '서버리스에서는 파일에 저장할 수 없어 데이터가 남지 않습니다. ' +
        '환경변수 TURSO_DATABASE_URL 과 TURSO_AUTH_TOKEN 을 Production 에 등록하고 다시 배포하세요.',
    );
  }
  return createLocalDb();
}

function getDb(): Promise<Db> {
  if (!ready) {
    ready = connect()
      .then(async (instance) => {
        await runMigrations(instance);
        return instance;
      })
      .catch((err) => {
        ready = null; // 다음 요청에서 다시 시도할 수 있게 한다
        if ((err as { expose?: boolean }).expose) throw err;
        // 연결·마이그레이션 실패(토큰 만료, 주소 오타 등)도 이유를 보여준다.
        throw configError(`데이터베이스에 연결하지 못했습니다 — ${(err as Error).message}`);
      });
  }
  return ready;
}

/** 어디서든 `db.get(...)` 처럼 쓰면 필요한 시점에 연결된다. */
export const db: Db = {
  async all(sql, params) {
    return (await getDb()).all(sql, params);
  },
  async get(sql, params) {
    return (await getDb()).get(sql, params);
  },
  async run(sql, params) {
    return (await getDb()).run(sql, params);
  },
  async batch(statements) {
    return (await getDb()).batch(statements);
  },
  async exec(sql) {
    return (await getDb()).exec(sql);
  },
};

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

async function runMigrations(instance: Db): Promise<void> {
  const row = await instance.get<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;

  for (let i = version; i < MIGRATIONS.length; i++) {
    await instance.exec(MIGRATIONS[i]!);
    await instance.exec(`PRAGMA user_version = ${i + 1}`);
  }
}
