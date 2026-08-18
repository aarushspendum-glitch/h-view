/*
 * HVAC / Device Health Monitor — CLIENT INSTALL TEMPLATE (h-view.vercel.app)
 * Hardware : ESP32 Dev Module + ICM-42670-P (6-axis IMU) + LiPo battery/TP4056
 * Libraries (install via Sketch -> Include Library -> Manage Libraries):
 *   - "SparkFun/InvenSense ICM42670P" -- search "ICM42670P", install the one
 *     published by InvenSense (github.com/InvenSenseInc/arduino.ICM42670P)
 *   - "WiFiManager" by tzapu
 *   - "ArduinoJson" by Benoit Blanchon (v7.x -- uses the JsonDocument API,
 *     not the older StaticJsonDocument<N> template from v6)
 *   Preferences, esp_task_wdt, esp_sleep are part of the ESP32 core, no
 *   separate install needed.
 *
 * Wiring:
 *   ICM-42670-P VCC → ESP32 3V3      ICM-42670-P GND → ESP32 GND
 *   ICM-42670-P SDA → ESP32 D21      ICM-42670-P SCL → ESP32 D22
 *   (JST-PH locking connector, not jumper wires -- see Phase 7 physical
 *   rework notes. Conformal-coat the assembled board.)
 *   Recalibration button: ESP32 onboard BOOT button (GPIO0) -- no new
 *   wiring, every dev board already has this broken out and RTC-wake-capable.
 *
 * ── ARCHITECTURE: DUTY-CYCLED DEEP SLEEP, NOT CONTINUOUS SAMPLING ─────────────
 * This is a full rewrite of the always-on version, driven by the switch to
 * battery power. The device now wakes from deep sleep, does one bounded burst
 * of work (reconnect WiFi, sample the IMU, send one reading), then goes back
 * to deep sleep. `setup()` runs fresh on every wake -- deep sleep is a real
 * chip reset that wipes normal RAM, so anything that must survive a sleep
 * cycle (calibration accumulators, WiFi fast-reconnect hints, the offline
 * retry buffer) lives in RTC_DATA_ATTR memory, which is the one RAM region
 * deep sleep preserves. `loop()` is intentionally left empty: there is no
 * repeating loop in this architecture, each wake does its one pass of work
 * inside setup() and then calls esp_deep_sleep_start(), which never returns.
 *
 * ── PROVISIONING WORKFLOW ──────────────────────────────────────────────────
 *   1. At your desk: flash this file as-is onto a unit over USB.
 *   2. Watch Serial Monitor once to read its auto-generated device ID and
 *      pairing-hotspot password (also write both as a sticker on the unit).
 *   3. In the admin panel, assign that device ID to the client's account --
 *      this generates and shows a per-device secret ONCE. Write it on the
 *      same sticker before heading to the site; there's no second chance to
 *      see it and no OTA path to push it later.
 *   4. At the client site: power it on, connect a phone to the
 *      "HVIEW-xxxxxxxxxxxx" WiFi network using the sticker's password, and a
 *      setup page pops up automatically. Enter the client's real WiFi
 *      name/password AND the device secret from the sticker in that same
 *      form, then Save. Both are stored in flash and survive every future
 *      sleep/wake/power cycle.
 *
 * To re-provision a returned/reused unit for a different client, set
 * FORCE_REPROVISION to true below, reflash once, then set it back to false
 * and reflash again. This wipes WiFi creds, the device secret, and any
 * partial/complete calibration baseline -- a reused unit must not carry the
 * old install's vibration profile into a new one.
 */

#include <Wire.h>
#include <ICM42670P.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WiFiManager.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <esp_mac.h>
#include <esp_sleep.h>
#include <esp_task_wdt.h>

// ── Tunable parameters ────────────────────────────────────────────────────────
const bool          FORCE_REPROVISION   = false; // set true, reflash, set back false, reflash again
const char*         SERVER_ADDRESS      = "https://h-view.vercel.app/api/data";
const unsigned long CALIBRATION_MS      = 7UL * 24UL * 60UL * 60UL * 1000UL; // 7 days -- full weekday+weekend cycle
const int           CAL_BUCKET_HOURS    = 1; // sub-baseline bucket width; bump to 2 if the linker reports RTC memory overflow
const int           MAX_CAL_BUCKETS     = (7 * 24) / CAL_BUCKET_HOURS;
const unsigned long WAKE_INTERVAL_S     = 300UL; // 5 min -- sized against a 1500mAh cell on the FireBeetle-class board's ~10uA sleep current for ~24 days runway; see BUILD_PLAN.md. Shortening this trades battery life for responsiveness
const unsigned long SAMPLE_INTERVAL_MS  = 100UL;
const int           BURST_SAMPLES       = 30; // ~3s burst per wake at the interval above
const float          WARN_SIGMA          = 3.0f;
const float          CRIT_SIGMA          = 6.0f;
const float          FLATLINE_EPSILON    = 1e-5f; // burst variance below this = sensor stuck, not just quiet
const unsigned long WIFI_CONNECT_TIMEOUT_MS = 12000UL; // per-wake bounded connect attempt (fast-path + fallback)
const unsigned long PORTAL_TIMEOUT_S    = 300UL; // full pairing portal timeout when it actually opens
const unsigned long WIFI_REPAIR_AWAKE_MS = 20UL * 60UL * 1000UL; // cumulative AWAKE failed-connect time (not wall time) before forcing the pairing portal back open
const int           WDT_TIMEOUT_S       = 90;
const int           RING_BUFFER_SIZE    = 15; // small in-RAM (RTC) retry buffer for transient blips only -- not a multi-day offline queue
const int           RECAL_HOLD_MS       = 5000; // BOOT button must stay held this long to trigger recalibration, to reject accidental taps
const gpio_num_t    RECAL_BUTTON_PIN    = GPIO_NUM_0;

