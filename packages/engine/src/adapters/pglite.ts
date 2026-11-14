// PGlite: Postgres compiled to WebAssembly, for local accounts on a device (desktop, Android) and for tests.
// dataDir: "memory://" (tests), "idb://name" (browser / Android WebView), or a folder path (desktop).
import { IdbFs, PGlite } from "@electric-sql/pglite";
import { PARSERS, type Db, type Sql } from "../db";

const ANALYZE_EVERY = 500;
/** After a failed save (storage full, say), when to try again. */
const RETRY_SAVE_MS = 5000;

/** IndexedDB storage that writes back only when told to (save()), never on its own behind the queries. */
class SaveOnFlush extends IdbFs {
  // PGlite calls this after every query, with relaxed = true when relaxedDurability is on (and without waiting)
  override syncToFs(relaxed?: boolean) { return relaxed ? Promise.resolve() : super.syncToFs(); }
  save() { return super.syncToFs(); }
}

export async function pgliteDb(dataDir = "memory://"): Promise<Db> {
  // In a browser the files live in IndexedDB, and by default every query waits until PGlite has compared all its files
  // with IndexedDB and written back the changed ones: about 50 ms per read and 80 ms per write in Chromium (under 1 ms
  // without it), so a page that asks for a few things took a second or more. So reads are relaxed and answer at once.
  // PGlite's own relaxed write-back is switched off, not just left behind the queries: it would run while later queries
  // change the files (saving a mix of before and after), and IndexedDB storage picks the files to save by their
  // modified time in whole milliseconds, so one it saved in the same millisecond as the next commit looks unchanged to
  // the next save, which then skips it and a change shown as saved is lost. Instead nothing is written back on its own:
  // every path that writes (the web transports after each change, a sync, opening and first loading the copy) calls
  // flush(), which saves inside the query queue, so no query touches the files while they are saved. A change must not
  // be lost once the app shows it saved: the replica's unsent changes and a local account's only copy live here.
  // Same IndexedDB database name as PGlite's own "idb://name", so data saved before this stays readable.
  const fs = dataDir.startsWith("idb://") ? new SaveOnFlush(dataDir.slice("idb://".length)) : undefined;
  const lite = await PGlite.create({ ...(fs ? { fs } : { dataDir }), parsers: PARSERS, relaxedDurability: !!fs });
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
  let retry: ReturnType<typeof setTimeout> | undefined, closed = false;
  const db: Db = {
    kind: "pglite",
    admin,
    tx: (fn) => {
      if (++txs % ANALYZE_EVERY === 0) analyze();
      return run(async () => (await lite.transaction((tx) => fn({ query: (t, p) => tx.query(t, p as any[]) as any, exec: async (t) => { await tx.exec(t); } })))!);
    },
    // A failed save doesn't undo the commit: the caller still gets its answer (it is in the database), and the save is
    // tried again shortly; any later flush saves it too.
    flush: () => run(async () => { await fs?.save(); }).catch((e) => {
      if (!retry && !closed) retry = setTimeout(() => { retry = undefined; void db.flush!().catch(() => {}); }, RETRY_SAVE_MS);
      throw e;
    }),
    // queued, so a save already waiting runs before the close and none can run after it (it would reopen the storage)
    close: () => { closed = true; clearTimeout(retry); return run(() => lite.close()); },
  };
  return db;
}
