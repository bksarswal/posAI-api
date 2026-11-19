# POSAI API

Backend REST API for **POSAI** – a modern, multi-tenant Restaurant POS (Point of Sale) SaaS platform tailored for the Indian food service market. Built as a high-performance modular monolith with Node.js, Express 5, TypeScript, and MongoDB.

---

## Tech Stack

- **Runtime**: Node.js (`>= 20.0.0`, Node 20 LTS used in CI)
- **Framework**: Express 5 (`express@^5.3.0`)
- **Language**: TypeScript (`^5.9.3`) in strict mode using standard ES Modules
- **Database**: MongoDB (v7.0.x replica set required for multi-document ACID transactions), managed with Mongoose (`^9.11.2`)
- **Validation**: Zod (`^4.6.7`) with strict schema parsing and `@asteasolutions/zod-to-openapi` (`^9.1.0`)
- **Security**: Helmet, CORS, Express Rate Limit, Bcrypt.js, JSON Web Tokens (JWT)
- **Logging**: Pino & Pino-HTTP with strict multi-level credential and token redaction
- **Testing**: Vitest (`^5.0.5`), Supertest, and `mongodb-memory-server` (`^11.3.0`)

---

## Requirements

1. **Node.js**: Version `>= 20.0.0` (as specified in `package.json` engines and CI).
2. **Package Manager**: `npm` only (`>= 10.0.0`). Do not use `yarn` or `pnpm`.
3. **MongoDB Replica Set**: A MongoDB replica set is required because POS transactions (table management, order-to-bill, staff onboarding, auth token rotations) execute inside multi-document transactions.

### Running MongoDB Locally
- **Option A (Docker Compose Replica Set - Recommended)**:
  Run the single-node replica set (`rs0`) published on port 27018:
  ```bash
  docker compose up -d
  ```
  Set in your `.env`:
  ```env
  MONGODB_URI=mongodb://localhost:27018/posai?replicaSet=rs0&directConnection=true
  ```
- **Option B (Local Standalone / Atlas)**:
  For non-transactional standalone local testing on port 27017 or remote Atlas clusters:
  ```env
  MONGODB_URI=mongodb://localhost:27017/posai
  ```

---

## Quick Start

### 1. Clone & Install
```bash
git clone <repo-url> posai-api
cd posai-api
npm install
```

### 2. Configure Environment Variables
Copy the example environment template to `.env`:
```bash
cp .env.example .env
```
Generate random secrets of at least 32 characters for `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`:
```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

### 3. Build & Run
```bash
# Start in development mode with live watch/reload
npm run dev

# Compile TypeScript to dist/
npm run build

