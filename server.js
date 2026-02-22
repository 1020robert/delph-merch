require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const OWNER_EMAIL = '1020rjl@gmail.com';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
const COOKIE_SECURE =
  String(process.env.COOKIE_SECURE || process.env.NODE_ENV === 'production').toLowerCase() ===
  'true';

const USERS_PATH = path.join(DATA_DIR, 'users.json');
const ORDERS_PATH = path.join(DATA_DIR, 'orders.json');

const SESSION_COOKIE = 'club_session';
const sessions = new Map();

const SIGNUP_TOKEN_TTL_MS = 1000 * 60 * 15;

const MERCH_ITEMS = [
  {
    id: 'glass',
    name: 'Engraved Glass',
    price: 8,
    image: '/glass.JPG'
  }
];

let googleClient;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

function ensureDataFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '[]', 'utf8');
  }
}

function readJsonArray(filePath) {
  ensureDataFile(filePath);
  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJsonArray(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function signValue(raw) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(raw).digest('hex');
}

function safeEqualStrings(a, b) {
  const aBuf = Buffer.from(String(a), 'utf8');
  const bBuf = Buffer.from(String(b), 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function createSignedToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = signValue(encoded);
  return `${encoded}.${signature}`;
}

function verifySignedToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) {
    return { valid: false, reason: 'Malformed token' };
  }

  const [encoded, signature] = parts;
  const expectedSignature = signValue(encoded);
  if (!safeEqualStrings(signature, expectedSignature)) {
    return { valid: false, reason: 'Signature mismatch' };
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    return { valid: true, payload };
  } catch {
    return { valid: false, reason: 'Invalid token payload' };
  }
}

function createSession(userId) {
  const raw = `${userId}:${Date.now()}:${crypto.randomBytes(24).toString('hex')}`;
  const signature = signValue(raw);
  const token = Buffer.from(`${raw}:${signature}`).toString('base64url');
  sessions.set(token, { userId, createdAt: new Date().toISOString() });
  return token;
}

function setSessionCookie(res, userId) {
  const token = createSession(userId);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: 1000 * 60 * 60 * 24 * 7
  });
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
    approved: user.approved !== false,
    isOwner: isOwnerUser(user)
  };
}

function getGoogleClient() {
  if (!GOOGLE_CLIENT_ID) return null;
  if (!googleClient) {
    googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
  }
  return googleClient;
}

function getUserFromRequest(req) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token || !sessions.has(token)) return null;

  const session = sessions.get(token);
  const users = readJsonArray(USERS_PATH);
  const user = users.find((u) => u.id === session.userId) || null;

  if (!user) {
    sessions.delete(token);
    return null;
  }

  return user;
}

function authRequired(req, res, next) {
  const user = getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Not signed in' });
  }
  req.user = user;
  return next();
}

function ownerRequired(req, res, next) {
  if (!isOwnerUser(req.user)) {
    return res.status(403).json({ error: 'Owner access only' });
  }
  return next();
}

function buildTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';

  if (!host || !user || !pass || !OWNER_EMAIL) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });
}

function createSignupToken({ email, sub, name }) {
  return createSignedToken({
    type: 'signup',
    email,
    sub,
    name,
    iat: Date.now()
  });
}

function verifySignupToken(token) {
  const parsed = verifySignedToken(token);
  if (!parsed.valid) return parsed;

  const payload = parsed.payload;
  if (payload.type !== 'signup') {
    return { valid: false, reason: 'Wrong token type' };
  }

  if (!Number.isFinite(payload.iat) || Date.now() - payload.iat > SIGNUP_TOKEN_TTL_MS) {
    return { valid: false, reason: 'Signup session expired. Start Google sign-in again.' };
  }

  if (!payload.email) {
    return { valid: false, reason: 'Invalid signup payload' };
  }

  return { valid: true, payload };
}

