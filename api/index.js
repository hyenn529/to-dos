// server/src/index.ts
import { existsSync } from "node:fs";
import { dirname as dirname2, join, resolve as resolve2 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import cookieParser from "cookie-parser";
import express from "express";

// server/src/db.ts
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
var here = dirname(fileURLToPath(import.meta.url));
function env(name) {
  const value = process.env[name]?.replace(/\s+/g, "").replace(/^['"]|['"]$/g, "");
  return value ? value : void 0;
}
var tursoUrl = env("TURSO_DATABASE_URL");
async function createLocalDb() {
  const { DatabaseSync } = await import("node:sqlite");
  const path = process.env.HARU_DB_PATH ?? resolve(here, "../../data/haru.db");
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path);
  raw.exec("PRAGMA journal_mode = WAL");
  raw.exec("PRAGMA foreign_keys = ON");
  return {
    async all(sql, params = []) {
      return raw.prepare(sql).all(...params);
    },
    async get(sql, params = []) {
      return raw.prepare(sql).get(...params);
    },
    async run(sql, params = []) {
      const result = raw.prepare(sql).run(...params);
      return { lastInsertRowid: Number(result.lastInsertRowid), changes: Number(result.changes) };
    },
    async batch(statements) {
      raw.exec("BEGIN");
      try {
        for (const statement of statements) {
          raw.prepare(statement.sql).run(...statement.params ?? []);
        }
        raw.exec("COMMIT");
      } catch (err) {
        raw.exec("ROLLBACK");
        throw err;
      }
    },
    async exec(sql) {
      raw.exec(sql);
    }
  };
}
async function createTursoDb(url) {
  const { createClient } = await import("@libsql/client/web");
  const client = createClient({ url, authToken: env("TURSO_AUTH_TOKEN") });
  return {
    async all(sql, params = []) {
      const result = await client.execute({ sql, args: params });
      return result.rows;
    },
    async get(sql, params = []) {
      const result = await client.execute({ sql, args: params });
      return result.rows[0];
    },
    async run(sql, params = []) {
      const result = await client.execute({ sql, args: params });
      return {
        lastInsertRowid: Number(result.lastInsertRowid ?? 0),
        changes: Number(result.rowsAffected ?? 0)
      };
    },
    async batch(statements) {
      await client.batch(
        statements.map((statement) => ({ sql: statement.sql, args: statement.params ?? [] })),
        "write"
      );
    },
    async exec(sql) {
      for (const statement of splitStatements(sql)) {
        await client.execute(statement);
      }
    }
  };
}
function splitStatements(sql) {
  const out = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === ";") {
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}
var backend = tursoUrl ? "turso" : "local";
var ready = null;
function redact(message) {
  const token = env("TURSO_AUTH_TOKEN");
  let out = message;
  if (token) out = out.split(token).join("***");
  return out.replace(/\beyJ[\w-]*[\s.][\w\s.-]{20,}/g, "***");
}
function configError(message) {
  return Object.assign(new Error(redact(message)), { expose: true });
}
async function connect() {
  if (tursoUrl) {
    if (!env("TURSO_AUTH_TOKEN")) {
      throw configError("TURSO_DATABASE_URL \uC740 \uC788\uB294\uB370 TURSO_AUTH_TOKEN \uC774 \uC5C6\uC2B5\uB2C8\uB2E4.");
    }
    if (!/^(libsql|https?|wss?):\/\/[^\s/]+$/.test(tursoUrl)) {
      throw configError(
        `TURSO_DATABASE_URL \uD615\uC2DD\uC774 \uC774\uC0C1\uD569\uB2C8\uB2E4 \u2014 \uBC1B\uC740 \uAC12: "${tursoUrl}". libsql://\uC774\uB984-\uACC4\uC815.turso.io \uCC98\uB7FC \uD55C \uC904\uC774\uC5B4\uC57C \uD558\uACE0, \uACF5\uBC31\uC774\uB098 \uACBD\uB85C\uAC00 \uBD99\uC73C\uBA74 \uC548 \uB429\uB2C8\uB2E4.`
      );
    }
    return createTursoDb(tursoUrl);
  }
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    throw configError(
      "TURSO_DATABASE_URL \uC774 \uC124\uC815\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4. \uC11C\uBC84\uB9AC\uC2A4\uC5D0\uC11C\uB294 \uD30C\uC77C\uC5D0 \uC800\uC7A5\uD560 \uC218 \uC5C6\uC5B4 \uB370\uC774\uD130\uAC00 \uB0A8\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uD658\uACBD\uBCC0\uC218 TURSO_DATABASE_URL \uACFC TURSO_AUTH_TOKEN \uC744 Production \uC5D0 \uB4F1\uB85D\uD558\uACE0 \uB2E4\uC2DC \uBC30\uD3EC\uD558\uC138\uC694."
    );
  }
  return createLocalDb();
}
function getDb() {
  if (!ready) {
    ready = connect().then(async (instance) => {
      await runMigrations(instance);
      return instance;
    }).catch((err) => {
      ready = null;
      if (err.expose) throw err;
      throw configError(`\uB370\uC774\uD130\uBCA0\uC774\uC2A4\uC5D0 \uC5F0\uACB0\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4 \u2014 ${err.message}`);
    });
  }
  return ready;
}
var db = {
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
  }
};
var MIGRATIONS = [
  // 1 — 최초 스키마
  `
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    initial       TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS spaces (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS memberships (
    space_id   INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (space_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS todos (
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

  CREATE INDEX IF NOT EXISTS idx_todos_space_date  ON todos (space_id, date);
  CREATE INDEX IF NOT EXISTS idx_todos_space_owner ON todos (space_id, owner_id);

  CREATE TABLE IF NOT EXISTS subtasks (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    todo_id  INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    title    TEXT    NOT NULL,
    done     INTEGER NOT NULL DEFAULT 0,
    position REAL    NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_subtasks_todo ON subtasks (todo_id);
  `,
  // 2 — 변경 감지용 버전. 쓰기가 일어날 때마다 1씩 올린다.
  //     화면은 이 숫자만 물어보고, 바뀌었을 때만 전체를 다시 불러온다.
  `
  ALTER TABLE spaces ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
  `
];
async function runMigrations(instance) {
  await instance.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))"
  );
  let applied = await appliedCount(instance);
  for (let i = 1; i <= applied; i++) {
    await instance.run("INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)", [i]);
  }
  for (let i = applied; i < MIGRATIONS.length; i++) {
    await instance.exec(MIGRATIONS[i]);
    await instance.run("INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)", [i + 1]);
    applied = i + 1;
  }
}
async function appliedCount(instance) {
  const rows = await instance.all("SELECT version FROM schema_migrations");
  if (rows.length) return Math.max(...rows.map((r) => Number(r.version)));
  const spaces = await instance.get(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'spaces'"
  );
  if (!spaces?.sql) return 0;
  return /\bversion\b/.test(spaces.sql) ? 2 : 1;
}

