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
const SHARED_LOGIN_PASSWORD = String(process.env.LOGIN_PASSWORD || '').trim();
const PASSWORD_GATE_ENABLED = false;
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const COOKIE_SECURE =
  String(process.env.COOKIE_SECURE || process.env.NODE_ENV === 'production').toLowerCase() ===
  'true';

const USERS_PATH = path.join(DATA_DIR, 'users.json');
const ORDERS_PATH = path.join(DATA_DIR, 'orders.json');
const MERCH_ITEMS_PATH = path.join(DATA_DIR, 'merch-items.json');

const SESSION_COOKIE = 'club_session';
const sessions = new Map();
const ensuredDataFiles = new Set();

const DEFAULT_MERCH_ITEMS = [
  {
    id: 'torch-hat',
    name: "'47 Delph Hat",
    price: 25,
    image: '/hat2.png',
    sizes: [],
    allowInitials: false,
    paused: false,
    twoXlPrice: null,
    createdAt: '2026-02-26T00:00:00.000Z'
  }
];

const STANDARD_SIZES = ['S', 'M', 'L', 'XL', '2XL'];

app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));
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

app.get('/uploads/:filename', (req, res) => {
  const filename = String(req.params.filename || '').trim();
  if (!/^[A-Za-z0-9._-]+$/.test(filename)) {
    return res.status(400).send('Invalid filename');
  }

  const absolutePath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(absolutePath)) {
    return res.status(404).send('Not found');
  }

  res.setHeader('Cache-Control', 'public, max-age=604800');
  return res.sendFile(absolutePath);
});

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

function normalizePrice(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  if (amount <= 0 || amount > 10000) return null;
  return Math.round(amount * 100) / 100;
}

function normalizeOptionalPrice(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }
  return normalizePrice(value);
}

function normalizeSizes(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const normalized = String(value || '')
      .trim()
      .toUpperCase();
    if (!normalized) continue;
    if (normalized.length > 12) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= 12) break;
  }
  return output;
}

function normalizeMerchItem(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;

  const id = String(candidate.id || '').trim();
  const name = String(candidate.name || '').trim();
  const image = String(candidate.image || '').trim();
  const price = normalizePrice(candidate.price);
  if (!id || !name || !image || price === null) return null;

  const includeSizes =
    candidate.includeSizes === true ||
    (Array.isArray(candidate.sizes) && normalizeSizes(candidate.sizes).length > 0);
  const twoXlPrice = normalizeOptionalPrice(candidate.twoXlPrice);

  return {
    id,
    name,
    price,
    image,
    sizes: includeSizes ? [...STANDARD_SIZES] : [],
    allowInitials: Boolean(candidate.allowInitials),
    paused: Boolean(candidate.paused),
    twoXlPrice: includeSizes ? twoXlPrice : null,
    createdAt: candidate.createdAt || new Date().toISOString()
  };
}

function readMerchItems() {
  const fileExisted = fs.existsSync(MERCH_ITEMS_PATH);
  const rawItems = readJsonArray(MERCH_ITEMS_PATH);
  const normalized = rawItems.map(normalizeMerchItem).filter(Boolean);

  if (normalized.length > 0) {
    return normalized;
  }

  if (fileExisted) {
    return [];
  }

  const seeded = DEFAULT_MERCH_ITEMS.map((item) => ({ ...item }));
  writeJsonArray(MERCH_ITEMS_PATH, seeded);
  return seeded;
}

function writeMerchItems(items) {
  writeJsonArray(MERCH_ITEMS_PATH, items);
}

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
  sessions.set(token, { userId, passwordVerified: Boolean(passwordVerified), createdAt: new Date().toISOString() });
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    `Size: ${order.selectedSize || 'N/A'}`,
    `Include Initials: ${order.includeInitials ? 'Yes' : 'No'}`,
    `Unit Price: $${Number(order.unitPrice || 0).toFixed(2)}`,
    `Total: $${Number(order.totalPrice || 0).toFixed(2)}`,
    `Quantity: ${order.quantity}`,
    `Venmo Agreed: ${order.venmoAgreed ? 'Yes' : 'No'}`,
    `Ordered At: ${order.createdAt}`,
    `Order ID: ${order.id}`
  ].join('\n');

  const mailOptions = {
    from: process.env.SMTP_USER,
    to: OWNER_EMAIL,
    subject,
    text: body
  };

  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await transport.sendMail(mailOptions);
      return { emailed: true };
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        await wait(500);
      }
    }
  }

  return {
    emailed: false,
    reason: 'Owner notification unavailable',
    error: lastError ? String(lastError.message || lastError) : 'Unknown email error'
  };
}

