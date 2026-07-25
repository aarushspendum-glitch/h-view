const { supabaseRequest } = require('./_utils/supabase');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const deviceId = req.headers['x-device-id'];
  if (!deviceId) return res.status(400).json({ error: 'Missing x-device-id header' });

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

  try {
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
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('data error:', err);
    return res.status(500).json({ error: 'Failed to save reading' });
  }
};
