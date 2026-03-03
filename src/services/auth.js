const crypto = require('crypto');

const {
  COOKIE_SECURE,
  OWNER_EMAIL,
  PASSWORD_GATE_ENABLED,
  SESSION_COOKIE,
  SESSION_SECRET,
  USERS_PATH
} = require('../config');
const { readJsonArray } = require('./storage');

const sessions = new Map();

function signValue(raw) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(raw).digest('hex');
}

function isPasswordVerificationRequired(session) {
  return PASSWORD_GATE_ENABLED && !session?.passwordVerified;
}

function createSession(userId, passwordVerified = !PASSWORD_GATE_ENABLED) {
  const raw = `${userId}:${Date.now()}:${crypto.randomBytes(24).toString('hex')}`;
  const signature = signValue(raw);
  const token = Buffer.from(`${raw}:${signature}`).toString('base64url');
  sessions.set(token, {
    userId,
    passwordVerified: Boolean(passwordVerified),
    createdAt: new Date().toISOString()
  });
  return token;
}

function setSessionCookie(res, userId, passwordVerified = !PASSWORD_GATE_ENABLED) {
  const token = createSession(userId, passwordVerified);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: 1000 * 60 * 60 * 24 * 7
  });
}

function clearSession(token) {
  if (token) sessions.delete(token);
}

function splitName(fullName) {
  const parts = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ')
  };
}

function buildInitials(firstName, lastName) {
  return `${String(firstName || '').charAt(0)}${String(lastName || '').charAt(0)}`.toUpperCase();
}

function normalizeInitials(initials) {
  const normalized = String(initials || '').trim().toUpperCase();
  if (!/^[A-Z]{1,5}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeEmail(email) {
  const normalized = String(email || '')
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function profileIsComplete(user) {
  return Boolean(
    String(user.firstName || '').trim() &&
      String(user.lastName || '').trim() &&
      normalizeInitials(user.initials)
  );
}

function profileSuggestion(preferredName) {
  const split = splitName(preferredName);
  const initials = buildInitials(split.firstName, split.lastName);
  return {
    firstName: split.firstName,
    lastName: split.lastName,
    initials: initials || ''
  };
}

function isOwnerUser(user) {
  return String(user.email || '').trim().toLowerCase() === OWNER_EMAIL;
}

function userPublicShape(user) {
  return {
    id: user.id,
    name: user.name,
    firstName: user.firstName,
    lastName: user.lastName,
    initials: user.initials,
    email: user.email,
    isOwner: isOwnerUser(user)
  };
}

function getAuthContext(req) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token || !sessions.has(token)) return null;

  const session = sessions.get(token);
  const users = readJsonArray(USERS_PATH);
  const user = users.find((u) => u.id === session.userId) || null;

  if (!user) {
    sessions.delete(token);
    return null;
  }

  return { token, session, user };
}

function authRequired(req, res, next) {
  const context = getAuthContext(req);
  if (!context) {
    return res.status(401).json({ error: 'Not signed in' });
  }
  if (isPasswordVerificationRequired(context.session)) {
    return res.status(403).json({ error: 'Password verification required', passwordRequired: true });
  }
  req.user = context.user;
  req.authSession = context.session;
  return next();
}

function ownerRequired(req, res, next) {
  if (!isOwnerUser(req.user)) {
    return res.status(403).json({ error: 'Owner access only' });
  }
  return next();
}

module.exports = {
  sessions,
  isPasswordVerificationRequired,
  setSessionCookie,
  clearSession,
  splitName,
  buildInitials,
  normalizeInitials,
  normalizeEmail,
  profileIsComplete,
  profileSuggestion,
  isOwnerUser,
  userPublicShape,
  getAuthContext,
  authRequired,
  ownerRequired
};
