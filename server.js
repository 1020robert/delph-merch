require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');

const {
  STATIC_DIR,
  PORT,
  OWNER_EMAIL,
  SHARED_LOGIN_PASSWORD,
  PASSWORD_GATE_ENABLED,
  UPLOADS_DIR,
  USERS_PATH,
  ORDERS_PATH,
  SESSION_COOKIE,
  STANDARD_SIZES
} = require('./src/config');
const { readJsonArray, writeJsonArray } = require('./src/services/storage');
const {
  normalizePrice,
  normalizeOptionalPrice,
  readMerchItems,
  writeMerchItems
} = require('./src/services/merch');
const {
  clearSession,
  setSessionCookie,
  buildInitials,
  normalizeInitials,
  normalizeEmail,
  profileIsComplete,
  profileSuggestion,
  userPublicShape,
  getAuthContext,
  authRequired,
  ownerRequired,
  isPasswordVerificationRequired
} = require('./src/services/auth');
const { maybeSendOrderEmail } = require('./src/services/email');
const { saveUploadedPngDataUrl, removeUploadedImage } = require('./src/services/uploads');

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));
app.use(cookieParser());
app.use(
  express.static(STATIC_DIR, {
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
  clearSession(token);
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

  removeUploadedImage(removed?.image);

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
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Club Merch site running at http://localhost:${PORT}`);
});
