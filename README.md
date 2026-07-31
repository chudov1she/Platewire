# Platewire

Live MLB Analytics Desk — NestJS backend + mobile-first Next.js frontend.

```
platewire/
  README.md
  backend/     ← Nest API (games, odds, formula, AI, ledger, auth)
  frontend/    ← Next.js phone app (matches, ledger, agent, formula)
```

## Quick start

### Backend

```bash
cd backend
cp .env.example .env   # set DATABASE_URL, JWT_SECRET, TELEGRAM_BOT_TOKEN, AI_API_KEY
npm install
npx prisma migrate dev
npm run prisma:seed    # creates ADMIN from ADMIN_LOGIN/ADMIN_PASSWORD (default admin/admin)
npm run start:dev
```

- API: http://localhost:8000/api/v1
- Docs: http://localhost:8000/docs

### Frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev            # http://localhost:3000
```

Login: `admin` / `admin` (or Telegram Login Widget on a BotFather `/setdomain` host).

## Auth

| Method | Path | Notes |
|--------|------|-------|
| POST | `/auth/login` | `{ login, password, rememberMe? }` → JWT (`12h` or `30d`) |
| POST | `/auth/telegram` | Telegram Login Widget payload → JWT |
| GET | `/auth/me` | Current user |
| * | `/users/*` | Admin-only user CRUD / status |

Statuses: `GUEST` (pending), `USER`, `ADMIN`. Global JWT + status guards; `/health` is public.

## Frontend tabs

- **Матчи** — today's slate (live/upcoming/final)
- **Match detail** — F5 odds tracks, context, readiness, formula eval, ledger for game
- **Ledger** — stats + entries + AiDecisionTrace
- **Агент** — curation run + proposals apply/reject (admin)
- **Формула** — production spec + versions
- **Ещё** — profile + admin user management

## Analytics Desk API (auth required)

Formula, readiness, ledger capture/settle, agent proposals — see Swagger `/docs`.
Mutations that change production formula / capture bets / run pipeline require `ADMIN`.