// Post-calibration baseline drift tracking (seasonal adaptation).
// After the initial 7-day calibration, the baseline keeps slowly moving
// toward NORMAL-classified readings so a real seasonal load change doesn't
// permanently look like an alert -- but only NORMAL readings ever get
// blended in, so an active fault can't drag its own baseline out from under
// itself. Separately, a weekly snapshot of the baseline is kept so a
// persistent multi-week climb (a real developing fault, which also looks
// locally "normal" reading-by-reading) can be told apart from a seasonal
// shift that moves once and then plateaus.
const float          BASELINE_ADAPT_ALPHA = 0.0001f; // ~5-week EMA time constant at this wake interval -- a guess, not yet validated against real seasonal data
const unsigned long SNAPSHOT_INTERVAL_MS = 7UL * 24UL * 60UL * 60UL * 1000UL; // 1 week between drift snapshots
const int           BASELINE_HISTORY_SIZE = 12; // ~12 weeks of snapshots kept
const int           DRIFT_TREND_WEEKS    = 3; // consecutive rising weekly snapshots before flagging a trend
const float          DRIFT_MIN_SIGMAS     = 1.0f; // total rise over that window must exceed this many original-calibration stddevs to count as real drift, not noise
// ─────────────────────────────────────────────────────────────────────────────

ICM42670P imu(Wire, 0);
WiFiManager wm;
WiFiClientSecure secureClient; // created ONCE, reused every send -- recreating this per-cycle fragments heap
HTTPClient httpClient;         // same reasoning, hoisted alongside secureClient
Preferences prefs;
String deviceID;
String macHex;

