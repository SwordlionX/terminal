/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test support. */
/**
 * Minimal libsql Client/Transaction stand-in on Node's built-in SQLite.
 *
 * The native @libsql/client sqlite driver occasionally segfaults while the test process exits
 * on Windows (prepared statements finalized after their connection closed). Production talks to
 * Turso over HTTP and is unaffected; integration tests use this in-memory adapter instead.
 */
const { DatabaseSync } = require('node:sqlite');

function createSqliteClient() {
  const db = new DatabaseSync(':memory:');
  let lock = Promise.resolve();
  const value = v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v);
  const run = statement => {
    const { sql, args = [] } = typeof statement === 'string' ? { sql: statement } : statement;
    const prepared = db.prepare(sql);
    const values = args.map(value);
    const rows = prepared.columns().length ? prepared.all(...values) : (prepared.run(...values), []);
    const rowsAffected = Number(db.prepare('SELECT changes() AS c').get().c);
    return { rows, rowsAffected, columns: prepared.columns().map(c => c.name) };
  };
  // Write transactions are serialized, as SQLite's write lock serializes libsql connections.
  const acquire = async () => {
    let release;
    const previous = lock;
    lock = new Promise(resolve => (release = resolve));
    await previous;
    return release;
  };
  return {
    execute: async statement => run(statement),
    batch: async statements => {
      const release = await acquire();
      db.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(run);
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      } finally {
        release();
      }
    },
    transaction: async () => {
      const release = await acquire();
      db.exec('BEGIN IMMEDIATE');
      let open = true;
      const finish = sql => {
        if (!open) return;
        open = false;
        try {
          db.exec(sql);
        } finally {
          release();
        }
      };
      return {
        execute: async statement => run(statement),
        batch: async statements => statements.map(run),
        commit: async () => finish('COMMIT'),
        rollback: async () => finish('ROLLBACK'),
        close: () => finish('ROLLBACK'),
      };
    },
    close: () => db.close(),
  };
}

module.exports = { createSqliteClient };
