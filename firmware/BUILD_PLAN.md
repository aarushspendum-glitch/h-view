# H-VIEW device — full build plan

Complete build guide for a new unit from raw parts, matching the hardware
decisions in this session's redesign (ICM-42670-P, battery + deep sleep,
JST-PH connector, conformal coating). If you're reworking an *existing*
wall-powered pilot unit rather than building fresh, see
[`PHYSICAL_REWORK.md`](PHYSICAL_REWORK.md) instead — the two documents
share the wiring/coating/testing steps but that one is framed around
retrofitting a unit already in the field.

## Bill of materials (per unit)

| # | Part | Spec | Example source | Approx unit cost |
|---|---|---|---|---|
| 1 | ESP32 dev board | A purpose-built low-power board, not a generic dev board — e.g. DFRobot FireBeetle 2 ESP32-E. Measured ~10µA deep-sleep current (vs. ~4mA on a stock dev board, whose onboard USB-serial chip and regulator stay powered even in "sleep"), plus a built-in LiPo charge circuit with automatic USB/battery switching | Amazon / DFRobot / Mouser | $10–15 |
| 2 | ICM-42670-P breakout | 6-axis IMU, I2C, 3.3V logic | Boutique breakout boards exist from small makers (e.g. search "ICM-42670-P breakout" on Tindie/Lectronz) — stock on these is not guaranteed, check availability before ordering. Fallback: TDK's own `EV_ICM-42670-P` eval board via DigiKey (~$99, overkill for production volume but always in stock) | $10–20 (boutique) / ~$99 (eval board) |
| 3 | LiPo battery | Single-cell 3.7V, **1500mAh**. Sized specifically against the firmware's 5-minute wake interval and the FireBeetle's ~10µA sleep current for ~24-25 days of runway per charge (see calculation below) — going bigger just adds size/cost/weight on a device that already hits the target, going smaller cuts into that margin. Connects directly to the FireBeetle's onboard battery connector; no separate charge module needed | Adafruit / SparkFun / Amazon | $8–12 |
| 4 | JST-PH 4-pin connector pair | One socket + one plug, 2mm pitch, for the IMU link | Amazon / DigiKey / AliExpress | $1–2 |
| 5 | Conformal coating | Acrylic or silicone spray-on (e.g. MG Chemicals 419D or similar) | Amazon / electronics distributors | $10–15 (covers many units) |
| 6 | 3D-printed enclosure | See enclosure requirements below | Print in-house or via a print service | Filament cost only if printing in-house |
| 7 | Hookup wire, solder, heat-shrink | 26–28 AWG stranded | Any electronics supplier | Negligible |
| 8 | Double-sided foam tape | Secures the battery cell against vibration inside the enclosure | Any hardware/electronics supplier | Negligible |
| 9 | Small solar panel | 5V, 1W / 200mA, epoxy or ETFE-coated for outdoor weather resistance (e.g. [Adafruit's 5V 1.22W ETFE panel](https://www.adafruit.com/product/5368), ~100-130mm class) | Adafruit / Amazon | $8–15 |
| 10 | Solar LiPo charge module | CN3065-based mini solar charger board — 4.4-6V solar input, up to 500mA charge current, 2-pin JST output matching standard LiPo connectors, built-in short-circuit protection | Amazon / HiLetgo / ICStation | $2–4 |

Approximate per-unit hardware cost: **$37–68** using boutique IMU breakouts
and adding solar, or **~$125–159** if forced to use the TDK eval board.
Coating and enclosure costs amortize across a batch, not per-unit.

### Why 1500mAh, not bigger or smaller

Each wake cycle (WiFi connect + IMU burst + send) costs about the same
fixed amount of charge regardless of how often it happens (~0.19mAh).
Sleep between wakes costs almost nothing on the FireBeetle (~10µA). At the
firmware's 5-minute wake interval, that works out to roughly 2.2mA average
draw — so a 1500mAh cell (about 1350mAh usable after derating for the
protection circuit cutoff) gives:

```
1350mAh / 2.2mA ≈ 614 hours ≈ 24-25 days per charge
```

Going bigger than 1500mAh adds size, weight, and cost to the enclosure for
runway you don't need. Going smaller cuts directly into that margin. If
`WAKE_INTERVAL_S` in the firmware changes, this number changes with it —
shorter interval, shorter runway, and a bigger cell would be needed to
compensate.

### Why solar, and why the numbers work out well here

Requiring a client to manually recharge every ~24 days is real friction —
a recurring task on their end, and a plausible reason to lose a sale. Solar
is a strong fix specifically *because* this device sits outdoors on a
rooftop, in direct sun most of the day — a much better solar environment
than most battery-IoT applications get.

**Daily energy need**, from the same duty-cycle math as above:

```
Average current  ≈ 2.243 mA  (established above)
Average power     = 2.243mA x 3.7V nominal ≈ 8.3 mW
Daily energy need = 8.3mW x 24h ≈ 0.20 Wh/day
```

**Minimum panel size**, sized conservatively for real-world conditions —
2.5 peak-sun-hours/day (accounts for cloudy days and winter, not a
best-case sunny-day number) and 50% system efficiency (panel angle isn't
perfectly optimized, plus dust, plus charge-circuit conversion loss):

```
Required panel wattage = 0.20 Wh / (2.5h x 0.5) = 0.20 / 1.25 ≈ 0.16 W
```

A **1W (200mA @ 5V) panel** — the small, cheap, widely available size
listed in the BOM — provides roughly **6x** that minimum requirement.
That's real margin for a run of bad weather, some shading, dust
accumulation, or panel aging over years outdoors, not a number sized to
the bare minimum.

**The battery becomes a buffer, not the primary supply.** The 1350mAh
usable capacity alone (4.99Wh, same 90%-derated figure used above) still
provides ~25 days of runway with *zero* solar input at all (matches the
earlier no-solar calculation exactly), so a multi-day
stretch of heavy cloud cover, snow-covered panel, or a shaded install
doesn't cause a gap in monitoring — the panel's job is to keep that
battery topped up so recharging is rarely if ever needed, not to power
the device directly in real time.

**Net effect:** this isn't "extend the interval to 2 months" — the power
budget here is small enough that solar plausibly eliminates manual
recharging almost entirely for most installs, with the battery absorbing
the bad-weather stretches.

## Tools needed

- Soldering iron + solder, or a crimping tool if using pre-terminated JST-PH
  leads instead of soldering directly to the connector
- Multimeter (continuity + voltage check before first power-up)
- USB cable matching the ESP32 board's port, for flashing and bench testing
- 3D printer access (or a print service) for the enclosure
- A well-ventilated area for spraying conformal coating

## Wiring / pinout

| ICM-42670-P pin | ESP32 pin |
|---|---|
| VCC | 3V3 |
| GND | GND |
| SDA | GPIO21 (D21) |
| SCL | GPIO22 (D22) |

The battery plugs directly into the FireBeetle's onboard 2-pin JST battery
connector — no separate charge circuit to wire for USB charging. The
board's own USB port (routed to the enclosure's external charge-port
cutout) still works as a manual/bench charging option and automatically
switches between USB and battery power.

**Solar addition:** the solar panel's output wires into the CN3065
module's solar input terminals; the CN3065's 2-pin JST output goes to the
same battery the FireBeetle uses (a splitter/parallel JST connection, or
solder both leads to the same battery tabs). In the field, only the solar
path is actively charging day to day — the FireBeetle's own USB charge
circuit sits idle whenever nothing is plugged into USB, so the two charge
paths aren't normally both driving current into the cell at once. Worth
confirming on the actual bench-built unit (see checklist below) rather
than assuming it from the datasheet alone — this is the one part of the
solar addition not yet verified against real hardware.

BOOT button (GPIO0) is already broken out on the board — no new wiring
needed, it's reused as the firmware's recalibration trigger.

## Assembly steps

1. **Bench-wire before committing to connectors.** Temporarily jumper-wire
   the ICM-42670-P to the ESP32 per the pinout above and confirm the sensor
   is detected (flash the firmware, watch Serial for a successful IMU init)
   before soldering anything permanent.
2. **Terminate the JST-PH pair**: solder or crimp one half onto the
   ESP32-side harness (VCC/GND/SDA/SCL, in that order, matching the
   breakout's own pad order) and the other half onto the ICM-42670-P
   breakout's four pads. Double-check polarity with a multimeter
   (continuity from ESP32 3V3 pin through to the connector's VCC pin,
   confirmed against the breakout's silkscreen) — a reversed VCC/GND on a
   locking connector is much harder to visually catch after the fact than
   on loose jumper wires.
3. **Plug in the battery** to the FireBeetle's onboard 2-pin JST connector
   — no charge-circuit wiring needed for USB charging, the board handles it.
4. **Wire the solar path**: solar panel leads into the CN3065 module's
   input terminals, CN3065 output paralleled onto the same battery. Verify
   with a multimeter that the CN3065 is actually delivering charge current
   into the battery under a bright light or direct sun before moving on —
   don't assume it from the wiring alone.
5. **Dry-fit everything** in the enclosure before any coating: confirm the
   JST-PH connectors mate cleanly, the board's USB port aligns with the
   enclosure's charge-port cutout, the solar panel sits in its sky-facing
   window, and the BOOT button is reachable (see enclosure requirements
   below).
6. **Flash and bench-test** `hvac_wifi.ino` over USB with the unit fully
   assembled but not yet coated — confirm one full wake → WiFi connect →
   IMU sample → send → deep-sleep cycle, then confirm it wakes again on
   schedule. See [`README.md`](README.md) for the library install list and
   per-unit provisioning workflow (device ID, pairing password, device
   secret).
7. **Apply conformal coating** only after the bench test passes. Mask the
   USB charge port, the BOOT button, the solar panel's own face, and the
   JST connectors' actual mating contacts (coat the wire insulation and
   solder joints around them, not the contact surfaces themselves —
   coating over a mechanical connector's contacts defeats the connector,
   and coating over the panel's face blocks the light it needs). Let it
   cure fully per the product's datasheet before closing the enclosure.
8. **Close the enclosure**, verify the charge port and solar panel are
   externally accessible/exposed and the BOOT button is reachable, then
   repeat the bench test once more fully sealed as a final check before
   field deployment.

## Enclosure requirements

- Internal volume for the LiPo cell, sized to whichever battery capacity
  you land on.
- The battery cell secured against vibration — double-sided foam tape or a
  molded pocket, not just sitting loose in the case. A pouch cell rattling
  around on a vibrating HVAC unit risks wearing through the pouch or
  working its connector loose over time, the same failure mode the
  JST-PH connector swap is meant to avoid elsewhere.
- An externally-accessible USB charge port aligned with the board's own
  USB connector, so units can be recharged manually without opening the
  case if the solar path ever isn't enough on its own.
- A sky-facing window or externally-mounted face for the solar panel —
  it needs direct light, not light filtered through the enclosure wall.
  Check the actual mounting orientation on the HVAC unit before finalizing
  this — the panel needs a real, mostly-unshaded view of the sky from
  wherever the device ends up physically installed.
- Strain relief on the JST-PH harness if the IMU isn't co-located with the
  ESP32/battery compartment.
- The BOOT button reachable (exposed, or through a small access hole with a
  thin tool) without fully disassembling the unit.

There's no existing CAD file in this repo to start from — model fresh
against these requirements, sized around the ESP32 board and battery you
choose.

## Bench-test checklist before first field deployment

- [ ] IMU detected on boot (Serial shows a successful init, not a retry loop)
- [ ] WiFi connects via the pairing portal on first boot
- [ ] Device secret entered in the portal is accepted (`x-device-key` reads
      back correctly — confirm a reading shows up on the dashboard, not a
      401 in the Vercel function logs)
- [ ] One full wake/sleep cycle observed end-to-end (Serial log shows sleep,
      then a fresh boot log after the wake interval elapses)
- [ ] BOOT-button long-press triggers recalibration (Serial confirms the
      baseline was cleared)
- [ ] Battery charges via the external USB port with the enclosure fully
      closed
- [ ] Solar panel actually charges the battery — measure charge current
      into the cell under direct sun/bright light with a multimeter, don't
      just assume the wiring works
- [ ] USB charging and solar charging don't conflict when both are
      connected at once (the one part of this design not yet verified
      against real hardware, per the wiring note above)
- [ ] Unit still reports correctly after being fully sealed and coated (not
      just on the open bench)

Only after all of the above pass on one unit should it go to a real pilot
site, and only after that unit has run a few full cycles successfully
should a second unit be built the same way.
