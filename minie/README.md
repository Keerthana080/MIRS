# MIRS (Frontend + Backend + DB)

This project serves the refactored MIRS frontend and provides a backend API:

- Static site hosting (pages under `pages/`, assets under `assets/`)
- AI Coach proxy: `POST /api/coach` (keeps API keys server-side)
- Assessment persistence: SQLite DB under `data/mirs.db`

## Run locally

1. Install dependencies

```bash
npm install
```

2. Configure environment

```bash
copy .env.example .env
```

3. Start server

```bash
npm run dev
```

Open:

- `http://localhost:5173/pages/assessment.html`

## Database

- DB file: `data/mirs.db`
- Save assessment snapshot: `POST /api/assessment`
- Get latest snapshot: `GET /api/assessment/latest?clientId=...`

