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
  (`5h`, `day`, `7d`), the reset countdown, and a capacity bar with a thin
  violet bar under it for the time left in that window, on the same scale:
  full just after a reset, empty when the next one is due. Capacity longer
  than time means there is capacity to spare; shorter means it is being used
  faster than the clock. The owner has gone back and forth on the direction;
  `TIME_BAR_DRAINS` in `capacity_ui.h` flips every time bar at once. A provider with no short window (Grok) leaves that cell
  empty. Scoped limits, such as Claude's Fable cap or Antigravity's Argon
  group, appear as a small line under the provider name. Percentages turn
  amber at or under 25% and red at or under 10%; a prior value is grey and
  marked `prior`. Tapping a row lists every reading for that provider with
  exact reset times.
- **Limits:** every reading, with ordinary vertical scrolling. Each card
  shows the remaining percentage, capacity bar, reset countdown and a compact
  violet bar for the time left. Credit balances, if a snapshot has any, follow the
  quotas; USD values are converted from the contract's integer cents.
- **Settings:** brightness, a saved Rotate 90 deg clockwise control, Touch calibration, and Refresh now.
- **Metric details:** tap a card for its source label, reading state, reading
  age, capacity, exact local reset date/time, and separately labeled time
  remaining in its reset window. A due reset stays marked as awaiting collection;
  the display never fabricates a refilled bucket.
- **Issues:** when there are any, the status strip at the top shows an amber
  count and becomes tappable; it opens collection warnings, including
  sources the collector could not read and readings this firmware skipped.

Nothing in the firmware names a provider or a limit. A provider is summarised
by rule (`capacity_model::providers`), in the order the provider reports them:
its quick limit is the first with a window under six days; its main limit is
the first longer one (or one with no stated window) that does not count toward
another; its other long-window limits are extras. A reading with an unknown kind or unit, an out-of-range
value or a repeated key is skipped and counted, and the rest of the snapshot
is shown. A payload is rejected only when its envelope is wrong or nothing in
it is usable. With more than five providers the Home face scrolls.

Navigation is by swipe. The three pages sit side by side in a horizontally
scrolling pager, so a page follows the finger. On release, a drag of more
than 50 pixels carries on to the next page and a shorter one springs back.
Page dots sit at the bottom. The order is Home, Limits, Settings and it wraps: Settings
is to the left of Home. On a detail page a swipe right goes back, as does the
Back button. Pulling down refreshes on every page: the page moves with the finger, a thin
bar under the status strip fills as the pull deepens, and the status reads
"Release to refresh" once it is far enough. Letting go earlier does nothing.
A second refresh within a minute is ignored, with a note in the status. There are no edge, double-tap or
hold gestures, and touch calibration ignores swipes. A swipe never counts as
a tap, nothing lights up when touched, and dragging the brightness slider
does not turn the page. Buttons and rows are at least 44 pixels tall; the
issues strip is 34. Home is rebuilt only when a value it shows changes, and
once a minute so countdowns keep moving. Rotate cycles through 0, 90, 180, and 270 degrees and saves the selected
orientation. ESPHome rotates both the display output and calibrated touch
coordinates together. Calibration temporarily returns to the panel's base
orientation and restores the selected orientation when finished.

**Refresh** (pull down, or Refresh now in Settings) asks the collector to
read every provider now, by sending the snapshot request with an
`X-Capacity-Refresh: 1` header, then fetches the result ten seconds later.
The collector also starts at most one extra pass a minute. Automatic display refresh is once per minute.
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
contains these device credentials; keep that binary private. There is no OTA;
flash over USB.

### Screen off when the office is empty

The firmware enables the encrypted Home Assistant API (`api_encryption_key` in
`secrets.yaml`) for one purpose: it follows
`binary_sensor.everything_presence_one_278be8_occupancy` ("Tony's Office
Presence Occupancy", an Everything Presence One). When that sensor turns off,
the backlight fades out and LVGL pauses. When it turns on, the screen comes back
at the brightness last set in Settings. Snapshot polling continues while the
screen is dark.

- A tap on the dark screen wakes it. The tap does nothing else, because LVGL is
  paused. The screen stays on until the sensor next reports empty.
- If Home Assistant disconnects, the screen turns on and stays on. Without Home
  Assistant the display behaves as before.
- How long the room must be empty before the screen turns off is the sensor's
  `number.everything_presence_one_278be8_occupancy_off_latency` (15 s when last
  checked), set in Home Assistant.
- Home Assistant must have the device added: Settings > Devices & services >
  ESPHome, "Capacity Square", with the key from `secrets.yaml`. Until it is
  added, nothing subscribes and the screen stays on. The device also exposes
  its Backlight light to Home Assistant.
- To change the sensor, edit `entity_id` under `binary_sensor` in
  `capacity.yaml`.

### Auto brightness

**Settings > Auto** (on by default, remembered across restarts) sets the
brightness from the same sensor's light level,
`sensor.everything_presence_one_278be8_illuminance`. The mapping is
logarithmic: 5 lux or less gives 15%, 300 lux or more gives 100%, and about
70 lux gives roughly 67%. Changes fade over 2 s, and changes under 4% are
ignored so the screen doesn't flicker. Dragging the slider switches Auto off;
tap Auto to turn it back on. While the screen is off, readings update the
level without waking it. The curve constants (`DIM_LUX`, `BRIGHT_LUX`,
`MIN_AUTO`, `AUTO_STEP`) are in `capacity_ui.h`. This also needs the device
added to Home Assistant; without readings the brightness stays where it was.
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