// server/src/routes/auth.ts
import { Router } from "express";

// server/src/auth.ts
import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from "node:crypto";
var SESSION_COOKIE = "haru_session";
var SESSION_TTL_MS = 1e3 * 60 * 60 * 24 * 60;
var cachedSecret = null;
function secret() {
  if (cachedSecret) return cachedSecret;
  const fromEnv = process.env.HARU_SECRET?.trim().replace(/^['"]|['"]$/g, "");
  if (fromEnv && fromEnv.length >= 16) return cachedSecret = fromEnv;
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    throw Object.assign(
      new Error("HARU_SECRET \uD658\uACBD\uBCC0\uC218\uAC00 \uC5C6\uAC70\uB098 16\uC790\uBCF4\uB2E4 \uC9E7\uC2B5\uB2C8\uB2E4. \uAE34 \uC784\uC758 \uBB38\uC790\uC5F4\uC744 \uC9C0\uC815\uD558\uC138\uC694."),
      { expose: true }
    );
  }
  console.warn(
    "[haru] HARU_SECRET \uC774 \uC5C6\uC5B4 \uC784\uC2DC \uD0A4\uB97C \uC0AC\uC6A9\uD569\uB2C8\uB2E4 \u2014 \uC11C\uBC84\uB97C \uC7AC\uC2DC\uC791\uD558\uBA74 \uB85C\uADF8\uC778\uC774 \uD480\uB9BD\uB2C8\uB2E4."
  );
  return cachedSecret = randomBytes(32).toString("hex");
}
function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}
function verifyPassword(password, hash, salt) {
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}
function sign(value) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}
function makeToken(userId) {
  const body = `${userId}.${Date.now()}`;
  return `${body}.${sign(body)}`;
}
function readToken(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [rawId, rawTime, signature] = parts;
  const body = `${rawId}.${rawTime}`;
  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const issuedAt = Number(rawTime);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > SESSION_TTL_MS) return null;
  const userId = Number(rawId);
  return Number.isInteger(userId) ? userId : null;
}
function setSessionCookie(res, userId) {
  res.cookie(SESSION_COOKIE, makeToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS,
    path: "/"
  });
}
function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}
async function findUserById(id) {
  const row = await db.get("SELECT id, email, name, initial FROM users WHERE id = ?", [
    id
  ]);
  return row ? { ...row } : null;
}
async function findSpaceForUser(userId) {
  const row = await db.get(
    `SELECT s.id, s.name, s.invite_code AS inviteCode
       FROM spaces s
       JOIN memberships m ON m.space_id = s.id
      WHERE m.user_id = ?
      ORDER BY m.created_at
      LIMIT 1`,
    [userId]
  );
  return row ? { ...row } : null;
}
async function findSeat(spaceId, userId) {
  const row = await db.get(
    `SELECT user_id FROM memberships
      WHERE space_id = ?
      ORDER BY created_at, user_id
      LIMIT 1`,
    [spaceId]
  );
  return row?.user_id === userId ? "a" : "b";
}
async function findPartner(spaceId, userId) {
  const row = await db.get(
    `SELECT u.id, u.email, u.name, u.initial
       FROM users u
       JOIN memberships m ON m.user_id = u.id
      WHERE m.space_id = ? AND u.id != ?
      ORDER BY m.created_at
      LIMIT 1`,
    [spaceId, userId]
  );
  return row ? { ...row } : null;
}
async function requireAuth(req, res, next) {
  const userId = readToken(req.cookies?.[SESSION_COOKIE]);
  if (userId === null) {
    res.status(401).json({ error: "\uB85C\uADF8\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4." });
    return;
  }
  const user = await findUserById(userId);
  if (!user) {
    clearSessionCookie(res);
    res.status(401).json({ error: "\uB85C\uADF8\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4." });
    return;
  }
  const space = await findSpaceForUser(user.id);
  if (!space) {
    res.status(403).json({ error: "\uC544\uC9C1 \uACF5\uAC04\uC5D0 \uC18D\uD574 \uC788\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4." });
    return;
  }
  req.user = user;
  req.space = space;
  req.partner = await findPartner(space.id, user.id);
  req.seat = await findSeat(space.id, user.id);
  next();
}
function generateInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += alphabet[bytes[i] % alphabet.length];
    if (i === 3) code += "-";
  }
  return code;
}

