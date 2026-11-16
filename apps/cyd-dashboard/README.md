# CYD dashboard firmware

Firmware for the ESP32-2432S028 Cheap Yellow Display (CYD). It shows the same
validated balances and subscription limits as the browser extension by
polling the local bridge's token-protected, read-only display endpoint.

No Wi-Fi credentials, bridge tokens, provider data, or device identifiers are
stored in this repository. Device settings live in ESP32 preferences, and the
last valid snapshot is cached in LittleFS so a bridge or Wi-Fi outage is shown
honestly without erasing the last known readings.

## Hardware profile

The ESP32-2432S028 family uses the following common wiring:

- TFT SPI: MISO 12, MOSI 13, clock 14, chip select 15, data/command 2
- backlight: GPIO 21, active high
- XPT2046 touch SPI: MOSI 32, MISO 39, clock 25, chip select 33, IRQ 36

Newer USB-C boards have shipped with more than one compatible display
controller. Both known profiles are buildable:

- `cyd-usbc-ili934x` (default): the ILI9342-compatible TFT_eSPI profile with
  the USB-C panel's required color inversion
- `cyd-usbc-st7789`: fallback for ST7789-equipped USB-C / dual-USB boards

Selecting the wrong profile does not damage the board; the screen will be
blank or visibly incorrect, and the alternate environment can be flashed.

## Provision the local bridge

On the computer running the Capacity Monitor local bridge:

```sh
cd apps/local-bridge
CAPACITY_COLLECTOR_CONFIG=~/.config/ai-capacity-monitor/collector.json npm run display:enable
systemctl --user restart ai-capacity-collector.service
```

The command prints a display token. Keep it private. The CYD snapshot URL is:

```text
http://COMPUTER-LAN-IP:8788/snapshot/v1
```

Collection ingestion remains on loopback. Only the authenticated, read-only
snapshot route is exposed to the trusted LAN, and it has no write methods.

## Build, upload, and first setup

From this directory:

```sh
pio run
pio run -t upload
pio device monitor
```

To test the fallback controller:

```sh
pio run -e cyd-usbc-st7789 -t upload
```

After the first boot, connect a phone or computer to the temporary
`Capacity Monitor Setup` Wi-Fi network and open `http://192.168.4.1`. Choose
the device's Wi-Fi, then enter the snapshot URL and display token. The setup
portal closes after five minutes. Touch the display during its first second of
boot to reopen setup later.

### Optional Home Assistant brightness

The CYD does not use its onboard LDR: on this board it shares a poor divider
with the TFT backlight, so sampling it would require visible display blanking.
Instead, it can subscribe to a retained MQTT brightness value published by
Home Assistant. The first setup screen defaults to Tony's Office:

```text
Broker: 192.168.50.84:1883
Topic:  perkinslab/cyd/tonys-office/brightness
```

Create a dedicated broker login for this device and enter its username and
password in the same setup portal. Those credentials are stored only in the
device's ESP32 preferences; they are never committed, logged, or sent through
the Capacity Monitor bridge. The firmware accepts only decimal `0`–`255`
payloads, reconnects after Wi-Fi or broker loss, and continues to show the
normal dashboard while it waits for a retained value.

The Office Home Assistant automation is named
`automation.cyd_office_display_brightness`. It already publishes a retained
payload after a 15-second illuminance dwell and at Home Assistant startup:
`38` (15%) below 2 lx, `100` (39%) at 2–10 lx, `180` (71%) at 10–50 lx, and
`255` (100%) at 50 lx or brighter. The payload is the raw 8-bit PWM value;
some other CYD UIs display its percentage instead. Reuse that automation
rather than creating another publisher for the same Office topic.

For one-device, no-portal provisioning, copy `mqtt_credentials.example.h` to
the ignored `mqtt_credentials.h`, enter the dedicated broker login there,
flash the device, then remove the local file. The device saves the credential
in ESP32 preferences at boot; the temporary header is never tracked by Git.

The device polls once per minute. Its bottom status strip shows the true age of
the collected snapshot, a page indicator, and `LIVE`, `CACHED`, `WAIT`, or a
warning count. Tap the screen to move between balance and limit pages. Double
tap to cycle the saved backlight brightness through 100%, 50%, 20%, and 5%.
Press and hold for about 1.5 seconds to rotate clockwise; the selected
orientation and brightness are saved across restarts. Portrait and landscape
use separate responsive layouts rather than scaling the same canvas.

