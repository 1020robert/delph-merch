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

function isOwnerAccount(user) {
  const email = String(user?.email || '')
    .trim()
    .toLowerCase();
  return email === OWNER_ACCOUNT_EMAIL;
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

  let pendingSignupToken = '';

  function showSignupForm(data) {
    const firstNameInput = signupForm.elements.firstName;
    const lastNameInput = signupForm.elements.lastName;
    const initialsInput = signupForm.elements.initials;

    signupEmailEl.textContent = `Google account: ${data.email}`;
    firstNameInput.value = data.suggestedProfile?.firstName || '';
    lastNameInput.value = data.suggestedProfile?.lastName || '';
    initialsInput.value = data.suggestedProfile?.initials || '';
    signupForm.classList.remove('hidden');
  }

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

        if (data.signupRequired) {
          pendingSignupToken = data.signupToken;
          showSignupForm(data);
          setMessage(
            messageEl,
            'Complete signup details (first name, last name, initials) to continue.',
            'success'
          );
          return;
        }

        startMerchLoadingTransition();
        window.location.href = '/merch.html';
      } catch (err) {
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

    if (!pendingSignupToken) {
      setMessage(messageEl, 'Start with Google sign-in first.', 'error');
      return;
    }

    const payload = {
      signupToken: pendingSignupToken,
      firstName: signupForm.elements.firstName.value,
      lastName: signupForm.elements.lastName.value,
      initials: signupForm.elements.initials.value
    };

    setMessage(messageEl, 'Submitting signup...');

    try {
      await api('/api/auth/google/signup', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      startMerchLoadingTransition();
      window.location.href = '/merch.html';
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

  const merch = await api('/api/merch');
  if ((merch.items || []).length === 1) {
    merchGrid.classList.add('single-item');
  }

  merch.items.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'catalog-card';

    card.innerHTML = `
      <a class="catalog-link" href="/product.html?item=${encodeURIComponent(item.id)}">
        <div class="item-photo-wrap catalog-photo-wrap">
          <img src="${item.image || '/glass.JPG'}" alt="${item.name}" class="item-photo catalog-photo" />
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
  const includeInitialsBox = document.getElementById('productIncludeInitials');
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

  const merch = await api('/api/merch');
  const itemIdFromUrl = new URLSearchParams(window.location.search).get('item');
  const item =
    merch.items.find((candidate) => candidate.id === itemIdFromUrl) ||
    merch.items.find((candidate) => candidate.id === 'glass') ||
    merch.items[0];

  if (!item) {
    setMessage(messageEl, 'Product not found.', 'error');
    return;
  }

  productTitle.textContent = item.name;
  productPrice.textContent = formatCurrency(item.price);
  productImage.src = item.image || '/glass.JPG';
  productImage.alt = item.name;

  orderButton.addEventListener('click', async () => {
    setMessage(messageEl, 'Submitting order...');
    orderButton.disabled = true;
    try {
      const data = await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          itemId: item.id,
          includeInitials: Boolean(includeInitialsBox?.checked),
          quantity: Number(quantityInput.value),
          venmoAgreed: venmoBox.checked
        })
      });

      const emailInfo = data.emailStatus.emailed
        ? ' Order email sent.'
        : ` Order saved. (${data.emailStatus.reason})`;

      setMessage(
        messageEl,
        `Order received for ${data.order.quantity} x ${item.name}. Include initials: ${data.order.includeInitials ? 'Yes' : 'No'}.${emailInfo} Returning to merch page...`,
        'success'
      );
      quantityInput.value = '1';
      venmoBox.checked = false;
      if (includeInitialsBox) includeInitialsBox.checked = false;
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
  const ordersTableBody = document.getElementById('ordersTableBody');
  if (!ordersTableBody) return;

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

  let orders = [];
  try {
    const response = await api('/api/admin/orders');
    orders = response.orders || [];
  } catch (err) {
    setMessage(ordersMessage, err.message, 'error');
    return;
  }

  if (orders.length === 0) {
    setMessage(ordersMessage, 'No orders yet.');
  } else {
    setMessage(ordersMessage, `${orders.length} order(s) loaded.`, 'success');
  }

  orders.forEach((order) => {
    const row = document.createElement('tr');
    const orderedAt = order.createdAt ? new Date(order.createdAt).toLocaleString() : '';
    row.innerHTML = `
      <td>${orderedAt}</td>
      <td>${order.userName || ''}</td>
      <td>${order.userInitials || ''}</td>
      <td>${order.userEmail || ''}</td>
      <td>${order.itemName || ''}</td>
      <td>${order.includeInitials ? 'Yes' : 'No'}</td>
      <td>${order.quantity || ''}</td>
      <td>${order.venmoAgreed ? 'Yes' : 'No'}</td>
    `;
    ordersTableBody.appendChild(row);
  });

  exportCsvBtn.addEventListener('click', () => {
    const rows = orders.map((order) => [
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
      'delphic-club-merch-orders.csv',
      ['createdAt', 'userName', 'userInitials', 'userEmail', 'itemName', 'includeInitials', 'quantity', 'venmoAgreed', 'itemId', 'userId', 'orderId'],
      rows
    );
  });
}

setupAuthPage();
setupMerchPage();
setupProductPage();
setupAdminOrdersPage();
