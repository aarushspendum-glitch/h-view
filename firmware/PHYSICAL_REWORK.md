# Physical rework — battery, connector, enclosure

Covers the hardware side of the reliability overhaul: swapping the sensor,
adding battery power, and replacing the jumper-wire I2C link with a locking
connector. Pair this with a single reflash of `hvac_wifi.ino` (already
rewritten for the new hardware) so each existing pilot unit only needs **one**
physical visit to cover both.

## New parts per unit

| Part | Notes |
|---|---|
| ICM-42670-P breakout | Replaces the MPU-6050. Same I2C interface (SDA/SCL/VCC/GND), 3.3V logic. |
| LiPo battery | Single-cell 3.7V. Capacity depends on the enclosure's available volume — pick the largest cell that physically fits behind/beside the ESP32 and charge board. |
| TP4056 charge module | USB-C variant preferred for the external charge port. Handles battery charging and (on most breakout boards) also provides basic over-discharge protection — confirm the specific module has protection circuitry before relying on it, some bare TP4056 boards don't. |
| JST-PH 4-pin connector (pair) | One half on the ESP32/wiring harness side, one half on the ICM-42670-P breakout side. Replaces the 4 jumper wires (VCC/GND/SDA/SCL). |
| Conformal coating | Acrylic or silicone spray-on, applied post-assembly. HVAC rooftop/mechanical-room environments see dust, humidity swings, and occasional condensation — the coating is what the vibration-loosened-jumper failure mode (the thing the JST connector itself fixes) shouldn't be the only defense against environmental wear. |

## Enclosure revision

The existing 3D-printed case was sized for a wall-powered ESP32 + MPU-6050
only. It needs:

1. **Added internal volume** for the LiPo cell and the TP4056 module,
   sized to whichever battery you land on above.
2. **An externally-accessible USB-C charge port** — cut/print an opening
   aligned with the TP4056 module's USB connector so units can be recharged
   in place without opening the enclosure. Opening the case in the field to
   plug in a charge cable defeats the point of a sealed, coated assembly.
3. **Strain relief** for the JST-PH harness where it crosses from the main
   compartment to wherever the IMU is mounted, if they're not co-located —
   the connector is only as reliable as the wire leading into it.
4. Keep the BOOT button (used for the firmware's long-press recalibration
   trigger) either exposed or reachable with a thin tool through a small
   access hole — it needs to be reachable without fully opening the case for
   routine recalibration after a reinstall.

There's no existing CAD file to revise in this repo — start from the current
printed enclosure's physical dimensions and iterate from there, or start a
fresh model against the dimensions above.

## Assembly steps

1. Solder or crimp the JST-PH connector pair onto the ESP32-side harness
   (VCC, GND, SDA, SCL) and the ICM-42670-P breakout's four pads, matching
   pinout 1:1 — double-check polarity before first power-up, a reversed
   VCC/GND on a locking connector is harder to visually catch than on
   jumper wires.
2. Wire the TP4056 module's battery output to the ESP32's battery input
   (typically a JST-PH 2-pin on dev boards with a built-in charge circuit —
   if the board has no native battery input, wire TP4056 OUT+/OUT- directly
   to the board's 3V3/GND with the TP4056 handling regulation, per that
   module's own documentation).
3. Dry-fit everything in the revised enclosure before coating anything —
   confirm the JST connectors mate cleanly, the USB charge port aligns with
   the cutout, and the BOOT button is reachable.
4. Flash the rewritten `hvac_wifi.ino` and bench-test one full wake → connect
   → sample → send → sleep cycle over USB Serial before disconnecting from
   power and going to battery-only.
5. **Apply conformal coating last**, after the bench test passes. Mask off
   the USB charge port, the BOOT button, and the JST connector's mating
   contacts (coat the wire insulation and solder joints, not the contact
   surfaces themselves) — coating over a mechanical connector's actual
   contact points defeats the connector.
6. Let the coating cure fully per its datasheet (typically a few hours to a
   day depending on product) before closing the enclosure.
7. Reassemble, confirm the charge port is accessible from outside, and
   verify BOOT-button recalibration is reachable through the enclosure.

## Rollout to existing pilot units

Since this bundles a firmware rewrite with the trust-boundary and other
backend changes, do the full rollout in this order, not piecemeal:

1. Apply the pending Supabase migrations.
2. Deploy the updated backend.
3. Re-provision each pilot device in the admin panel (generates its new
   device secret).
4. Physically rework and reflash one pilot unit first — bench-verify a full
   sleep/wake/calibration cycle reports correctly on the dashboard before
   touching the second unit.
5. Repeat for remaining pilot units once the first is confirmed stable.

Old firmware talking to the new backend will fail closed (missing
`x-device-key` gets rejected by `api/data.js`), so don't deploy the backend
changes without also having a plan to revisit every live device in short
order.
