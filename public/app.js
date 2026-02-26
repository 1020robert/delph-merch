async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const OWNER_ACCOUNT_EMAIL = '1020rjl@gmail.com';
const MERCH_CACHE_KEY = 'merchItemsCacheV3';

function isOwnerAccount(user) {
  const email = String(user?.email || '')
    .trim()
    .toLowerCase();
  return email === OWNER_ACCOUNT_EMAIL;
}

function readCachedMerchItems() {
  try {
    const raw = sessionStorage.getItem(MERCH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedMerchItems(items) {
  try {
    sessionStorage.setItem(MERCH_CACHE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage write errors (private mode/quota/etc.)
  }
}

async function getMerchItems() {
  const cachedItems = readCachedMerchItems();
  if (cachedItems) return cachedItems;

  const merch = await api('/api/merch');
  const items = Array.isArray(merch.items) ? merch.items : [];
  writeCachedMerchItems(items);
  return items;
}

function setMessage(el, text, type = '') {
  if (!el) return;
  el.textContent = text;
  el.className = `message ${type}`.trim();
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(Number(amount) || 0);
}

function startMerchLoadingTransition() {
  sessionStorage.setItem('showMerchLoader', '1');
}

function csvEscape(value) {
  const stringValue = String(value ?? '');
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function downloadCsv(filename, headers, rows) {
  const headerLine = headers.map(csvEscape).join(',');
  const bodyLines = rows.map((row) => row.map(csvEscape).join(','));
  const csv = [headerLine, ...bodyLines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function setupAuthPage() {
  const authPanel = document.getElementById('emailAuthPanel');
  if (!authPanel) return;

  const emailStep = document.getElementById('emailStep');
  const passwordStep = document.getElementById('passwordStep');
  const authTitle = document.getElementById('authTitle');
  const authCopy = document.getElementById('authCopy');
  const emailMessageEl = document.getElementById('authMessage');
  const passwordMessageEl = document.getElementById('passwordMessage');
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const showRegisterBtn = document.getElementById('showRegisterBtn');
  const showLoginBtn = document.getElementById('showLoginBtn');
  const passwordGateForm = document.getElementById('passwordGateForm');
  const passwordBackBtn = document.getElementById('passwordBackBtn');
  if (
    !emailStep ||
    !passwordStep ||
    !authTitle ||
    !authCopy ||
    !loginForm ||
    !registerForm ||
    !showRegisterBtn ||
    !showLoginBtn ||
    !passwordGateForm ||
    !passwordBackBtn
  ) {
    return;
  }

  function showLoginForm() {
    authTitle.textContent = 'Sign In';
    authCopy.textContent = 'Sign in to continue to the merch page.';
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
    setMessage(emailMessageEl, '');
  }

  function showRegisterForm() {
    authTitle.textContent = 'Create Account';
    authCopy.textContent = 'Create your account, then continue to password verification.';
    registerForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
    setMessage(emailMessageEl, '');
  }

  function showEmailStep() {
    emailStep.classList.remove('hidden');
    passwordStep.classList.add('hidden');
    setMessage(passwordMessageEl, '');
  }

  function showPasswordStep() {
    emailStep.classList.add('hidden');
    passwordStep.classList.remove('hidden');
    setMessage(emailMessageEl, '');
    setMessage(passwordMessageEl, '');
    if (passwordGateForm.elements.password) {
      passwordGateForm.elements.password.value = '';
      passwordGateForm.elements.password.focus();
    }
  }

  function continueToMerchPage() {
    startMerchLoadingTransition();
    window.location.href = '/merch.html';
  }

  try {
    const me = await api('/api/auth/me');
    if (me.passwordRequired) {
      showPasswordStep();
      return;
    }
    continueToMerchPage();
    return;
  } catch {
    // No active session.
  }

  showEmailStep();
  showLoginForm();

  showRegisterBtn.addEventListener('click', () => {
    showRegisterForm();
  });

  showLoginBtn.addEventListener('click', () => {
    showLoginForm();
  });

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const payload = {
      email: loginForm.elements.email.value
    };

    setMessage(emailMessageEl, 'Signing in...');

    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (data.passwordRequired) {
        showPasswordStep();
        return;
      }
      continueToMerchPage();
    } catch (err) {
      setMessage(emailMessageEl, err.message, 'error');
    }
  });

  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const payload = {
      email: registerForm.elements.email.value,
      firstName: registerForm.elements.firstName.value,
      lastName: registerForm.elements.lastName.value,
      initials: registerForm.elements.initials.value
    };

    setMessage(emailMessageEl, 'Creating account...');

    try {
      const data = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (data.passwordRequired) {
        showPasswordStep();
        return;
      }
      continueToMerchPage();
    } catch (err) {
      setMessage(emailMessageEl, err.message, 'error');
    }
  });

  passwordGateForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const payload = {
      password: passwordGateForm.elements.password.value
    };

    setMessage(passwordMessageEl, 'Verifying password...');

    try {
      await api('/api/auth/verify-password', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      continueToMerchPage();
    } catch (err) {
      if (err.status === 503) {
        setMessage(
          passwordMessageEl,
          'Password verification is unavailable right now. Owner must configure LOGIN_PASSWORD.',
          'error'
        );
        return;
      }
      setMessage(passwordMessageEl, err.message, 'error');
    }
  });

  passwordBackBtn.addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore and reset local view state.
    }
    showEmailStep();
    showLoginForm();
    loginForm.reset();
    registerForm.reset();
  });
}

