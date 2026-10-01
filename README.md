![Platewire — Live MLB Analytics Desk](docs/banner.png)

<h1 align="center">Platewire</h1>

<p align="center">
  <strong>MLB data collector</strong> — игры, игроки, погода, судьи и линии F5 Winline<br/>
  в фоне, плюс HTTP MCP для агента.
</p>

<p align="center">
  <img alt="NestJS" src="https://img.shields.io/badge/NestJS-11-E0234E?style=flat-square&logo=nestjs&logoColor=white" />
  <img alt="Postgres" src="https://img.shields.io/badge/Postgres-17-4169E1?style=flat-square&logo=postgresql&logoColor=white" />
  <img alt="Prisma" src="https://img.shields.io/badge/Prisma-7-2D3748?style=flat-square&logo=prisma&logoColor=white" />
  <img alt="Docker" src="https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white" />
</p>

---

## Что внутри

| Область | Что делает |
|--------|------------|
| **Slate / live** | Расписание MLB, live feed, probable SP, погода, Savant / Statcast |
| **Players / umpires** | Составы, фичи игроков, судьи |
| **Odds** | Скрейп Winline F5 в фоне, пока игра не финальная. История снимков хранится |
| **Pack** | Одно досье на игру для Hermes |
| **MCP** | Поиск, чтение и точечный досъём (`/mcp`) |
| **Auth** | Login/password JWT для HTTP-клиента скилла |

Формула и решения о ставках живут снаружи, в Hermes.

---

## Стек

```
platewire/
├── backend/          NestJS 11 + Prisma 7 + Playwright (odds)
├── docker/nginx/     reverse proxy → /api + /mcp + /docs
├── docker-compose.yml
└── docs/
```

Данные: MLB Stats API, Baseball Savant, Open-Meteo, Ump Scorecards, Winline.

---

## Быстрый старт (Docker)

Рекомендуемый путь — весь стек одной командой:

```bash
cp .env.docker.example .env.docker
# заполни JWT_SECRET; MCP_SERVICE_TOKEN уже в примере — это сегмент URL /mcp/<token>

docker compose --env-file .env.docker up --build
```

| URL | Назначение |
|-----|------------|
| http://baseballai.mooo.com/docs | Прод, Swagger (`HTTP_PORT=80`) |
| http://localhost:8080/docs | Локально (`HTTP_PORT=8080`) |
| `/api/v1` | REST |
| `/mcp/<MCP_SERVICE_TOKEN>` | MCP, ключ в пути |

Логин по умолчанию: `admin` / `admin` (из `ADMIN_LOGIN` / `ADMIN_PASSWORD`).

---

## Локальная разработка

### Backend

```bash
cd backend
cp .env.example .env
npm install
npx prisma migrate dev
npm run prisma:seed
npm run start:dev
```

- API: http://localhost:8000/api/v1  
- MCP: http://localhost:8000/mcp/<MCP_SERVICE_TOKEN>  
- Docs: http://localhost:8000/docs  

---

## Auth

| Метод | Path | Notes |
|-------|------|--------|
| POST | `/auth/login` | `{ login, password, rememberMe? }` → JWT (`12h` / `30d`) |
| GET | `/auth/me` | Текущий пользователь |
| * | `/users/*` | Admin: CRUD / статусы |

Статусы: `GUEST` → `USER` / `ADMIN`. JWT + status guards глобально; `/health` публичный. MCP использует отдельный `MCP_SERVICE_TOKEN`, не пользовательский JWT.

---

## Pipeline

При `PIPELINE_ENABLED=true` бэкенд крутит сбор:

1. hydrate schedule / live / probable pitchers  
2. context (Savant, umps, weather, …)  
3. линии F5, пока игра не `FINAL` — новый снимок, старые остаются  

Ручной tick одной игры — `POST /ops/pipeline/tick` (ADMIN) или MCP `refresh_game`.

---

## Переменные окружения

| Переменная | Зачем |
|------------|--------|
| `HTTP_PORT` | Порт nginx на хосте (`80` на VPS, `8080` локально) |
| `DATABASE_URL` | Postgres (в Docker задаётся compose) |
| `JWT_SECRET` | Подпись токенов |
| `MCP_SERVICE_TOKEN` | Сегмент пути `/mcp/<token>`. Пустой — маршрут не поднимается |
| `PIPELINE_ENABLED` | Автопайплайн |
| `WINLINE_*` | URL скрейпа линий |

Секреты (`.env`, `.env.docker`) в git не коммитятся.

Обновление кода на сервере: `git pull` + `docker compose --env-file .env.docker up -d --build`. Миграция `20260930140000_collector_only` дропает старые таблицы формулы, журнала и чата.

---

## API

Games, pack, odds, pipeline — в Swagger: `/docs`.  
Префикс API: `/api/v1`. MCP: `/mcp/<MCP_SERVICE_TOKEN>`.
