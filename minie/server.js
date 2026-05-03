import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { openDb } from "./db.js";

const app = express();
let db;

app.use(express.json({ limit: "1mb" }));

// JSON parse/body errors → return JSON (not HTML stack traces)
app.use((err, req, res, next) => {
  if (!err) return next();
  const isJsonParse =
    err instanceof SyntaxError && "body" in err && err.type === "entity.parse.failed";
  if (isJsonParse) {
    return res.status(400).json({ error: "Invalid JSON body", details: err.message });
  }
  return res.status(400).json({ error: "Bad request", details: String(err?.message || err) });
});

// Basic CORS for local usage
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Serve frontend (disable caching so changes + score refresh correctly)
app.use(
  express.static(process.cwd(), {
    extensions: ["html"],
    etag: false,
    setHeaders(res, filePath) {
      const p = String(filePath).toLowerCase();
      if (p.endsWith(".html") || p.endsWith(".js") || p.endsWith(".css")) {
        res.setHeader("Cache-Control", "no-store");
      }
    },
  }),
);
app.get("/", (req, res) => res.sendFile("index.html", { root: process.cwd() }));

app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/health/db", async (req, res) => {
  try {
    const row = await db.get("SELECT 1 AS ok");
    res.json({ ok: true, db: row?.ok === 1 });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Persist assessment snapshot (DB is source of truth)
app.post("/api/assessment", async (req, res) => {
  try {
    const { clientId, userData } = req.body || {};
    if (!clientId || typeof clientId !== "string") return res.status(400).json({ error: "Missing clientId" });
    if (!userData || typeof userData !== "object") return res.status(400).json({ error: "Missing userData" });

    const completed = Array.isArray(userData.completedLessons) ? userData.completedLessons : [];
    const asBoolInt = (v) => (v === true ? 1 : v === false ? 0 : null);

    // --- ML enrichment (Decision Tree service) ---
    const income = Number(userData.income || 0);
    const expenses =
      Number(userData.rent || 0) +
      Number(userData.food || 0) +
      Number(userData.transport || 0) +
      Number(userData.phone || 0) +
      Number(userData.misc || 0);
    const savings = income - expenses;
    const debt = Number(userData.debt || 0);

    const mlUrl = (process.env.ML_API_URL || "http://localhost:5000").replace(/\/+$/, "");
    let financialLevel = null;
    let spendingBehavior = null;
    let mlOk = false;
    try {
      const upstream = await fetch(`${mlUrl}/predict`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ income, expenses, savings, debt }),
      });
      const pred = await upstream.json().catch(() => ({}));
      if (upstream.ok && pred?.financial_level && pred?.spending_behavior) {
        financialLevel = String(pred.financial_level);
        spendingBehavior = String(pred.spending_behavior);
        mlOk = true;
      }
    } catch {
      // Keep saving assessment even if ML service is temporarily unavailable.
      // Frontend will show "ML offline" and user can retry by re-submitting.
    }

    const stmt = await db.run(
      `
      INSERT INTO assessments (
        client_id,
        profile, age, experience,
        income, rent, food, transport, phone, misc,
        debt, emergency,
        goal, risk, horizon,
        q1, q2, q3,
        score,
        xp, completed_lessons_json
        , financial_level, spending_behavior
      ) VALUES (
        ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?,
        ?, ?,
        ?, ?
      )
      `,
      [
        clientId,
        userData.profile ?? null,
        userData.age ?? null,
        userData.experience ?? null,
        income,
        Number(userData.rent || 0),
        Number(userData.food || 0),
        Number(userData.transport || 0),
        Number(userData.phone || 0),
        Number(userData.misc || 0),
        debt,
        userData.emergency ?? null,
        userData.goal ?? null,
        userData.risk ?? null,
        userData.horizon ?? null,
        asBoolInt(userData.q1),
        asBoolInt(userData.q2),
        asBoolInt(userData.q3),
        userData.score ?? null,
        userData.xp ?? null,
        JSON.stringify(completed),
        financialLevel,
        spendingBehavior,
      ],
    );

    res.json({
      ok: true,
      id: stmt.lastID,
      ai: { ok: mlOk, source: "decision_tree" },
      financial_level: financialLevel,
      spending_behavior: spendingBehavior,
    });
  } catch (e) {
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

app.get("/api/assessment/latest", async (req, res) => {
  try {
    const clientId = String(req.query.clientId || "");
    if (!clientId) return res.status(400).json({ error: "Missing clientId" });

    const row = await db.get(
      `SELECT * FROM assessments WHERE client_id = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT 1`,
      [clientId],
    );
    if (!row) return res.json({ ok: true, found: false });

    const completedLessons = (() => {
      try {
        const arr = JSON.parse(row.completed_lessons_json || "[]");
        return Array.isArray(arr) ? arr : [];
      } catch {
        return [];
      }
    })();

    const toBool = (v) => (v === 1 ? true : v === 0 ? false : null);

    const userData = {
      profile: row.profile,
      age: row.age,
      experience: row.experience,
      income: row.income ?? 0,
      rent: row.rent ?? 0,
      food: row.food ?? 0,
      transport: row.transport ?? 0,
      phone: row.phone ?? 0,
      misc: row.misc ?? 0,
      debt: row.debt ?? 0,
      emergency: row.emergency,
      goal: row.goal,
      risk: row.risk,
      horizon: row.horizon,
      q1: toBool(row.q1),
      q2: toBool(row.q2),
      q3: toBool(row.q3),
      score: row.score ?? 0,
      xp: row.xp ?? 0,
      completedLessons,
      financial_level: row.financial_level ?? null,
      spending_behavior: row.spending_behavior ?? null,
    };

    res.json({ ok: true, found: true, createdAt: row.created_at, userData });
  } catch (e) {
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

app.get("/api/users", async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT a.client_id AS clientId,
             MAX(datetime(a.created_at)) AS lastSeen,
             (
               SELECT score
               FROM assessments a2
               WHERE a2.client_id = a.client_id
               ORDER BY datetime(a2.created_at) DESC, a2.id DESC
               LIMIT 1
             ) AS lastScore
      FROM assessments a
      GROUP BY a.client_id
      ORDER BY datetime(lastSeen) DESC
      LIMIT 200
    `);
    res.json({ ok: true, users: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// AI Coach via Groq (OpenAI-compatible). Supports multi-turn chats.
app.post("/api/coach", async (req, res) => {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: "Missing GROQ_API_KEY. Add it to a .env file.",
      });
    }

    const { system, message, messages, model } = req.body || {};
    if (!system) return res.status(400).json({ error: "Missing system." });

    const userMessages = Array.isArray(messages)
      ? messages
          .filter((m) => m && typeof m === "object")
          .map((m) => ({ role: m.role, content: String(m.content ?? "") }))
          .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim().length > 0)
      : null;

    const finalMessages = userMessages?.length
      ? [{ role: "system", content: system }, ...userMessages]
      : message
        ? [{ role: "system", content: system }, { role: "user", content: String(message) }]
        : null;

    if (!finalMessages) {
      return res.status(400).json({ error: "Missing message or messages[]" });
    }

    const desiredModel = (model || process.env.GROQ_MODEL || "llama-3.1-70b-versatile").trim();
    // Common typo guard: "lllama-" → "llama-"
    const safeModel = desiredModel.startsWith("lllama-")
      ? desiredModel.replace(/^lllama-/, "llama-")
      : desiredModel;

    const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: safeModel,
        temperature: 0.4,
        messages: finalMessages,
      }),
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: data?.error?.message || "Upstream error",
        details: data,
      });
    }

    const text = data?.choices?.[0]?.message?.content || null;
    return res.json({ text });
  } catch (e) {
    return res.status(500).json({ error: "Server error", details: String(e) });
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 5173;
async function main() {
  const dataDir = path.join(process.cwd(), "data");
  if (!dataDir) throw new Error("Invalid data dir");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  db = await openDb();
  console.log(`Using DB at: ${path.join(process.cwd(), "data", "mirs.db")}`);

  app.listen(port, () => {
    console.log(`MIRS running on http://localhost:${port}`);
  });
}

main().catch((e) => {
  console.error("Failed to start server:", e);
  process.exit(1);
});