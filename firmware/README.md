# H-VIEW client install template

This is the sketch to flash onto every new client's ESP32 unit. Unlike the
test version, **this exact file never needs editing** — no WiFi credentials,
no device ID, nothing client-specific baked in.

The device is battery-powered and duty-cycled: it wakes from deep sleep every
few minutes, takes one reading, sends it, and goes back to sleep. It is not
continuously connected or continuously sampling.

## One-time setup (per Arduino IDE computer)

Install these via Sketch → Include Library → Manage Libraries:
- **ICM42670P** (published by InvenSense) — the IMU driver
- **WiFiManager** by tzapu
- **ArduinoJson** by Benoit Blanchon

Preferences, esp_task_wdt, and esp_sleep ship with the ESP32 board package
and don't need a separate install.

## Per-unit workflow

1. **At your desk:** flash this file as-is over USB.
2. **Read its device ID and pairing password once**, from Serial Monitor
   (`115200` baud — it prints both right at boot) or by noting the temporary
   WiFi network it broadcasts, since the network name *is* the device ID.
   Write both on a sticker on the physical unit.
3. **In the admin panel** (`h-view.vercel.app/admin`): assign that device ID
   to the client's account. This generates and shows a device secret
   **once** — write it on the same sticker before leaving your desk. There's
   no OTA path to deliver it later if it's lost.
4. **At the client site:** power it on. No laptop needed. On a phone, join
   the WiFi network named `HVIEW-xxxxxxxxxxxx` (matches the sticker) using
   the pairing password from the sticker. A setup page pops up automatically
   (if not, open a browser and go to `192.168.4.1`) — enter the client's
   real WiFi name/password **and** the device secret from the sticker in
   that same form. Both are saved permanently in flash and survive every
   future sleep/wake and power cycle.

That's it — the client's dashboard goes live immediately (each reading sends
as soon as it's taken), though status will read NORMAL by default until the
7-day baseline calibration finishes, since there's no learned vibration
profile to compare against yet.

## Recalibrating an installed unit

Hold the ESP32's onboard **BOOT** button for 5 seconds (no new wiring — every
dev board already has this). This wipes the learned baseline and restarts
the 7-day calibration window from zero. Use this if a unit is physically
moved or reinstalled in a way that changes its normal vibration profile.

## Re-provisioning a returned unit

If a unit comes back and needs to go to a different client, set
`FORCE_REPROVISION` to `true` near the top of the sketch, reflash once, then
set it back to `false` and reflash again. This wipes the saved WiFi
credentials, the device secret, and any calibration baseline — a reused unit
must not carry the previous install's vibration profile or credentials into
the new one.