async function setupMerchPage() {
  const merchGrid = document.getElementById('merchGrid');
  if (!merchGrid) return;

  const loadingOverlay = document.getElementById('loadingOverlay');
  const logoutMoose = document.getElementById('logoutMoose');
  const adminOrdersLink = document.getElementById('adminOrdersLink');

  let user;
  try {
    const me = await api('/api/auth/me');
    if (me.passwordRequired) {
      window.location.href = '/';
      return;
    }
    user = me.user;
  } catch {
    window.location.href = '/';
    return;
  }

  if (loadingOverlay) {
    const shouldShowLoader = sessionStorage.getItem('showMerchLoader') === '1';
    if (shouldShowLoader) {
      setTimeout(() => {
        loadingOverlay.classList.add('hidden');
      }, 2400);
      sessionStorage.removeItem('showMerchLoader');
    } else {
      loadingOverlay.classList.add('hidden');
    }
  }

  if (adminOrdersLink) {
    if (isOwnerAccount(user)) {
      adminOrdersLink.classList.remove('hidden');
    } else {
      adminOrdersLink.classList.add('hidden');
    }
  }

  if (logoutMoose) {
    logoutMoose.addEventListener('click', async () => {
      await api('/api/auth/logout', { method: 'POST' });
      window.location.href = '/';
    });
  }

  const items = await getMerchItems();
  if (items.length === 1) {
    merchGrid.classList.add('single-item');
  }

  items.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'catalog-card';

    card.innerHTML = `
      <a class="catalog-link" href="/product.html?item=${encodeURIComponent(item.id)}">
        <div class="item-photo-wrap catalog-photo-wrap">
          <img src="${item.image || '/hat2.png'}" alt="${item.name}" class="item-photo catalog-photo" loading="lazy" decoding="async" fetchpriority="low" />
        </div>
        <h3 class="item-name catalog-name">${item.name}</h3>
        <p class="catalog-price">${formatCurrency(item.price)}</p>
      </a>
    `;

    merchGrid.appendChild(card);
  });
}

