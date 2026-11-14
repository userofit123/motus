// PGlite: Postgres compiled to WebAssembly, for local accounts on a device (desktop, Android) and for tests.
// dataDir: "memory://" (tests), "idb://name" (browser / Android WebView), or a folder path (desktop).
import { PGlite } from "@electric-sql/pglite";
import { PARSERS, type Db, type Sql } from "../db";

const ANALYZE_EVERY = 500;

export async function pgliteDb(dataDir = "memory://"): Promise<Db> {
  // In a browser the files live in IndexedDB, and by default every query waits until PGlite has compared all its files
  // with IndexedDB and written back the changed ones: about 50 ms per read and 80 ms per write in Chromium (under 1 ms
  // without it), so a page that asks for a few things took a second or more. Relaxed, a query answers at once and the
  // write-back runs behind it. Reads stay that way; a change must not be lost once the app shows it saved (the
  // replica's unsent changes and a local account's only copy live in this database), so the web transports call
  // flush() after every change, which waits for the write-back.
  const lite = await PGlite.create(dataDir, { parsers: PARSERS as any, relaxedDurability: dataDir.startsWith("idb://") });
  // PGlite runs one query at a time; queue transactions so they never interleave
  let chain: Promise<unknown> = Promise.resolve();
  const run = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.then(fn, fn);
    chain = p.catch(() => {});
    return p;
  };
  const admin: Sql = { query: (t, p) => run(() => lite.query(t, p as any[]) as any), exec: (t) => run(async () => { await lite.exec(t); }) };
  // PGlite has no autovacuum, so nothing gathers the planner's statistics: without them it takes every table for a
  // few rows and joins a workout's history by rescanning whole tables (reloading a running workout took several times
  // longer). Gathered when opened and after every ANALYZE_EVERY transactions, as autovacuum would; queued like any query.
  let txs = 0;
  const analyze = () => { void run(() => lite.exec("ANALYZE")).catch(() => {}); };
  analyze();
  return {
    kind: "pglite",
    admin,
    tx: (fn) => {
      if (++txs % ANALYZE_EVERY === 0) analyze();
      return run(async () => (await lite.transaction((tx) => fn({ query: (t, p) => tx.query(t, p as any[]) as any, exec: async (t) => { await tx.exec(t); } })))!);
    },
    // straight to the file system's save: lite.syncToFs() doesn't wait when relaxed. Queued so no query changes the
    // files while they are saved.
    flush: () => run(async () => { await lite.fs?.syncToFs(); }),
    close: () => lite.close(),
  };
}
