async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Something went wrong');
  }
  return data;
}

function setMessage(el, text, type = '') {
  if (!el) return;
  el.textContent = text;
  el.className = `message ${type}`.trim();
}

function startMerchLoadingTransition() {
  sessionStorage.setItem('showMerchLoader', '1');
}

async function setupAuthPage() {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  if (!loginForm || !registerForm) return;

  try {
    await api('/api/auth/me');
    window.location.href = '/merch.html';
    return;
  } catch {
    // No active session, show auth forms.
  }

  const loginTab = document.getElementById('loginTab');
  const registerTab = document.getElementById('registerTab');
  const messageEl = document.getElementById('authMessage');

  function showTab(tab) {
    const onLogin = tab === 'login';
    loginTab.classList.toggle('active', onLogin);
    registerTab.classList.toggle('active', !onLogin);
    loginForm.classList.toggle('active', onLogin);
    registerForm.classList.toggle('active', !onLogin);
    setMessage(messageEl, '');
  }

  loginTab.addEventListener('click', () => showTab('login'));
  registerTab.addEventListener('click', () => showTab('register'));

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setMessage(messageEl, 'Signing in...');

    const formData = new FormData(loginForm);
    const payload = {
      email: formData.get('email'),
      password: formData.get('password')
    };

    try {
      await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      startMerchLoadingTransition();
      window.location.href = '/merch.html';
    } catch (err) {
      setMessage(messageEl, err.message, 'error');
    }
  });

  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setMessage(messageEl, 'Creating account...');

    const formData = new FormData(registerForm);
    const payload = {
      name: formData.get('name'),
      email: formData.get('email'),
      password: formData.get('password')
    };

    try {
      await api('/api/auth/register', {
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
  const userInfo = document.getElementById('userInfo');
  const orderMessage = document.getElementById('orderMessage');
  const logoutBtn = document.getElementById('logoutBtn');

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
      }, 1200);
      sessionStorage.removeItem('showMerchLoader');
    } else {
      loadingOverlay.classList.add('hidden');
    }
  }

  userInfo.textContent = `${user.name} (${user.email})`;

  logoutBtn.addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  });

  const merch = await api('/api/merch');

  merch.items.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'item-card';
    card.innerHTML = `
      <h3 class="item-name">${item.name}</h3>
      <p>Price: $${item.price}</p>
      <label>
        Quantity
        <input type="number" min="1" max="50" value="1" />
      </label>
      <label class="venmo-row">
        <input type="checkbox" />
        I agree to pay by Venmo.
      </label>
      <button class="primary-btn" type="button">Buy</button>
    `;

    const quantityInput = card.querySelector('input[type="number"]');
    const venmoBox = card.querySelector('input[type="checkbox"]');
    const buyButton = card.querySelector('button');

    buyButton.addEventListener('click', async () => {
      setMessage(orderMessage, 'Submitting order...');
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
          orderMessage,
          `Order received for ${data.order.quantity} x ${item.name}.${emailInfo}`,
          'success'
        );
      } catch (err) {
        setMessage(orderMessage, err.message, 'error');
      }
    });

    merchGrid.appendChild(card);
  });
}

setupAuthPage();
setupMerchPage();