async function setupProductPage() {
  const productPage = document.getElementById('productDetailPage');
  if (!productPage) return;

  const logoutMoose = document.getElementById('logoutMoose');
  const adminOrdersLink = document.getElementById('adminOrdersLink');
  const productTitle = document.getElementById('productTitle');
  const productPrice = document.getElementById('productPrice');
  const productImage = document.getElementById('productImage');
  const quantityInput = document.getElementById('productQuantity');
  const venmoBox = document.getElementById('productVenmo');
  const orderButton = document.getElementById('submitProductOrder');
  const messageEl = document.getElementById('productOrderMessage');

  let user;
  try {
    const me = await api('/api/auth/me');
    if (me.passwordRequired) {
      window.location.href = '/';
      return;
    }
    user = me.user;
  } catch {
    window.location.href = '/';
    return;
  }

  if (adminOrdersLink) {
    if (isOwnerAccount(user)) {
      adminOrdersLink.classList.remove('hidden');
    } else {
      adminOrdersLink.classList.add('hidden');
    }
  }

  if (logoutMoose) {
    logoutMoose.addEventListener('click', async () => {
      await api('/api/auth/logout', { method: 'POST' });
      window.location.href = '/';
    });
  }

  const items = await getMerchItems();
  const itemIdFromUrl = new URLSearchParams(window.location.search).get('item');
  const item =
    items.find((candidate) => candidate.id === itemIdFromUrl) ||
    items.find((candidate) => candidate.id === 'torch-hat') ||
    items[0];

  if (!item) {
    setMessage(messageEl, 'Product not found.', 'error');
    return;
  }

  productTitle.textContent = item.name;
  productPrice.textContent = formatCurrency(item.price);
  productImage.src = item.image || '/hat2.png';
  productImage.alt = item.name;
  productImage.decoding = 'async';

  orderButton.addEventListener('click', async () => {
    setMessage(messageEl, 'Submitting pre-order...');
    orderButton.disabled = true;
    try {
      const data = await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          itemId: item.id,
          quantity: Number(quantityInput.value),
          venmoAgreed: venmoBox.checked
        })
      });

      const emailInfo = data.emailStatus.emailed
        ? ' Order email sent.'
        : ` Order saved. (${data.emailStatus.reason})`;

      setMessage(
        messageEl,
        `Pre-order received for ${data.order.quantity} x ${item.name}.${emailInfo} Returning to merch page...`,
        'success'
      );
      quantityInput.value = '1';
      venmoBox.checked = false;
      setTimeout(() => {
        window.location.href = '/merch.html';
      }, 1400);
    } catch (err) {
      setMessage(messageEl, err.message, 'error');
      orderButton.disabled = false;
    }
  });
}