// Google Trust Services roots that h-view.vercel.app's cert chain actually
// resolves to (verified directly against the live endpoint, not assumed --
// Vercel does NOT use Let's Encrypt/ISRG Root X1). Both are embedded because
// the served intermediate (currently "WR1") cross-chains to either depending
// on path building; either root alone would eventually work but embedding
// both is cheap insurance against Vercel/Google shuffling the intermediate.
// With no OTA, a wrong or stale pinned cert here means a truck roll to fix
// it -- these are self-signed roots valid to 2036, not a leaf/intermediate
// that rotates on its own schedule.
const char* CA_BUNDLE =
"-----BEGIN CERTIFICATE-----\n"
"MIIFVzCCAz+gAwIBAgINAgPlk28xsBNJiGuiFzANBgkqhkiG9w0BAQwFADBHMQsw\n"
"CQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEU\n"
"MBIGA1UEAxMLR1RTIFJvb3QgUjEwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAw\n"
"MDAwWjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZp\n"
"Y2VzIExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjEwggIiMA0GCSqGSIb3DQEBAQUA\n"
"A4ICDwAwggIKAoICAQC2EQKLHuOhd5s73L+UPreVp0A8of2C+X0yBoJx9vaMf/vo\n"
"27xqLpeXo4xL+Sv2sfnOhB2x+cWX3u+58qPpvBKJXqeqUqv4IyfLpLGcY9vXmX7w\n"
"Cl7raKb0xlpHDU0QM+NOsROjyBhsS+z8CZDfnWQpJSMHobTSPS5g4M/SCYe7zUjw\n"
"TcLCeoiKu7rPWRnWr4+wB7CeMfGCwcDfLqZtbBkOtdh+JhpFAz2weaSUKK0Pfybl\n"
"qAj+lug8aJRT7oM6iCsVlgmy4HqMLnXWnOunVmSPlk9orj2XwoSPwLxAwAtcvfaH\n"
"szVsrBhQf4TgTM2S0yDpM7xSma8ytSmzJSq0SPly4cpk9+aCEI3oncKKiPo4Zor8\n"
"Y/kB+Xj9e1x3+naH+uzfsQ55lVe0vSbv1gHR6xYKu44LtcXFilWr06zqkUspzBmk\n"
"MiVOKvFlRNACzqrOSbTqn3yDsEB750Orp2yjj32JgfpMpf/VjsPOS+C12LOORc92\n"
"wO1AK/1TD7Cn1TsNsYqiA94xrcx36m97PtbfkSIS5r762DL8EGMUUXLeXdYWk70p\n"
"aDPvOmbsB4om3xPXV2V4J95eSRQAogB/mqghtqmxlbCluQ0WEdrHbEg8QOB+DVrN\n"
"VjzRlwW5y0vtOUucxD/SVRNuJLDWcfr0wbrM7Rv1/oFB2ACYPTrIrnqYNxgFlQID\n"
"AQABo0IwQDAOBgNVHQ8BAf8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4E\n"
"FgQU5K8rJnEaK0gnhS9SZizv8IkTcT4wDQYJKoZIhvcNAQEMBQADggIBAJ+qQibb\n"
"C5u+/x6Wki4+omVKapi6Ist9wTrYggoGxval3sBOh2Z5ofmmWJyq+bXmYOfg6LEe\n"
"QkEzCzc9zolwFcq1JKjPa7XSQCGYzyI0zzvFIoTgxQ6KfF2I5DUkzps+GlQebtuy\n"
"h6f88/qBVRRiClmpIgUxPoLW7ttXNLwzldMXG+gnoot7TiYaelpkttGsN/H9oPM4\n"
"7HLwEXWdyzRSjeZ2axfG34arJ45JK3VmgRAhpuo+9K4l/3wV3s6MJT/KYnAK9y8J\n"
"ZgfIPxz88NtFMN9iiMG1D53Dn0reWVlHxYciNuaCp+0KueIHoI17eko8cdLiA6Ef\n"
"MgfdG+RCzgwARWGAtQsgWSl4vflVy2PFPEz0tv/bal8xa5meLMFrUKTX5hgUvYU/\n"
"Z6tGn6D/Qqc6f1zLXbBwHSs09dR2CQzreExZBfMzQsNhFRAbd03OIozUhfJFfbdT\n"
"6u9AWpQKXCBfTkBdYiJ23//OYb2MI3jSNwLgjt7RETeJ9r/tSQdirpLsQBqvFAnZ\n"
"0E6yove+7u7Y/9waLd64NnHi/Hm3lCXRSHNboTXns5lndcEZOitHTtNCjv0xyBZm\n"
"2tIMPNuzjsmhDYAPexZ3FL//2wmUspO8IFgV6dtxQ/PeEMMA3KgqlbbC1j+Qa3bb\n"
"bP6MvPJwNQzcmRk13NfIRmPVNnGuV/u3gm3c\n"
"-----END CERTIFICATE-----\n"
"-----BEGIN CERTIFICATE-----\n"
"MIICCTCCAY6gAwIBAgINAgPlwGjvYxqccpBQUjAKBggqhkjOPQQDAzBHMQswCQYD\n"
"VQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIG\n"
"A1UEAxMLR1RTIFJvb3QgUjQwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAwMDAw\n"
"WjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2Vz\n"
"IExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjQwdjAQBgcqhkjOPQIBBgUrgQQAIgNi\n"
"AATzdHOnaItgrkO4NcWBMHtLSZ37wWHO5t5GvWvVYRg1rkDdc/eJkTBa6zzuhXyi\n"
"QHY7qca4R9gq55KRanPpsXI5nymfopjTX15YhmUPoYRlBtHci8nHc8iMai/lxKvR\n"
"HYqjQjBAMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQW\n"
"BBSATNbrdP9JNqPV2Py1PsVq8JQdjDAKBggqhkjOPQQDAwNpADBmAjEA6ED/g94D\n"
"9J+uHXqnLrmvT/aDHQ4thQEd0dlq7A/Cr8deVl5c1RxYIigL9zC2L7F8AjEA8GE8\n"
"p/SgguMh1YQdc4acLa/KNJvxn7kjNuK8YAOdgLOaVsjh4rsUecrNIdSUtUlD\n"
"-----END CERTIFICATE-----\n";

// ── RTC memory: survives deep sleep, wiped only on power-on/brownout/manual
// reset. Everything that must carry across a sleep/wake cycle lives here. ──
struct RunningStats {
  long  n    = 0;
  float mean = 0.0f;
  float M2   = 0.0f;
  void update(float x) {
    n++;
    float delta  = x - mean;
    mean        += delta / n;
    float delta2 = x - mean;
    M2          += delta * delta2;
  }
  float variance() { return (n > 1) ? M2 / (n - 1) : 0.0f; }
  float stddev()   { return sqrt(variance()); }
};

struct Baseline { float mean; float stddev; };

struct BufferedReading {
  bool  valid;
  char  status[16];
  float accel, gyro, temp, accelSigma, gyroSigma;
  float accelBaseMean, accelBaseStd, gyroBaseMean, gyroBaseStd;
};

