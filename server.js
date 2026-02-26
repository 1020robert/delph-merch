require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const OWNER_EMAIL = '1020rjl@gmail.com';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const SHARED_LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || '9linden';
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
const ensuredDataFiles = new Set();

const MERCH_ITEMS = [
  {
    id: 'torch-hat',
    name: 'Delphic Torch Hat',
    price: 25,
    image: '/hat2.png'
  }
];

app.disable('x-powered-by');
app.use(express.json());
app.use(cookieParser());
app.use(
  express.static(path.join(__dirname, 'public'), {
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-store');
        return;
      }

      if (/\.(?:css|js|png|jpe?g|gif|svg|webp|ico|woff2?|ttf)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=604800');
      }
    }
  })
);

function ensureDataFile(filePath) {
  if (ensuredDataFiles.has(filePath)) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '[]', 'utf8');
  }
  ensuredDataFiles.add(filePath);
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
    approved: user.approved !== false,
    isOwner: isOwnerUser(user)
  };
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

async function maybeSendOrderEmail(order, user, item) {
  const transport = buildTransport();
  if (!transport) {
    return { emailed: false, reason: 'Email not configured' };
  }

  const subject = `New Club Merch pre-order: ${item.name}`;
  const body = [
    'A new merch pre-order was placed.',
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

app.get('/api/config', (_req, res) => {
  return res.json({
    authMode: 'email'
  });
});

app.post('/api/auth/register', (req, res) => {
  const normalizedEmail = normalizeEmail(req.body?.email);
  const normalizedFirstName = String(req.body?.firstName || '').trim();
  const normalizedLastName = String(req.body?.lastName || '').trim();
  const normalizedInitials = normalizeInitials(req.body?.initials);
  const password = String(req.body?.password || '');

  if (!normalizedEmail || !normalizedFirstName || !normalizedLastName || !normalizedInitials) {
    return res.status(400).json({
      error: 'email, firstName, lastName, and initials are required'
    });
  }

  if (password !== SHARED_LOGIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  const users = readJsonArray(USERS_PATH);
  const existingUser = users.find(
    (candidate) => String(candidate.email || '').trim().toLowerCase() === normalizedEmail
  );
  if (existingUser) {
    return res.status(409).json({ error: 'Account already exists. Sign in instead.' });
  }

  const user = {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    provider: 'email',
    firstName: normalizedFirstName,
    lastName: normalizedLastName,
    initials: normalizedInitials,
    name: `${normalizedFirstName} ${normalizedLastName}`.trim(),
    approved: true,
    approvedAt: new Date().toISOString(),
    approvedBy: OWNER_EMAIL,
    createdAt: new Date().toISOString()
  };

  users.push(user);
  writeJsonArray(USERS_PATH, users);

  setSessionCookie(res, user.id);
  return res.json({
    registered: true,
    user: userPublicShape(user)
  });
});

app.post('/api/auth/login', (req, res) => {
  const normalizedEmail = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');

  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  if (password !== SHARED_LOGIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  const users = readJsonArray(USERS_PATH);
  const user = users.find(
    (candidate) => String(candidate.email || '').trim().toLowerCase() === normalizedEmail
  );
  if (!user) {
    return res.status(404).json({ error: 'Account not found. Create an account first.' });
  }

  let changed = false;
  if (user.email !== normalizedEmail) {
    user.email = normalizedEmail;
    changed = true;
  }
  if (!profileIsComplete(user)) {
    const fallback = profileSuggestion(user.name || normalizedEmail);
    const firstName = String(user.firstName || fallback.firstName || 'Club').trim() || 'Club';
    const lastName = String(user.lastName || fallback.lastName || 'Member').trim() || 'Member';
    const initials =
      normalizeInitials(user.initials) || normalizeInitials(buildInitials(firstName, lastName)) || 'DC';

    user.firstName = firstName;
    user.lastName = lastName;
    user.initials = initials;
    user.name = `${firstName} ${lastName}`.trim();
    changed = true;
  }
  if (user.approved !== true) {
    user.approved = true;
    user.approvedAt = user.approvedAt || new Date().toISOString();
    user.approvedBy = user.approvedBy || OWNER_EMAIL;
    changed = true;
  }
  if (changed) {
    writeJsonArray(USERS_PATH, users);
  }

  setSessionCookie(res, user.id);
  return res.json({
    signedIn: true,
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
    const user = usersById.get(order.userId);
    return {
      ...order,
      userInitials: order.userInitials || user?.initials || '',
      fulfilled: Boolean(order.fulfilled),
      fulfilledAt: order.fulfilledAt || null,
      fulfilledBy: order.fulfilledBy || null
    };
  });

  const openOrders = enriched
    .filter((order) => !order.fulfilled)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  const fulfilledOrders = enriched
    .filter((order) => order.fulfilled)
    .sort((a, b) =>
      String(b.fulfilledAt || b.createdAt).localeCompare(String(a.fulfilledAt || a.createdAt))
    );

  return res.json({ openOrders, fulfilledOrders });
});

app.get('/api/orders', authRequired, ownerRequired, (_req, res) => {
  const orders = readJsonArray(ORDERS_PATH);
  const users = readJsonArray(USERS_PATH);
  const usersById = new Map(users.map((user) => [user.id, user]));

  const enriched = orders
    .map((order) => {
      const user = usersById.get(order.userId);
      return {
        ...order,
        userInitials: order.userInitials || user?.initials || '',
        fulfilled: Boolean(order.fulfilled),
        fulfilledAt: order.fulfilledAt || null,
        fulfilledBy: order.fulfilledBy || null
      };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  return res.json({ orders: enriched });
});

app.post('/api/admin/orders/:orderId/fulfill', authRequired, ownerRequired, (req, res) => {
  const orderId = String(req.params.orderId || '').trim();
  if (!orderId) {
    return res.status(400).json({ error: 'orderId is required' });
  }

  const orders = readJsonArray(ORDERS_PATH);
  const orderIndex = orders.findIndex((order) => order.id === orderId);
  if (orderIndex < 0) {
    return res.status(404).json({ error: 'Order not found' });
  }

  const existing = orders[orderIndex];
  let fallbackInitials = existing.userInitials || '';
  if (!fallbackInitials) {
    const users = readJsonArray(USERS_PATH);
    const matchedUser = users.find((user) => user.id === existing.userId);
    fallbackInitials = matchedUser?.initials || '';
  }

  const updatedOrder = {
    ...existing,
    userInitials: fallbackInitials,
    fulfilled: true,
    fulfilledAt: existing.fulfilledAt || new Date().toISOString(),
    fulfilledBy: existing.fulfilledBy || req.user.email
  };

  orders[orderIndex] = updatedOrder;
  writeJsonArray(ORDERS_PATH, orders);

  return res.json({
    success: true,
    order: updatedOrder
  });
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
    includeInitials: false,
    quantity: qty,
    venmoAgreed: Boolean(venmoAgreed),
    userId: req.user.id,
    userName: req.user.name,
    userInitials: req.user.initials || '',
    userEmail: req.user.email,
    fulfilled: false,
    fulfilledAt: null,
    fulfilledBy: null,
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
