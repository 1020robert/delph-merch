const fs = require('fs');
const path = require('path');

const ensuredDataFiles = new Set();

function ensureDataFile(filePath) {
  if (ensuredDataFiles.has(filePath)) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '[]', 'utf8');
  }
  ensuredDataFiles.add(filePath);
}

function readJsonArray(filePath) {
  ensureDataFile(filePath);
  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJsonArray(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = {
  ensureDataFile,
  readJsonArray,
  writeJsonArray
};