RTC_DATA_ATTR bool          calibrationDone     = false;
RTC_DATA_ATTR unsigned long calibrationElapsedMs = 0;
RTC_DATA_ATTR Baseline      accelBase = { 0, 0 };
RTC_DATA_ATTR Baseline      gyroBase  = { 0, 0 };
RTC_DATA_ATTR RunningStats  accelHourly[MAX_CAL_BUCKETS];
RTC_DATA_ATTR RunningStats  gyroHourly[MAX_CAL_BUCKETS];

RTC_DATA_ATTR unsigned long snapshotElapsedMs = 0;
RTC_DATA_ATTR float         accelBaselineHistory[BASELINE_HISTORY_SIZE];
RTC_DATA_ATTR float         gyroBaselineHistory[BASELINE_HISTORY_SIZE];
RTC_DATA_ATTR int           baselineHistoryCount = 0;
RTC_DATA_ATTR bool          driftFlag = false;

RTC_DATA_ATTR unsigned long wifiFailedAwakeMs = 0;
RTC_DATA_ATTR uint8_t       cachedBSSID[6]     = { 0, 0, 0, 0, 0, 0 };
RTC_DATA_ATTR int32_t       cachedChannel      = 0;
RTC_DATA_ATTR bool          haveCachedBSSID    = false;

RTC_DATA_ATTR BufferedReading ringBuffer[RING_BUFFER_SIZE];
RTC_DATA_ATTR int             ringBufferCount = 0;

// ── Helpers ─────────────────────────────────────────────────────────────────

String getDeviceID() {
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA); // factory-burned MAC from eFuse, reliable regardless of WiFi driver state
  char buf[13];
  sprintf(buf, "%02X%02X%02X%02X%02X%02X", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  macHex = String(buf);
  return "HVIEW-" + macHex;
}

// Deterministic per-device pairing-hotspot password -- the old version left
// the setup AP completely open. Derived from the device's own MAC so every
// unit gets a different password with zero extra provisioning workflow.
String getApPassword() {
  return "hv" + macHex.substring(macHex.length() - 8);
}

void feedWatchdog() {
  esp_task_wdt_reset();
}

float medianOf(float* vals, int n) {
  for (int i = 1; i < n; i++) {
    float key = vals[i];
    int j = i - 1;
    while (j >= 0 && vals[j] > key) { vals[j + 1] = vals[j]; j--; }
    vals[j + 1] = key;
  }
  return (n % 2 == 1) ? vals[n / 2] : (vals[n / 2 - 1] + vals[n / 2]) / 2.0f;
}

// Median of per-bucket means/stddevs, not one global running mean -- a
// single anomalous bucket (technician bumping the unit, an abnormal duty
// cycle during install) can permanently skew a running mean, but the median
// shrugs off a small number of outlier buckets.
void finalizeBaseline(RunningStats* buckets, Baseline& out) {
  float means[MAX_CAL_BUCKETS];
  float stds[MAX_CAL_BUCKETS];
  int count = 0;
  for (int i = 0; i < MAX_CAL_BUCKETS; i++) {
    if (buckets[i].n > 0) {
      means[count] = buckets[i].mean;
      stds[count]  = buckets[i].stddev();
      count++;
    }
  }
  if (count == 0) { out = { 0, 0 }; return; }
  out.mean   = medianOf(means, count);
  out.stddev = medianOf(stds, count);
}

void saveBaselineToFlash() {
  prefs.putFloat("accel_mean", accelBase.mean);
  prefs.putFloat("accel_std",  accelBase.stddev);
  prefs.putFloat("gyro_mean",  gyroBase.mean);
  prefs.putFloat("gyro_std",   gyroBase.stddev);
  prefs.putBool("cal_done", true);
}

void loadBaselineFromFlash() {
  accelBase.mean   = prefs.getFloat("accel_mean", 0);
  accelBase.stddev = prefs.getFloat("accel_std", 0);
  gyroBase.mean    = prefs.getFloat("gyro_mean", 0);
  gyroBase.stddev  = prefs.getFloat("gyro_std", 0);
}

// Slowly blends the current reading into the baseline mean -- ONLY when this
// wake's own reading is healthy and NORMAL. That gate is what stops a
// developing fault from dragging its own baseline out from under itself:
// an active WARNING/CRITICAL reading never gets blended in, only readings
// that already look fine do. This absorbs genuine seasonal/load drift
// (which is made up of many "still normal" readings shifting gradually)
// without letting the baseline chase an actual fault.
void updateAdaptiveBaseline(float aMag, float gMag, bool sensorHealthy, const String& status) {
  if (!calibrationDone || !sensorHealthy || status != "NORMAL") return;
  if (accelBase.stddev > 0) accelBase.mean += (aMag - accelBase.mean) * BASELINE_ADAPT_ALPHA;
  if (gyroBase.stddev  > 0) gyroBase.mean  += (gMag - gyroBase.mean)  * BASELINE_ADAPT_ALPHA;
}