async function maybeSendOrderEmail(order, user, item) {
  const transport = buildTransport();
  if (!transport) {
    return { emailed: false, reason: 'Email not configured' };
  }

  const subject = `New Club Merch order: ${item.name}`;
  const body = [
    'A new merch order was placed.',
    '',
    `Name: ${user.name}`,
    `Email: ${user.email}`,
    `Item: ${item.name}`,
    `Include Initials: ${order.includeInitials ? 'Yes' : 'No'}`,
    `Quantity: ${order.quantity}`,
    `Venmo Agreed: ${order.venmoAgreed ? 'Yes' : 'No'}`,
    `Ordered At: ${order.createdAt}`,
    `Order ID: ${order.id}`
  ].join('\n');

  await transport.sendMail({
    from: process.env.SMTP_USER,
    to: OWNER_EMAIL,
    subject,
    text: body
  });

  return { emailed: true };
}

async function maybeSendSignupNotificationEmail(user) {
  const transport = buildTransport();
  if (!transport) {
    return { emailed: false, reason: 'Email not configured' };
  }

  const subject = `New signup: ${user.firstName} ${user.lastName}`;
  const body = [
    'A new user signed up via Google.',
    '',
    `First Name: ${user.firstName}`,
    `Last Name: ${user.lastName}`,
    `Initials: ${user.initials}`,
    `Email: ${user.email}`,
    `Signed up at: ${new Date().toISOString()}`
  ].join('\n');

  await transport.sendMail({
    from: process.env.SMTP_USER,
    to: OWNER_EMAIL,
    subject,
    text: body
  });

  return { emailed: true };
}

app.get('/api/config', (_req, res) => {
  return res.json({
    googleClientId: GOOGLE_CLIENT_ID || null
  });
});

app.post('/api/auth/google', async (req, res) => {
  const { credential } = req.body || {};
  if (!credential) {
    return res.status(400).json({ error: 'Missing Google credential token' });
  }

  const client = getGoogleClient();
  if (!client) {
    return res.status(503).json({ error: 'Google login is not configured yet' });
  }

  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID
    });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: 'Google token verification failed' });
  }

  const email = String(payload?.email || '').trim().toLowerCase();
  const googleName = String(payload?.name || 'Club Member').trim();
  const emailVerified = Boolean(payload?.email_verified);
  const sub = String(payload?.sub || '').trim();

  if (!email || !emailVerified) {
    return res.status(400).json({ error: 'Google account email is not verified' });
  }

  const users = readJsonArray(USERS_PATH);
  const user = users.find((u) => u.email === email);

  if (!user) {
    const signupToken = createSignupToken({ email, sub, name: googleName });
    return res.json({
      signupRequired: true,
      signupToken,
      email,
      suggestedProfile: profileSuggestion(googleName)
    });
  }

  let changed = false;
  if (user.provider !== 'google') {
    user.provider = 'google';
    changed = true;
  }
  if (sub && user.googleSub !== sub) {
    user.googleSub = sub;
    changed = true;
  }
  if (user.approved === false) {
    user.approved = true;
    user.approvedAt = user.approvedAt || new Date().toISOString();
    changed = true;
  }
  if (typeof user.approved !== 'boolean') {
    user.approved = true;
    user.approvedAt = user.approvedAt || new Date().toISOString();
    changed = true;
  }

  if (!profileIsComplete(user)) {
    if (changed) {
      writeJsonArray(USERS_PATH, users);
    }

    const fallbackName = user.name || googleName;
    const signupToken = createSignupToken({ email, sub, name: fallbackName });
    return res.json({
      signupRequired: true,
      signupToken,
      email,
      suggestedProfile: {
        firstName: user.firstName || profileSuggestion(fallbackName).firstName,
        lastName: user.lastName || profileSuggestion(fallbackName).lastName,
        initials: user.initials || profileSuggestion(fallbackName).initials
      }
    });
  }

  if (changed) {
    writeJsonArray(USERS_PATH, users);
  }

  setSessionCookie(res, user.id);
  return res.json({ approved: true, user: userPublicShape(user) });
});

