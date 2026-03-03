const nodemailer = require('nodemailer');

const { OWNER_EMAIL } = require('../config');

function buildTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';

  if (!host || !user || !pass || !OWNER_EMAIL) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function maybeSendOrderEmail(order, user, item) {
  const transport = buildTransport();
  if (!transport) {
    return { emailed: false, reason: 'Email not configured' };
  }

  const subject = `New Club Merch pre-order: ${item.name}`;
  const body = [
    'A new merch pre-order was placed.',
    '',
    `Name: ${user.name}`,
    `Email: ${user.email}`,
    `Item: ${item.name}`,
    `Size: ${order.selectedSize || 'N/A'}`,
    `Include Initials: ${order.includeInitials ? 'Yes' : 'No'}`,
    `Unit Price: $${Number(order.unitPrice || 0).toFixed(2)}`,
    `Total: $${Number(order.totalPrice || 0).toFixed(2)}`,
    `Quantity: ${order.quantity}`,
    `Venmo Agreed: ${order.venmoAgreed ? 'Yes' : 'No'}`,
    `Ordered At: ${order.createdAt}`,
    `Order ID: ${order.id}`
  ].join('\n');

  const mailOptions = {
    from: process.env.SMTP_USER,
    to: OWNER_EMAIL,
    subject,
    text: body
  };

  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await transport.sendMail(mailOptions);
      return { emailed: true };
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        await wait(500);
      }
    }
  }

  return {
    emailed: false,
    reason: 'Owner notification unavailable',
    error: lastError ? String(lastError.message || lastError) : 'Unknown email error'
  };
}

module.exports = {
  maybeSendOrderEmail
};
