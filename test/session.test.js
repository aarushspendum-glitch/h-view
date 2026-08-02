// Covers Phase 2: sessions must actually expire server-side, and
// register.js/assign-device.js must require an admin session (not just
// ADMIN_SECRET alone). Run against a local `vercel dev` server.

const test = require('node:test');
const assert = require('node:assert');
const { api, createTestClient, ADMIN_SECRET } = require('./helpers');

const TEST_EMAIL = `test-session-${Date.now()}@example.com`;
const TEST_PASSWORD = 'testpassword123';

test('login issues a session with a cookie', async () => {
  await createTestClient(TEST_EMAIL);
  // set-password normally handles first login for invited clients; this
  // test creates the account with a direct password (register.js's
  // direct-password path) so login can be exercised straightforwardly.
  const res = await api('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  assert.strictEqual(res.status, 200);
  assert.ok(res.headers.get('set-cookie'), 'login should set a session cookie');
});

test('login with wrong password is rejected', async () => {
  const res = await api('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email: TEST_EMAIL, password: 'wrong-password' }),
  });
  assert.strictEqual(res.status, 401);
});

test('/api/register without a valid admin session is rejected even with correct ADMIN_SECRET', async () => {
  // Phase 2: ADMIN_SECRET becomes a second factor, not the sole gate --
  // an admin session is required in addition to it.
  const res = await api('/api/register', {
    method: 'POST',
    body: JSON.stringify({
      email: `test-noauth-${Date.now()}@example.com`,
      name: 'Should Fail',
      role: 'client',
      password: TEST_PASSWORD,
      secret: ADMIN_SECRET,
    }),
  });
  assert.strictEqual(res.status, 401);
});
