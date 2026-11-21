import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from '../db.ts';

export interface AuthContext {
  userId: string | null;
  organizationId: string | null;
  fullName: string;
  email: string;
  role: string;
  department: string;
  isPlatformAdmin: boolean;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

let ephemeralDevSecretNoticeLogged = false;

function resolveSessionHmacKey(): string {
  const configured = process.env.SESSION_SECRET?.trim();
  const isProd = process.env.NODE_ENV === 'production';

  if (configured && configured.length >= 16) {
    return configured;
  }

  if (isProd) {
    throw new Error(
      'FATAL: SESSION_SECRET environment variable must be set (minimum 16 characters) when NODE_ENV=production.'
    );
  }

  if (!ephemeralDevSecretNoticeLogged) {
    ephemeralDevSecretNoticeLogged = true;
    console.warn(
      '[Auth] SESSION_SECRET is not set (or < 16 chars); using an ephemeral development fallback secret.'
    );
  }
  return crypto.randomBytes(32).toString('hex');
}

const SESSION_HMAC_KEY = resolveSessionHmacKey();
const SESSION_TTL_MS = 1000 * 60 * 60 * 24;

export function validateAuthConfig(): void {
  if (!SESSION_HMAC_KEY || SESSION_HMAC_KEY.length < 16) {
    throw new Error('Authentication session signing key is invalid.');
  }
}

export function isDemoAuthEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') {
    return process.env.ENABLE_DEMO_AUTH === 'true';
  }
  return process.env.ENABLE_DEMO_AUTH !== 'false';
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function hashToken(rawToken: string): string {
  return crypto.createHmac('sha256', SESSION_HMAC_KEY).update(rawToken).digest('hex');
}

export function createSession(params: {
  userId: string | null;
  organizationId: string | null;
  isPlatformAdmin: boolean;
  adminUsername?: string | null;
}): string {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, organization_id, is_platform_admin, admin_username, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    tokenHash,
    params.userId,
    params.organizationId,
    params.isPlatformAdmin ? 1 : 0,
    params.adminUsername ?? null,
    expiresAt,
    now.toISOString()
  );

  return rawToken;
}

export function revokeSession(rawToken: string): void {
  const tokenHash = hashToken(rawToken);
  db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(tokenHash);
}

export function revokeAllUserSessions(userId: string, exceptRawToken?: string): void {
  if (exceptRawToken) {
    const keepHash = hashToken(exceptRawToken);
    db.prepare(`DELETE FROM sessions WHERE user_id = ? AND token_hash != ?`).run(userId, keepHash);
    return;
  }
  db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

export function resolveAuthFromToken(rawToken: string): AuthContext | null {
  const tokenHash = hashToken(rawToken);
  const session = db
    .prepare(
      `SELECT token_hash, user_id, organization_id, is_platform_admin, admin_username, expires_at
       FROM sessions WHERE token_hash = ?`
    )
    .get(tokenHash) as
    | {
        token_hash: string;
        user_id: string | null;
        organization_id: string | null;
        is_platform_admin: number;
        admin_username: string | null;
        expires_at: string;
      }
    | undefined;

  if (!session) return null;
  const expiresAtMs = new Date(session.expires_at).getTime();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(tokenHash);
    return null;
  }

  if (session.is_platform_admin === 1) {
    return {
      userId: null,
      organizationId: null,
      fullName: session.admin_username || 'Platform Administrator',
      email: 'platform-admin@complianceos.internal',
      role: 'platform_admin',
      department: 'Platform Operations',
      isPlatformAdmin: true,
    };
  }

  if (!session.user_id || !session.organization_id) return null;
  const user = db
    .prepare(
      `SELECT id, organization_id, full_name, email, role, department, status
       FROM users WHERE id = ? AND organization_id = ?`
    )
    .get(session.user_id, session.organization_id) as
    | {
        id: string;
        organization_id: string;
        full_name: string;
        email: string;
        role: string;
        department: string;
        status: string;
      }
    | undefined;

  if (!user || user.status !== 'Active') return null;

  return {
    userId: user.id,
    organizationId: user.organization_id,
    fullName: user.full_name,
    email: user.email,
    role: user.role,
    department: user.department,
    isPlatformAdmin: false,
  };
}

export function requireWorkspaceAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const auth = resolveAuthFromToken(token);
  if (!auth || auth.isPlatformAdmin || !auth.organizationId || !auth.userId) {
    res.status(401).json({ error: 'Valid organization session required.' });
    return;
  }
  req.auth = auth;
  next();
}

export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Platform administrator authentication required.' });
    return;
  }
  const auth = resolveAuthFromToken(token);
  if (!auth || !auth.isPlatformAdmin) {
    res.status(403).json({ error: 'Platform administrator permissions required.' });
    return;
  }
  req.auth = auth;
  next();
}

export function requireOrgRole(allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!allowedRoles.includes(req.auth.role)) {
      res.status(403).json({
        error: `This action requires one of the following roles: ${allowedRoles.join(', ')}.`,
      });
      return;
    }
    next();
  };
}

export function logAuditEvent(params: {
  organizationId: string;
  actorName: string;
  actorRole: string;
  action: string;
  objectType: string;
  objectId: string;
  objectLabel: string;
  previousState: string;
  newState: string;
  sourceRef: string;
}): void {
  db.prepare(
    `INSERT INTO audit_events (
      id, organization_id, timestamp, actor_name, actor_role, action,
      object_type, object_id, object_label, previous_state, new_state, source_ref
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `aud_${crypto.randomUUID().slice(0, 12)}`,
    params.organizationId,
    new Date().toISOString(),
    params.actorName,
    params.actorRole,
    params.action,
    params.objectType,
    params.objectId,
    params.objectLabel,
    params.previousState,
    params.newState,
    params.sourceRef
  );
}
