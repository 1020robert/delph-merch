const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const STATIC_DIR = path.join(ROOT_DIR, 'public');

const PORT = Number(process.env.PORT) || 3000;
const OWNER_EMAIL = String(process.env.OWNER_EMAIL || '1020rjl@gmail.com').trim().toLowerCase();
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const SHARED_LOGIN_PASSWORD = String(process.env.LOGIN_PASSWORD || '').trim();
const PASSWORD_GATE_ENABLED = false;

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT_DIR, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

const COOKIE_SECURE =
  String(process.env.COOKIE_SECURE || process.env.NODE_ENV === 'production').toLowerCase() ===
  'true';

const USERS_PATH = path.join(DATA_DIR, 'users.json');
const ORDERS_PATH = path.join(DATA_DIR, 'orders.json');
const MERCH_ITEMS_PATH = path.join(DATA_DIR, 'merch-items.json');

const SESSION_COOKIE = 'club_session';

const STANDARD_SIZES = ['S', 'M', 'L', 'XL', '2XL'];

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

module.exports = {
  STATIC_DIR,
  PORT,
  OWNER_EMAIL,
  SESSION_SECRET,
  SHARED_LOGIN_PASSWORD,
  PASSWORD_GATE_ENABLED,
  DATA_DIR,
  UPLOADS_DIR,
  COOKIE_SECURE,
  USERS_PATH,
  ORDERS_PATH,
  MERCH_ITEMS_PATH,
  SESSION_COOKIE,
  STANDARD_SIZES,
  DEFAULT_MERCH_ITEMS
};
