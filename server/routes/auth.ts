import crypto from 'node:crypto';
import { Router } from 'express';
import { db } from '../db.ts';
import { seedStarterWorkspaceForNewOrg } from '../seed.ts';
import {
  constantTimeEquals,
  createSession,
  extractBearerToken,
  hashPassword,
  isDemoAuthEnabled,
  logAuditEvent,
  resolveAuthFromToken,
  revokeAllUserSessions,
  revokeSession,
  verifyPassword,
} from '../services/auth.ts';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const authRouter = Router();

authRouter.post('/signup', (req, res) => {
  const { fullName, companyName, email, password, country, industry } = req.body ?? {};
  if (
    typeof fullName !== 'string' ||
    typeof companyName !== 'string' ||
    typeof email !== 'string' ||
    typeof password !== 'string'
  ) {
    res.status(400).json({ error: 'All required fields must be valid text values.' });
    return;
  }

  const trimmedName = fullName.trim();
  const trimmedCompany = companyName.trim();
  const normalizedEmail = email.trim().toLowerCase();

  if (
    !trimmedName ||
    trimmedName.length > 120 ||
    !trimmedCompany ||
    trimmedCompany.length > 160 ||
    !normalizedEmail ||
    normalizedEmail.length > 254 ||
    !EMAIL_REGEX.test(normalizedEmail)
  ) {
    res.status(400).json({ error: 'Please provide a valid full name, company name, and work email address.' });
    return;
  }

  if (password.length < 8 || password.length > 128) {
    res.status(400).json({ error: 'Password must be between 8 and 128 characters.' });
    return;
  }

  if ((country !== undefined && typeof country !== 'string') || (industry !== undefined && typeof industry !== 'string')) {
    res.status(400).json({ error: 'Country and industry must be text values.' });
    return;
  }

  const existingUser = db.prepare(`SELECT id FROM users WHERE LOWER(email) = ?`).get(normalizedEmail);
  if (existingUser) {
    res.status(409).json({ error: 'An account with this work email already exists.' });
    return;
  }

  const existingOrg = db
    .prepare(`SELECT id FROM organizations WHERE LOWER(TRIM(name)) = LOWER(?)`)
    .get(trimmedCompany);
  if (existingOrg) {
    res.status(409).json({ error: 'An organization with this name already exists.' });
    return;
  }

  const orgId = `org_${crypto.randomUUID().slice(0, 10)}`;
  const userId = `usr_${crypto.randomUUID().slice(0, 10)}`;
  const now = new Date().toISOString();
  const orgCountry = typeof country === 'string' && country.trim() ? country.trim().slice(0, 80) : 'Bangladesh';
  const orgIndustry =
    typeof industry === 'string' && industry.trim() ? industry.trim().slice(0, 120) : 'Financial Technology';

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO organizations (
        id, name, country, industry, size, operating_jurisdictions, business_description, onboarding_completed, is_demo, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`
    ).run(
      orgId,
      trimmedCompany,
      orgCountry,
      orgIndustry,
      '50-200 employees',
      JSON.stringify([orgCountry]),
      `${trimmedCompany} enterprise compliance workspace.`,
      now
    );

    db.prepare(
      `INSERT INTO users (id, organization_id, full_name, email, password_hash, role, department, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'org_admin', 'Compliance & Governance', 'Active', ?)`
    ).run(userId, orgId, trimmedName, normalizedEmail, hashPassword(password), now);

    seedStarterWorkspaceForNewOrg({
      organizationId: orgId,
      companyName: trimmedCompany,
      country: orgCountry,
      industry: orgIndustry,
      actorName: trimmedName,
    });

    logAuditEvent({
      organizationId: orgId,
      actorName: trimmedName,
      actorRole: 'org_admin',
      action: 'User signed up',
      objectType: 'User',
      objectId: userId,
      objectLabel: normalizedEmail,
      previousState: 'None',
      newState: 'Active (org_admin)',
      sourceRef: 'Web Signup',
    });

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const token = createSession({
    userId,
    organizationId: orgId,
    isPlatformAdmin: false,
  });

  const org = db.prepare(`SELECT * FROM organizations WHERE id = ?`).get(orgId);
  res.status(201).json({
    token,
    user: {
      id: userId,
      organizationId: orgId,
      fullName: trimmedName,
      email: normalizedEmail,
      role: 'org_admin',
      department: 'Compliance & Governance',
    },
    organization: org,
  });
});

authRouter.post('/login', (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    res.status(400).json({ error: 'Work email and password are required.' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!EMAIL_REGEX.test(normalizedEmail)) {
    res.status(400).json({ error: 'Please enter a valid work email address.' });
    return;
  }

  const user = db
    .prepare(
      `SELECT id, organization_id, full_name, email, password_hash, role, department, status
       FROM users WHERE LOWER(email) = ?`
    )
    .get(normalizedEmail) as
    | {
        id: string;
        organization_id: string;
        full_name: string;
        email: string;
        password_hash: string;
        role: string;
        department: string;
        status: string;
      }
    | undefined;

  if (!user) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  const allowDemoBypass =
    isDemoAuthEnabled() &&
    (normalizedEmail === 'demo@complianceos.local' || normalizedEmail === 'deltapay@complianceos.local');
  if (!allowDemoBypass && !verifyPassword(password, user.password_hash)) {
    logAuditEvent({
      organizationId: user.organization_id,
      actorName: user.full_name,
      actorRole: user.role,
      action: 'Failed login attempt',
      objectType: 'Session',
      objectId: user.id,
      objectLabel: user.email,
      previousState: 'Signed Out',
      newState: 'Authentication Rejected',
      sourceRef: 'Web Auth',
    });
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  if (user.status !== 'Active') {
    res.status(403).json({ error: 'Account is inactive. Contact your organization administrator.' });
    return;
  }

  const token = createSession({
    userId: user.id,
    organizationId: user.organization_id,
    isPlatformAdmin: false,
  });

  const org = db.prepare(`SELECT * FROM organizations WHERE id = ?`).get(user.organization_id);
  logAuditEvent({
    organizationId: user.organization_id,
    actorName: user.full_name,
    actorRole: user.role,
    action: 'User signed in',
    objectType: 'Session',
    objectId: user.id,
    objectLabel: user.email,
    previousState: 'Signed Out',
    newState: 'Signed In',
    sourceRef: allowDemoBypass ? 'Web Auth (Demo Mode)' : 'Web Auth',
  });

  res.json({
    token,
    user: {
      id: user.id,
      organizationId: user.organization_id,
      fullName: user.full_name,
      email: user.email,
      role: user.role,
      department: user.department,
    },
    organization: org,
  });
});

authRouter.post('/demo', (_req, res) => {
  if (!isDemoAuthEnabled()) {
    res.status(403).json({ error: 'One-click demo access is disabled in production mode.' });
    return;
  }

  const demoUser = db
    .prepare(`SELECT id, organization_id, full_name, email, role, department, status FROM users WHERE email = ?`)
    .get('demo@complianceos.local') as
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

  if (!demoUser || demoUser.status !== 'Active') {
    res.status(404).json({ error: 'Demo organization is not initialized.' });
    return;
  }

  const token = createSession({
    userId: demoUser.id,
    organizationId: demoUser.organization_id,
    isPlatformAdmin: false,
  });
  const org = db.prepare(`SELECT * FROM organizations WHERE id = ?`).get(demoUser.organization_id);

  logAuditEvent({
    organizationId: demoUser.organization_id,
    actorName: demoUser.full_name,
    actorRole: demoUser.role,
    action: 'Demo session started',
    objectType: 'Session',
    objectId: demoUser.id,
    objectLabel: demoUser.email,
    previousState: 'Signed Out',
    newState: 'Signed In (Demo)',
    sourceRef: 'Demo Workspace Launcher',
  });

  res.json({
    token,
    user: {
      id: demoUser.id,
      organizationId: demoUser.organization_id,
      fullName: demoUser.full_name,
      email: demoUser.email,
      role: demoUser.role,
      department: demoUser.department,
    },
    organization: org,
  });
});

authRouter.post('/logout', (req, res) => {
  const token = extractBearerToken(req);
  if (token) {
    const auth = resolveAuthFromToken(token);
    if (auth && !auth.isPlatformAdmin && auth.organizationId && auth.userId) {
      logAuditEvent({
        organizationId: auth.organizationId,
        actorName: auth.fullName,
        actorRole: auth.role,
        action: 'User signed out',
        objectType: 'Session',
        objectId: auth.userId,
        objectLabel: auth.email,
        previousState: 'Signed In',
        newState: 'Signed Out',
        sourceRef: 'Web Auth',
      });
    } else if (auth && auth.isPlatformAdmin) {
      console.info(`[Auth] Platform admin signed out: ${auth.fullName}`);
    }
    revokeSession(token);
  }
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }
  const auth = resolveAuthFromToken(token);
  if (!auth) {
    res.status(401).json({ error: 'Session expired or invalid.' });
    return;
  }
  if (auth.isPlatformAdmin) {
    res.json({ auth, organization: null });
    return;
  }
  const org = db.prepare(`SELECT * FROM organizations WHERE id = ?`).get(auth.organizationId);
  if (!org) {
    res.status(401).json({ error: 'Organization workspace not found.' });
    return;
  }
  res.json({ auth, organization: org });
});

authRouter.post('/change-password', (req, res) => {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const auth = resolveAuthFromToken(token);
  if (!auth || auth.isPlatformAdmin || !auth.userId || !auth.organizationId) {
    res.status(401).json({ error: 'Valid workspace session required.' });
    return;
  }

  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== 'string' || !currentPassword) {
    res.status(400).json({ error: 'Current password is required.' });
    return;
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
    res.status(400).json({ error: 'New password must be between 8 and 128 characters.' });
    return;
  }
  if (currentPassword === newPassword) {
    res.status(400).json({ error: 'New password must differ from current password.' });
    return;
  }

  const user = db
    .prepare(`SELECT id, email, password_hash FROM users WHERE id = ? AND organization_id = ?`)
    .get(auth.userId, auth.organizationId) as
    | { id: string; email: string; password_hash: string }
    | undefined;

  if (!user) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  if (!verifyPassword(currentPassword, user.password_hash)) {
    res.status(401).json({ error: 'Current password is incorrect.' });
    return;
  }

  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ? AND organization_id = ?`).run(
    hashPassword(newPassword),
    user.id,
    auth.organizationId
  );

  // Invalidate all previous sessions and issue a fresh session token
  revokeAllUserSessions(user.id);
  const newToken = createSession({
    userId: user.id,
    organizationId: auth.organizationId,
    isPlatformAdmin: false,
  });

  logAuditEvent({
    organizationId: auth.organizationId,
    actorName: auth.fullName,
    actorRole: auth.role,
    action: 'Password changed',
    objectType: 'User',
    objectId: user.id,
    objectLabel: user.email,
    previousState: 'Credential active',
    newState: 'Password updated; previous sessions invalidated',
    sourceRef: 'Workspace Settings',
  });

  res.json({ ok: true, token: newToken });
});

