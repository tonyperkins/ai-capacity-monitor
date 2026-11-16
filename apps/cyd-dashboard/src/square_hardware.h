#pragma once

// Guition/Sunton ESP32-4848S040: ST7701 RGB + GT911 capacitive touch.
// Wiring/init profile: Arduino_GFX ESP32_4848S040_86BOX_GUITION.
// Legacy prototype. Use apps/square-dashboard for the maintained LVGL version.
#include <Arduino_GFX_Library.h>
#include <Wire.h>

constexpr uint16_t TFT_BLACK = 0x0000;
constexpr uint16_t TFT_WHITE = 0xffff;
constexpr uint16_t TFT_CYAN = 0x07ff;
constexpr uint16_t TFT_GREEN = 0x07e0;
constexpr uint16_t TFT_ORANGE = 0xfd20;
constexpr uint16_t TFT_RED = 0xf800;
constexpr uint8_t TL_DATUM = 0, TR_DATUM = 2, ML_DATUM = 3, MC_DATUM = 4, MR_DATUM = 5;

// Keep the existing dashboard's drawing interface, while using an RGB driver
// rather than the original CYD's SPI-only TFT_eSPI driver.
class SquareDisplay : public Arduino_RGB_Display {
 public:
  SquareDisplay()
      : Arduino_RGB_Display(480, 480,
            new Arduino_ESP32RGBPanel(
                18, 17, 16, 21,
                11, 12, 13, 14, 0,
                8, 20, 3, 46, 9, 10,
                4, 5, 6, 7, 15,
                1, 10, 8, 50, 1, 10, 8, 20,
                0, 6000000),
            1, false,
            new Arduino_SWSPI(GFX_NOT_DEFINED, 39, 48, 47, GFX_NOT_DEFINED),
            GFX_NOT_DEFINED, st7701_type9_init_operations, sizeof(st7701_type9_init_operations)) {}

  void init() {
    if (!begin()) {
      Serial.println("RGB display initialization failed");
      while (true) delay(1000);
    }
    setTextWrap(false);
  }
  void setTextDatum(uint8_t value) { datum_ = value; }
  int16_t textWidth(const String& text, uint8_t font) {
    return text.length() * 6 * fontScale(font);
  }
  void drawString(const String& text, int16_t x, int16_t y, uint8_t font) {
    const uint8_t scale = fontScale(font);
    const int16_t w = textWidth(text, font);
    if (datum_ == TR_DATUM || datum_ == MR_DATUM) x -= w;
    else if (datum_ == MC_DATUM) x -= w / 2;
    if (datum_ == ML_DATUM || datum_ == MC_DATUM || datum_ == MR_DATUM) y -= 4 * scale;
    setTextSize(scale);
    setCursor(x, y);
    print(text);
  }
 private:
  static uint8_t fontScale(uint8_t font) { return font >= 4 ? 3 : font >= 2 ? 2 : 1; }
  uint8_t datum_ = TL_DATUM;
};

// Navigation only needs contact state, not coordinates. Read the GT911's
// ready/status register, acknowledge each frame, and retain contact between
// frames so a long press is not mistaken for repeated taps.
class SquareTouch {
 public:
  void begin() {
    Wire.begin(19, 45, 400000);
    Wire.setTimeOut(20);
    for (uint8_t candidate : {uint8_t(0x5d), uint8_t(0x14)}) {
      Wire.beginTransmission(candidate);
      if (Wire.endTransmission() == 0) { address_ = candidate; break; }
    }
    Serial.println(address_ ? "GT911 touch detected" : "GT911 touch unavailable");
  }
  void setRotation(uint8_t) {}  // Contact-only navigation is rotation-independent.
  bool tirqTouched() { return address_ != 0; }
  bool touched() {
    if (!address_) return false;
    Wire.beginTransmission(address_);
    Wire.write(0x81); Wire.write(0x4e);
    if (Wire.endTransmission(false) != 0 || Wire.requestFrom(address_, uint8_t(1)) != 1) return false;
    const uint8_t status = Wire.read();
    if (status & 0x80) {
      down_ = (status & 0x0f) > 0;
      Wire.beginTransmission(address_);
      Wire.write(0x81); Wire.write(0x4e); Wire.write(0);
      Wire.endTransmission();
    }
    return down_;
  }
 private:
  uint8_t address_ = 0;
  bool down_ = false;
};