// Checks whether the last DRIFT_TREND_WEEKS+1 weekly baseline snapshots rose
// monotonically by more than DRIFT_MIN_SIGMAS worth of the ORIGINAL
// calibration stddev. A real seasonal shift moves once and then plateaus in
// this history; a genuine developing fault keeps climbing week over week.
// Only the accel channel drives the flag -- accel magnitude is the primary
// vibration signal and keeping this to one channel keeps the check simple
// and easy to reason about; gyro history is still recorded for reference.
bool checkPersistentDrift() {
  if (baselineHistoryCount < DRIFT_TREND_WEEKS + 1) return false;
  int n = baselineHistoryCount;
  int start = n - (DRIFT_TREND_WEEKS + 1);
  for (int i = start + 1; i < n; i++) {
    if (accelBaselineHistory[i] <= accelBaselineHistory[i - 1]) return false; // not monotonic -- plateaued or reversed
  }
  float totalRise = accelBaselineHistory[n - 1] - accelBaselineHistory[start];
  float origStddev = prefs.getFloat("accel_std", accelBase.stddev); // original calibration stddev, not the (also slowly drifting) live one
  if (origStddev <= 0) return false;
  return totalRise > (DRIFT_MIN_SIGMAS * origStddev);
}

// Called once per wake, after the adaptive baseline update above. Pushes a
// weekly snapshot into the rolling history and re-evaluates the trend flag
// -- re-evaluated fresh every week so it also clears itself if the trend
// stops or reverses, not just when it starts.
void snapshotAndCheckDrift() {
  if (!calibrationDone) return;
  snapshotElapsedMs += (WAKE_INTERVAL_S * 1000UL);
  if (snapshotElapsedMs < SNAPSHOT_INTERVAL_MS) return;
  snapshotElapsedMs = 0;

  if (baselineHistoryCount < BASELINE_HISTORY_SIZE) {
    accelBaselineHistory[baselineHistoryCount] = accelBase.mean;
    gyroBaselineHistory[baselineHistoryCount]  = gyroBase.mean;
    baselineHistoryCount++;
  } else {
    for (int i = 0; i < BASELINE_HISTORY_SIZE - 1; i++) {
      accelBaselineHistory[i] = accelBaselineHistory[i + 1];
      gyroBaselineHistory[i]  = gyroBaselineHistory[i + 1];
    }
    accelBaselineHistory[BASELINE_HISTORY_SIZE - 1] = accelBase.mean;
    gyroBaselineHistory[BASELINE_HISTORY_SIZE - 1]  = gyroBase.mean;
  }

  driftFlag = checkPersistentDrift();
  saveBaselineToFlash(); // persist the adapted mean so it survives a power loss, not just deep sleep
}

void resetCalibrationState() {
  calibrationDone = false;
  calibrationElapsedMs = 0;
  accelBase = { 0, 0 };
  gyroBase  = { 0, 0 };
  for (int i = 0; i < MAX_CAL_BUCKETS; i++) {
    accelHourly[i] = RunningStats();
    gyroHourly[i]  = RunningStats();
  }
  snapshotElapsedMs = 0;
  baselineHistoryCount = 0;
  driftFlag = false;
  prefs.remove("cal_done");
  prefs.remove("accel_mean");
  prefs.remove("accel_std");
  prefs.remove("gyro_mean");
  prefs.remove("gyro_std");
}

// fabs(), not just positive deviation -- the old version only flagged a
// vibration reading *above* baseline, so a sensor gone quiet from a failed
// connection (reading near zero, i.e. *below* baseline) looked NORMAL forever.
// NaN/inf and flatline (stuck sensor) both report SENSOR_FAULT, a status the
// backend already recognizes (api/data.js's VALID_STATUSES / ALERT_STATUSES).
String statusLabel(float current, const Baseline& base, bool sensorHealthy) {
  if (!sensorHealthy || isnan(current) || isinf(current)) return "SENSOR_FAULT";
  if (base.stddev <= 0) return "NORMAL"; // no meaningful baseline yet (pre-calibration or a bucket with a single sample)
  float diff = fabs(current - base.mean);
  if (diff > CRIT_SIGMA * base.stddev) return "CRITICAL";
  if (diff > WARN_SIGMA * base.stddev) return "WARNING";
  return "NORMAL";
}

void bufferReading(const BufferedReading& r) {
  if (ringBufferCount >= RING_BUFFER_SIZE) {
    // full -- drop the oldest to make room for the newest
    for (int i = 0; i < RING_BUFFER_SIZE - 1; i++) ringBuffer[i] = ringBuffer[i + 1];
    ringBufferCount = RING_BUFFER_SIZE - 1;
  }
  ringBuffer[ringBufferCount] = r;
  ringBufferCount++;
}

