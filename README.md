# ComplianceOS

**The operating system for continuous regulatory compliance.**

ComplianceOS connects regulatory updates to concrete organizational action and verifiable audit trails:

`Regulatory Change → Applicability → Obligation → Impact → Action → Evidence → Verification → Audit Trail`

## Key Capabilities

- **Multi-Tenant Organization Workspaces**: Strict `organization_id` database isolation across users, profiles, documents, regulations, controls, evidence, and audit logs.
- **Regulatory Diff & Applicability Engine**: Side-by-side clause diffs paired with company-profile-grounded applicability assessments and source citations.
- **Impact Mapping & Knowledge Graph**: Interactive lineage visualization connecting regulations, obligations, controls, policies, systems, and remediation tasks.
- **Human-in-the-Loop Policy Diffs**: AI-recommended policy edits require explicit Compliance Officer or Admin approval (`Approve`, `Reject`, `Request Changes`).
- **Evidence & Verification ("Prove It")**: File and configuration upload, Gemini 4 Hydrogen decision-support assessment, human verification sign-off, and completion tracking.
- **ComplianceOS MCP Server & Guardrails**: Organization-scoped MCP endpoints (`/api/mcp/tools`, `/api/mcp/call`) and deterministic evaluation checks (`/api/evals`).
- **Platform Admin Console (`/admin/login`)**: Aggregate multi-tenant metrics without exposing private tenant document contents.

## Running Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Click **One-Click Demo — BanglaPay Technologies Ltd.** on the sign-in screen to walk through the seeded Bangladesh Bank Circular `PSD-09/2026` retention narrative.

## Authentication & Environment Setup

ComplianceOS uses server-side session tokens (cryptographically random 32-byte tokens stored as HMAC-SHA256 digests in SQLite) and `scrypt` per-user salted password hashes. Session tokens are held in JavaScript memory on the client and never written to `localStorage` or `sessionStorage`.

### Environment Variables

Configure runtime variables in `.env` (never commit `.env`; copy from `.env.example`):

- `SESSION_SECRET`: Cryptographic secret used for HMAC-SHA256 session token hashing (`openssl rand -hex 32`).
  - **Development**: If omitted, the server generates an ephemeral random key per process and logs a startup warning.
  - **Production (`NODE_ENV=production`)**: Required (minimum 16 characters). The server refuses to start without it.
- `ADMIN_USERNAME` & `ADMIN_PASSWORD`: Credentials for the Platform Admin Portal (`/admin/login` or the **Admin Login** tab).
- `DEMO_USER_PASSWORD`: Optional password override for the seeded demo user (`demo@complianceos.local`).
- `ENABLE_DEMO_AUTH`: Controls hackathon/demo auth shortcuts (`true` by default in development, `false` by default in `NODE_ENV=production`).
- `GEMINI_API_KEY`: Server-side API key for Gemini regulatory applicability, action planning, and evidence evaluation.
- `PORT`: HTTP port (defaults to `3000`).
- `NODE_ENV`: Set to `development` locally or `production` for hardened deployments.

### Development vs. Production Behavior

- **Development / Hackathon Mode (`ENABLE_DEMO_AUTH=true`, `NODE_ENV !== production`)**:
  - The **User Login** tab prefills `demo@complianceos.local` (accepts any non-empty password) and provides the **One-Click Demo** launcher (`POST /api/auth/demo`).
  - The **Admin Login** tab prefills `test_123` (accepts any non-empty password).
  - First-run `POST /api/auth/admin/claim` is permitted only while no `ADMIN_PASSWORD` is configured and `platform_admins` is empty.
- **Production Mode (`NODE_ENV=production`)**:
  - Demo shortcuts (`/api/auth/demo`, `demo@complianceos.local` passwordless bypass, `test_123` bypass, and `/api/auth/admin/claim`) are disabled by default unless `ENABLE_DEMO_AUTH=true` is explicitly set.
  - All user logins require strict `scrypt` password verification, and platform admin logins require matching `ADMIN_USERNAME` / `ADMIN_PASSWORD` (or a claimed hashed admin record).
  - `SESSION_SECRET` is strictly enforced at startup.

### Session Expiration & Security

- Sessions expire after 24 hours (`expires_at` enforced on every authenticated request; expired rows are purged automatically).
- `POST /api/auth/logout` immediately revokes the active session token.
- Changing a user's password via `POST /api/auth/change-password` or `PATCH /api/users/:id/password` invalidates all prior active sessions for that user.
- Every workspace API query derives `organization_id` strictly from the authenticated server session, keeping customer workspaces and the aggregate Platform Admin Portal isolated.

