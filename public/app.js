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
const MERCH_CACHE_KEY = 'merchItemsCacheV2';

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

async function waitForGoogleSdk(maxWaitMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    if (window.google && window.google.accounts && window.google.accounts.id) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
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
  const authPanel = document.getElementById('googleAuthPanel');
  if (!authPanel) return;

  const messageEl = document.getElementById('authMessage');
  const googleButtonEl = document.getElementById('googleSignInButton');
  const signupForm = document.getElementById('signupForm');
  const signupEmailEl = document.getElementById('signupEmail');

  try {
    await api('/api/auth/me');
    window.location.href = '/merch.html';
    return;
  } catch {
    // No active session.
  }

  let config;
  try {
    config = await api('/api/config');
  } catch {
    setMessage(messageEl, 'Could not load auth config.', 'error');
    return;
  }

  if (!config.googleClientId) {
    setMessage(messageEl, 'Google sign-in is not configured on the server yet.', 'error');
    return;
  }

  const sdkReady = await waitForGoogleSdk();
  if (!sdkReady) {
    setMessage(messageEl, 'Google sign-in script did not load. Refresh and try again.', 'error');
    return;
  }

  window.google.accounts.id.initialize({
    client_id: config.googleClientId,
    callback: async (response) => {
      setMessage(messageEl, 'Checking Google account...');
      try {
        const data = await api('/api/auth/google', {
          method: 'POST',
          body: JSON.stringify({ credential: response.credential })
        });

        startMerchLoadingTransition();
        window.location.href = '/merch.html';
      } catch (err) {
        if (err.status === 403 && err.data?.approvalRequired) {
          const pendingEmail = String(err.data?.email || '').trim();
          if (pendingEmail && signupForm?.elements?.email) {
            signupForm.elements.email.value = pendingEmail;
          }
          if (signupEmailEl) {
            signupEmailEl.textContent = pendingEmail
              ? `Requested email: ${pendingEmail}`
              : 'This Google email is not approved yet.';
          }
          setMessage(
            messageEl,
            err.message || `Your account is pending approval by ${OWNER_ACCOUNT_EMAIL}.`,
            'error'
          );
          return;
        }
        setMessage(messageEl, err.message, 'error');
      }
    }
  });

  window.google.accounts.id.renderButton(googleButtonEl, {
    type: 'standard',
    shape: 'pill',
    theme: 'outline',
    text: 'signin_with',
    size: 'large',
    width: 300
  });

  signupForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const payload = {
      email: signupForm.elements.email.value,
      firstName: signupForm.elements.firstName.value,
      lastName: signupForm.elements.lastName.value,
      initials: signupForm.elements.initials.value
    };

    setMessage(messageEl, `Submitting approval request to ${OWNER_ACCOUNT_EMAIL}...`);

    try {
      const data = await api('/api/auth/request-approval', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (signupEmailEl) {
        signupEmailEl.textContent = `Requested email: ${data.email || payload.email}`;
      }

      if (data.alreadyApproved) {
        setMessage(
          messageEl,
          'Email is already approved. Use Sign in with Google.',
          'success'
        );
        return;
      }

      if (data.alreadyPending) {
        setMessage(
          messageEl,
          `Request re-sent. ${OWNER_ACCOUNT_EMAIL} still needs to approve this email.`,
          'success'
        );
        return;
      }

      setMessage(
        messageEl,
        `Request sent. ${OWNER_ACCOUNT_EMAIL} must approve your email before sign-in works.`,
        'success'
      );
    } catch (err) {
      setMessage(messageEl, err.message, 'error');
    }
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
          <img src="${item.image || '/hat.png'}" alt="${item.name}" class="item-photo catalog-photo" loading="lazy" decoding="async" fetchpriority="low" />
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
  productImage.src = item.image || '/hat.png';
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
  const pendingUsersTableBody = document.getElementById('pendingUsersTableBody');
  const openOrdersPanel = document.getElementById('openOrdersPanel');
  const fulfilledOrdersPanel = document.getElementById('fulfilledOrdersPanel');
  const pendingUsersPanel = document.getElementById('pendingUsersPanel');
  const openOrdersTabBtn = document.getElementById('openOrdersTabBtn');
  const fulfilledOrdersTabBtn = document.getElementById('fulfilledOrdersTabBtn');
  const pendingUsersTabBtn = document.getElementById('pendingUsersTabBtn');
  const ordersMessage = document.getElementById('ordersMessage');
  const exportCsvBtn = document.getElementById('exportCsvBtn');

  let user;
  try {
    const me = await api('/api/auth/me');
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
  let pendingUsers = [];
  try {
    const [ordersResponse, pendingResponse] = await Promise.all([
      api('/api/admin/orders'),
      api('/api/admin/pending-users')
    ]);
    const allOrders = Array.isArray(ordersResponse.orders) ? ordersResponse.orders : [];
    openOrders = Array.isArray(ordersResponse.openOrders)
      ? ordersResponse.openOrders
      : allOrders.filter((order) => !order.fulfilled);
    fulfilledOrders = Array.isArray(ordersResponse.fulfilledOrders)
      ? ordersResponse.fulfilledOrders
      : allOrders.filter((order) => order.fulfilled);
    pendingUsers = Array.isArray(pendingResponse.pendingUsers) ? pendingResponse.pendingUsers : [];
  } catch (err) {
    setMessage(ordersMessage, err.message, 'error');
    return;
  }

  const byCreatedAtDesc = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt));
  const byFulfilledAtDesc = (a, b) =>
    String(b.fulfilledAt || b.createdAt).localeCompare(String(a.fulfilledAt || a.createdAt));
  const byApprovalRequestedAtDesc = (a, b) =>
    String(b.approvalRequestedAt || b.createdAt).localeCompare(
      String(a.approvalRequestedAt || a.createdAt)
    );

  openOrders.sort(byCreatedAtDesc);
  fulfilledOrders.sort(byFulfilledAtDesc);
  pendingUsers.sort(byApprovalRequestedAtDesc);

  let activeTab = 'open';

  function setActiveTab(tab) {
    activeTab = ['open', 'fulfilled', 'pending'].includes(tab) ? tab : 'open';

    if (openOrdersPanel) {
      openOrdersPanel.classList.toggle('hidden', activeTab !== 'open');
    }
    if (fulfilledOrdersPanel) {
      fulfilledOrdersPanel.classList.toggle('hidden', activeTab !== 'fulfilled');
    }
    if (pendingUsersPanel) {
      pendingUsersPanel.classList.toggle('hidden', activeTab !== 'pending');
    }

    if (openOrdersTabBtn) {
      openOrdersTabBtn.classList.toggle('active', activeTab === 'open');
    }
    if (fulfilledOrdersTabBtn) {
      fulfilledOrdersTabBtn.classList.toggle('active', activeTab === 'fulfilled');
    }
    if (pendingUsersTabBtn) {
      pendingUsersTabBtn.classList.toggle('active', activeTab === 'pending');
    }
  }

  function updateSummaryMessage() {
    if (openOrders.length === 0 && fulfilledOrders.length === 0 && pendingUsers.length === 0) {
      setMessage(ordersMessage, 'No orders or pending applicants yet.');
      return;
    }
    setMessage(
      ordersMessage,
      `${openOrders.length} open order(s), ${fulfilledOrders.length} fulfilled order(s), ${pendingUsers.length} pending applicant(s).`,
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

  function renderPendingUsersTable() {
    if (!pendingUsersTableBody) return;
    pendingUsersTableBody.innerHTML = '';

    if (pendingUsers.length === 0) {
      const emptyRow = document.createElement('tr');
      emptyRow.innerHTML =
        '<td class="order-empty-cell" colspan="6">No pending applicants.</td>';
      pendingUsersTableBody.appendChild(emptyRow);
      return;
    }

    pendingUsers.forEach((userEntry) => {
      const row = document.createElement('tr');
      const requestedAt = userEntry.approvalRequestedAt
        ? new Date(userEntry.approvalRequestedAt).toLocaleString()
        : '';
      row.innerHTML = `
        <td>${escapeHtml(requestedAt)}</td>
        <td>${escapeHtml(userEntry.name || '')}</td>
        <td>${escapeHtml(userEntry.initials || '')}</td>
        <td>${escapeHtml(userEntry.email || '')}</td>
        <td>${escapeHtml(userEntry.id || '')}</td>
        <td>
          <button class="order-action-btn approve-user-btn" type="button" data-user-id="${escapeHtml(
            userEntry.id || ''
          )}">
            Approve
          </button>
        </td>
      `;
      pendingUsersTableBody.appendChild(row);
    });

    pendingUsersTableBody.querySelectorAll('.approve-user-btn').forEach((button) => {
      button.addEventListener('click', async () => {
        const userId = button.dataset.userId;
        if (!userId) return;

        button.disabled = true;
        button.textContent = 'Approving...';

        try {
          await api(`/api/admin/users/${encodeURIComponent(userId)}/approve`, { method: 'POST' });
          pendingUsers = pendingUsers.filter((userEntry) => userEntry.id !== userId);
          renderPendingUsersTable();
          updateSummaryMessage();
          setMessage(ordersMessage, 'User approved successfully.', 'success');
        } catch (err) {
          button.disabled = false;
          button.textContent = 'Approve';
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
  if (pendingUsersTabBtn) {
    pendingUsersTabBtn.addEventListener('click', () => setActiveTab('pending'));
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

      const rows = pendingUsers.map((userEntry) => [
        userEntry.approvalRequestedAt || '',
        userEntry.name || '',
        userEntry.initials || '',
        userEntry.email || '',
        userEntry.id || ''
      ]);

      downloadCsv(
        'delphic-club-merch-pending-users.csv',
        ['approvalRequestedAt', 'name', 'initials', 'email', 'userId'],
        rows
      );
    });
  }

  renderOpenOrdersTable();
  renderFulfilledOrdersTable();
  renderPendingUsersTable();
  updateSummaryMessage();
  setActiveTab(
    openOrders.length > 0
      ? 'open'
      : pendingUsers.length > 0
        ? 'pending'
        : fulfilledOrders.length > 0
          ? 'fulfilled'
          : 'open'
  );
}

setupAuthPage();
setupMerchPage();
setupProductPage();
setupAdminOrdersPage();
