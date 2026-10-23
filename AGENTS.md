# AGENTS.md - posai-api (Backend)

Project spec: `docs/master-prompt.md`. This repo is the BACKEND only. The frontend lives in `posai-web`.

## Working Rules

- Build ONE sprint at a time, ONE small task at a time. Stop after each task and wait for my review.
- For a new sprint, give the plan first (architecture, schema, APIs, user stories, task order). Write no code until I approve.
- If a requirement is unclear or a decision is risky, ask before assuming.
- Never commit secrets. Only `.env.example` is committed.

---

## General Rules

- Use TypeScript only (strict). No `any` without a comment explaining why.
- Use ES Modules (`import/export`). Relative imports include the `.js` extension.
- Use npm as the package manager.
- Follow clean architecture and a modular structure.
- Keep code simple, readable, and production-ready.
- Avoid unnecessary abstractions and over-engineering.

## Backend Stack

Node.js, Express.js, TypeScript, MongoDB (replica set), Mongoose, Zod, JWT, Bcrypt.

## Dependencies

- Ask before adding any new dependency.
- Pre-approved for project setup only: eslint, prettier, husky, lint-staged, vitest (testing), pino (logging), helmet, cors, express-rate-limit, dotenv, jsonwebtoken, bcrypt, zod, mongoose, express, and a Zod-to-OpenAPI package (propose the exact one before installing).

---

## Architecture

- Modular monolith: one Express app, one folder per feature under `src/modules/<name>/`. No microservices, no API gateway.
- No separate repository layer. Services use Mongoose models directly (see Multi-Tenancy for how tenant safety is enforced).
- Modules never import another module's model directly. They call that module's service through its `index.ts`.

## Folder Structure

Each feature/module contains:

```
auth/
├── auth.controller.ts
├── auth.service.ts
├── auth.model.ts
├── auth.route.ts
├── auth.validation.ts
├── auth.interface.ts
├── auth.types.ts
└── index.ts
```

Shared code lives in `src/config`, `src/middleware`, `src/utils`. Do not create files that stay unused or contain placeholder code.

---

## Multi-Tenancy (critical)

- Every tenant-owned document has `tenantId` (and `branchId` where relevant).
- `tenantId` always comes from the authenticated token, never from request body or params.
- Tenant safety is enforced by one shared Mongoose plugin applied to every tenant-owned schema. It rejects any `find`, `update`, `delete`, or `aggregate` that has no `tenantId` filter, and auto-sets `tenantId` on create. Services must not bypass it.
- Every module needs tests proving tenant A cannot read or modify tenant B's data.

## Money and GST

- Store money as integer paise. Never use floats for money.
- All tax, discount, service charge, and round-off math lives in one shared money utility with heavy unit tests.

## Data Integrity

- Use MongoDB transactions for table merge/split, order-to-bill, payments, and refunds.
- Retryable mutating endpoints (orders, payments) accept an idempotency key.

---

## Controller Rules

- Function-based controllers, exported as named exports.

```ts
export const signup = async (req: Request, res: Response) => {};
```

- Always use try/catch. Catch error type is `unknown`. Check `err instanceof Error`.
- Never leave unhandled exceptions.
- Keep controllers thin. They only parse input, call a service, and send the response.

## Service Rules

- All business logic lives in services.
- Services never access Express Request/Response.

## Validation Rules

- Use Zod. Validate every request. Never trust client input.
- Zod schemas live in `*.validation.ts`. DTO types come from `z.infer`. Keep DTOs separate from interfaces.

## Database Rules

- Use Mongoose with timestamps.
- Add indexes where needed (always include `tenantId` in compound indexes for tenant data).
- Use unique constraints where required (unique per tenant, not globally, for tenant data).
- Use proper schema types.

## Response Rules

- Use one common response helper for success and one for errors.
- Success and error responses each have one consistent format.

## Authentication and Security

- JWT: short-lived access token, refresh token stored in the database and rotated on use.
- Passwords hashed with bcrypt. Never return the password.
- Email verification and password reset tokens expire and are single-use.
- RBAC middleware on every route. Roles: OWNER, MANAGER, WAITER, CASHIER, CHEF, ADMIN.
- Rate limit auth endpoints. Audit-log sensitive actions (refunds, discounts, role changes).

## API Docs

- Every API is documented in OpenAPI, generated from the Zod schemas. The frontend generates its types from this spec, so keep it accurate.

---

## Code Style

- Use async/await. Avoid nested callbacks.
- Prefer early return.
- Use meaningful variable names.
- Keep functions small. Avoid duplicate code.
- Prefer consistency over cleverness.

## Naming

`<feature>.controller.ts`, `.service.ts`, `.model.ts`, `.validation.ts`, `.interface.ts`, `.types.ts`, `.route.ts`.

## Imports

Prefer namespace imports for services:

```ts
import * as AuthService from "./auth.service.js";
```

## Comments

Write comments only when they explain WHY. No unnecessary comments.

## Testing and Git

- Write tests with the feature: unit tests for services and the money utility, integration tests for APIs.
- Conventional commits (`feat(auth): add signup API`). Small commits, one branch per feature (`feat/sprintN-name`).

---

## AI Rules

- Follow the existing project structure. Never change architecture without asking.
- Ask before introducing a new dependency.
- Generate production-ready code. No placeholder code, no unused files.

## Definition of Done

Feature works, tests pass, lint passes, OpenAPI updated, tenant-isolation test exists, no secrets in diff.

## Lessons Learned (add agent mistakes here)

- (empty)