// Platform Admin Status, Claim & Login
authRouter.get('/admin/status', (_req, res) => {
  const claimedCount = (db.prepare(`SELECT COUNT(*) as c FROM platform_admins`).get() as { c: number }).c;
  const envConfigured = Boolean(process.env.ADMIN_USERNAME?.trim() && process.env.ADMIN_PASSWORD?.trim());
  const demoMode = isDemoAuthEnabled();
  res.json({
    adminConfigured: envConfigured || claimedCount > 0 || demoMode,
    mode: demoMode ? 'hackathon' : 'production',
  });
});

authRouter.post('/admin/claim', (req, res) => {
  if (!isDemoAuthEnabled()) {
    res.status(403).json({ error: 'Admin claiming is disabled in production. Configure ADMIN_USERNAME and ADMIN_PASSWORD.' });
    return;
  }
  if (process.env.ADMIN_PASSWORD?.trim()) {
    res.status(403).json({ error: 'Platform administrator credentials are already configured via environment.' });
    return;
  }
  const existingAdmins = (db.prepare(`SELECT COUNT(*) as c FROM platform_admins`).get() as { c: number }).c;
  if (existingAdmins > 0) {
    res.status(403).json({ error: 'Platform administrator account has already been claimed.' });
    return;
  }

  const { username, password } = req.body ?? {};
  if (
    typeof username !== 'string' ||
    typeof password !== 'string' ||
    username.trim().length < 3 ||
    password.length < 8
  ) {
    res.status(400).json({ error: 'Username (min 3 chars) and password (min 8 chars) are required.' });
    return;
  }

  const cleanUsername = username.trim();
  const id = `adm_${crypto.randomUUID().slice(0, 10)}`;
  db.prepare(`INSERT INTO platform_admins (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)`).run(
    id,
    cleanUsername,
    hashPassword(password),
    new Date().toISOString()
  );

  const token = createSession({
    userId: null,
    organizationId: null,
    isPlatformAdmin: true,
    adminUsername: cleanUsername,
  });

  console.info(`[Auth] Platform admin claimed in demo/hackathon mode: ${cleanUsername}`);
  res.status(201).json({
    token,
    admin: { username: cleanUsername, role: 'platform_admin' },
  });
});

