# POSAI API

Backend REST API for **POSAI** – a modern, cloud-based multi-tenant Restaurant POS platform built with Node.js, Express 5, TypeScript, and MongoDB.

---

## Requirements

- **Node.js**: `>= 20.0.0` (Node 22 LTS recommended)
- **npm**: `>= 10.0.0`
- **MongoDB**: Local standalone (port 27017), local replica set via Docker Compose (port 27018), or MongoDB Atlas.

---

## Getting Started

### 1. Clone & Install
```bash
git clone <repo-url> posai-api
cd posai-api
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Generate random 32+ character secrets for `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Start Database
- **Option A (Local Standalone)**: Connect to your existing MongoDB instance on port 27017:
  ```env
  MONGODB_URI=mongodb://localhost:27017/posai
  ```
- **Option B (Docker Compose Replica Set)**: Start the single-node replica set container on port 27018:
  ```bash
  docker compose up -d
  ```
  Then set in `.env`:
  ```env
  MONGODB_URI=mongodb://localhost:27018/posai?replicaSet=rs0&directConnection=true
  ```

### 4. Run the API
```bash
# Start in development mode with live reload
npm run dev

# Check health endpoint
curl http://localhost:8080/health
```

---

## Available Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Starts server with live reload using `tsx watch` |
| `npm run build` | Compiles TypeScript into `dist/` |
| `npm start` | Runs the compiled production server (`node dist/server.js`) |
| `npm test` | Runs the Vitest test suite |
| `npm run test:watch` | Runs Vitest in interactive watch mode |
| `npm run test:coverage` | Generates v8 test coverage report |
| `npm run typecheck` | Runs TypeScript type checking (`tsc --noEmit`) |
| `npm run lint` | Lints `src`, `tests`, and `scripts` with ESLint |
| `npm run lint:fix` | Automatically fixes fixable lint errors |
| `npm run format` | Formats files with Prettier |
| `npm run format:check` | Verifies code adheres to Prettier formatting |
| `npm run openapi:generate` | Exports OpenAPI 3.1 specification to `openapi.json` |

---

## Folder Structure

```text
posai-api/
├── .github/workflows/  # GitHub Actions CI workflow
├── docs/               # Project spec and architectural decisions
├── scripts/            # Build and utility scripts (e.g. openapi generator)
├── src/
│   ├── config/         # Environment, database, and OpenAPI registries
│   ├── middleware/     # Global error and not-found handlers
│   ├── modules/        # Modular monolith domain features (health, auth, etc.)
│   ├── routes/         # Central API routing and versioning (v1)
│   ├── utils/          # Shared utilities (logger, response helpers, AppError)
│   ├── app.ts          # Express app configuration & middleware pipeline
│   └── server.ts       # Server entrypoint and graceful shutdown lifecycle
├── tests/              # Unit and integration test suites
├── openapi.json        # Generated OpenAPI 3.1 contract
└── docker-compose.yml  # Local MongoDB replica set service
```

---

## Architectural Decisions

Detailed architectural and technical decisions are documented in [docs/decisions.md](docs/decisions.md).
