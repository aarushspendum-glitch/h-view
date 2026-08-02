const { supabaseRequest } = require('./_utils/supabase');
const { requireSession } = require('./_utils/session');

function mapReading(r) {
  return {
    status: r.status,
    accel: r.accel,
    gyro: r.gyro,
    temp: r.temp,
    accelSigma: r.accel_sigma,
    gyroSigma: r.gyro_sigma,
    accelBaseMean: r.accel_base_mean,
    accelBaseStd: r.accel_base_std,
    gyroBaseMean: r.gyro_base_mean,
    gyroBaseStd: r.gyro_base_std,
    receivedAt: r.created_at,
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const session = await requireSession(req);
    if (!session) return res.status(401).json({ error: 'Not authenticated' });

    if (session.role === 'admin') {
      const readings = await supabaseRequest('readings?select=*&order=created_at.desc&limit=100');
      const byDevice = {};
      for (const r of readings || []) {
        if (!byDevice[r.device_id]) byDevice[r.device_id] = mapReading(r);
      }
      return res.status(200).json(byDevice);
    }

    const devices = await supabaseRequest(
      `devices?user_id=eq.${session.user_id}&select=id,name`
    );
    const device = devices && devices[0];
    if (!device) return res.status(200).json({ status: 'WAITING' });

    const readings = await supabaseRequest(
      `readings?device_id=eq.${encodeURIComponent(device.id)}&select=*&order=created_at.desc&limit=1`
    );
    const reading = readings && readings[0];
    if (!reading) return res.status(200).json({ status: 'WAITING' });

    return res.status(200).json({ deviceName: device.name, ...mapReading(reading) });
  } catch (err) {
    console.error('latest error:', err);
    return res.status(500).json({ error: 'Failed to fetch latest reading' });
  }
};
