// Covers Phase 1: /api/data must reject readings that don't carry a valid
// per-device secret. Run against a local `vercel dev` server.

const test = require('node:test');
const assert = require('node:assert');
const { api, createTestClient, assignTestDevice } = require('./helpers');

const TEST_DEVICE_ID = `TEST_DEVICE_${Date.now()}`;
const TEST_EMAIL = `test-device-auth-${Date.now()}@example.com`;

let deviceSecret;

test('setup: create test client + assign device', async () => {
  await createTestClient(TEST_EMAIL);
  const assignRes = await assignTestDevice(TEST_DEVICE_ID, TEST_EMAIL);
  assert.ok(assignRes.deviceSecret, 'assign-device should return a one-time device secret');
  deviceSecret = assignRes.deviceSecret;
});

test('POST /api/data with no x-device-key is rejected', async () => {
  const res = await api('/api/data', {
    method: 'POST',
    headers: { 'x-device-id': TEST_DEVICE_ID },
    body: JSON.stringify({ status: 'NORMAL', accel: 0.04, gyro: 1.2, temp: 71 }),
  });
  assert.strictEqual(res.status, 401);
});

test('POST /api/data with wrong x-device-key is rejected', async () => {
  const res = await api('/api/data', {
    method: 'POST',
    headers: { 'x-device-id': TEST_DEVICE_ID, 'x-device-key': 'wrong-secret-entirely' },
    body: JSON.stringify({ status: 'NORMAL', accel: 0.04, gyro: 1.2, temp: 71 }),
  });
  assert.strictEqual(res.status, 401);
});

test('POST /api/data with the correct x-device-key succeeds', async () => {
  const res = await api('/api/data', {
    method: 'POST',
    headers: { 'x-device-id': TEST_DEVICE_ID, 'x-device-key': deviceSecret },
    body: JSON.stringify({ status: 'NORMAL', accel: 0.04, gyro: 1.2, temp: 71 }),
  });
  assert.strictEqual(res.status, 200);
});

test('POST /api/data with malformed numeric fields is rejected, not silently stored', async () => {
  const res = await api('/api/data', {
    method: 'POST',
    headers: { 'x-device-id': TEST_DEVICE_ID, 'x-device-key': deviceSecret },
    body: JSON.stringify({ status: 'NORMAL', accel: 'not-a-number', gyro: 1.2, temp: 71 }),
  });
  assert.strictEqual(res.status, 400);
});
