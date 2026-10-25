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

---

## 9. Sprint 1 Architectural Amendments & Security Rules

1. **`AUTO_VERIFY_EMAIL` Flag**:
   - `AUTO_VERIFY_EMAIL` is parsed with `z.stringbool()` (never `z.coerce.boolean()`, which treats `"false"` as `true`).
   - Startup fail-safe: Application startup throws an error and exits immediately if `NODE_ENV === 'production'` and `AUTO_VERIFY_EMAIL === true`.

2. **Single Global Bypass API (`withGlobalScope`) & Allowlist Enforcement**:
   - `withGlobalScope` from `src/utils/tenantBypass.ts` is the only approved bypass mechanism for legitimate cross-tenant queries.
   - The bypass stays in `src/utils/tenantBypass.ts`. The allowlist test (`tests/unit/bypassAllowlist.test.ts`) is the enforcement. Auth service files get added to the allowlist when they are created.
   - Native-driver escape hatches (`.collection.`, `connection.db`, `connection.collection(`, `getClient(`) outside the allowlist are strictly forbidden and guarded by the same test.

3. **Staff `mustChangePassword` Requirement & Planned Gate**:
   - Staff created by owners or admins receive a temporary password with `mustChangePassword: true` and are required to change their password on first login.
   - Planned: Users with `mustChangePassword: true` get 403 `PASSWORD_CHANGE_REQUIRED` on every route except change-password, logout, and `GET /users/me` (implemented in the auth task).

4. **Privilege & Role Hierarchy**:
   - `OWNER` has full tenant authority, including restaurant deletion and ownership management.
   - Only `OWNER` can create or promote `ADMIN`. Nobody can change the `OWNER`'s role or status. Nobody can deactivate themselves.
   - Empty `branchIds` does NOT mean all branches; only `OWNER` and `ADMIN` are tenant-wide. Staff roles (`MANAGER`, `WAITER`, `CASHIER`, `CHEF`) must be assigned explicit `branchIds`; empty `branchIds` is not permitted for staff.

5. **Rate Limiting Keyed by IP + Email**:
   - Authentication endpoints (login, forgot-password) use composite rate-limiting keys (`${ip}:${normalizedEmail}`) to defend against credential-stuffing and targeted dictionary attacks.

6. **Decoupled Signup & Onboarding Flow**:
   - `POST /api/v1/auth/signup` creates only the `Tenant` and the `OWNER` `User`.
   - Signup runs inside `tenantContext` plus a transaction, takes `businessName` in the body, handles slug collisions, and returns 409 on duplicate email (Mongo 11000).
   - Restaurant profile and initial branch are created after authentication via onboarding endpoints:
     - `POST /api/v1/restaurant` returns 409 if one already exists for the tenant.
     - `POST /api/v1/branches` returns 409 `RESTAURANT_REQUIRED` if no restaurant exists yet for the tenant.

7. **Shared Plugins Directory (`src/plugins`)**:
   - Shared Mongoose plugins (including `src/plugins/tenantScoping.plugin.ts`) live under `src/plugins/`.

8. **Branch Rules & One Main Branch Constraint**:
   - Exactly one `isMain: true` branch per tenant, enforced at the database level via a partial unique index on `{ tenantId: 1 }` with `partialFilterExpression: { isMain: true }`.

9. **Restaurant Multi-Tenancy Constraint**:
   - Unique index on `{ tenantId }`: one restaurant per tenant for now (Sprint 11 relaxes this to support multi-restaurant per tenant).

10. **Refresh Token 10-Second Grace Window (`REFRESH_TOKEN_ROTATED`)**:
    - Replaying a just-rotated refresh token within 10 seconds returns `401 REFRESH_TOKEN_ROTATED` without revoking the token family (grace window for concurrent requests from multiple tabs).
    - Replaying a token after 10 seconds triggers reuse detection and revokes the entire `familyId`.
    - Frontend note: The frontend Axios response interceptor intercepts `401 REFRESH_TOKEN_ROTATED` and retries the refresh request once before giving up.

11. **Global User Email Uniqueness**:
    - The `User` model enforces a global unique index on `{ email: 1 }` (NOT compound per-tenant) because user authentication (`POST /api/v1/auth/login`) is performed using email and password alone without requiring a preliminary tenant identifier.

12. **In-Memory Rate Limiting**:
    - Rate limiters use `express-rate-limit`'s built-in in-memory store. This is suitable for single-instance deployments. Distributed rate limiting via Redis will be introduced in a future sprint for horizontal multi-instance scaling.

13. **Signup Email Enumeration Trade-Off**:
    - `POST /api/v1/auth/signup` returns `409 EMAIL_ALREADY_REGISTERED` when an email already exists. While this reveals that an email is registered, strict composite rate limits (3/hr per IP+email and 10/hr per IP) serve as the mitigation against dictionary-based enumeration.

14. **JWT Claims & Authoritative Database Role**:
    - Access tokens are signed using pinned `HS256` with claims: `sub` (userId), `tid` (tenantId), `role`, `iss` ("posai-api"), `iat`, and `exp` (`ACCESS_TOKEN_TTL_MINUTES`).
    - Security rule: Role is **never** trusted from the JWT claims. The `authenticate` middleware reloads the user document from the database on every authenticated request inside `runWithTenant(payload.tid)`. The authoritative role attached to `req.auth` is strictly derived from the current database state.

15. **Per-Request Database Reload Trade-Off**:
    - Reloading the user on every request guarantees immediate enforcement when a user is deactivated, when a tenant is suspended, when a password is changed, or when staff permissions are modified. While this incurs one indexed read per authenticated request, primary key lookups against MongoDB's working set resolve in sub-millisecond time, avoiding the complexity of distributed token revocation blocklists in early sprints.
