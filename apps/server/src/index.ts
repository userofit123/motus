import Fastify from "fastify";
import pg from "pg";

const PORT = Number(process.env.PORT ?? 8080);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const app = Fastify({ logger: true });

// Health of the server and its database, shown on the development page.
app.get("/api/health", async () => {
  let db: { ok: boolean; version?: string; error?: string };
  try {
    const { rows } = await pool.query<{ v: string }>("SELECT current_setting('server_version') AS v");
    db = { ok: true, version: rows[0]?.v };
  } catch (e) {
    db = { ok: false, error: (e as Error).message };
  }
  return { ok: true, app: "motus", node: process.version, db };
});

await app.listen({ host: "0.0.0.0", port: PORT });