app.post('/api/auth/google/signup', async (req, res) => {
  const { signupToken, firstName, lastName, initials } = req.body || {};

  if (!signupToken || !firstName || !lastName || !initials) {
    return res.status(400).json({
      error: 'signupToken, firstName, lastName, and initials are required'
    });
  }

  const verified = verifySignupToken(signupToken);
  if (!verified.valid) {
    return res.status(400).json({ error: verified.reason || 'Invalid signup session' });
  }

  const normalizedFirstName = String(firstName).trim();
  const normalizedLastName = String(lastName).trim();
  const normalizedInitials = normalizeInitials(initials);

  if (!normalizedFirstName || !normalizedLastName) {
    return res.status(400).json({ error: 'First and last name are required' });
  }

  if (!normalizedInitials) {
    return res.status(400).json({ error: 'Initials must be 1-5 letters' });
  }

  const { email, sub } = verified.payload;
  const users = readJsonArray(USERS_PATH);
  let user = users.find((u) => u.email === email);

  if (!user) {
    user = {
      id: crypto.randomUUID(),
      email,
      provider: 'google',
      googleSub: sub || null,
      approved: true,
      approvedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
    users.push(user);
  }

  if (user.approved !== true) {
    user.approved = true;
    user.approvedAt = user.approvedAt || new Date().toISOString();
  }

  user.provider = 'google';
  user.googleSub = sub || user.googleSub || null;
  user.firstName = normalizedFirstName;
  user.lastName = normalizedLastName;
  user.initials = normalizedInitials;
  user.name = `${normalizedFirstName} ${normalizedLastName}`.trim();

  writeJsonArray(USERS_PATH, users);

  let notificationStatus = { emailed: false, reason: 'Email not attempted' };
  try {
    notificationStatus = await maybeSendSignupNotificationEmail(user);
  } catch (err) {
    notificationStatus = { emailed: false, reason: `Email failed: ${err.message}` };
  }

  setSessionCookie(res, user.id);
  return res.json({
    signupComplete: true,
    approved: true,
    notificationStatus,
    user: userPublicShape(user)
  });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies[SESSION_COOKIE];
  if (token) sessions.delete(token);
  res.clearCookie(SESSION_COOKIE);
  return res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
  const user = getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });

  return res.json({ user: userPublicShape(user) });
});

app.get('/api/merch', authRequired, (_req, res) => {
  return res.json({ items: MERCH_ITEMS });
});

app.get('/api/admin/orders', authRequired, ownerRequired, (_req, res) => {
  const orders = readJsonArray(ORDERS_PATH);
  const users = readJsonArray(USERS_PATH);
  const usersById = new Map(users.map((user) => [user.id, user]));

  const enriched = orders.map((order) => {
    if (order.userInitials) return order;
    const user = usersById.get(order.userId);
    return {
      ...order,
      userInitials: user?.initials || ''
    };
  });

  const sorted = [...enriched].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return res.json({ orders: sorted });
});

app.post('/api/orders', authRequired, async (req, res) => {
  const { itemId, quantity, venmoAgreed, includeInitials } = req.body || {};
  const qty = Number(quantity);

  if (!itemId || Number.isNaN(qty)) {
    return res.status(400).json({ error: 'itemId and quantity are required' });
  }

  if (qty < 1 || qty > 50) {
    return res.status(400).json({ error: 'Quantity must be between 1 and 50' });
  }

  if (!venmoAgreed) {
    return res.status(400).json({ error: 'You must agree to pay via Venmo' });
  }

  const item = MERCH_ITEMS.find((x) => x.id === itemId);
  if (!item) {
    return res.status(404).json({ error: 'Merch item not found' });
  }

  const order = {
    id: crypto.randomUUID(),
    itemId: item.id,
    itemName: item.name,
    includeInitials: Boolean(includeInitials),
    quantity: qty,
    venmoAgreed: Boolean(venmoAgreed),
    userId: req.user.id,
    userName: req.user.name,
    userInitials: req.user.initials || '',
    userEmail: req.user.email,
    createdAt: new Date().toISOString()
  };

  const orders = readJsonArray(ORDERS_PATH);
  orders.push(order);
  writeJsonArray(ORDERS_PATH, orders);

  let emailStatus = { emailed: false, reason: 'Email not attempted' };
  try {
    emailStatus = await maybeSendOrderEmail(order, req.user, item);
  } catch (err) {
    emailStatus = { emailed: false, reason: `Email failed: ${err.message}` };
  }

  return res.json({
    success: true,
    order,
    emailStatus
  });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Club Merch site running at http://localhost:${PORT}`);
});
