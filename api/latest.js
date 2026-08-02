const { supabaseRequest } = require('./_utils/supabase');
const { requireSession } = require('./_utils/session');

// Shared shape for a single device's latest reading, used by both the admin
// map and the client devices array below.
function mapDeviceRow(d) {
  return {
    id: d.id,
    deviceName: d.name,
    status: d.last_status,
    accel: d.last_accel,
    gyro: d.last_gyro,
    temp: d.last_temp,
    accelSigma: d.last_accel_sigma,
    gyroSigma: d.last_gyro_sigma,
    accelBaseMean: d.last_accel_base_mean,
    accelBaseStd: d.last_accel_base_std,
    gyroBaseMean: d.last_gyro_base_mean,
    gyroBaseStd: d.last_gyro_base_std,
    receivedAt: d.last_reading_at,
  };
}

const DEVICE_COLUMNS =
  'id,name,last_status,last_accel,last_gyro,last_temp,last_accel_sigma,last_gyro_sigma,' +
  'last_accel_base_mean,last_accel_base_std,last_gyro_base_mean,last_gyro_base_std,last_reading_at';

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const session = await requireSession(req);
    if (!session) return res.status(401).json({ error: 'Not authenticated' });

    if (session.role === 'admin') {
      // Previously scanned the last 100 readings globally and deduped
      // client-side -- devices silently vanished from this view once total
      // reading volume across the fleet exceeded 100 recent rows. Reading
      // the denormalized columns on `devices` directly is a single indexed
      // query, independent of reading volume.
      const devices = await supabaseRequest(`devices?select=${DEVICE_COLUMNS}`);
      const byDevice = {};
      for (const d of devices || []) {
        byDevice[d.id] = mapDeviceRow(d);
      }
      return res.status(200).json(byDevice);
    }

    // Previously only ever returned devices[0] -- a client with a second
    // assigned device had it silently inaccessible with no error shown.
    const devices = await supabaseRequest(
      `devices?user_id=eq.${session.user_id}&select=${DEVICE_COLUMNS}`
    );
    return res.status(200).json({ devices: (devices || []).map(mapDeviceRow) });
  } catch (err) {
    console.error('latest error:', err);
    return res.status(500).json({ error: 'Failed to fetch latest reading' });
  }
};
