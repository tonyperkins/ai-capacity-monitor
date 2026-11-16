# Capacity Square — LVGL touch dashboard

A standalone 480×480 dashboard for Guition/Sunton ESP32-4848S040 boards.
It uses ESPHome **2026.10.2**, native ESP-IDF, LVGL **9.5.0**, and the
maintained `mipi_rgb` **GUITION-4848S040** profile. Home Assistant is not
required: readings come directly from the local
[collector](../collector/README.md), on the port and with the token the local
bridge used before it.

## What the interface emphasizes

- **Home:** one row per provider, five visible without scrolling. Each row
  has two fixed columns: the short window (session, 5-hour or daily) and the
  long one (weekly). A cell shows percent remaining in large type, the window
  (`5h`, `day`, `7d`), the reset countdown, and a bar. The violet tick on the
  bar is the time left in that window on the same scale: a bar that reaches
  past its tick has capacity to spare, and one that stops short is running
  ahead of the clock. A provider with no short window (Grok) leaves that cell
  empty. Scoped limits, such as Claude's Fable cap or Antigravity's Argon
  group, appear as a small line under the provider name. Percentages turn
  amber at or under 25% and red at or under 10%; a prior value is grey and
  marked `prior`. Tapping a row lists every reading for that provider with
  exact reset times.
- **Limits:** every reading, with ordinary vertical scrolling. Each card
  shows the remaining percentage, capacity bar, reset countdown and a compact
  violet time-left bar. Credit balances, if a snapshot has any, follow the
  quotas; USD values are converted from the contract's integer cents.
- **Settings:** brightness, a saved Rotate 90 deg clockwise control, and Touch calibration. Refresh stays available in the bottom button row.
- **Metric details:** tap a card for its source label, reading state, reading
  age, capacity, exact local reset date/time, and separately labeled time
  remaining in its reset window. A due reset stays marked as awaiting collection;
  the display never fabricates a refilled bucket.
- **Issues:** an explicit amber button opens collection warnings, including
  sources the collector could not read and readings this firmware skipped.

Nothing in the firmware names a provider or a limit. A provider is summarised
by rule (`capacity_model::providers`), in the order the provider reports them:
its quick limit is the first with a window under six days; its main limit is
the first longer one (or one with no stated window) that does not count toward
another; its other long-window limits are extras. A reading with an unknown kind or unit, an out-of-range
value or a repeated key is skipped and counted, and the rest of the snapshot
is shown. A payload is rejected only when its envelope is wrong or nothing in
it is usable. With more than five providers the Home face scrolls.

There are no double-tap or hold gestures. Navigation targets are at least
44 pixels tall. Text and bars update without animations or full-screen clears;
unchanged widgets are retained. Home is redrawn only when a value it shows
changes, and once a minute so countdowns keep moving. Tabs and detail pages are deliberate touch
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
understand, provider summaries, the Home face and provider page,
USD units, invalid-response retention, touch navigation, scrolling, detail views, brightness,
refresh, offline/attention states, calibration recovery for offset/scaled/swapped
controllers, rejection of inconsistent samples, and confirmation before saving. They write 480×480 PPM previews using
synthetic readings. Physical stability and touch alignment must also be checked
on the connected board; a passing serial log alone cannot verify tearing.
