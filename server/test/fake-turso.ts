import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';

/**
 * 가짜 Turso 서버.
 *
 * Turso 계정 없이도 **배포에서 실제로 도는 코드 경로**를 테스트하기 위한 것이다.
 * libSQL 클라이언트가 쓰는 Hrana v2 HTTP 프로토콜(`POST /v2/pipeline`)만 받아서
 * 메모리 SQLite 로 실행하고 같은 형식으로 돌려준다.
 *
 * 이게 없으면 "로컬에서는 되는데 올리면 안 된다"를 배포 후에야 알게 된다.
 */

type Value =
  | { type: 'null' }
  | { type: 'integer'; value: string }
  | { type: 'float'; value: number }
  | { type: 'text'; value: string }
  | { type: 'blob'; value: string };

type Stmt = { sql?: string; sql_id?: number; args?: Value[]; want_rows?: boolean };

function toValue(v: unknown): Value {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'bigint') return { type: 'integer', value: v.toString() };
  if (typeof v === 'number') {
    return Number.isInteger(v)
      ? { type: 'integer', value: String(v) }
      : { type: 'float', value: v };
  }
  if (typeof v === 'string') return { type: 'text', value: v };
  if (v instanceof Uint8Array) {
    return { type: 'blob', value: Buffer.from(v).toString('base64') };
  }
  return { type: 'text', value: String(v) };
}

function fromValue(v: Value): string | number | null | Uint8Array {
  switch (v.type) {
    case 'null':
      return null;
    case 'integer':
      return Number(v.value);
    case 'float':
      return v.value;
    case 'text':
      return v.value;
    case 'blob':
      return new Uint8Array(Buffer.from(v.value, 'base64'));
  }
}

function isRead(sql: string): boolean {
  const head = sql.trimStart().slice(0, 8).toUpperCase();
  if (head.startsWith('SELECT') || head.startsWith('WITH') || head.startsWith('EXPLAIN')) {
    return true;
  }
  // 값을 읽는 PRAGMA 는 SELECT 처럼, 값을 넣는 PRAGMA(= 포함) 는 쓰기처럼 다룬다.
  return head.startsWith('PRAGMA') && !sql.includes('=');
}

export async function startFakeTurso(): Promise<{ url: string; close(): Promise<void> }> {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');

  const storedSql = new Map<number, string>();

  const runStatement = (stmt: Stmt) => {
    const sql = stmt.sql ?? storedSql.get(stmt.sql_id!) ?? '';
    const args = (stmt.args ?? []).map(fromValue) as (string | number | null | Uint8Array)[];

    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) {
      db.exec(sql);
      return { cols: [], rows: [], affected_row_count: 0, last_insert_rowid: null };
    }

    if (isRead(sql)) {
      const rows = db.prepare(sql).all(...args) as Record<string, unknown>[];
      const cols = rows.length > 0 ? Object.keys(rows[0]!) : [];
      return {
        cols: cols.map((name) => ({ name, decltype: null })),
        rows: rows.map((row) => cols.map((name) => toValue(row[name]))),
        affected_row_count: 0,
        last_insert_rowid: null,
      };
    }

    const result = db.prepare(sql).run(...args);
    return {
      cols: [],
      rows: [],
      affected_row_count: Number(result.changes),
      last_insert_rowid: String(result.lastInsertRowid),
    };
  };

  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url?.startsWith('/v2/pipeline')) {
        res.writeHead(404).end('{}');
        return;
      }

      const payload = JSON.parse(body || '{}') as { requests?: Record<string, unknown>[] };
      const results: unknown[] = [];

      for (const request of payload.requests ?? []) {
        try {
          switch (request.type) {
            case 'store_sql':
              storedSql.set(request.sql_id as number, request.sql as string);
              results.push({ type: 'ok', response: { type: 'store_sql' } });
              break;

            case 'execute':
              results.push({
                type: 'ok',
                response: { type: 'execute', result: runStatement(request.stmt as Stmt) },
              });
              break;

            case 'batch': {
              const steps = (request.batch as { steps: { stmt: Stmt; condition?: unknown }[] })
                .steps;
              const stepOk: boolean[] = [];
              const stepResults: unknown[] = [];
              const stepErrors: unknown[] = [];

              const holds = (condition: any): boolean => {
                if (!condition) return true;
                if (condition.type === 'ok') return stepOk[condition.step] === true;
                if (condition.type === 'not') return !holds(condition.cond);
                if (condition.type === 'and') return condition.conds.every(holds);
                if (condition.type === 'or') return condition.conds.some(holds);
                return true;
              };

              for (const step of steps) {
                if (!holds(step.condition)) {
                  stepOk.push(false);
                  stepResults.push(null);
                  stepErrors.push(null);
                  continue;
                }
                try {
                  stepResults.push(runStatement(step.stmt));
                  stepErrors.push(null);
                  stepOk.push(true);
                } catch (err) {
                  stepResults.push(null);
                  stepErrors.push({ message: String(err) });
                  stepOk.push(false);
                }
              }

              results.push({
                type: 'ok',
                response: {
                  type: 'batch',
                  result: { step_results: stepResults, step_errors: stepErrors },
                },
              });
              break;
            }

            case 'close':
              results.push({ type: 'ok', response: { type: 'close' } });
              break;

            default:
              results.push({ type: 'ok', response: { type: String(request.type) } });
          }
        } catch (err) {
          results.push({ type: 'error', error: { message: String(err) } });
        }
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ baton: null, base_url: null, results }));
    });
  });

  server.listen(0);
  await new Promise((done) => server.once('listening', done));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((done) =>
        server.close(() => {
          db.close();
          done();
        }),
      ),
  };
}
