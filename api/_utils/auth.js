const crypto = require('crypto');

function hashWithSalt(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function makePasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashWithSalt(password, salt);
  return `${salt}:${hash}`;
}

function verifyPassword(password, record) {
  if (!record || typeof record !== 'string' || !record.includes(':')) return false;
  const [salt, hash] = record.split(':');
  const candidate = hashWithSalt(password, salt);
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { makePasswordRecord, verifyPassword, generateToken, timingSafeEqualStr };