# Start the compiled production build
npm start
```

---

## Environment Variables

All environment variables are parsed and strictly validated at application startup using Zod in `src/config/env.ts`. Any missing or invalid configuration terminates the process with an informative error message.

| Variable | Required? | Default | Secret? | Purpose & Constraints |
| :--- | :---: | :---: | :---: | :--- |
| `NODE_ENV` | No | `development` | No | Server environment (`development`, `test`, `production`). |
| `PORT` | No | `8080` | No | Port the HTTP Express server listens on. |
| `MONGODB_URI` | **Yes** | — | **Yes** | MongoDB connection string (standalone, replica set, or Atlas). |
| `JWT_ACCESS_SECRET` | **Yes** | — | **Yes** | Secret used to sign short-lived access JWTs. Minimum 32 characters. Cannot start with `"change-me"` in production. |
| `JWT_REFRESH_SECRET` | **Yes** | — | **Yes** | Secret used for HMAC hashing of refresh tokens. Minimum 32 characters. Cannot start with `"change-me"` in production. |
| `ACCESS_TOKEN_TTL_MINUTES` | No | `15` | No | Access token expiration window in minutes. |
| `REFRESH_TOKEN_TTL_DAYS` | No | `7` | No | Sliding refresh token validity period in days. |
| `CLIENT_URL` | **Yes** | — | No | Allowed CORS origin (frontend web app URL, no trailing slash). Must be a valid URL. |
| `BCRYPT_ROUNDS` | No | `12` | No | Bcrypt hash work factor (min 4, max 15). Enforced `>= 10` in production. |
| `AUTO_VERIFY_EMAIL` | No | `false` | No | Auto-verifies user email upon signup for development/testing. **Strictly blocked (`false`) in production**. |
| `TRUST_PROXY` | No | `0` | No | Number of reverse proxy hops in front of Express (0 = direct, 1 = behind Nginx/ALB/Cloudflare). |
| `EMAIL_PROVIDER` | No | `log` | No | Transactional email provider (`log` or `smtp`). **`log` is strictly blocked in production**. |
| `EMAIL_FROM` | Conditional | — | No | Sender email address for outbound emails. Required when `EMAIL_PROVIDER=smtp`. |
| `SMTP_HOST` | Conditional | — | No | SMTP relay server hostname. Required when `EMAIL_PROVIDER=smtp`. |
| `SMTP_PORT` | Conditional | — | No | SMTP server port (e.g. 587, 465). Required when `EMAIL_PROVIDER=smtp`. |
| `SMTP_USER` | Conditional | — | **Yes** | SMTP authentication username. Required when `EMAIL_PROVIDER=smtp`. |
| `SMTP_PASS` | Conditional | — | **Yes** | SMTP authentication password. Required when `EMAIL_PROVIDER=smtp`. |
| `LOG_LEVEL` | No | `info` (`silent` in test) | No | Application log verbosity (`silent`, `error`, `warn`, `info`, `debug`). |
| `MONGOMS_VERSION` | No | `7.0.14` | No | MongoDB binary version used by `mongodb-memory-server` in tests and CI. |

---

## Scripts

All available scripts defined in `package.json`:

| Script | Command | Purpose |
| :--- | :--- | :--- |
| `npm run dev` | `tsx watch src/server.ts` | Runs the server in development mode with automatic restarts on file changes. |
| `npm run build` | `tsc --project tsconfig.json` | Compiles TypeScript source code to the `dist/` directory. |
| `npm start` | `node dist/server.js` | Runs the compiled production server from `dist/`. |
| `npm run lint` | `eslint src tests scripts` | Runs ESLint across source, test, and script files. |
| `npm run lint:fix` | `eslint src tests scripts --fix` | Automatically fixes auto-fixable ESLint issues. |
| `npm run format` | `prettier --write "{src,tests,scripts}/**/*.ts"` | Formats code with Prettier. |
| `npm run format:check` | `prettier --check "{src,tests,scripts}/**/*.ts"` | Validates code formatting against Prettier rules. |
| `npm test` | `vitest run` | Runs all automated unit, integration, and security test suites once. |
| `npm run test:watch` | `vitest` | Runs Vitest in interactive watch mode for rapid TDD. |
| `npm run test:coverage` | `vitest run --coverage` | Runs tests and generates V8 code coverage reports. |
| `npm run typecheck` | `tsc --noEmit` | Performs strict TypeScript type-checking without emitting files. |
| `npm run openapi:generate` | `tsx scripts/generate-openapi.ts` | Generates `openapi.json` from registered Zod routes and OpenAPI definitions. |
| `npm run prepare` | `husky` | Installs git pre-commit hooks via Husky. |

---

## Project Structure

```
src/
├── config/             # Environment schemas, database connection, and OpenAPI configuration
├── middleware/         # Express middleware (authenticate, authorize, errorHandler, rateLimiters)
├── modules/            # Feature modules (Domain-driven modular monolith)
│   ├── auth/           # Authentication, token rotation, password reset, email verification
│   ├── branch/         # Restaurant branches and branch-level access control
│   ├── health/         # System and database health check endpoint
│   ├── restaurant/     # Singleton restaurant entity configuration
│   ├── tenant/         # SaaS tenant organization lifecycle and slug management
│   └── user/           # User accounts, staff management, and role validation rules
├── plugins/            # Shared Mongoose plugins (tenantScoping.plugin.ts)
├── routes/             # Central API router registry (routes/v1/index.ts)
├── types/              # Ambient Express request extensions and shared global types
├── utils/              # Shared utilities (password hashing, money, slug, logger, tenant context)
├── app.ts              # Express application factory and middleware pipeline
└── server.ts           # HTTP server bootstrap and graceful shutdown hooks
```

Each domain module under `src/modules/<feature>/` adheres to a strict internal structure:
- `<feature>.controller.ts`: Function-based HTTP controllers.
- `<feature>.service.ts`: Business logic directly using models.
- `<feature>.model.ts`: Mongoose schema definitions and indexes.
- `<feature>.route.ts`: Express router setup and inline OpenAPI route documentation.
- `<feature>.validation.ts`: Zod validation schemas for request bodies and query parameters.
- `<feature>.interface.ts`: Mongoose document and database typing.
- `<feature>.types.ts`: DTO types derived from `z.infer`.
- `index.ts`: Public module exports (modules only consume other modules via their public interface).

---

## Architecture Rules

Every contributor must adhere to these foundational architectural invariants:

1. **Modular Monolith**: One single Express application. Modules communicate via service functions exposed through `index.ts`, never by importing another module's Mongoose model directly.
2. **Multi-Tenancy Enforced by Plugin**: Every tenant-owned Mongoose collection applies `tenantScopingPlugin`. Queries and mutations run inside the `runWithTenant(tenantId)` `AsyncLocalStorage` context. The plugin automatically injects `tenantId` into queries, writes, and aggregations, and strictly throws `TenantScopingError` if an operation lacks tenant context.
3. **The Single Bypass API (`withGlobalScope`)**: Bypassing tenant scoping is restricted exclusively to `withGlobalScope()` in `src/utils/tenantBypass.ts`. It is reserved for legitimate cross-tenant actions (e.g. login user lookup by email, signup uniqueness check). Unauthorized use of `withGlobalScope` or native-driver escape hatches outside the allowlist triggers immediate failure in `tests/unit/bypassAllowlist.test.ts`.
4. **Money Stored in Integer Paise**: All currency values (prices, totals, taxes, discounts) are represented as integer paise (1 INR = 100 paise). Floating-point math for money is strictly prohibited.
5. **Strict ES Modules (ESM)**: Code is written using ES Module syntax (`import`/`export`). CommonJS `require()` or `module.exports` is strictly forbidden. All relative imports must include the explicit `.js` extension.
6. **Express Native Parsers**: Use `express.json()` and `express.urlencoded()`. Never import the standalone `body-parser` package.
7. **Node.js Built-In Protocol Prefix**: All Node.js built-in modules must be imported using the `node:` protocol prefix (e.g. `import crypto from 'node:crypto';`).
8. **Strict Zod Validation**: Every request body is validated with `.strict()` Zod schemas, rejecting unexpected fields with `400 VALIDATION_ERROR` to protect against mass-assignment.

---

## Authentication & Security Overview

- **Access Token (JWT)**:
  - Algorithm: Pinned `HS256`.
  - Expiration: 15 minutes (`ACCESS_TOKEN_TTL_MINUTES`).
  - Claims: `sub` (userId), `tid` (tenantId), `role`, `iss` (`"posai-api"`), `iat`, `exp`.
  - **Authoritative Database Role**: The role claim in the JWT is **never** trusted for authorization. The `authenticate` middleware reloads the user from MongoDB on every authenticated request inside `runWithTenant(payload.tid)`. If a user is deactivated or their role changes, it takes effect instantly.
- **Refresh Token (Opaque Cookie)**:
  - Cryptographically secure 64-hex string delivered via a strictly configured cookie (`HttpOnly`, `SameSite=Lax`, `Path=/api/v1/auth`, `Max-Age=604800` / 7 days, `Secure` in production).
  - Stored in the database solely as a SHA-256 hash.
  - **Rotation**: On every use, the token is atomically rotated inside a transaction.
  - **Grace Window**: Replaying a token within `REFRESH_GRACE_SECONDS = 10` returns `401 REFRESH_TOKEN_ROTATED` without revoking the token family (handling concurrent frontend requests).
  - **Reuse Detection**: Replaying a token after 10 seconds revokes the entire token family (`familyId`) and clears the cookie.
- **`mustChangePassword` Gate**: Staff provisioned with temporary passwords must complete `POST /api/v1/auth/change-password` before accessing other routes; attempts to access protected routes return `403 PASSWORD_CHANGE_REQUIRED`.
- **RBAC Roles**: `OWNER`, `ADMIN`, `MANAGER`, `WAITER`, `CASHIER`, `CHEF`.

---

## API Documentation

- **OpenAPI 3.1 Spec Endpoint**: Served dynamically at `GET /api/v1/docs/openapi.json`.
- **Exporting the Specification**:
  ```bash
  npm run openapi:generate
  ```
  Exports the specification to `openapi.json` at the root of the repository.
- **Freshness Guard**: CI executes `npm run openapi:generate` followed by `git diff --exit-code --ignore-cr-at-eol openapi.json`. CI fails if changes to routes or validation schemas are not reflected in a committed `openapi.json`.

---

## Testing

Testing is powered by [Vitest](https://vitest.dev).

```bash
# Run the complete test suite once
npm test