// server/src/events.ts
async function bumpVersion(spaceId, _reason) {
  await db.run("UPDATE spaces SET version = version + 1 WHERE id = ?", [spaceId]);
}
async function readVersion(spaceId) {
  const row = await db.get("SELECT version FROM spaces WHERE id = ?", [
    spaceId
  ]);
  return row?.version ?? 0;
}

// server/src/routes/auth.ts
var authRouter = Router();
function firstGrapheme(name) {
  return [...name.trim()][0] ?? "?";
}
authRouter.post("/signup", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const name = String(req.body?.name ?? "").trim();
  const password = String(req.body?.password ?? "");
  const inviteCode = String(req.body?.inviteCode ?? "").trim().toUpperCase();
  if (!email.includes("@")) {
    res.status(400).json({ error: "\uC774\uBA54\uC77C \uD615\uC2DD\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694." });
    return;
  }
  if (name.length === 0) {
    res.status(400).json({ error: "\uC774\uB984\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694." });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "\uBE44\uBC00\uBC88\uD638\uB294 8\uC790 \uC774\uC0C1\uC774\uC5B4\uC57C \uD569\uB2C8\uB2E4." });
    return;
  }
  const taken = await db.get("SELECT id FROM users WHERE email = ?", [email]);
  if (taken) {
    res.status(409).json({ error: "\uC774\uBBF8 \uAC00\uC785\uB41C \uC774\uBA54\uC77C\uC785\uB2C8\uB2E4." });
    return;
  }
  let targetSpaceId = null;
  if (inviteCode) {
    const space = await db.get("SELECT id FROM spaces WHERE invite_code = ?", [
      inviteCode
    ]);
    if (!space) {
      res.status(404).json({ error: "\uCD08\uB300 \uCF54\uB4DC\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." });
      return;
    }
    const members = await db.get(
      "SELECT COUNT(*) AS n FROM memberships WHERE space_id = ?",
      [space.id]
    );
    if ((members?.n ?? 0) >= 2) {
      res.status(409).json({ error: "\uC774\uBBF8 \uB450 \uC0AC\uB78C\uC774 \uC4F0\uACE0 \uC788\uB294 \uACF5\uAC04\uC785\uB2C8\uB2E4." });
      return;
    }
    targetSpaceId = space.id;
  }
  const { hash, salt } = hashPassword(password);
  const inserted = await db.run(
    `INSERT INTO users (email, name, initial, password_hash, password_salt)
     VALUES (?, ?, ?, ?, ?)`,
    [email, name, firstGrapheme(name), hash, salt]
  );
  const userId = inserted.lastInsertRowid;
  try {
    if (targetSpaceId === null) {
      const space = await db.run("INSERT INTO spaces (name, invite_code) VALUES (?, ?)", [
        `${name}\uC758 \uD558\uB8E8`,
        generateInviteCode()
      ]);
      targetSpaceId = space.lastInsertRowid;
    }
    await db.run("INSERT INTO memberships (space_id, user_id) VALUES (?, ?)", [
      targetSpaceId,
      userId
    ]);
  } catch (err) {
    await db.run("DELETE FROM users WHERE id = ?", [userId]).catch(() => void 0);
    throw err;
  }
  setSessionCookie(res, userId);
  if (inviteCode) await bumpVersion(targetSpaceId, "space:joined");
  res.status(201).json(await sessionPayload(userId));
});
authRouter.post("/login", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  const row = await db.get(
    "SELECT id, password_hash, password_salt FROM users WHERE email = ?",
    [email]
  );
  if (!row || !verifyPassword(password, row.password_hash, row.password_salt)) {
    res.status(401).json({ error: "\uC774\uBA54\uC77C\uC774\uB098 \uBE44\uBC00\uBC88\uD638\uAC00 \uB9DE\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4." });
    return;
  }
  setSessionCookie(res, row.id);
  res.json(await sessionPayload(row.id));
});
authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});
authRouter.get("/me", requireAuth, (req, res) => {
  res.json({
    user: req.user,
    space: req.space,
    partner: req.partner,
    seat: req.seat
  });
});
async function sessionPayload(userId) {
  const user = await findUserById(userId);
  const space = await findSpaceForUser(userId);
  return {
    user,
    space,
    partner: space ? await findPartner(space.id, userId) : null,
    seat: space ? await findSeat(space.id, userId) : "a"
  };
}

