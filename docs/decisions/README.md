# Architecture Decisions Record (ADR) Index

This document provides a concise index of the architectural, technical, and operational decisions established for the `posai-api` backend. For full historical details, refer to [docs/decisions.md](../decisions.md).

---

## Decisions Index

1. **Modular Monolith**: One Express app with self-contained feature directories under `src/modules/<name>/` and no microservices or API gateways to keep deployment and local development simple.
2. **Tenant Scoping Mongoose Plugin + AsyncLocalStorage**: Multi-tenancy is enforced by a single shared Mongoose plugin using AsyncLocalStorage context (`runWithTenant`) to auto-inject and filter `tenantId` on all model operations without relying on manual query filtering.
3. **Single Global Bypass API (`withGlobalScope`) & Allowlist Test**: Bypassing tenant scoping is restricted to `withGlobalScope` in `src/utils/tenantBypass.ts` for legitimate cross-tenant flows (e.g. login email lookup), strictly guarded by a static analysis test (`tests/unit/bypassAllowlist.test.ts`).
4. **Money in Integer Paise**: All monetary amounts are stored and processed strictly as integer paise to prevent floating-point rounding errors in tax, discount, and billing computations.
5. **Short-Lived Access JWT + Rotating Opaque Refresh Token**: Authentication uses 15-minute `HS256` signed JWTs alongside cryptographically random opaque refresh tokens stored as SHA-256 hashes in MongoDB and delivered via HttpOnly cookies.
6. **Authoritative Database Role Reloaded Per Request**: Access token role claims are never trusted for authorization; the `authenticate` middleware reloads the active user from MongoDB inside `runWithTenant(payload.tid)` on every authenticated request.
7. **Cross-Tenant ID Lookups Return 404 (Not 403)**: Accessing resources owned by another tenant returns `404 Not Found` rather than `403 Forbidden` to prevent leaking the existence of other tenants' records.
8. **Strict Zod Schemas on Request Bodies**: Every request payload is validated using Zod `.strict()` schemas to reject unexpected or forbidden extra properties at the gateway and prevent mass-assignment attacks.
9. **Structured Pino Logging with Key Redaction**: Application logs use `pino` and `pino-http` with strict redaction of sensitive credentials, tokens, authorization headers, and cookie payloads.
10. **Shared MongoDB Memory Replica Set for Testing**: Vitest runs against a single shared `MongoMemoryReplSet` initialized via `globalSetup` to support transactions across test workers while reducing replica set bootstrap overhead.
11. **Isolated Worker Database Names in Tests**: Each test file connects to a uniquely generated database name on the shared test replica set, ensuring tests run in parallel without cross-test data pollution.
12. **Bidirectional OpenAPI Coverage Guards**: Dedicated test guards ensure that every operation in the OpenAPI document is registered in both the tenant-isolation matrix and the mass-assignment matrix.
13. **Partial Unique Index for Main Branch**: The invariant that each tenant has exactly one main branch (`isMain: true`) is enforced at the database level via a partial unique index on `{ tenantId: 1 }` with `partialFilterExpression: { isMain: true }`.
14. **Global User Email Uniqueness**: User emails are indexed uniquely across all tenants (`{ email: 1 }`) to support frictionless single-identifier login without requiring pre-login tenant resolution.
15. **10-Second Refresh Token Rotation Grace Window**: Replaying a recently rotated refresh token within 10 seconds returns `401 REFRESH_TOKEN_ROTATED` without revoking the token family to tolerate legitimate concurrent multi-tab frontend requests.
16. **Family-Wide Refresh Token Revocation on Reuse**: Replaying a rotated refresh token after the 10-second grace window is treated as token theft, immediately revoking all refresh tokens in that family.
17. **Universal Session Revocation on Password Change**: Changing or resetting passwords updates `passwordChangedAt`, immediately invalidating all older access tokens and revoking all active refresh token families across all devices.
18. **Temporary Passwords with Forced First-Login Change**: Floor staff are provisioned with 12-character temporary passwords and flagged with `mustChangePassword: true`, which blocks access to all operational endpoints until their password is changed.
19. **Soft Branch Deactivation Over Physical Deletion**: Branches are deactivated via `status: 'INACTIVE'` rather than deleted (`DELETE /branches` does not exist), preserving referential integrity for orders, tax audits, and historical billing.
20. **Deterministic CI Binary Caching**: GitHub Actions CI explicitly sets `MONGOMS_DOWNLOAD_DIR: ${{ github.workspace }}/.cache/mongodb-binaries` and pins `MONGOMS_VERSION: 7.0.14` to reliably cache the MongoDB memory server binary across runs.
