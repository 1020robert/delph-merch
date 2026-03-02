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
const MERCH_CACHE_KEY = 'merchItemsCacheV4';
const MERCH_CACHE_TTL_MS = 30 * 1000;

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
    if (Array.isArray(parsed)) return parsed; // backward compatibility
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.items)) return null;
    if (Number(parsed.cachedAt || 0) + MERCH_CACHE_TTL_MS < Date.now()) return null;
    return parsed.items;
  } catch {
    return null;
  }
}

function writeCachedMerchItems(items) {
  try {
    sessionStorage.setItem(
      MERCH_CACHE_KEY,
      JSON.stringify({
        cachedAt: Date.now(),
        items
      })
    );
  } catch {
    // Ignore storage write errors (private mode/quota/etc.)
  }
}

function clearCachedMerchItems() {
  try {
    sessionStorage.removeItem(MERCH_CACHE_KEY);
  } catch {
    // Ignore storage cleanup errors.
  }
}

async function getMerchItems({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cachedItems = readCachedMerchItems();
    if (cachedItems) return cachedItems;
  }

  const merch = await api('/api/merch');
  const items = Array.isArray(merch.items) ? merch.items : [];
  writeCachedMerchItems(items);
  return items;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
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
      if (err.status === 409) {
        try {
          const fallbackLogin = await api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: payload.email })
          });
          if (fallbackLogin.passwordRequired) {
            showPasswordStep();
            return;
          }
          continueToMerchPage();
          return;
        } catch (fallbackErr) {
          setMessage(emailMessageEl, fallbackErr.message, 'error');
          return;
        }
      }
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

  const items = await getMerchItems({ forceRefresh: true });
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
  const productOptions = document.getElementById('productOptions');
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

  const items = await getMerchItems({ forceRefresh: true });
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

  let selectedSize = Array.isArray(item.sizes) && item.sizes.length > 0 ? item.sizes[0] : null;
  let initialsCheckbox = null;

  if (productOptions) {
    productOptions.innerHTML = '';

    if (Array.isArray(item.sizes) && item.sizes.length > 0) {
      const sizeSection = document.createElement('section');
      sizeSection.className = 'product-option-section';
      sizeSection.innerHTML = `
        <p class="product-option-label">Select Size</p>
        <div class="product-option-grid" id="productSizeGrid"></div>
      `;
      const sizeGrid = sizeSection.querySelector('#productSizeGrid');
      item.sizes.forEach((size, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `option-btn ${index === 0 ? 'active' : ''}`.trim();
        button.textContent = size;
        button.addEventListener('click', () => {
          selectedSize = size;
          sizeGrid.querySelectorAll('.option-btn').forEach((candidate) => {
            candidate.classList.remove('active');
          });
          button.classList.add('active');
        });
        sizeGrid.appendChild(button);
      });
      productOptions.appendChild(sizeSection);
    }

    if (item.allowInitials) {
      const initialsRow = document.createElement('label');
      initialsRow.className = 'initials-row';
      initialsRow.innerHTML = `
        <input id="productIncludeInitials" type="checkbox" />
        Include initials
      `;
      initialsCheckbox = initialsRow.querySelector('#productIncludeInitials');
      productOptions.appendChild(initialsRow);
    }
  }

  orderButton.addEventListener('click', async () => {
    if (Array.isArray(item.sizes) && item.sizes.length > 0 && !selectedSize) {
      setMessage(messageEl, 'Please select a size.', 'error');
      return;
    }

    setMessage(messageEl, 'Submitting pre-order...');
    orderButton.disabled = true;
    try {
      const data = await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          itemId: item.id,
          selectedSize,
          includeInitials: Boolean(initialsCheckbox?.checked),
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
      if (initialsCheckbox) initialsCheckbox.checked = false;
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
  const manageProductsPanel = document.getElementById('manageProductsPanel');
  const openOrdersTabBtn = document.getElementById('openOrdersTabBtn');
  const fulfilledOrdersTabBtn = document.getElementById('fulfilledOrdersTabBtn');
  const manageProductsTabBtn = document.getElementById('manageProductsTabBtn');
  const ordersMessage = document.getElementById('ordersMessage');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const addProductForm = document.getElementById('addProductForm');
  const productFormMessage = document.getElementById('productFormMessage');
  const ownerProductsList = document.getElementById('ownerProductsList');
  const newProductName = document.getElementById('newProductName');
  const newProductPrice = document.getElementById('newProductPrice');
  const newProductImage = document.getElementById('newProductImage');
  const newProductIncludeSizes = document.getElementById('newProductIncludeSizes');
  const newProductAllowInitials = document.getElementById('newProductAllowInitials');

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

  let ownerProducts = [];
  let activeTab = 'open';

  function setActiveTab(tab) {
    if (tab === 'fulfilled') {
      activeTab = 'fulfilled';
    } else if (tab === 'products') {
      activeTab = 'products';
    } else {
      activeTab = 'open';
    }

    if (openOrdersPanel) {
      openOrdersPanel.classList.toggle('hidden', activeTab !== 'open');
    }
    if (fulfilledOrdersPanel) {
      fulfilledOrdersPanel.classList.toggle('hidden', activeTab !== 'fulfilled');
    }
    if (manageProductsPanel) {
      manageProductsPanel.classList.toggle('hidden', activeTab !== 'products');
    }

    if (openOrdersTabBtn) {
      openOrdersTabBtn.classList.toggle('active', activeTab === 'open');
    }
    if (fulfilledOrdersTabBtn) {
      fulfilledOrdersTabBtn.classList.toggle('active', activeTab === 'fulfilled');
    }
    if (manageProductsTabBtn) {
      manageProductsTabBtn.classList.toggle('active', activeTab === 'products');
    }
    if (exportCsvBtn) {
      exportCsvBtn.disabled = activeTab === 'products';
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
      emptyRow.innerHTML = '<td class="order-empty-cell" colspan="10">No open orders.</td>';
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
        <td>${escapeHtml(order.selectedSize || '')}</td>
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
      emptyRow.innerHTML = '<td class="order-empty-cell" colspan="10">No fulfilled orders yet.</td>';
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
        <td>${escapeHtml(order.selectedSize || '')}</td>
        <td>${order.includeInitials ? 'Yes' : 'No'}</td>
        <td>${escapeHtml(order.quantity || '')}</td>
        <td>${order.venmoAgreed ? 'Yes' : 'No'}</td>
      `;
      fulfilledOrdersTableBody.appendChild(row);
    });
  }

  function renderOwnerProducts() {
    if (!ownerProductsList) return;
    ownerProductsList.innerHTML = '';

    if (ownerProducts.length === 0) {
      ownerProductsList.innerHTML = '<p class="message">No products yet.</p>';
      return;
    }

    ownerProducts
      .slice()
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .forEach((item) => {
        const includeSizes = Array.isArray(item.sizes) && item.sizes.length > 0;
        const isLive = !item.paused;
        const card = document.createElement('article');
        card.className = 'owner-product-card';
        const sizesText = includeSizes ? 'S, M, L, XL, 2XL' : 'Off';
        card.innerHTML = `
          <img src="${escapeHtml(item.image || '')}" alt="${escapeHtml(item.name || 'Product')}" class="owner-product-thumb" loading="lazy" decoding="async" />
          <div>
            <h4 class="owner-product-name">${escapeHtml(item.name || '')}</h4>
            <p class="owner-product-price">${formatCurrency(item.price)}</p>
            <p class="owner-product-meta">Sizes: ${escapeHtml(sizesText)}</p>
            <p class="owner-product-meta">Status: ${isLive ? 'Live' : 'Paused'}</p>
            <div class="owner-product-controls">
              <label class="owner-toggle-row">
                <input type="checkbox" data-action="toggle-sizes" ${includeSizes ? 'checked' : ''} />
                Include sizes (S, M, L, XL, 2XL)
              </label>
              <label class="owner-toggle-row">
                <input type="checkbox" data-action="toggle-initials" ${item.allowInitials ? 'checked' : ''} />
                Allow initials option
              </label>
              <label class="owner-toggle-row">
                <input type="checkbox" data-action="toggle-live" ${isLive ? 'checked' : ''} />
                Live on shop
              </label>
            </div>
          </div>
        `;

        const toggleSizesInput = card.querySelector('[data-action="toggle-sizes"]');
        const toggleInitialsInput = card.querySelector('[data-action="toggle-initials"]');
        const toggleLiveInput = card.querySelector('[data-action="toggle-live"]');

        async function updateItemSettings(patch, changedInput, fallbackValue, successMessage) {
          if (!changedInput) return;
          changedInput.disabled = true;
          try {
            await api(`/api/admin/merch/${encodeURIComponent(item.id)}`, {
              method: 'PATCH',
              body: JSON.stringify(patch)
            });
            clearCachedMerchItems();
            await refreshOwnerProducts();
            setMessage(productFormMessage, successMessage, 'success');
          } catch (err) {
            changedInput.checked = fallbackValue;
            setMessage(productFormMessage, err.message, 'error');
          } finally {
            changedInput.disabled = false;
          }
        }

        if (toggleSizesInput) {
          toggleSizesInput.addEventListener('change', () => {
            const nextValue = toggleSizesInput.checked;
            updateItemSettings(
              { includeSizes: nextValue },
              toggleSizesInput,
              includeSizes,
              `Updated sizes for ${item.name}.`
            );
          });
        }

        if (toggleInitialsInput) {
          toggleInitialsInput.addEventListener('change', () => {
            const nextValue = toggleInitialsInput.checked;
            updateItemSettings(
              { allowInitials: nextValue },
              toggleInitialsInput,
              Boolean(item.allowInitials),
              `Updated initials option for ${item.name}.`
            );
          });
        }

        if (toggleLiveInput) {
          toggleLiveInput.addEventListener('change', () => {
            const nextLiveValue = toggleLiveInput.checked;
            updateItemSettings(
              { paused: !nextLiveValue },
              toggleLiveInput,
              isLive,
              nextLiveValue ? `${item.name} is now live.` : `${item.name} is now paused.`
            );
          });
        }

        ownerProductsList.appendChild(card);
      });
  }

  async function refreshOwnerProducts() {
    if (!ownerProductsList) return;

    try {
      const response = await api('/api/admin/merch');
      ownerProducts = Array.isArray(response.items) ? response.items : [];
      renderOwnerProducts();
    } catch (err) {
      ownerProductsList.innerHTML = `<p class="message error">${escapeHtml(err.message)}</p>`;
    }
  }

  if (openOrdersTabBtn) {
    openOrdersTabBtn.addEventListener('click', () => setActiveTab('open'));
  }
  if (fulfilledOrdersTabBtn) {
    fulfilledOrdersTabBtn.addEventListener('click', () => setActiveTab('fulfilled'));
  }
  if (manageProductsTabBtn) {
    manageProductsTabBtn.addEventListener('click', () => {
      setActiveTab('products');
      setMessage(ordersMessage, '');
    });
  }

  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
      if (activeTab === 'products') {
        setMessage(ordersMessage, 'CSV export is available for order tabs only.', 'error');
        return;
      }
      if (activeTab === 'open') {
        const rows = openOrders.map((order) => [
          order.createdAt || '',
          order.userName || '',
          order.userInitials || '',
          order.userEmail || '',
          order.itemName || '',
          order.selectedSize || '',
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
            'selectedSize',
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
          order.selectedSize || '',
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
            'selectedSize',
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

  if (
    addProductForm &&
    newProductName &&
    newProductPrice &&
    newProductImage &&
    newProductIncludeSizes &&
    newProductAllowInitials
  ) {
    addProductForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      const name = String(newProductName.value || '').trim();
      const price = Number(newProductPrice.value || '');
      const imageFile = newProductImage.files?.[0] || null;

      if (!name) {
        setMessage(productFormMessage, 'Product name is required.', 'error');
        return;
      }
      if (!Number.isFinite(price) || price <= 0) {
        setMessage(productFormMessage, 'Valid product price is required.', 'error');
        return;
      }
      if (!imageFile) {
        setMessage(productFormMessage, 'Please choose a PNG image.', 'error');
        return;
      }
      const isPngFile =
        String(imageFile.type || '').toLowerCase() === 'image/png' ||
        String(imageFile.name || '').toLowerCase().endsWith('.png');
      if (!isPngFile) {
        setMessage(productFormMessage, 'Image must be a PNG file.', 'error');
        return;
      }

      setMessage(productFormMessage, 'Publishing product...');

      try {
        const imageDataUrl = await readFileAsDataUrl(imageFile);
        await api('/api/admin/merch', {
          method: 'POST',
          body: JSON.stringify({
            name,
            price,
            imageDataUrl,
            includeSizes: Boolean(newProductIncludeSizes.checked),
            allowInitials: Boolean(newProductAllowInitials.checked)
          })
        });

        clearCachedMerchItems();
        addProductForm.reset();
        await refreshOwnerProducts();
        setMessage(productFormMessage, 'Product published and live on shop.', 'success');
      } catch (err) {
        setMessage(productFormMessage, err.message, 'error');
      }
    });
  }

  renderOpenOrdersTable();
  renderFulfilledOrdersTable();
  await refreshOwnerProducts();
  updateSummaryMessage();
  setActiveTab(openOrders.length > 0 || fulfilledOrders.length === 0 ? 'open' : 'fulfilled');
}

setupAuthPage();
setupMerchPage();
setupProductPage();
setupAdminOrdersPage();