bool sendReading(const BufferedReading& r) {
  httpClient.begin(secureClient, SERVER_ADDRESS);
  httpClient.addHeader("Content-Type", "application/json");
  httpClient.addHeader("x-device-id", deviceID);
  httpClient.addHeader("x-device-key", prefs.getString("device_secret", ""));

  JsonDocument doc;
  doc["status"]         = r.status;
  doc["accel"]          = r.accel;
  doc["gyro"]           = r.gyro;
  doc["temp"]           = r.temp;
  doc["accelSigma"]     = r.accelSigma;
  doc["gyroSigma"]      = r.gyroSigma;
  doc["accelBaseMean"]  = r.accelBaseMean;
  doc["accelBaseStd"]   = r.accelBaseStd;
  doc["gyroBaseMean"]   = r.gyroBaseMean;
  doc["gyroBaseStd"]    = r.gyroBaseStd;

  String payload;
  serializeJson(doc, payload);

  int code = httpClient.POST(payload);
  httpClient.end();

  // Was `code > 0`, which is true for any HTTP response including 4xx/5xx --
  // a rejected/errored request was logged as "Sent OK".
  bool ok = (code >= 200 && code < 300);
  Serial.print("  [Cloud] ");
  Serial.println(ok ? ("Sent OK, HTTP " + String(code)) : ("Send FAILED, HTTP " + String(code)));
  return ok;
}

// Retries whatever's queued from previous failed sends before sending the
// current reading, bounded per wake so a prolonged outage can't make one
// wake cycle run indefinitely. This is a small transient-blip mitigation,
// not the persistent multi-day offline buffer that was reviewed and shelved.
void flushBufferedReadings() {
  int attempts = 0;
  while (ringBufferCount > 0 && attempts < 3) {
    attempts++;
    if (sendReading(ringBuffer[0])) {
      for (int i = 0; i < ringBufferCount - 1; i++) ringBuffer[i] = ringBuffer[i + 1];
      ringBufferCount--;
    } else {
      break; // still down -- stop trying this wake, keep the rest queued
    }
  }
}

// Fast-path reconnect using a cached BSSID+channel (skips the WiFi scan)
// before falling back to the slower autoConnect()/portal path. SSID/password
// come from the ESP32 core's own flash-persisted STA config (WiFi.begin()
// with no args already reconnects to it) -- WiFi.SSID()/WiFi.psk() below
// just let us pass them explicitly alongside the cached channel/bssid hint.
bool connectWiFi() {
  WiFi.mode(WIFI_STA);
  unsigned long start = millis();

  if (haveCachedBSSID && WiFi.SSID().length() > 0) {
    WiFi.begin(WiFi.SSID().c_str(), WiFi.psk().c_str(), cachedChannel, cachedBSSID, true);
    while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_CONNECT_TIMEOUT_MS) {
      delay(100);
    }
  }

  if (WiFi.status() != WL_CONNECTED) {
    // Either first-ever connect, or the fast path didn't pan out (router
    // moved, credentials changed, etc). autoConnect() tries the flash-saved
    // credentials itself, then opens the pairing portal if that also fails.
    String secretDefault = prefs.getString("device_secret", "");
    WiFiManagerParameter customSecret("secret", "Device Secret (from admin panel)", secretDefault.c_str(), 64);
    wm.addParameter(&customSecret);

    // A short timeout here (not the full PORTAL_TIMEOUT_S) unless we've
    // already accumulated enough failed awake-time to justify the longer,
    // more disruptive full pairing portal -- see wifiFailedAwakeMs below.
    bool openFullPortal = wifiFailedAwakeMs >= WIFI_REPAIR_AWAKE_MS;
    wm.setConnectTimeout(15); // bound autoConnect()'s own saved-credentials attempt so a routine failure can't blow the wake cycle's time budget
    wm.setConfigPortalTimeout(openFullPortal ? PORTAL_TIMEOUT_S : 20);
    if (!openFullPortal) wm.setEnableConfigPortal(false); // try saved creds only, don't open an AP for a routine transient blip

    bool connected = wm.autoConnect(deviceID.c_str(), getApPassword().c_str());
    if (connected && customSecret.getValue()[0] != '\0') {
      prefs.putString("device_secret", String(customSecret.getValue()));
    }
    if (!connected) {
      wifiFailedAwakeMs += (millis() - start);
      return false;
    }
  }

  wifiFailedAwakeMs = 0;
  uint8_t* bssid = WiFi.BSSID();
  if (bssid) memcpy(cachedBSSID, bssid, 6);
  cachedChannel = WiFi.channel();
  haveCachedBSSID = true;
  return true;
}

// ── Setup: does all the work for one wake cycle, then deep-sleeps ───────────

