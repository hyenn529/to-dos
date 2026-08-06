import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * 데이터 파일 위치. 배포 시 HARU_DB_PATH 로 볼륨 경로를 넘기면 된다.
 * ':memory:' 를 주면 테스트용 인메모리 DB.
 */
const dbPath = process.env.HARU_DB_PATH ?? resolve(here, '../../data/haru.db');

if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

/**
 * 마이그레이션. user_version 을 보고 필요한 단계만 적용하므로
 * 기존 데이터가 있어도 안전하게 재실행된다.
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
];

export function migrate(): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  let version = row.user_version;

  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]!);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

migrate();