function saveUploadedPngDataUrl(imageDataUrl, itemId) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(imageDataUrl || '').trim());
  if (!match) {
    return { error: 'Image must be a PNG upload' };
  }

  const imageBuffer = Buffer.from(match[1], 'base64');
  if (imageBuffer.length === 0) {
    return { error: 'Uploaded image is empty' };
  }
  if (imageBuffer.length > 5 * 1024 * 1024) {
    return { error: 'Uploaded image must be under 5MB' };
  }

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const filename = `${itemId}-${crypto.randomBytes(3).toString('hex')}.png`;
  const filePath = path.join(UPLOADS_DIR, filename);
  fs.writeFileSync(filePath, imageBuffer);
  return { imagePath: `/uploads/${filename}` };
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

  if (!normalizedEmail) {
    return res.status(400).json({ error: 'email is required' });
  }

  const users = readJsonArray(USERS_PATH);
  const existingUser = users.find(
    (candidate) => String(candidate.email || '').trim().toLowerCase() === normalizedEmail
  );
  if (existingUser) {
    let changed = false;

    if (normalizedFirstName && String(existingUser.firstName || '').trim() !== normalizedFirstName) {
      existingUser.firstName = normalizedFirstName;
      changed = true;
    }
    if (normalizedLastName && String(existingUser.lastName || '').trim() !== normalizedLastName) {
      existingUser.lastName = normalizedLastName;
      changed = true;
    }
    if (
      normalizedInitials &&
      String(existingUser.initials || '').trim().toUpperCase() !== normalizedInitials
    ) {
      existingUser.initials = normalizedInitials;
      changed = true;
    }

    const computedName = `${normalizedFirstName || existingUser.firstName || ''} ${normalizedLastName || existingUser.lastName || ''}`.trim();
    if (computedName && String(existingUser.name || '').trim() !== computedName) {
      existingUser.name = computedName;
      changed = true;
    }

    if (changed) {
      writeJsonArray(USERS_PATH, users);
    }

    setSessionCookie(res, existingUser.id);
    return res.json({
      registered: false,
      existingAccount: true,
      passwordRequired: PASSWORD_GATE_ENABLED,
      user: userPublicShape(existingUser)
    });
  }

  if (!normalizedFirstName || !normalizedLastName || !normalizedInitials) {
    return res.status(400).json({
      error: 'email, firstName, lastName, and initials are required'
    });
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
    passwordRequired: PASSWORD_GATE_ENABLED,
    user: userPublicShape(user)
  });
});

app.post('/api/auth/login', (req, res) => {
  const normalizedEmail = normalizeEmail(req.body?.email);

  if (!normalizedEmail) {
    return res.status(400).json({ error: 'email is required' });
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
    passwordRequired: PASSWORD_GATE_ENABLED,
    user: userPublicShape(user)
  });
});

