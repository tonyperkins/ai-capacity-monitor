# Capacity Square — LVGL touch dashboard

A standalone 480×480 dashboard for Guition/Sunton ESP32-4848S040 boards.
It uses ESPHome **2026.10.2**, native ESP-IDF, LVGL **9.5.0**, and the
maintained `mipi_rgb` **GUITION-4848S040** profile. Home Assistant is not
required: readings come directly from the local
[collector](../collector/README.md), on the port and with the token the local
bridge used before it.

## What the interface emphasizes

- **Rings** (home): one arc per provider, up to five, showing its tightest
  long-window limit as percent remaining. Arcs run clockwise from 12 o'clock
  over three quarters of a circle. A violet dot on each ring marks the time
  left in that limit's window on the same scale: an arc that reaches past its
  dot has capacity to spare, and one that stops short is being used faster
  than the window allows. The dot is absent when the reset time is unknown.
  Beside each ring: provider, percent left, and its short-window limit (such
  as `5h 36`), red at or under 10%. The centre shows the tightest provider and
  opens its detail page.
- **Dispatch:** where to send the next job. Providers are ranked by spare
  capacity per hour until reset (percent left divided by hours left), so
  capacity that would expire unused is spent first. Providers with a stale
  reading rank after fresh ones, and those with any limit at or under the 10%
  hold line rank last and are marked On hold. The amber tick on each bar is
  the hold line.
- **Limits:** every reading, with ordinary vertical scrolling. Each card
  shows the remaining percentage, capacity bar, reset countdown and a compact
  violet time-left bar. Credit balances, if a snapshot has any, follow the
  quotas; USD values are converted from the contract's integer cents.
- **Settings:** brightness, a saved Rotate 90 deg clockwise control, and Touch calibration. Refresh stays available in the header.
- **Metric details:** tap a card for its source label, reading state, reading
  age, capacity, exact local reset date/time, and separately labeled time
  remaining in its reset window. A due reset stays marked as awaiting collection;
  the display never fabricates a refilled bucket.
- **Issues:** an explicit amber button opens collection warnings, including
  sources the collector could not read and readings this firmware skipped.

Nothing in the firmware names a provider or a limit. A provider is summarised
by rule (`capacity_model::providers`): its primary limit is the tightest one
with a window of six days or more, or no stated window; its quick limit is the
tightest shorter one. A reading with an unknown kind or unit, an out-of-range
value or a repeated key is skipped and counted, and the rest of the snapshot
is shown. A payload is rejected only when its envelope is wrong or nothing in
it is usable. More than five providers would need a layout change on Rings.

There are no double-tap or hold gestures. Navigation targets are at least
44 pixels tall. Text and bars update without animations or full-screen clears;
unchanged widgets are retained. Rings and Dispatch are redrawn only when a
value they show changes, and every ten minutes so countdowns keep moving. Tabs and detail pages are deliberate touch
navigation rather than timed page cycling. Rotate cycles through 0, 90, 180, and 270 degrees and saves the selected
orientation. ESPHome rotates both the display output and calibrated touch
coordinates together. Calibration temporarily returns to the panel's base
orientation and restores the selected orientation when finished.

**Refresh** fetches the collector's latest snapshot. It does not start a new
reading or call a provider. Automatic display refresh is once per minute.
The age indicator refers to the collection timestamp, and retained readings
are labeled as prior values. Bad responses preserve the current snapshot with
an offline indicator. This version retains outage data in RAM, not across
power loss; after reboot it waits for an authenticated collector response.

## Hardware and stability baseline

The board has an ESP32-S3, 16 MB flash, 8 MB octal PSRAM, ST7701 RGB LCD,
and GT911 capacitive touch. Pin routing and initialization come from the
[maintained ESPHome board model](https://github.com/esphome/esphome/blob/2026.10.2/esphome/components/mipi_rgb/models/guition.py),
with its default 12 MHz pixel clock and ten-line SRAM bounce buffers.
The framework is compiled with execution from PSRAM enabled, keeping the
external-memory cache available around flash access. This replaces the
experimental custom Arduino framebuffer swapping that caused screen jumps.

The board uses DIO flash boot, octal 80 MHz PSRAM, SPI control pins 48/47/39,
RGB control pins 18/16/17/21, GT911 I2C pins 19/45, and GPIO 38 backlight.
The fallback touch orientation mirrors both axes. First boot displays a
five-target calibration screen that measures the controller's raw range,
offset, scale, mirroring, and axis ordering, then checks the center point. Tap
each target center and lift. The final **Done** button tests the newly applied
mapping and saves it in device preferences. Invalid or inconsistent samples
are rejected rather than saved. **Settings → Calibrate touch** repeats the
process. Raw calibration uses the controller coordinates, so it works even
when ordinary buttons are misaligned.
The relay outputs are not configured.

## Build and provision

Install the pinned ESPHome release in a Python virtual environment:

```sh
python -m pip install esphome==2026.10.2
```

Copy `secrets.example.yaml` to the ignored `secrets.yaml`. Supply Wi-Fi
credentials, the collector's snapshot URL, and its display bearer token (the
`display` section of `~/.config/ai-capacity-monitor/collector.json`).

```sh
esphome config apps/square-dashboard/capacity.yaml
esphome compile apps/square-dashboard/capacity.yaml
esphome upload apps/square-dashboard/capacity.yaml --device /dev/ttyUSB0
esphome logs apps/square-dashboard/capacity.yaml --device /dev/ttyUSB0
```

`secrets.yaml` and `.esphome/` build products are ignored. Personal firmware
contains these device credentials; keep that binary private. This standalone
configuration enables neither a Home Assistant API nor unauthenticated OTA.
Backlight settings use ESPHome's preferences, with writes coalesced over five
minutes. Touch calibration is explicitly synchronized to storage after Done; rotation
changes are also saved promptly rather than waiting for the backlight interval. Returning to the original Arduino prototype requires restoring its
matching partition table/bootloader as well as the application; private rollback
images are kept locally under `dist/device-backups/`.

## Verify the UI without a device

The same native LVGL UI can render headlessly on a computer. After ESPHome
has prepared the managed dependencies, run:

```sh
cmake -S apps/square-dashboard/tests -B /tmp/capacity-ui-tests \
  -DLVGL_SOURCE="$PWD/apps/square-dashboard/.esphome/build/capacity-square/managed_components/lvgl__lvgl" \
  -DARDUINOJSON_SOURCE="$PWD/apps/square-dashboard/.esphome/build/capacity-square/managed_components/bblanchon__arduinojson"
cmake --build /tmp/capacity-ui-tests -j
cd /tmp
/tmp/capacity-ui-tests/capacity_ui_tests
```

If `cmake` is not installed, ESPHome's own copy works:
`~/.cache/esphome/idf/tools/cmake/<version>/bin/cmake`.

Tests cover snapshot validation, skipping of readings the firmware does not
understand, provider summaries, dispatch order, the Rings and Dispatch faces,
USD units, invalid-response retention, touch navigation, scrolling, detail views, brightness,
refresh, offline/attention states, calibration recovery for offset/scaled/swapped
controllers, rejection of inconsistent samples, and confirmation before saving. They write 480×480 PPM previews using
synthetic readings. Physical stability and touch alignment must also be checked
on the connected board; a passing serial log alone cannot verify tearing.
