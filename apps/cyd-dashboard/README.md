# CYD dashboard firmware

Firmware for the ESP32-2432S028 Cheap Yellow Display (CYD). The first
milestone is intentionally a hardware test: it proves the display, backlight,
XPT2046 touch controller, Wi-Fi radio, serial connection, and board profile
before the Capacity Monitor data client and final UI are added.

No Wi-Fi credentials, bridge tokens, provider data, or device identifiers are
stored in this repository or required by the hardware test.

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

## Build and upload

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

The expected display has red, green, and blue test bars plus status rows. Touch
the screen and confirm that raw coordinates appear. A successful Wi-Fi scan
reports only the number of nearby networks; network names are not displayed or
logged.

## Reference

The wiring and controller profiles follow the maintained
[ESP32 Cheap Yellow Display reference](https://github.com/witnessmenow/ESP32-Cheap-Yellow-Display).