# Run tests with coverage
npm run test:coverage
```

### Shared MongoDB Replica Set & Test Isolation
- **Global Setup**: Tests run against a single shared in-memory MongoDB replica set started once via `tests/globalSetup.ts` using `MongoMemoryReplSet` pinned to MongoDB `7.0.14` (`MONGOMS_VERSION`).
- **Database Partitioning**: Each test file connects to a unique database name on the shared replica set (`test_<uuid>`), ensuring tests run in parallel without cross-test race conditions. Database cleanup drops only the worker's isolated database.
- **First Run Download**: On the first run, `mongodb-memory-server` downloads the ~590 MB MongoDB binary to `~/.cache/mongodb-binaries` (cached across CI runs).

### Test Categories
1. **Unit Tests**: Pure domain logic, money utilities, role rules, and schema validation.
2. **Integration Tests**: Feature module tests (`auth.test.ts`, `onboarding.test.ts`, `staff.test.ts`, etc.).
3. **Tenant Isolation Matrix (`tests/tenantIsolation.test.ts`)**: Cross-tenant attack tests verifying that Tenant B receives `404 Not Found` when attempting to access or modify Tenant A's resources.
4. **Mass Assignment Matrix (`tests/massAssignment.test.ts`)**: Exercises all write endpoints with forbidden properties to verify strict Zod `.strict()` rejection.
5. **Token Abuse Suite (`tests/tokenAbuse.test.ts`)**: Validates token tampering, algorithm confusion (`alg: none`), expired tokens, cross-tenant claim mismatches, and cookie tampering.
6. **Coverage Guard Rule**: Adding any new endpoint requires adding it to the isolation matrix in `tests/tenantIsolation.test.ts` and the mass-assignment matrix in `tests/massAssignment.test.ts`; otherwise, the coverage guard tests fail.

---

## Continuous Integration (CI)

The GitHub Actions workflow defined in `.github/workflows/ci.yml` runs on every `push` and `pull_request` to `main` and `feat/**` branches.

### Workflow Pipeline
1. **Checkout Repository**: `actions/checkout@v4`.
2. **Setup Node.js**: `actions/setup-node@v4` with Node `20` and npm caching.
3. **Install Dependencies**: `npm ci`.
4. **Cache MongoDB Binary**: `actions/cache@v4` caches `${{ github.workspace }}/.cache/mongodb-binaries` using key `${{ runner.os }}-mongodb-binaries-${{ env.MONGOMS_VERSION }}`.
5. **Lint & Code Format**: `npm run lint` and `npm run format:check`.
6. **Typecheck**: `npm run typecheck` (`tsc --noEmit`).
7. **Test Suite**: `npm test` (`vitest run`).
8. **Build**: `npm run build`.
9. **OpenAPI Freshness**: `npm run openapi:generate` followed by `git diff --exit-code --ignore-cr-at-eol openapi.json`.

---

## Logging & Observability

- **Engine**: Structured JSON logging powered by `pino` and `pino-http`.
- **Log Level**: Controlled by `LOG_LEVEL` (`silent`, `error`, `warn`, `info`, `debug`). Defaults to `silent` when `NODE_ENV=test` and `info` otherwise.
- **Request ID Tracking**: Every inbound request receives or propagates an `X-Request-Id` header, attached to all log lines emitted during request execution.
- **Automatic Redaction**: Strict multi-level redaction automatically sanitizes passwords, temporary passwords, tokens, `Authorization` headers, `Cookie` headers, and SMTP credentials.

---

## Troubleshooting

- **Slow First Test Run**: The initial test run downloads the ~590 MB MongoDB binary. Subsequent runs use the local cache.
- **Windows CRLF Warnings**: Git may warn about replacing LF with CRLF on Windows checkouts. The build and CI scripts use `--ignore-cr-at-eol` to ensure cross-platform compatibility.
- **Hook Timeouts Under High Load**: In resource-constrained environments, Vitest hooks are configured with a generous `hookTimeout: 60000` to allow replica set initialization.
