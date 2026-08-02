const { supabaseRequest } = require('./_utils/supabase');
const { sendEmail } = require('./_utils/email');
const { verifyPassword } = require('./_utils/auth');

const SITE_URL = 'https://h-view.vercel.app';
const ALERT_STATUSES = ['WARNING', 'CRITICAL'];
const VALID_STATUSES = ['NORMAL', 'WARNING', 'CRITICAL', 'SENSOR_FAULT'];

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const deviceId = req.headers['x-device-id'];
  const deviceKey = req.headers['x-device-key'];
  if (!deviceId) return res.status(400).json({ error: 'Missing x-device-id header' });
  if (!deviceKey) return res.status(401).json({ error: 'Missing x-device-key header' });

  const {
    status,
    accel,
    gyro,
    temp,
    accelSigma,
    gyroSigma,
    accelBaseMean,
    accelBaseStd,
    gyroBaseMean,
    gyroBaseStd,
  } = req.body || {};

  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${VALID_STATUSES.join(', ')}` });
  }
  const numericFields = { accel, gyro, temp, accelSigma, gyroSigma, accelBaseMean, accelBaseStd, gyroBaseMean, gyroBaseStd };
  for (const [key, value] of Object.entries(numericFields)) {
    if (value !== undefined && value !== null && !isFiniteNumber(value)) {
      return res.status(400).json({ error: `${key} must be a finite number` });
    }
  }

  try {
    const devices = await supabaseRequest(
      `devices?id=eq.${encodeURIComponent(deviceId)}&select=device_secret_hash`
    );
    const device = devices && devices[0];
    if (!device || !verifyPassword(deviceKey, device.device_secret_hash)) {
      return res.status(401).json({ error: 'Invalid device credentials' });
    }

    let previousStatus = null;
    if (ALERT_STATUSES.includes(status)) {
      const prev = await supabaseRequest(
        `readings?device_id=eq.${encodeURIComponent(deviceId)}&select=status&order=created_at.desc&limit=1`
      );
      previousStatus = prev && prev[0] ? prev[0].status : null;
    }

    await supabaseRequest('readings', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        device_id: deviceId,
        status,
        accel,
        gyro,
        temp,
        accel_sigma: accelSigma,
        gyro_sigma: gyroSigma,
        accel_base_mean: accelBaseMean,
        accel_base_std: accelBaseStd,
        gyro_base_mean: gyroBaseMean,
        gyro_base_std: gyroBaseStd,
      }),
    });

    // Only alert on a transition into (or between) bad states -- not on every single reading
    if (ALERT_STATUSES.includes(status) && status !== previousStatus) {
      const devices = await supabaseRequest(
        `devices?id=eq.${encodeURIComponent(deviceId)}&select=user_id,name`
      );
      const device = devices && devices[0];
      if (device) {
        const users = await supabaseRequest(`users?id=eq.${device.user_id}&select=email,name`);
        const user = users && users[0];
        if (user) {
          await sendEmail({
            to: user.email,
            subject: `H-VIEW alert: ${device.name || deviceId} is ${status}`,
            html: `
              <p>Hi ${user.name},</p>
              <p>Your device <strong>${device.name || deviceId}</strong> just changed status to <strong>${status}</strong>.</p>
              <p><a href="${SITE_URL}/dashboard">View your dashboard</a></p>
            `,
          });
        }
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('data error:', err);
    return res.status(500).json({ error: 'Failed to save reading' });
  }
};
