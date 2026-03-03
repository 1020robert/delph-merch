# Delphic Club Merch

Delphic Club merch storefront with:
- Email sign-in and account creation (first name, last name, initials)
- Owner-only order dashboard (`1020rjl@gmail.com`)
- Product catalog and product detail checkout flow
- Venmo agreement + quantity capture per order
- Optional owner email notification for new orders
- JSON-file persistence (Render disk friendly)

## Project Layout

```text
.
├── public/              # Frontend pages, JS, CSS, static images
├── src/
│   ├── config.js        # App constants and env-derived config
│   └── services/        # Backend domain services
│       ├── auth.js
│       ├── email.js
│       ├── merch.js
│       ├── storage.js
│       └── uploads.js
├── data/                # Local JSON data store
├── server.js            # Express app + route wiring
├── render.yaml          # Render blueprint
└── .env.example
```

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example` and set values.

Required:
- `PORT` (default: `3000`)
- `SESSION_SECRET`
- `DATA_DIR` (default: `./data`)
- `COOKIE_SECURE` (`false` locally, `true` in production)
- `OWNER_EMAIL` (defaults to `1020rjl@gmail.com` in code)

Optional (order emails):
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_SECURE`

3. Start server:

```bash
npm start
```

4. Open:

- `http://localhost:3000`

## Deploy (Render)

This repo includes `render.yaml`.

1. Push to GitHub.
2. In Render, create a **Blueprint** from this repo.
3. Ensure env vars are set in Render service settings.
4. Deploy.

`render.yaml` mounts persistent storage at `/var/data`, so user/order/product data survives restarts.

## Notes

- Sessions are in-memory; restarting the service signs users out.
- Data is JSON-backed. For higher scale, migrate to a database and persistent session store.