// server/src/routes/space.ts
import { Router as Router2 } from "express";
var spaceRouter = Router2();
spaceRouter.use(requireAuth);
spaceRouter.post("/invite/regenerate", async (req, res) => {
  const space = req.space;
  if (req.partner) {
    res.status(409).json({ error: "\uC774\uBBF8 \uB450 \uC0AC\uB78C\uC774 \uD568\uAED8 \uC4F0\uACE0 \uC788\uC5B4 \uCD08\uB300 \uCF54\uB4DC\uAC00 \uD544\uC694 \uC5C6\uC2B5\uB2C8\uB2E4." });
    return;
  }
  const code = generateInviteCode();
  await db.run("UPDATE spaces SET invite_code = ? WHERE id = ?", [code, space.id]);
  res.json({ inviteCode: code });
});
spaceRouter.post("/join", async (req, res) => {
  const user = req.user;
  const current = req.space;
  const code = String(req.body?.inviteCode ?? "").trim().toUpperCase();
  const target = await db.get("SELECT id FROM spaces WHERE invite_code = ?", [
    code
  ]);
  if (!target) {
    res.status(404).json({ error: "\uCD08\uB300 \uCF54\uB4DC\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." });
    return;
  }
  if (target.id === current.id) {
    res.status(400).json({ error: "\uC774\uBBF8 \uC774 \uACF5\uAC04\uC5D0 \uC788\uC2B5\uB2C8\uB2E4." });
    return;
  }
  const members = await db.get(
    "SELECT COUNT(*) AS n FROM memberships WHERE space_id = ?",
    [target.id]
  );
  if ((members?.n ?? 0) >= 2) {
    res.status(409).json({ error: "\uC774\uBBF8 \uB450 \uC0AC\uB78C\uC774 \uC4F0\uACE0 \uC788\uB294 \uACF5\uAC04\uC785\uB2C8\uB2E4." });
    return;
  }
  const myTodos = await db.get(
    "SELECT COUNT(*) AS n FROM todos WHERE space_id = ? AND owner_id = ?",
    [current.id, user.id]
  );
  await db.batch([
    {
      sql: "UPDATE todos SET space_id = ? WHERE space_id = ? AND owner_id = ?",
      params: [target.id, current.id, user.id]
    },
    {
      sql: "DELETE FROM memberships WHERE space_id = ? AND user_id = ?",
      params: [current.id, user.id]
    },
    {
      sql: "INSERT INTO memberships (space_id, user_id) VALUES (?, ?)",
      params: [target.id, user.id]
    },
    // 아무도 안 남은 빈 공간은 정리한다.
    {
      sql: `DELETE FROM spaces
             WHERE id = ?
               AND NOT EXISTS (SELECT 1 FROM memberships WHERE space_id = ?)`,
      params: [current.id, current.id]
    }
  ]);
  await bumpVersion(target.id, "space:joined");
  res.json({
    space: await db.get("SELECT id, name, invite_code AS inviteCode FROM spaces WHERE id = ?", [
      target.id
    ]),
    partner: await findPartner(target.id, user.id),
    movedTodos: myTodos?.n ?? 0
  });
});

// server/src/routes/todos.ts
import { Router as Router3 } from "express";

// server/src/todos.ts
function bucketFor(row, viewerId) {
  const isMine = row.owner_id === viewerId;
  if (row.lane === "work") return isMine ? "mineWork" : "partnerWork";
  if (row.together === 1) return "mine";
  return isMine ? "mine" : "partner";
}
async function subtasksFor(todoIds) {
  const out = /* @__PURE__ */ new Map();
  if (todoIds.length === 0) return out;
  const placeholders = todoIds.map(() => "?").join(",");
  const rows = await db.all(
    `SELECT id, todo_id, title, done, position
       FROM subtasks
      WHERE todo_id IN (${placeholders})
      ORDER BY position, id`,
    todoIds
  );
  for (const row of rows) {
    const list = out.get(row.todo_id) ?? [];
    list.push({
      id: row.id,
      todoId: row.todo_id,
      title: row.title,
      done: row.done === 1,
      position: row.position
    });
    out.set(row.todo_id, list);
  }
  return out;
}
function toTodo(row, viewerId, subtasks) {
  const bucket = bucketFor(row, viewerId);
  const isOwner = row.owner_id === viewerId;
  const together = row.together === 1;
  return {
    id: row.id,
    spaceId: row.space_id,
    ownerId: row.owner_id,
    lane: row.lane,
    bucket,
    title: row.title,
    note: row.note,
    date: row.date,
    endDate: row.end_date,
    position: row.position,
    together,
    done: row.done === 1,
    doneAt: row.done_at,
    doneBy: row.done_by,
    carriedFrom: row.carried_from,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    subtasks,
    // 체크는 자기 것만. 단 "같이" 항목은 둘 다 누를 수 있다.
    canCheck: isOwner || together,
    // 고치고 지우는 건 언제나 주인만.
    canEdit: isOwner,
    // 상대 갈래는 내 "남은 개수"에 들어가지 않는다.
    // 「같이」는 내 칸에 놓이는 만큼 내 몫으로도 센다.
    countable: isOwner || together
  };
}
async function hydrate(rows, viewerId) {
  const subtaskMap = await subtasksFor(rows.map((r) => r.id));
  return rows.map((row) => toTodo(row, viewerId, subtaskMap.get(row.id) ?? []));
}
var SELECT_TODO = `
  SELECT id, space_id, owner_id, lane, title, note, date, end_date, position,
         together, done, done_at, done_by, carried_from, created_at, updated_at
    FROM todos`;
