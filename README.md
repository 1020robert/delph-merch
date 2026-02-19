# Club Merch Website

Simple website with:
- Google sign-in
- Required signup details for new users: first name, last name, initials
- Admin approval required for new accounts
- Signup notification email sent to admin when someone signs up
- One merch page where signed-in users can choose an item, confirm Venmo agreement, and enter quantity
- Orders automatically saved with signed-in user name/email
- Optional email notification to you for each order

## 1) Install

```bash
npm install
```

## 2) Configure

Create a `.env` file from `.env.example` and set:

- `PORT`: default `3000`
- `PUBLIC_BASE_URL`: full URL of your app (used in approval email links)
- `SESSION_SECRET`: long random secret
- `DATA_DIR`: folder for persistent `users.json` and `orders.json` (default `./data`)
- `COOKIE_SECURE`: use `true` in production HTTPS
- `OWNER_EMAIL`: your email address
- `GOOGLE_CLIENT_ID`: Google OAuth web client ID
- SMTP vars: required for approval/order emails

## 3) Google setup

1. In Google Cloud Console, create OAuth client credentials for a **Web application**.
2. Add authorized JavaScript origins (example: `http://localhost:3000`).
3. Put that client ID in `GOOGLE_CLIENT_ID`.

## 4) Run

```bash
npm start
```

Open `http://localhost:3000`.

## 5) Deploy on Render

This repo includes a `render.yaml` blueprint for quick setup.

1. Push your latest code to GitHub.
2. In Render, click **New +** -> **Blueprint**.
3. Select this repo and deploy.
4. Render will create:
   - a Node web service
   - a persistent disk mounted at `/var/data`
5. In Render service settings -> **Environment**, set these secrets/values:
   - `PUBLIC_BASE_URL=https://<your-render-service>.onrender.com`
   - `OWNER_EMAIL=1020rjl@gmail.com`
   - `SESSION_SECRET=<long-random-string>`
   - `GOOGLE_CLIENT_ID=<your-google-client-id>`
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`
6. Redeploy after env vars are set.

### Google OAuth for production URL

In Google Cloud Console for your OAuth client:

1. Add Authorized JavaScript origin:
   - `https://<your-render-service>.onrender.com`
2. Keep local origin too if you still test locally:
   - `http://localhost:3000`
3. If your OAuth consent screen is in **Testing**, add each allowed user under **Test users**.
4. If you want everyone in your club to sign in, publish consent screen to **Production**.

## Approval flow

- New user signs in with Google.
- New user must complete signup details: first name, last name, initials.
- Account is then created as `approved: false`.
- You get a signup notification email with an approval link.
- After you click the link, that user can sign in and access merch.

## How order info gets to you

- Every order is saved in `data/orders.json` with:
  - user name
  - user email
  - item
  - quantity
  - timestamp
- If SMTP + `OWNER_EMAIL` are configured, each order also triggers an email to you.

## Notes

- Sessions are in memory (server restart clears active sessions).
- Data is stored in JSON files in `DATA_DIR` (`/var/data` on Render via persistent disk).
- For production, use HTTPS, secure cookies, persistent session store, and a real database.
