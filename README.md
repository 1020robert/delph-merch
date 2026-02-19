# Club Merch Website

Simple website with:
- Sign up + sign in
- One merch page where signed-in users can choose an item, confirm Venmo agreement, and enter quantity
- Orders automatically saved with signed-in user name/email
- Optional email notification to you for each order

## 1) Install

```bash
npm install
```

## 2) Configure

Copy `.env.example` values into your environment (or use a `.env` loader if you prefer):

- `PORT`: default `3000`
- `SESSION_SECRET`: set this to a long random secret in production
- `OWNER_EMAIL`: your email address
- SMTP vars are optional, but required if you want automatic email notifications

## 3) Run

```bash
npm start
```

Open `http://localhost:3000`.

## How order info gets to you

- Every order is saved in `data/orders.json` with:
  - user name
  - user email
  - item
  - quantity
  - timestamp
- If SMTP + `OWNER_EMAIL` are configured, each order also triggers an email to you.

## Notes

- This starter keeps sessions in memory (restart clears active sessions).
- Data is stored in local JSON files.
- For production, use HTTPS, secure cookies, persistent session store, and a real database.