async function listByRange(spaceId, viewerId, from, to) {
  const rows = await db.all(
    `${SELECT_TODO}
      WHERE space_id = ?
        AND date IS NOT NULL
        AND date <= ?
        AND COALESCE(end_date, date) >= ?
      ORDER BY position, id`,
    [spaceId, to, from]
  );
  return hydrate(rows, viewerId);
}
async function listSomeday(spaceId, viewerId) {
  const rows = await db.all(
    `${SELECT_TODO} WHERE space_id = ? AND date IS NULL ORDER BY position, id`,
    [spaceId]
  );
  return hydrate(rows, viewerId);
}
async function getById(id) {
  const row = await db.get(`${SELECT_TODO} WHERE id = ?`, [id]);
  return row ?? null;
}
async function getForViewer(id, viewerId) {
  const row = await getById(id);
  if (!row) return null;
  const subtasks = (await subtasksFor([id])).get(id) ?? [];
  return toTodo(row, viewerId, subtasks);
}
async function monthLoad(spaceId, viewerId, from, to) {
  const rows = await db.all(
    `${SELECT_TODO}
      WHERE space_id = ?
        AND date IS NOT NULL
        AND date <= ?
        AND COALESCE(end_date, date) >= ?`,
    [spaceId, to, from]
  );
  const byDate = /* @__PURE__ */ new Map();
  const touch = (date) => {
    let entry = byDate.get(date);
    if (!entry) {
      entry = {
        date,
        mine: 0,
        mineWork: 0,
        partner: 0,
        partnerWork: 0,
        allDone: false,
        total: 0,
        doneCount: 0
      };
      byDate.set(date, entry);
    }
    return entry;
  };
  const alone = (await db.get(
    "SELECT COUNT(*) AS n FROM memberships WHERE space_id = ?",
    [spaceId]
  )).n < 2;
  for (const row of rows) {
    const bucket = bucketFor(row, viewerId);
    const mirrored = !alone && row.together === 1 && row.lane === "personal";
    for (const date of eachDate(row.date, row.end_date, from, to)) {
      const entry = touch(date);
      entry[bucket] += 1;
      if (mirrored) entry.partner += 1;
      entry.total += 1;
      if (row.done === 1) entry.doneCount += 1;
    }
  }
  return [...byDate.values()].map(({ total, doneCount, ...rest }) => ({
    ...rest,
    allDone: total > 0 && doneCount === total
  })).sort((a, b) => a.date.localeCompare(b.date));
}
function eachDate(start, end, clampFrom, clampTo) {
  if (!end || end <= start) return start >= clampFrom && start <= clampTo ? [start] : [];
  const out = [];
  let cursor = start;
  for (let guard = 0; guard < 400 && cursor <= end; guard++) {
    if (cursor >= clampFrom && cursor <= clampTo) out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}
function addDays(date, days) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
async function create(input) {
  const position = await nextPosition(input.spaceId, input.date ?? null);
  const result = await db.run(
    `INSERT INTO todos (space_id, owner_id, lane, title, note, date, end_date,
                        position, together)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.spaceId,
      input.ownerId,
      input.lane,
      input.title,
      input.note ?? null,
      input.date ?? null,
      input.endDate ?? null,
      position,
      input.together ? 1 : 0
    ]
  );
  return result.lastInsertRowid;
}
async function nextPosition(spaceId, date) {
  const row = await db.get(
    date === null ? "SELECT MAX(position) AS maxPos FROM todos WHERE space_id = ? AND date IS NULL" : "SELECT MAX(position) AS maxPos FROM todos WHERE space_id = ? AND date = ?",
    date === null ? [spaceId] : [spaceId, date]
  );
  return (row?.maxPos ?? 0) + 1;
}
async function patch(id, input) {
  const sets = [];
  const values = [];
  if (input.title !== void 0) {
    sets.push("title = ?");
    values.push(input.title);
  }
  if (input.note !== void 0) {
    sets.push("note = ?");
    values.push(input.note);
  }
  if (input.date !== void 0) {
    sets.push("date = ?");
    values.push(input.date);
  }
  if (input.endDate !== void 0) {
    sets.push("end_date = ?");
    values.push(input.endDate);
  }
  if (input.together !== void 0) {
    sets.push("together = ?");
    values.push(input.together ? 1 : 0);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  values.push(id);
  await db.run(`UPDATE todos SET ${sets.join(", ")} WHERE id = ?`, values);
}
async function setDone(id, done, byUserId) {
  await db.run(
    `UPDATE todos
        SET done = ?, done_at = ?, done_by = ?, updated_at = datetime('now')
      WHERE id = ?`,
    [done ? 1 : 0, done ? (/* @__PURE__ */ new Date()).toISOString() : null, done ? byUserId : null, id]
  );
}
async function remove(id) {
  await db.run("DELETE FROM todos WHERE id = ?", [id]);
}
async function reorder(spaceId, orderedIds) {
  await db.batch(
    orderedIds.map((id, index) => ({
      sql: "UPDATE todos SET position = ? WHERE id = ? AND space_id = ?",
      params: [index + 1, id, spaceId]
    }))
  );
}
async function carryForward(spaceId, ownerId, today) {
  const rows = await db.all(
    `SELECT id, date FROM todos
      WHERE space_id = ? AND owner_id = ? AND done = 0
        AND date IS NOT NULL AND COALESCE(end_date, date) < ?`,
    [spaceId, ownerId, today]
  );
  if (rows.length === 0) return 0;
  await db.batch(
    rows.map((row) => ({
      sql: `UPDATE todos
               SET date = ?, carried_from = COALESCE(carried_from, ?),
                   updated_at = datetime('now')
             WHERE id = ?`,
      params: [today, row.date, row.id]
    }))
  );
  return rows.length;
}
async function countOverdue(spaceId, ownerId, today) {
  const row = await db.get(
    `SELECT COUNT(*) AS n FROM todos
      WHERE space_id = ? AND owner_id = ? AND done = 0
        AND date IS NOT NULL AND COALESCE(end_date, date) < ?`,
    [spaceId, ownerId, today]
  );
  return row?.n ?? 0;
}
async function addSubtask(todoId, title) {
  const row = await db.get(
    "SELECT MAX(position) AS maxPos FROM subtasks WHERE todo_id = ?",
    [todoId]
  );
  const result = await db.run(
    "INSERT INTO subtasks (todo_id, title, position) VALUES (?, ?, ?)",
    [todoId, title, (row?.maxPos ?? 0) + 1]
  );
  return result.lastInsertRowid;
}
async function patchSubtask(id, input) {
  const sets = [];
  const values = [];
  if (input.title !== void 0) {
    sets.push("title = ?");
    values.push(input.title);
  }
  if (input.done !== void 0) {
    sets.push("done = ?");
    values.push(input.done ? 1 : 0);
  }
  if (sets.length === 0) return;
  values.push(id);
  await db.run(`UPDATE subtasks SET ${sets.join(", ")} WHERE id = ?`, values);
}
async function removeSubtask(id) {
  await db.run("DELETE FROM subtasks WHERE id = ?", [id]);
}
async function findSubtaskParent(id) {
  const row = await db.get("SELECT todo_id FROM subtasks WHERE id = ?", [id]);
  return row?.todo_id ?? null;
}

// server/src/routes/todos.ts
var todosRouter = Router3();
todosRouter.use(requireAuth);
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function readDate(value) {
  if (value === void 0) return void 0;
  if (value === null || value === "") return null;
  const text = String(value);
  return DATE_RE.test(text) ? text : void 0;
}
todosRouter.get("/version", async (req, res) => {
  res.json({ version: await readVersion(req.space.id) });
});
todosRouter.get("/", async (req, res) => {
  const from = readDate(req.query.from);
  const to = readDate(req.query.to);
  if (!from || !to) {
    res.status(400).json({ error: "from, to \uB97C YYYY-MM-DD \uB85C \uC8FC\uC138\uC694." });
    return;
  }
  res.json({ todos: await listByRange(req.space.id, req.user.id, from, to) });
});
todosRouter.get("/someday", async (req, res) => {
  res.json({ todos: await listSomeday(req.space.id, req.user.id) });
});
todosRouter.get("/load", async (req, res) => {
  const from = readDate(req.query.from);
  const to = readDate(req.query.to);
  const today = readDate(req.query.today);
  if (!from || !to) {
    res.status(400).json({ error: "from, to \uB97C YYYY-MM-DD \uB85C \uC8FC\uC138\uC694." });
    return;
  }
  res.json({
    days: await monthLoad(req.space.id, req.user.id, from, to),
    overdue: today ? await countOverdue(req.space.id, req.user.id, today) : 0,
    version: await readVersion(req.space.id)
  });
});
todosRouter.post("/", async (req, res) => {
  const title = String(req.body?.title ?? "").trim();
  if (title.length === 0) {
    res.status(400).json({ error: "\uD560 \uC77C \uC81C\uBAA9\uC744 \uC801\uC5B4 \uC8FC\uC138\uC694." });
    return;
  }
  const lane = req.body?.lane === "work" ? "work" : "personal";
  const date = req.body?.date === void 0 ? null : readDate(req.body.date);
  const endDate = req.body?.endDate === void 0 ? null : readDate(req.body.endDate);
  if (date === void 0 || endDate === void 0) {
    res.status(400).json({ error: "\uB0A0\uC9DC\uB294 YYYY-MM-DD \uD615\uC2DD\uC774\uC5B4\uC57C \uD569\uB2C8\uB2E4." });
    return;
  }
  if (date === null && endDate !== null) {
    res.status(400).json({ error: "\uB05D\uB098\uB294 \uB0A0\uC9DC\uB9CC \uC815\uD560 \uC218\uB294 \uC5C6\uC2B5\uB2C8\uB2E4." });
    return;
  }
  if (date !== null && endDate !== null && endDate < date) {
    res.status(400).json({ error: "\uB05D\uB098\uB294 \uB0A0\uC9DC\uAC00 \uC2DC\uC791\uBCF4\uB2E4 \uBE60\uB985\uB2C8\uB2E4." });
    return;
  }
  const id = await create({
    spaceId: req.space.id,
    ownerId: req.user.id,
    lane,
    title,
    note: req.body?.note ? String(req.body.note) : null,
    date,
    endDate,
    together: Boolean(req.body?.together)
  });
  await bumpVersion(req.space.id, "todo:created");
  res.status(201).json({ todo: await getForViewer(id, req.user.id) });
});
todosRouter.patch("/:id", async (req, res) => {
  const row = await getById(Number(req.params.id));
  if (!row || row.space_id !== req.space.id) {
    res.status(404).json({ error: "\uD560 \uC77C\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." });
    return;
  }
  if (row.owner_id !== req.user.id) {
    res.status(403).json({ error: "\uC0C1\uB300\uC758 \uD560 \uC77C\uC740 \uACE0\uCE60 \uC218 \uC5C6\uC5B4\uC694." });
    return;
  }
  const date = readDate(req.body?.date);
  const endDate = readDate(req.body?.endDate);
  if (date === void 0 && req.body?.date !== void 0) {
    res.status(400).json({ error: "\uB0A0\uC9DC\uB294 YYYY-MM-DD \uD615\uC2DD\uC774\uC5B4\uC57C \uD569\uB2C8\uB2E4." });
    return;
  }
  if (endDate === void 0 && req.body?.endDate !== void 0) {
    res.status(400).json({ error: "\uB0A0\uC9DC\uB294 YYYY-MM-DD \uD615\uC2DD\uC774\uC5B4\uC57C \uD569\uB2C8\uB2E4." });
    return;
  }
  await patch(row.id, {
    title: req.body?.title !== void 0 ? String(req.body.title).trim() : void 0,
    note: req.body?.note !== void 0 ? req.body.note ? String(req.body.note) : null : void 0,
    date: req.body?.date !== void 0 ? date : void 0,
    endDate: req.body?.endDate !== void 0 ? endDate : void 0,
    together: req.body?.together !== void 0 ? Boolean(req.body.together) : void 0
  });
  await bumpVersion(req.space.id, "todo:updated");
  res.json({ todo: await getForViewer(row.id, req.user.id) });
});
todosRouter.post("/:id/toggle", async (req, res) => {
  const row = await getById(Number(req.params.id));
  if (!row || row.space_id !== req.space.id) {
    res.status(404).json({ error: "\uD560 \uC77C\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." });
    return;
  }
  const isOwner = row.owner_id === req.user.id;
  if (!isOwner && row.together !== 1) {
    res.status(403).json({ error: "\uC0C1\uB300\uC758 \uD560 \uC77C\uC740 \uCCB4\uD06C\uD560 \uC218 \uC5C6\uC5B4\uC694." });
    return;
  }
  const next = req.body?.done === void 0 ? row.done !== 1 : Boolean(req.body.done);
  await setDone(row.id, next, req.user.id);
  await bumpVersion(req.space.id, "todo:toggled");
  res.json({ todo: await getForViewer(row.id, req.user.id) });
});
todosRouter.delete("/:id", async (req, res) => {
  const row = await getById(Number(req.params.id));
  if (!row || row.space_id !== req.space.id) {
    res.status(404).json({ error: "\uD560 \uC77C\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." });
    return;
  }
  if (row.owner_id !== req.user.id) {
    res.status(403).json({ error: "\uC0C1\uB300\uC758 \uD560 \uC77C\uC740 \uC9C0\uC6B8 \uC218 \uC5C6\uC5B4\uC694." });
    return;
  }
  await remove(row.id);
  await bumpVersion(req.space.id, "todo:deleted");
  res.json({ ok: true });
});
todosRouter.post("/reorder", async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
  if (ids.some((id) => !Number.isInteger(id))) {
    res.status(400).json({ error: "ids \uB294 \uC815\uC218 \uBC30\uC5F4\uC774\uC5B4\uC57C \uD569\uB2C8\uB2E4." });
    return;
  }
  for (const id of ids) {
    const row = await getById(id);
    if (!row || row.space_id !== req.space.id || row.owner_id !== req.user.id) {
      res.status(403).json({ error: "\uB0B4 \uD560 \uC77C\uB9CC \uC21C\uC11C\uB97C \uBC14\uAFC0 \uC218 \uC788\uC5B4\uC694." });
      return;
    }
  }
  await reorder(req.space.id, ids);
  await bumpVersion(req.space.id, "todo:reordered");
  res.json({ ok: true });
});
todosRouter.post("/carry-forward", async (req, res) => {
  const today = readDate(req.body?.today);
  if (!today) {
    res.status(400).json({ error: "today \uB97C YYYY-MM-DD \uB85C \uC8FC\uC138\uC694." });
    return;
  }
  const moved = await carryForward(req.space.id, req.user.id, today);
  await bumpVersion(req.space.id, "todo:updated");
  res.json({ moved });
});
todosRouter.post("/:id/subtasks", async (req, res) => {
  const row = await getById(Number(req.params.id));
  if (!row || row.space_id !== req.space.id) {
    res.status(404).json({ error: "\uD560 \uC77C\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." });
    return;
  }
  if (row.owner_id !== req.user.id) {
    res.status(403).json({ error: "\uC0C1\uB300\uC758 \uD560 \uC77C\uC740 \uACE0\uCE60 \uC218 \uC5C6\uC5B4\uC694." });
    return;
  }
  const title = String(req.body?.title ?? "").trim();
  if (!title) {
    res.status(400).json({ error: "\uB0B4\uC6A9\uC744 \uC801\uC5B4 \uC8FC\uC138\uC694." });
    return;
  }
  await addSubtask(row.id, title);
  await bumpVersion(req.space.id, "todo:updated");
  res.status(201).json({ todo: await getForViewer(row.id, req.user.id) });
});
todosRouter.patch("/subtasks/:subId", async (req, res) => {
  const parentId = await findSubtaskParent(Number(req.params.subId));
  const parent = parentId === null ? null : await getById(parentId);
  if (!parent || parent.space_id !== req.space.id) {
    res.status(404).json({ error: "\uD56D\uBAA9\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." });
    return;
  }
  if (parent.owner_id !== req.user.id && parent.together !== 1) {
    res.status(403).json({ error: "\uC0C1\uB300\uC758 \uD560 \uC77C\uC740 \uCCB4\uD06C\uD560 \uC218 \uC5C6\uC5B4\uC694." });
    return;
  }
  await patchSubtask(Number(req.params.subId), {
    title: req.body?.title !== void 0 ? String(req.body.title) : void 0,
    done: req.body?.done !== void 0 ? Boolean(req.body.done) : void 0
  });
  await bumpVersion(req.space.id, "todo:updated");
  res.json({ todo: await getForViewer(parent.id, req.user.id) });
});
todosRouter.delete("/subtasks/:subId", async (req, res) => {
  const parentId = await findSubtaskParent(Number(req.params.subId));
  const parent = parentId === null ? null : await getById(parentId);
  if (!parent || parent.space_id !== req.space.id) {
    res.status(404).json({ error: "\uD56D\uBAA9\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." });
    return;
  }
  if (parent.owner_id !== req.user.id) {
    res.status(403).json({ error: "\uC0C1\uB300\uC758 \uD560 \uC77C\uC740 \uACE0\uCE60 \uC218 \uC5C6\uC5B4\uC694." });
    return;
  }
  await removeSubtask(Number(req.params.subId));
  await bumpVersion(req.space.id, "todo:updated");
  res.json({ todo: await getForViewer(parent.id, req.user.id) });
});

// server/src/index.ts
var here2 = dirname2(fileURLToPath2(import.meta.url));
var webDist = resolve2(here2, "../../dist");
function createApp({ serveWeb = true } = {}) {
  const app2 = express();
  app2.disable("x-powered-by");
  app2.use(express.json({ limit: "256kb" }));
  app2.use(cookieParser());
  app2.get("/api/health", (_req, res) => {
    res.json({ ok: true, backend });
  });
  app2.use("/api/auth", authRouter);
  app2.use("/api/space", spaceRouter);
  app2.use("/api/todos", todosRouter);
  if (serveWeb && existsSync(webDist)) {
    app2.use(
      express.static(webDist, {
        index: false,
        setHeaders(res, filePath) {
          if (filePath.includes(`${"assets"}/`)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          } else {
            res.setHeader("Cache-Control", "no-cache");
          }
        }
      })
    );
    app2.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
      res.sendFile(join(webDist, "index.html"));
    });
  }
  app2.use((req, res) => {
    res.status(404).json({ error: `${req.method} ${req.path} \uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.` });
  });
  app2.use((err, _req, res, _next) => {
    console.error("[haru]", err);
    const exposed = err.expose === true;
    res.status(500).json({ error: exposed ? err.message : "\uC11C\uBC84\uC5D0\uC11C \uBB38\uC81C\uAC00 \uC0DD\uACBC\uC2B5\uB2C8\uB2E4." });
  });
  return app2;
}
var isMain = process.argv[1] && resolve2(process.argv[1]) === resolve2(fileURLToPath2(import.meta.url));
if (isMain) {
  const port = Number(process.env.PORT ?? 4e3);
  const host = process.env.HOST ?? "0.0.0.0";
  createApp().listen(port, host, () => {
    console.log(`[haru] http://localhost:${port} \u2014 \uB370\uC774\uD130\uB294 ${backend} \uC5D0 \uC800\uC7A5\uB429\uB2C8\uB2E4.`);
    if (!existsSync(webDist)) {
      console.log("[haru] web/dist \uAC00 \uC5C6\uC5B4 API \uB9CC \uC81C\uACF5\uD569\uB2C8\uB2E4. `npm run build` \uD6C4 \uB2E4\uC2DC \uC2DC\uC791\uD558\uC138\uC694.");
    }
  });
}

// server/src/vercel-entry.ts
var app = createApp({ serveWeb: false });
function handler(req, res) {
  const url = new URL(req.url ?? "/", "http://haru.local");
  const forwarded = url.searchParams.get("__path");
  if (forwarded !== null) {
    url.searchParams.delete("__path");
    const lost = url.pathname === "/api" || url.pathname === "/api/index";
    if (lost) url.pathname = `/api/${forwarded}`;
    req.url = url.pathname + (url.search === "?" ? "" : url.search);
  }
  return app(req, res);
}
export {
  handler as default
};
