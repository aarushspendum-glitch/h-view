const { supabaseRequest } = require('./_utils/supabase');
const { timingSafeEqualStr, generateDeviceKey, makePasswordRecord } = require('./_utils/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { deviceId, userEmail, secret } = req.body || {};

  const expected = process.env.ADMIN_SECRET;
  if (!expected || !timingSafeEqualStr(secret || '', expected)) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  if (!deviceId || !userEmail) {
    return res.status(400).json({ error: 'deviceId and userEmail are required' });
  }

  try {
    const users = await supabaseRequest(`users?email=eq.${encodeURIComponent(userEmail)}&select=id`);
    const user = users && users[0];
    if (!user) return res.status(404).json({ error: 'No user with that email' });

    // The device secret is tied to the physical unit, not to which client
    // it's assigned to -- only generate one the first time this device ID
    // is seen. Reassigning an already-provisioned device to a different
    // client must not require reflashing it with a new secret.
    const existing = await supabaseRequest(`devices?id=eq.${encodeURIComponent(deviceId)}&select=device_secret_hash`);
    const alreadyProvisioned = existing && existing[0] && existing[0].device_secret_hash;

    let deviceSecret = null;
    const deviceRecord = { id: deviceId, user_id: user.id, name: deviceId };

    if (!alreadyProvisioned) {
      deviceSecret = generateDeviceKey();
      deviceRecord.device_secret_hash = makePasswordRecord(deviceSecret);
    }

    await supabaseRequest('devices?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(deviceRecord),
    });

    // deviceSecret is only non-null on first provisioning -- this is the one
    // and only time it's ever shown in plaintext. It is not recoverable
    // afterward; re-provisioning issues a new one and requires reflashing.
    return res.status(200).json({ success: true, deviceSecret, newlyProvisioned: !!deviceSecret });
  } catch (err) {
    console.error('assign-device error:', err);
    return res.status(500).json({ error: 'Failed to assign device' });
  }
};
