import path from "node:path";
import { fileURLToPath } from "node:url";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function openDb() {
  const dbPath = path.join(__dirname, "data", "mirs.db");
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  await db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS assessments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),

      profile TEXT,
      age TEXT,
      experience TEXT,

      income REAL,
      rent REAL,
      food REAL,
      transport REAL,
      phone REAL,
      misc REAL,
      debt REAL,
      emergency TEXT,

      goal TEXT,
      risk INTEGER,
      horizon INTEGER,

      q1 INTEGER,
      q2 INTEGER,
      q3 INTEGER,

      score INTEGER,

      xp INTEGER,
      completed_lessons_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_assessments_client_created
      ON assessments (client_id, created_at DESC);
  `);

  // Lightweight migrations: add AI columns if missing.
  const cols = await db.all(`PRAGMA table_info(assessments)`);
  const colNames = new Set(cols.map((c) => String(c?.name || "").toLowerCase()));
  if (!colNames.has("financial_level")) {
    await db.exec(`ALTER TABLE assessments ADD COLUMN financial_level TEXT`);
  }
  if (!colNames.has("spending_behavior")) {
    await db.exec(`ALTER TABLE assessments ADD COLUMN spending_behavior TEXT`);
  }

  return db;
}