async function setupAdminOrdersPage() {
  const openOrdersTableBody = document.getElementById('openOrdersTableBody');
  if (!openOrdersTableBody) return;

  const fulfilledOrdersTableBody = document.getElementById('fulfilledOrdersTableBody');
  const openOrdersPanel = document.getElementById('openOrdersPanel');
  const fulfilledOrdersPanel = document.getElementById('fulfilledOrdersPanel');
  const openOrdersTabBtn = document.getElementById('openOrdersTabBtn');
  const fulfilledOrdersTabBtn = document.getElementById('fulfilledOrdersTabBtn');
  const ordersMessage = document.getElementById('ordersMessage');
  const exportCsvBtn = document.getElementById('exportCsvBtn');

  let user;
  try {
    const me = await api('/api/auth/me');
    if (me.passwordRequired) {
      window.location.href = '/';
      return;
    }
    user = me.user;
  } catch {
    window.location.href = '/';
    return;
  }

  if (!isOwnerAccount(user)) {
    setMessage(ordersMessage, 'This page is owner-only.', 'error');
    setTimeout(() => {
      window.location.href = '/merch.html';
    }, 1200);
    return;
  }

  let openOrders = [];
  let fulfilledOrders = [];
  try {
    const ordersResponse = await api('/api/admin/orders');
    const allOrders = Array.isArray(ordersResponse.orders) ? ordersResponse.orders : [];
    openOrders = Array.isArray(ordersResponse.openOrders)
      ? ordersResponse.openOrders
      : allOrders.filter((order) => !order.fulfilled);
    fulfilledOrders = Array.isArray(ordersResponse.fulfilledOrders)
      ? ordersResponse.fulfilledOrders
      : allOrders.filter((order) => order.fulfilled);
  } catch (err) {
    setMessage(ordersMessage, err.message, 'error');
    return;
  }

  const byCreatedAtDesc = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt));
  const byFulfilledAtDesc = (a, b) =>
    String(b.fulfilledAt || b.createdAt).localeCompare(String(a.fulfilledAt || a.createdAt));

  openOrders.sort(byCreatedAtDesc);
  fulfilledOrders.sort(byFulfilledAtDesc);

  let activeTab = 'open';

  function setActiveTab(tab) {
    activeTab = tab === 'fulfilled' ? 'fulfilled' : 'open';

    if (openOrdersPanel) {
      openOrdersPanel.classList.toggle('hidden', activeTab !== 'open');
    }
    if (fulfilledOrdersPanel) {
      fulfilledOrdersPanel.classList.toggle('hidden', activeTab !== 'fulfilled');
    }

    if (openOrdersTabBtn) {
      openOrdersTabBtn.classList.toggle('active', activeTab === 'open');
    }
    if (fulfilledOrdersTabBtn) {
      fulfilledOrdersTabBtn.classList.toggle('active', activeTab === 'fulfilled');
    }
  }

  function updateSummaryMessage() {
    if (openOrders.length === 0 && fulfilledOrders.length === 0) {
      setMessage(ordersMessage, 'No orders yet.');
      return;
    }
    setMessage(
      ordersMessage,
      `${openOrders.length} open order(s), ${fulfilledOrders.length} fulfilled order(s).`,
      'success'
    );
  }

  function renderOpenOrdersTable() {
    openOrdersTableBody.innerHTML = '';

    if (openOrders.length === 0) {
      const emptyRow = document.createElement('tr');
      emptyRow.innerHTML = '<td class="order-empty-cell" colspan="9">No open orders.</td>';
      openOrdersTableBody.appendChild(emptyRow);
      return;
    }

    openOrders.forEach((order) => {
      const row = document.createElement('tr');
      const orderedAt = order.createdAt ? new Date(order.createdAt).toLocaleString() : '';
      row.innerHTML = `
        <td>${escapeHtml(orderedAt)}</td>
        <td>${escapeHtml(order.userName || '')}</td>
        <td>${escapeHtml(order.userInitials || '')}</td>
        <td>${escapeHtml(order.userEmail || '')}</td>
        <td>${escapeHtml(order.itemName || '')}</td>
        <td>${order.includeInitials ? 'Yes' : 'No'}</td>
        <td>${escapeHtml(order.quantity || '')}</td>
        <td>${order.venmoAgreed ? 'Yes' : 'No'}</td>
        <td>
          <button class="order-action-btn" type="button" data-order-id="${escapeHtml(order.id || '')}">
            Mark Fulfilled
          </button>
        </td>
      `;
      openOrdersTableBody.appendChild(row);
    });

    openOrdersTableBody.querySelectorAll('.order-action-btn').forEach((button) => {
      button.addEventListener('click', async () => {
        const orderId = button.dataset.orderId;
        if (!orderId) return;

        button.disabled = true;
        button.textContent = 'Saving...';

        try {
          const response = await api(`/api/admin/orders/${encodeURIComponent(orderId)}/fulfill`, {
            method: 'POST'
          });
          const updatedOrder = response.order || {};
          const movedIndex = openOrders.findIndex((order) => order.id === orderId);
          if (movedIndex >= 0) {
            openOrders.splice(movedIndex, 1);
          }
          fulfilledOrders.unshift({
            ...updatedOrder,
            fulfilled: true
          });
          fulfilledOrders.sort(byFulfilledAtDesc);

          renderOpenOrdersTable();
          renderFulfilledOrdersTable();
          updateSummaryMessage();
          setMessage(ordersMessage, 'Order marked fulfilled.', 'success');
        } catch (err) {
          button.disabled = false;
          button.textContent = 'Mark Fulfilled';
          setMessage(ordersMessage, err.message, 'error');
        }
      });
    });
  }

  function renderFulfilledOrdersTable() {
    fulfilledOrdersTableBody.innerHTML = '';

    if (fulfilledOrders.length === 0) {
      const emptyRow = document.createElement('tr');
      emptyRow.innerHTML = '<td class="order-empty-cell" colspan="9">No fulfilled orders yet.</td>';
      fulfilledOrdersTableBody.appendChild(emptyRow);
      return;
    }

    fulfilledOrders.forEach((order) => {
      const fulfilledAt = order.fulfilledAt ? new Date(order.fulfilledAt).toLocaleString() : '';
      const orderedAt = order.createdAt ? new Date(order.createdAt).toLocaleString() : '';
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${escapeHtml(fulfilledAt)}</td>
        <td>${escapeHtml(orderedAt)}</td>
        <td>${escapeHtml(order.userName || '')}</td>
        <td>${escapeHtml(order.userInitials || '')}</td>
        <td>${escapeHtml(order.userEmail || '')}</td>
        <td>${escapeHtml(order.itemName || '')}</td>
        <td>${order.includeInitials ? 'Yes' : 'No'}</td>
        <td>${escapeHtml(order.quantity || '')}</td>
        <td>${order.venmoAgreed ? 'Yes' : 'No'}</td>
      `;
      fulfilledOrdersTableBody.appendChild(row);
    });
  }

  if (openOrdersTabBtn) {
    openOrdersTabBtn.addEventListener('click', () => setActiveTab('open'));
  }
  if (fulfilledOrdersTabBtn) {
    fulfilledOrdersTabBtn.addEventListener('click', () => setActiveTab('fulfilled'));
  }

  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
      if (activeTab === 'open') {
        const rows = openOrders.map((order) => [
          order.createdAt || '',
          order.userName || '',
          order.userInitials || '',
          order.userEmail || '',
          order.itemName || '',
          order.includeInitials ? 'Yes' : 'No',
          order.quantity || '',
          order.venmoAgreed ? 'Yes' : 'No',
          order.itemId || '',
          order.userId || '',
          order.id || ''
        ]);

        downloadCsv(
          'delphic-club-merch-open-orders.csv',
          [
            'createdAt',
            'userName',
            'userInitials',
            'userEmail',
            'itemName',
            'includeInitials',
            'quantity',
            'venmoAgreed',
            'itemId',
            'userId',
            'orderId'
          ],
          rows
        );
        return;
      }

      if (activeTab === 'fulfilled') {
        const rows = fulfilledOrders.map((order) => [
          order.fulfilledAt || '',
          order.createdAt || '',
          order.userName || '',
          order.userInitials || '',
          order.userEmail || '',
          order.itemName || '',
          order.includeInitials ? 'Yes' : 'No',
          order.quantity || '',
          order.venmoAgreed ? 'Yes' : 'No',
          order.fulfilledBy || '',
          order.itemId || '',
          order.userId || '',
          order.id || ''
        ]);

        downloadCsv(
          'delphic-club-merch-fulfilled-orders.csv',
          [
            'fulfilledAt',
            'createdAt',
            'userName',
            'userInitials',
            'userEmail',
            'itemName',
            'includeInitials',
            'quantity',
            'venmoAgreed',
            'fulfilledBy',
            'itemId',
            'userId',
            'orderId'
          ],
          rows
        );
        return;
      }
    });
  }

  renderOpenOrdersTable();
  renderFulfilledOrdersTable();
  updateSummaryMessage();
  setActiveTab(openOrders.length > 0 || fulfilledOrders.length === 0 ? 'open' : 'fulfilled');
}

setupAuthPage();
setupMerchPage();
setupProductPage();
setupAdminOrdersPage();
