// Shared helpers for the integration test suite. These tests hit a real
// `vercel dev` server (so they exercise the actual deployed code path, not
// mocks) -- start `vercel dev` locally before running `npm test`.

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const ADMIN_SECRET = process.env.ADMIN_SECRET;

function url(path) {
  return `${BASE_URL}${path}`;
}

async function api(path, options = {}) {
  const res = await fetch(url(path), {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON response, leave body null
  }
  return { status: res.status, body, headers: res.headers };
}

// Creates a throwaway client user + device via the admin endpoints, for use
// as test fixtures. Requires ADMIN_SECRET to be set in the test environment
// (same value as the deployed ADMIN_SECRET) and an existing admin session
// is NOT required for these two endpoints specifically, since they're
// gated by ADMIN_SECRET as a standalone factor (Phase 2 adds session-gating
// on top of, not instead of, this).
async function createTestClient(email, name = 'Test Client') {
  const res = await api('/api/register', {
    method: 'POST',
    body: JSON.stringify({ email, name, role: 'client', password: 'testpassword123', secret: ADMIN_SECRET }),
  });
  if (!res.body || !res.body.user) {
    throw new Error(`createTestClient failed: ${JSON.stringify(res.body)}`);
  }
  return res.body.user;
}

async function assignTestDevice(deviceId, clientEmail) {
  const res = await api('/api/assign-device', {
    method: 'POST',
    body: JSON.stringify({ deviceId, userEmail: clientEmail, secret: ADMIN_SECRET }),
  });
  return res.body;
}

module.exports = { api, url, createTestClient, assignTestDevice, ADMIN_SECRET, BASE_URL };