void setup() {
  Serial.begin(115200);
  delay(200);

  // esp_task_wdt_init(timeout_s, panic) is the ESP32 Arduino core 2.x
  // signature, still the most common installed core as of writing. Core 3.x
  // (ESP-IDF 5.x based) changed this to take an esp_task_wdt_config_t*
  // struct instead -- if the build fails here with an argument-count/type
  // error, check Tools -> Board -> esp32 package version and swap to the
  // struct form for that version.
  esp_task_wdt_init(WDT_TIMEOUT_S, true); // panic+restart if a single wake cycle hangs this long
  esp_task_wdt_add(NULL);
  feedWatchdog();

  prefs.begin("hview", false);

  if (FORCE_REPROVISION) {
    wm.resetSettings();
    prefs.remove("device_secret");
    resetCalibrationState();
    Serial.println("FORCE_REPROVISION is set -- wiped WiFi/secret/calibration. Set it back to false and reflash.");
  }

  deviceID = getDeviceID();

  esp_sleep_wakeup_cause_t wakeCause = esp_sleep_get_wakeup_cause();
  bool recalTriggered = false;

  if (wakeCause == ESP_SLEEP_WAKEUP_EXT0) {
    // Woken by the BOOT button -- only treat as a real recalibration request
    // if it's held for RECAL_HOLD_MS, so a brief accidental bump doesn't
    // wipe a week of learned baseline.
    pinMode(RECAL_BUTTON_PIN, INPUT_PULLUP);
    unsigned long heldStart = millis();
    bool stillHeld = true;
    while (millis() - heldStart < RECAL_HOLD_MS) {
      if (digitalRead(RECAL_BUTTON_PIN) == HIGH) { stillHeld = false; break; }
      delay(50);
    }
    if (stillHeld) {
      Serial.println("Recalibration button held -- clearing baseline, starting fresh 7-day calibration.");
      resetCalibrationState();
      recalTriggered = true;
    }
  } else if (wakeCause == ESP_SLEEP_WAKEUP_TIMER) {
    calibrationElapsedMs += (WAKE_INTERVAL_S * 1000UL);
  }
  (void)recalTriggered;

  Serial.println("========================================");
  Serial.println("  HVIEW DEVICE MONITOR");
  Serial.println("  Device ID: " + deviceID);
  Serial.println("  Pairing password (first setup only): " + getApPassword());
  Serial.println("========================================");

  feedWatchdog();
  bool wifiOk = connectWiFi();
  feedWatchdog();

  if (wifiOk) {
    secureClient.setCACert(CA_BUNDLE);
    secureClient.setTimeout(15000);
    httpClient.setTimeout(15000);
    Serial.println("WiFi connected! IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("WiFi connect failed this cycle -- will retry next wake.");
  }

  // IMU init: bounded retries instead of the old `while(1);` hang, which
  // meant a loose connector (the exact failure mode this hardware rev's JST
  // connector is meant to fix) required a physical power-cycle to recover.
  bool imuOk = false;
  for (int attempt = 0; attempt < 5 && !imuOk; attempt++) {
    Wire.begin();
    imuOk = (imu.begin() == 0);
    if (!imuOk) { Serial.println("ICM-42670-P not responding, retrying..."); delay(300); }
  }
  if (imuOk) {
    imu.startAccel(100, 16);   // 100Hz, +/-16G
    imu.startGyro(100, 2000);  // 100Hz, +/-2000dps
    delay(50); // let the first samples settle
  } else {
    Serial.println("ICM-42670-P not found after retries -- sending SENSOR_FAULT this cycle.");
  }
  feedWatchdog();

  // Burst-sample instead of continuous 100ms polling -- battery power means
  // the device isn't awake long enough to sample continuously anymore.
  float accelSamples[BURST_SAMPLES];
  float gyroSamples[BURST_SAMPLES];
  float tempSum = 0;
  int   sampleCount = 0;

  for (int i = 0; i < BURST_SAMPLES; i++) {
    if (imuOk) {
      inv_imu_sensor_event_t evt;
      if (imu.getDataFromRegisters(evt) == 0) {
        float axG = evt.accel[0] / 2048.0f, ayG = evt.accel[1] / 2048.0f, azG = evt.accel[2] / 2048.0f; // +/-16G range -> 2048 LSB/g
        float gxD = evt.gyro[0] / 16.4f,   gyD = evt.gyro[1] / 16.4f,   gzD = evt.gyro[2] / 16.4f;       // +/-2000dps range -> 16.4 LSB/dps
        accelSamples[sampleCount] = sqrt(axG * axG + ayG * ayG + azG * azG);
        gyroSamples[sampleCount]  = sqrt(gxD * gxD + gyD * gyD + gzD * gzD);
        tempSum += (evt.temperature / 128.0f) + 25.0f; // deg C per the ICM42670P datasheet formula, converted to F below to match the rest of the system (dashboard/admin both display deg F)
        sampleCount++;
      }
    }
    delay(SAMPLE_INTERVAL_MS);
  }
  feedWatchdog();

  bool sensorHealthy = imuOk && sampleCount > 0;
  float aMag = 0, gMag = 0, temp = 0;
  if (sensorHealthy) {
    float aSum = 0, gSum = 0;
    for (int i = 0; i < sampleCount; i++) { aSum += accelSamples[i]; gSum += gyroSamples[i]; }
    aMag = aSum / sampleCount;
    gMag = gSum / sampleCount;
    float tempC = tempSum / sampleCount;
    temp = tempC * 9.0f / 5.0f + 32.0f;

    // Flatline check: near-zero variance across the burst means the sensor
    // is stuck returning the same value, not that the HVAC unit is quiet --
    // real ambient vibration always has some noise.
    if (sampleCount >= 5) {
      float aVar = 0, gVar = 0;
      for (int i = 0; i < sampleCount; i++) {
        aVar += (accelSamples[i] - aMag) * (accelSamples[i] - aMag);
        gVar += (gyroSamples[i] - gMag) * (gyroSamples[i] - gMag);
      }
      aVar /= sampleCount; gVar /= sampleCount;
      if (aVar < FLATLINE_EPSILON && gVar < FLATLINE_EPSILON) sensorHealthy = false;
    }
  }

  if (sensorHealthy && !calibrationDone) {
    int bucket = constrain((int)(calibrationElapsedMs / (CAL_BUCKET_HOURS * 3600000UL)), 0, MAX_CAL_BUCKETS - 1);
    accelHourly[bucket].update(aMag);
    gyroHourly[bucket].update(gMag);

    if (calibrationElapsedMs >= CALIBRATION_MS) {
      finalizeBaseline(accelHourly, accelBase);
      finalizeBaseline(gyroHourly, gyroBase);
      saveBaselineToFlash();
      calibrationDone = true;
      Serial.println("CALIBRATION COMPLETE -- baseline committed to flash.");
    }
  } else if (calibrationDone && accelBase.mean == 0 && accelBase.stddev == 0) {
    // Wake right after a power-on reset with calibration already marked done
    // in flash but RTC baseline not yet reloaded this boot.
    loadBaselineFromFlash();
  }

  String status = statusLabel(aMag, accelBase, sensorHealthy);
  String gyroStatus = statusLabel(gMag, gyroBase, sensorHealthy);
  if (gyroStatus == "CRITICAL" || (status != "CRITICAL" && gyroStatus == "WARNING")) status = gyroStatus;
  if (gyroStatus == "SENSOR_FAULT") status = "SENSOR_FAULT";

  updateAdaptiveBaseline(aMag, gMag, sensorHealthy, status);
  snapshotAndCheckDrift();

  // A persistent multi-week upward baseline trend (see checkPersistentDrift)
  // escalates the reported status one level -- this is what catches a fault
  // gradual enough that no single reading ever crosses the sigma thresholds
  // on its own, distinct from a seasonal shift that plateaus and clears the
  // flag on its own within a few weekly checks.
  if (driftFlag && status != "SENSOR_FAULT") {
    if (status == "NORMAL") status = "WARNING";
    else if (status == "WARNING") status = "CRITICAL";
  }

  float accelSigma = (accelBase.stddev > 0) ? (aMag - accelBase.mean) / accelBase.stddev : 0;
  float gyroSigma  = (gyroBase.stddev  > 0) ? (gMag - gyroBase.mean)  / gyroBase.stddev  : 0;

  Serial.print("STATUS: "); Serial.print(status);
  Serial.print("  accel="); Serial.print(aMag, 4);
  Serial.print("  gyro=");  Serial.print(gMag, 4);
  Serial.print("  temp=");  Serial.println(temp, 1);

  BufferedReading current;
  current.valid = true;
  status.toCharArray(current.status, sizeof(current.status));
  current.accel = aMag; current.gyro = gMag; current.temp = temp;
  current.accelSigma = accelSigma; current.gyroSigma = gyroSigma;
  current.accelBaseMean = accelBase.mean; current.accelBaseStd = accelBase.stddev;
  current.gyroBaseMean  = gyroBase.mean;  current.gyroBaseStd  = gyroBase.stddev;

  if (wifiOk) {
    flushBufferedReadings();
    if (!sendReading(current)) bufferReading(current);
  } else {
    bufferReading(current);
  }
  feedWatchdog();

  Serial.println("Going to sleep for " + String(WAKE_INTERVAL_S) + "s...");
  Serial.flush();

  // Explicit disarm before sleeping -- largely redundant since deep sleep is
  // a full chip reset that clears the WDT peripheral's state along with
  // everything outside RTC memory, but kept as defense-in-depth against a
  // future refactor that changes that assumption.
  esp_task_wdt_delete(NULL);

  esp_sleep_enable_timer_wakeup(WAKE_INTERVAL_S * 1000000ULL);
  esp_sleep_enable_ext0_wakeup(RECAL_BUTTON_PIN, 0); // BOOT button pulls LOW when pressed
  esp_deep_sleep_start();
}

void loop() {
  // Unreachable in normal operation -- setup() always ends in
  // esp_deep_sleep_start(), which resets the chip back into setup() on the
  // next wake rather than returning here.
}
