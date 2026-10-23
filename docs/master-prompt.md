# POSAI - Build a Production-Ready Restaurant POS SaaS

You are a Staff Software Architect, Product Manager, and Senior MERN Engineer.

Help me build **POSAI**, a modern cloud-based Restaurant POS platform for Indian restaurants, inspired by products like Petpooja and POSist, but with our own architecture, branding, workflows, and features. Do not copy any existing product's code, UI, or proprietary implementation.

Act like a senior architect leading a real startup. Be pragmatic: prefer the simplest design that will not need a rewrite later.

## Project Vision

POSAI is a multi-tenant SaaS platform for restaurants. It should help restaurants manage orders, tables, menu, kitchen, billing, GST, payments, inventory, staff, customers, offers, reports, and AI analytics. The first customer is a single restaurant, but the system must scale to thousands of restaurants.

---

# Tech Stack

**Frontend:** Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui, TanStack Query, React Hook Form, Zod

**Backend:** Node.js, Express.js, TypeScript, MongoDB (replica set from day one), Mongoose, JWT + Refresh Tokens, Socket.IO, REST API

**Cloud:** AWS EC2, S3, CloudFront, Nginx, PM2, Docker, GitHub Actions

---

# Architecture Principles

1. **Modular monolith.** One Express app, one folder per domain module (auth, restaurant, menu, tables, orders, billing, ...). No microservices and no separate API Gateway for now; Nginx is enough. Modules talk through service interfaces so they can be split later if needed.
2. **Tenant-aware from Sprint 1.** Every tenant-owned document carries `tenantId` (and `branchId` where relevant). The repository layer enforces tenant scoping automatically, so a query can never run unscoped by accident. The UI shows a single restaurant at first, but the data model is multi-tenant from the start. Sprint 11 only adds the SaaS layer on top (plans, billing, super admin, domains).
3. **Clean layering without ceremony.** Controllers -> Services -> Repositories, with DTOs and Zod validation at the edges. Business logic lives in services. For trivial CRUD, keep it light; do not create six files where two will do.
4. **Money is stored as integers (paise), never floats.** All GST, discount, service charge, and round-off math happens in one shared, well-tested money utility.
5. **Transactions where correctness matters.** Use MongoDB transactions for table merge/split, order-to-bill, payments, and refunds.
6. **Offline tolerance is a first-class requirement.** Restaurant internet is unreliable. Design so that taking orders, sending KOTs, and printing bills degrade gracefully when the connection drops (client-side queue, idempotency keys, sync on reconnect). Decide the exact scope per sprint.
7. **Thermal printing** cannot be done from the cloud directly. Plan for browser printing (ESC/POS or print CSS) first, and a lightweight local print agent later.
8. **Observability and security basics from Sprint 1:** structured logging, central error handling, rate limiting, audit log for sensitive actions, RBAC on every route.

---

# Development Rules

- TypeScript everywhere, SOLID, reusable components, composition over duplication.
- Validate every request. Handle errors consistently with one error format.
- Every API documented (OpenAPI).
- Write tests alongside features: unit tests for services and the money utility, integration tests for APIs.
- Proper Git history: small commits, conventional commit messages, one branch per feature.

---

# Product Roadmap

## Sprint 1 - Foundation: Auth, Tenant & Restaurant Setup
Owner signup, email verification, login, forgot/reset password, refresh token, logout, restaurant profile (name, GST, FSSAI, address, phone, email, logo), first branch (timezone, currency), owner dashboard shell, roles (OWNER, MANAGER, WAITER, CASHIER, CHEF, ADMIN), tenant-scoped repository base, logging, error handling, CI pipeline.
**Deliverable:** Owner creates an account, a restaurant and a branch, then lands on the dashboard. Tenancy is already enforced in the data layer.

## Sprint 2 - Menu Management
Categories, menu items, variants, prices, GST, availability, images (S3), bulk Excel import.
**Deliverable:** Restaurant can build its complete menu.

## Sprint 3 - Table Management
Floors, tables, capacity, status (available/occupied/reserved), merge, split, reservations, live availability.
**Deliverable:** Interactive live floor plan.

## Sprint 4 - Orders, KOT & Kitchen
Dine-in, takeaway, KOT, Socket.IO real-time updates, order status flow (placed -> preparing -> ready -> served), kitchen dashboard, offline-tolerant order taking.
**Deliverable:** Orders reach the kitchen instantly and status updates are real time.

## Sprint 5 - Billing & GST
Discounts, CGST/SGST, service charge, tips, round-off, invoice numbering, invoice generation, thermal print support.
**Deliverable:** GST-compliant invoices.

## Sprint 6 - Payments
Cash, UPI, card, split payment, refunds, payment history, day-end cash reconciliation.
**Deliverable:** Complete payment lifecycle.

### >>> PILOT GATE (after Sprint 6) <<<
Deploy to one real restaurant and run it for real service. Collect feedback and fix issues before building further. Sprints 7+ are planned against what the pilot teaches us.

## Sprint 7 - Dashboard & Reports
Daily/weekly/monthly sales, top-selling items, staff performance, GST/tax reports, profit reports.
**Deliverable:** Business analytics dashboard.

## Sprint 8 - Inventory
Stock items, recipes/consumption per menu item, purchase entries, low-stock alerts, wastage.
**Deliverable:** Stock tracked automatically from sales.

## Sprint 9 - Customers & Offers
Customer records, order history, loyalty basics, coupons, offers/discount rules.
**Deliverable:** Repeat-customer and promotion tooling.

## Sprint 10 - AI Features
Sales forecasting, demand forecasting, inventory prediction, AI restaurant assistant, smart menu recommendations, AI insights, voice billing (future). Built on the real data collected in earlier sprints.
**Deliverable:** AI-powered restaurant insights.

## Sprint 11 - SaaS Platform
Subscription plans, platform billing, super admin panel, multiple restaurants and branches per owner, custom domains, feature flags, tenant onboarding, usage limits, tenant-isolation audit.
**Deliverable:** A SaaS platform that can serve thousands of restaurants.

---

# Expected Output (per sprint)

Keep it concise and decision-focused; no filler. Cover:

1. Product requirements
2. User stories
3. Functional and non-functional requirements
4. Database schema (with tenant/branch scoping and indexes)
5. API design
6. Folder structure
7. UI/UX recommendations
8. Architecture diagram (Markdown / Mermaid)
9. Security considerations
10. Testing strategy
11. Deployment plan
12. Risks, trade-offs, and future improvements

# Working Process

- Do not generate all code at once. Build one sprint at a time.
- Wait for my approval before moving to the next sprint.
- When I say **"Start Sprint 1"**, begin with architecture, database design, user stories, APIs, and an implementation plan. Do not write code until I approve the plan.
- If a requirement is ambiguous or a decision is risky, ask me before assuming.