authRouter.post('/admin/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
    res.status(400).json({ error: 'Username and password are required.' });
    return;
  }

  const trimmedUsername = username.trim();
  const envUsername = process.env.ADMIN_USERNAME?.trim() || 'admin';
  const envPassword = process.env.ADMIN_PASSWORD?.trim();
  const demoMode = isDemoAuthEnabled();

  let authenticated = false;

  // 1. Strict environment credential check (works in both production & development)
  if (envPassword && constantTimeEquals(trimmedUsername, envUsername) && constantTimeEquals(password, envPassword)) {
    authenticated = true;
  }

  // 2. Database-stored scrypt-hashed platform_admins check
  if (!authenticated) {
    const adminRow = db
      .prepare(`SELECT id, username, password_hash FROM platform_admins WHERE username = ?`)
      .get(trimmedUsername) as { id: string; username: string; password_hash: string } | undefined;

    if (adminRow && verifyPassword(password, adminRow.password_hash)) {
      authenticated = true;
    }
  }

  // 3. Explicit Hackathon/Demo Mode login for test_123 (isolated strictly to non-production / explicit demo mode)
  if (!authenticated && demoMode && constantTimeEquals(trimmedUsername, 'test_123')) {
    authenticated = true;
  }

  if (!authenticated) {
    console.warn(`[Auth] Rejected platform admin login attempt for username: ${trimmedUsername}`);
    res.status(401).json({ error: 'Invalid administrator credentials.' });
    return;
  }

  const token = createSession({
    userId: null,
    organizationId: null,
    isPlatformAdmin: true,
    adminUsername: trimmedUsername,
  });
  console.info(`[Auth] Platform admin signed in (${demoMode ? 'hackathon' : 'production'} mode): ${trimmedUsername}`);
  res.json({ token, admin: { username: trimmedUsername, role: 'platform_admin' } });
});