The extension's **Settings → Display → Show Claude monthly spending cap**
also controls the CYD card. When hidden, the extension omits the cap from
published snapshots and refreshes the bridge's saved snapshot on save.
The display applies the change on its next successful poll; no firmware
update is needed. If the bridge is unreachable, the cached display remains
until delivery and polling recover.

When a valid MQTT brightness payload has arrived, it takes precedence over
the saved manual brightness level. Manual brightness remains the fallback
until then, or when MQTT has not been configured.

Portrait quota rows show a green capacity bar and, when the extension supplies
reset timing, a separate high-contrast magenta bar for time remaining until
the next reset. The reset bar is intentionally omitted when the provider does
not expose enough timing information to calculate it.

After enabling the bridge, run **Collect now** in the extension once so the
bridge has an initial validated snapshot to serve.

## Reference

The wiring and controller profiles follow the maintained
[ESP32 Cheap Yellow Display reference](https://github.com/witnessmenow/ESP32-Cheap-Yellow-Display).

## 4-inch 480×480 comparison build

The separate `square-4848s040` environment targets the Guition/Sunton
ESP32-4848S040 family: ESP32-S3, 16 MB flash, 8 MB octal PSRAM, ST7701 RGB
LCD and GT911 capacitive touch. It uses DIO flash boot with octal PSRAM;
forcing QIO in the ROM image header caused a boot loop on the tested board.
The original CYD remains the default build.
This is the earlier Arduino prototype, retained for hardware comparison and
rollback. The recommended 480×480 application is now the separate
[LVGL touch dashboard](../square-dashboard/README.md). The prototype uses a
6 MHz pixel clock and batched drawing; it can still tear during full redraws.
The experimental custom double-buffer driver was removed after it made
physical display stability worse.
The [Espressif board reference](https://github.com/esp-arduino-libs/ESP32_Display_Panel/blob/master/docs/board/board_jingcai.md)
and [Arduino_GFX v1.5.0 board example](https://github.com/moononournation/Arduino_GFX/blob/v1.5.0/examples/PDQgraphicstest/Arduino_GFX_dev_device.h)
provide the hardware profile. A generic “ESP32-S3 480×480” listing alone does
not guarantee compatibility with other board families.

This version uses Arduino_GFX for the RGB display; it shares the existing
snapshot, cache, setup portal, MQTT brightness, and navigation code rather
than requiring a separate LVGL application. The overview shows up to two balances
above seven quota rows, including separate capacity and reset-time bars. With
zero or one balance it fits eight quotas; the single balance spans the width. Overflow
readings use additional pages; tap to page, double tap for brightness, and
hold to rotate as on the CYD. A single tap does nothing when all readings fit
on one page, avoiding an unnecessary full-screen redraw. A larger number of balances or limits cycles
those sections independently across the available overview pages.

```sh
pio run -e square-4848s040
pio run -e square-4848s040 -t upload --upload-port /dev/ttyUSB0
pio device monitor --port /dev/ttyUSB0
```

The dedicated hardware adapter uses these pins:

- LCD control SPI: CS 39, SCK 48, MOSI 47
- RGB: DE 18, VSYNC 17, HSYNC 16, PCLK 21
- RGB red: 11, 12, 13, 14, 0; green: 8, 20, 3, 46, 9, 10;
  blue: 4, 5, 6, 7, 15
- GT911: SDA 19, SCL 45; probes addresses `0x5d` and `0x14`
- Backlight: GPIO 38, active high

For setup without the temporary Wi-Fi portal, copy
`src/device_credentials.example.h` to the ignored `src/device_credentials.h`
and supply the existing Wi-Fi settings, bridge snapshot URL, and display token.
The first unconfigured boot saves these settings to device preferences and
Wi-Fi storage. Remove the private header after provisioning; future builds use
saved settings and the setup portal can change them. Firmware built with the
header contains its credentials, so keep that personal binary private.

Before the first test flash, a full factory-image backup was saved locally
under the ignored `dist/device-backups/` directory at the repository root.
To restore a backup, use esptool with the board connected and write the full
backup at address `0x0`. This restores its previous flash contents, including
any settings in that image.
