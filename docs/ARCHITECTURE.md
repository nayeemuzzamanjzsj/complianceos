# ComplianceOS Architecture & Guardrails

## 1. System Overview
ComplianceOS runs as a full-stack TypeScript application:
- **Frontend**: React 19 + Vite + Tailwind CSS v4 (`src/`)
- **Backend**: Express + Node `node:sqlite` (`server.ts`, `server/db.ts`, `server/routes/`)
- **AI Engine**: Server-side `@google/genai` SDK (`gemini-4-hydrogen`) with structured JSON schemas (`server/services/ai.ts`)

## 2. Multi-Tenancy & Security
- Passwords hashed with per-user salted `crypto.scryptSync` and verified via `crypto.timingSafeEqual`.
- Bearer session tokens are HMAC-SHA256 hashed server-side and held strictly in browser memory (never persisted in `localStorage`).
- Every organization-owned SQL table includes `organization_id`, and all workspace queries filter strictly by the authenticated caller's `organizationId`.
- Uploaded files pass extension/MIME checks, size limits (10 MB), and `path.resolve` directory confinement.

## 3. Data Lineage
```text
Regulatory Fixture / Version
  -> Diff Highlights
    -> Applicability Assessment (Profile-Grounded + Citations)
      -> Obligations -> Controls -> Policies & Systems
        -> Remediation Actions -> Evidence Upload
          -> AI Decision Support -> Human Verification -> Audit Event
```

## 4. Guardrails
- ComplianceOS is compliance decision support, not legal certification.
- AI outputs never overwrite policies silently; human approval is enforced before policy status becomes `Approved`.
- Platform Administrators (`/admin/login`) view only aggregate tenant counts; private customer documents remain isolated.