app.post('/api/auth/verify-password', (req, res) => {
  const context = getAuthContext(req);
  if (!context) {
    return res.status(401).json({ error: 'Sign in first' });
  }
  if (!PASSWORD_GATE_ENABLED) {
    context.session.passwordVerified = true;
    context.session.passwordVerifiedAt = new Date().toISOString();
    return res.json({
      success: true,
      user: userPublicShape(context.user)
    });
  }
  if (!SHARED_LOGIN_PASSWORD) {
    return res
      .status(503)
      .json({ error: 'Password verification is not configured on the server' });
  }

  const password = String(req.body?.password || '');
  if (!password) {
    return res.status(400).json({ error: 'password is required' });
  }
  if (password !== SHARED_LOGIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  context.session.passwordVerified = true;
  context.session.passwordVerifiedAt = new Date().toISOString();

  return res.json({
    success: true,
    user: userPublicShape(context.user)
  });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies[SESSION_COOKIE];
  if (token) sessions.delete(token);
  res.clearCookie(SESSION_COOKIE);
  return res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
  const context = getAuthContext(req);
  if (!context) return res.status(401).json({ error: 'Not signed in' });

  return res.json({
    user: userPublicShape(context.user),
    passwordRequired: isPasswordVerificationRequired(context.session)
  });
});

app.get('/api/merch', authRequired, (_req, res) => {
  return res.json({ items: readMerchItems().filter((item) => !item.paused) });
});

app.get('/api/admin/merch', authRequired, ownerRequired, (_req, res) => {
  return res.json({ items: readMerchItems() });
});

app.post('/api/admin/merch', authRequired, ownerRequired, (req, res) => {
  const name = String(req.body?.name || '').trim();
  const price = normalizePrice(req.body?.price);
  const imageDataUrl = String(req.body?.imageDataUrl || '').trim();
  const includeSizes = Boolean(req.body?.includeSizes);
  const allowInitials = Boolean(req.body?.allowInitials);
  const twoXlPrice = normalizeOptionalPrice(req.body?.twoXlPrice);

  if (!name) {
    return res.status(400).json({ error: 'Product name is required' });
  }
  if (price === null) {
    return res.status(400).json({ error: 'Valid price is required' });
  }
  if (!imageDataUrl) {
    return res.status(400).json({ error: 'PNG image is required' });
  }
  if (includeSizes && req.body?.twoXlPrice !== undefined && twoXlPrice === null) {
    return res.status(400).json({ error: '2XL price must be a valid amount' });
  }
  if (!includeSizes && twoXlPrice !== null) {
    return res.status(400).json({ error: 'Enable sizes before setting a 2XL price' });
  }

  const itemId = `item-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
  const uploadResult = saveUploadedPngDataUrl(imageDataUrl, itemId);
  if (uploadResult.error) {
    return res.status(400).json({ error: uploadResult.error });
  }

  const items = readMerchItems();
  const item = {
    id: itemId,
    name,
    price,
    image: uploadResult.imagePath,
    sizes: includeSizes ? [...STANDARD_SIZES] : [],
    allowInitials,
    paused: false,
    twoXlPrice: includeSizes ? twoXlPrice : null,
    createdAt: new Date().toISOString()
  };
  items.push(item);
  writeMerchItems(items);

  return res.json({ success: true, item, items });
});

app.patch('/api/admin/merch/:itemId', authRequired, ownerRequired, (req, res) => {
  const itemId = String(req.params.itemId || '').trim();
  if (!itemId) {
    return res.status(400).json({ error: 'itemId is required' });
  }

  const hasIncludeSizes = Object.prototype.hasOwnProperty.call(req.body || {}, 'includeSizes');
  const hasAllowInitials = Object.prototype.hasOwnProperty.call(req.body || {}, 'allowInitials');
  const hasPaused = Object.prototype.hasOwnProperty.call(req.body || {}, 'paused');
  const hasTwoXlPrice = Object.prototype.hasOwnProperty.call(req.body || {}, 'twoXlPrice');

  if (!hasIncludeSizes && !hasAllowInitials && !hasPaused && !hasTwoXlPrice) {
    return res.status(400).json({ error: 'No product updates provided' });
  }

  const items = readMerchItems();
  const index = items.findIndex((item) => item.id === itemId);
  if (index < 0) {
    return res.status(404).json({ error: 'Product not found' });
  }

  const current = items[index];
  const updated = { ...current };

  if (hasIncludeSizes) {
    updated.sizes = Boolean(req.body.includeSizes) ? [...STANDARD_SIZES] : [];
    if (updated.sizes.length === 0) {
      updated.twoXlPrice = null;
    }
  }

  if (hasAllowInitials) {
    updated.allowInitials = Boolean(req.body.allowInitials);
  }

  if (hasPaused) {
    updated.paused = Boolean(req.body.paused);
  }

  if (hasTwoXlPrice) {
    if (!Array.isArray(updated.sizes) || updated.sizes.length === 0) {
      return res.status(400).json({ error: 'Enable sizes before setting a 2XL price' });
    }
    const normalizedTwoXlPrice = normalizeOptionalPrice(req.body.twoXlPrice);
    if (req.body.twoXlPrice !== null && req.body.twoXlPrice !== '' && normalizedTwoXlPrice === null) {
      return res.status(400).json({ error: '2XL price must be a valid amount' });
    }
    updated.twoXlPrice = normalizedTwoXlPrice;
  }

  items[index] = updated;
  writeMerchItems(items);

  return res.json({ success: true, item: updated, items });
});

app.delete('/api/admin/merch/:itemId', authRequired, ownerRequired, (req, res) => {
  const itemId = String(req.params.itemId || '').trim();
  if (!itemId) {
    return res.status(400).json({ error: 'itemId is required' });
  }

  const items = readMerchItems();
  const index = items.findIndex((item) => item.id === itemId);
  if (index < 0) {
    return res.status(404).json({ error: 'Product not found' });
  }

  const [removed] = items.splice(index, 1);
  writeMerchItems(items);

  const imagePath = String(removed?.image || '');
  if (imagePath.startsWith('/uploads/')) {
    const filename = path.basename(imagePath);
    if (/^[A-Za-z0-9._-]+$/.test(filename)) {
      const absolutePath = path.join(UPLOADS_DIR, filename);
      if (fs.existsSync(absolutePath)) {
        try {
          fs.unlinkSync(absolutePath);
        } catch {
          // Ignore file-delete issues; product is already removed from catalog.
        }
      }
    }
  }

  return res.json({ success: true, removedItem: removed, items });
});

app.get('/api/admin/orders', authRequired, ownerRequired, (_req, res) => {
  const orders = readJsonArray(ORDERS_PATH);
  const users = readJsonArray(USERS_PATH);
  const usersById = new Map(users.map((user) => [user.id, user]));

  const enriched = orders.map((order) => {
    const user = usersById.get(order.userId);
    return {
      ...order,
      selectedSize: order.selectedSize || null,
      includeInitials: Boolean(order.includeInitials),
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
        selectedSize: order.selectedSize || null,
        includeInitials: Boolean(order.includeInitials),
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
  const selectedSizeRaw = String(req.body?.selectedSize || '')
    .trim()
    .toUpperCase();
  const includeInitialsRequested = Boolean(req.body?.includeInitials);
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

  const item = readMerchItems().find((x) => x.id === itemId);
  if (!item) {
    return res.status(404).json({ error: 'Merch item not found' });
  }
  if (item.paused) {
    return res.status(400).json({ error: 'This item is currently unavailable' });
  }

  let selectedSize = null;
  if (item.sizes.length > 0) {
    if (!selectedSizeRaw) {
      return res.status(400).json({ error: 'Please select a size' });
    }
    if (!item.sizes.includes(selectedSizeRaw)) {
      return res.status(400).json({ error: 'Selected size is not valid for this item' });
    }
    selectedSize = selectedSizeRaw;
  }

  const includeInitials = item.allowInitials ? includeInitialsRequested : false;
  const unitPrice =
    selectedSize === '2XL' && normalizeOptionalPrice(item.twoXlPrice) !== null
      ? normalizeOptionalPrice(item.twoXlPrice)
      : item.price;
  const totalPrice = Math.round(qty * Number(unitPrice) * 100) / 100;

  const order = {
    id: crypto.randomUUID(),
    itemId: item.id,
    itemName: item.name,
    includeInitials,
    selectedSize,
    unitPrice,
    totalPrice,
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

  // Send owner notification after response so checkout stays fast.
  setImmediate(() => {
    maybeSendOrderEmail(order, req.user, item)
      .then((emailStatus) => {
        if (!emailStatus.emailed) {
          console.error('Order notification email failed', {
            orderId: order.id,
            reason: emailStatus.reason,
            error: emailStatus.error || null
          });
        }
      })
      .catch((err) => {
        console.error('Order notification email threw error', {
          orderId: order.id,
          reason: 'Owner notification unavailable',
          error: err.message || String(err)
        });
      });
  });

  return res.json({
    success: true,
    order,
    emailStatus: { queued: true }
  });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Club Merch site running at http://localhost:${PORT}`);
});
