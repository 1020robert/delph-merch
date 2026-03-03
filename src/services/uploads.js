const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { UPLOADS_DIR } = require('../config');

function saveUploadedPngDataUrl(imageDataUrl, itemId) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(imageDataUrl || '').trim());
  if (!match) {
    return { error: 'Image must be a PNG upload' };
  }

  const imageBuffer = Buffer.from(match[1], 'base64');
  if (imageBuffer.length === 0) {
    return { error: 'Uploaded image is empty' };
  }
  if (imageBuffer.length > 5 * 1024 * 1024) {
    return { error: 'Uploaded image must be under 5MB' };
  }

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const filename = `${itemId}-${crypto.randomBytes(3).toString('hex')}.png`;
  const filePath = path.join(UPLOADS_DIR, filename);
  fs.writeFileSync(filePath, imageBuffer);
  return { imagePath: `/uploads/${filename}` };
}

function removeUploadedImage(imagePath) {
  const normalized = String(imagePath || '');
  if (!normalized.startsWith('/uploads/')) {
    return;
  }

  const filename = path.basename(normalized);
  if (!/^[A-Za-z0-9._-]+$/.test(filename)) {
    return;
  }

  const absolutePath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(absolutePath)) {
    return;
  }

  try {
    fs.unlinkSync(absolutePath);
  } catch {
    // Ignore file-delete issues; product is already removed from catalog.
  }
}

module.exports = {
  saveUploadedPngDataUrl,
  removeUploadedImage
};
