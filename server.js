const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const OWNER_EMAIL = process.env.OWNER_EMAIL || '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

const USERS_PATH = path.join(__dirname, 'data', 'users.json');
const ORDERS_PATH = path.join(__dirname, 'data', 'orders.json');

const SESSION_COOKIE = 'club_session';
const sessions = new Map();

const MERCH_ITEMS = [
  { id: 'hoodie', name: 'Club Hoodie', price: 40 },
  { id: 'tshirt', name: 'Club T-Shirt', price: 20 },
  { id: 'sticker-pack', name: 'Sticker Pack', price: 8 }
];

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

function ensureDataFile(filePath) {
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

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  return `${salt}:${hash}`;
}

function verifyPassword(password, passwordRecord) {
  const parts = String(passwordRecord).split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHash] = parts;
  const actualHash = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(expectedHash, 'hex'));
}

function createSession(userId) {
  const raw = `${userId}:${Date.now()}:${crypto.randomBytes(24).toString('hex')}`;
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(raw).digest('hex');
  const token = Buffer.from(`${raw}:${signature}`).toString('base64url');
  sessions.set(token, { userId, createdAt: new Date().toISOString() });
  return token;
}

function getUserFromRequest(req) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token || !sessions.has(token)) return null;

  const session = sessions.get(token);
  const users = readJsonArray(USERS_PATH);
  return users.find((u) => u.id === session.userId) || null;
}

function authRequired(req, res, next) {
  const user = getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Not signed in' });
  }
  req.user = user;
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

async function maybeSendOrderEmail(order, user, item) {
  const transport = buildTransport();
  if (!transport) {
    return { emailed: false, reason: 'Email not configured' };
  }

  const subject = `New club merch order: ${item.name}`;
  const body = [
    'A new merch order was placed.',
    '',
    `Name: ${user.name}`,
    `Email: ${user.email}`,
    `Item: ${item.name}`,
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

app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address' });
  }

  if (String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const users = readJsonArray(USERS_PATH);
  const existing = users.find((u) => u.email === normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists' });
  }

  const user = {
    id: crypto.randomUUID(),
    name: String(name).trim(),
    email: normalizedEmail,
    password: createPasswordRecord(String(password)),
    createdAt: new Date().toISOString()
  };

  users.push(user);
  writeJsonArray(USERS_PATH, users);

  const token = createSession(user.id);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 * 7
  });

  return res.json({
    user: { id: user.id, name: user.name, email: user.email }
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const users = readJsonArray(USERS_PATH);
  const user = users.find((u) => u.email === normalizedEmail);

  if (!user || !verifyPassword(String(password), user.password)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = createSession(user.id);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 * 7
  });

  return res.json({
    user: { id: user.id, name: user.name, email: user.email }
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

  return res.json({
    user: { id: user.id, name: user.name, email: user.email }
  });
});

app.get('/api/merch', authRequired, (_req, res) => {
  return res.json({ items: MERCH_ITEMS });
});

app.post('/api/orders', authRequired, async (req, res) => {
  const { itemId, quantity, venmoAgreed } = req.body || {};
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
    quantity: qty,
    venmoAgreed: Boolean(venmoAgreed),
    userId: req.user.id,
    userName: req.user.name,
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
  console.log(`Club merch site running at http://localhost:${PORT}`);
});
