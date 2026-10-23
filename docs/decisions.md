# Architecture & Technical Decisions

This document records architectural, technical, and operational decisions agreed upon for the `posai-api` backend.

---

## 1. Package Manager: npm
- **Decision**: Use `npm` as the exclusive package manager. Do not use `pnpm` or add a `packageManager` field.
- **Context**: Standardizes developer workflows and CI execution using standard Node.js/npm commands.

---

## 2. TypeScript Version: Pinned to 5.x
- **Decision**: TypeScript is pinned to `^5.9` in `devDependencies` because `typescript-eslint` (v8) does not support TypeScript 7 yet. Revisit when official support is released.
- **Context**: `typescript-eslint` has a peer dependency constraint of `typescript@">=4.8.4 <6.1.0"`. Pinning ensures reliable AST analysis and type-aware lint rules without requiring `--legacy-peer-deps`.

---

## 3. HTTP Framework: Express 5
- **Decision**: Express 5 is used as the web framework.
- **Context**: Express 5 makes `req.query` a read-only getter. Validation middleware must never attempt to mutate or reassign `req.query`; validated request data must be stored separately (for example in `res.locals`).

---

## 4. Schema Validation: Zod 4
- **Decision**: Use Zod 4 (`zod@^4`) for runtime environment variable validation, request payloads, and API contracts.
- **Context**: Used alongside `@asteasolutions/zod-to-openapi` to generate OpenAPI 3.1 documentation directly from validation schemas.

---

## 5. API Versioning & Route Organization
- **Decision**: 
  - The health check endpoint `/health` stays at the root URL (`GET /health`) for infrastructure and load balancer probes.
  - All feature and domain routes are mounted under `/api/v1` (for example `/api/v1/auth/login`).
  - Feature module routers are centrally registered in [`src/routes/v1/index.ts`](../src/routes/v1/index.ts).
  - One-off utility scripts live in [`scripts/`](../scripts/).
- **Context**: Clean versioning separation while maintaining a predictable root endpoint for health monitors.

---

## 6. Local MongoDB & Replica Set Strategy
- **Decision**:
  - Local MongoDB standalone (port 27017) is supported for initial development.
  - An optional single-node MongoDB replica set (`rs0`) is provided via `docker-compose.yml` published on port 27018 (to prevent conflicts with any pre-existing local MongoDB on 27017).
  - Multi-document transactions will become required starting in Sprint 3 (table management) and Sprint 5/6 (billing and payments), which require a replica set.
  - `MONGODB_URI` is designed to work seamlessly with local standalone, local replica set, or MongoDB Atlas clusters.

---

## 7. OpenAPI Documentation Convention
- **Decision**:
  - For every future module, all request and response schemas must be defined in `<feature>.validation.ts` using Zod.
  - Each route must be registered with the central OpenAPI registry (`openApiRegistry.registerPath`) directly next to its route definition in `<feature>.route.ts`.
  - The OpenAPI 3.1 specification is served dynamically at `GET /api/v1/docs/openapi.json`.
  - An npm script (`npm run openapi:generate`) exports the specification to [`openapi.json`](../openapi.json) in the repository root for client SDK and type generation. `openapi.json` is committed to git and checked for freshness in CI.

---

## 8. Logging, Error Handling & Response Contracts
- **Decision**:
  - Structured logging with `pino` (log level from `LOG_LEVEL`), using `pino-pretty` only when `NODE_ENV === 'development'`.
  - Request logging via `pino-http` with automatic redaction of `authorization` and `cookie` headers.
  - Uniform response shapes via `sendSuccess` (`{ success: true, message, data? }`) and `sendError` (`{ success: false, message, code, errors? }`).
  - Domain errors throw framework-agnostic `AppError` instances, processed by the central error handler without leaking internal stack traces to clients.
