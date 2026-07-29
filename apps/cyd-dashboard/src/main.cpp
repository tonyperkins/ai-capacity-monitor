#include <Arduino.h>
#include <SPI.h>
#include <TFT_eSPI.h>
#include <WiFi.h>
#include <XPT2046_Touchscreen.h>

namespace {
constexpr uint8_t kTouchIrq = 36;
constexpr uint8_t kTouchMosi = 32;
constexpr uint8_t kTouchMiso = 39;
constexpr uint8_t kTouchClock = 25;
constexpr uint8_t kTouchChipSelect = 33;

constexpr uint16_t kBackground = 0x08F4;
constexpr uint16_t kPanel = 0x1126;
constexpr uint16_t kBorder = 0x2B4D;
constexpr uint16_t kPrimary = 0xDFFF;
constexpr uint16_t kMuted = 0x8D5A;
constexpr uint16_t kCyan = 0x2DFF;
constexpr uint16_t kGreen = 0x47F2;
constexpr uint16_t kAmber = 0xFD26;

TFT_eSPI display;
SPIClass touchSpi(VSPI);
XPT2046_Touchscreen touch(kTouchChipSelect, kTouchIrq);

#if defined(CYD_ST7789)
constexpr const char* kDisplayProfile = "ST7789 fallback";
#else
constexpr const char* kDisplayProfile = "ILI934x USB-C";
#endif

void drawLabelValue(int16_t y, const char* label, const String& value, uint16_t valueColor) {
  display.fillRect(10, y, 300, 27, kPanel);
  display.drawRoundRect(10, y, 300, 27, 4, kBorder);
  display.setTextDatum(ML_DATUM);
  display.setTextColor(kMuted, kPanel);
  display.drawString(label, 18, y + 14, 2);
  display.setTextDatum(MR_DATUM);
  display.setTextColor(valueColor, kPanel);
  display.drawString(value, 302, y + 14, 2);
}

void drawHardwareTest() {
  display.fillScreen(kBackground);
  display.setTextDatum(TL_DATUM);
  display.setTextColor(kCyan, kBackground);
  display.drawString("CAPACITY", 10, 7, 4);
  display.setTextColor(kMuted, kBackground);
  display.drawRightString("CYD HARDWARE TEST", 310, 12, 2);

  display.fillRect(10, 42, 96, 30, TFT_RED);
  display.fillRect(112, 42, 96, 30, TFT_GREEN);
  display.fillRect(214, 42, 96, 30, TFT_BLUE);
  display.setTextColor(TFT_WHITE);
  display.setTextDatum(MC_DATUM);
  display.drawString("RED", 58, 57, 2);
  display.drawString("GREEN", 160, 57, 2);
  display.drawString("BLUE", 262, 57, 2);

  drawLabelValue(84, "Display", kDisplayProfile, kGreen);
  drawLabelValue(116, "Backlight", "GPIO 21 ON", kGreen);
  drawLabelValue(148, "Touch", "touch the screen", kAmber);
  drawLabelValue(180, "Wi-Fi", "scanning", kAmber);

  display.setTextDatum(BC_DATUM);
  display.setTextColor(kMuted, kBackground);
  display.drawString("Serial 115200  |  no credentials stored", 160, 235, 2);
}

void runWifiScan() {
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(false, false);
  delay(250);
  Serial.println("Wi-Fi scan started");
  int16_t result = WiFi.scanNetworks(false, true);
  if (result < 0) {
    Serial.printf("Wi-Fi scan retry after result %d\n", result);
    WiFi.scanDelete();
    delay(500);
    result = WiFi.scanNetworks(false, true);
  }
  if (result >= 0) {
    drawLabelValue(180, "Wi-Fi", String(result) + " networks found", kGreen);
    Serial.printf("Wi-Fi radio PASS: %d networks found\n", result);
    WiFi.scanDelete();
    return;
  }
  drawLabelValue(180, "Wi-Fi", "scan failed", TFT_RED);
  Serial.printf("Wi-Fi radio FAIL: scan result %d\n", result);
}

void updateTouch() {
  if (!touch.tirqTouched() || !touch.touched()) return;
  const TS_Point point = touch.getPoint();
  drawLabelValue(148, "Touch", "x " + String(point.x) + "  y " + String(point.y) + "  z " + String(point.z), kGreen);
  Serial.printf("Touch PASS: raw x=%d y=%d pressure=%d\n", point.x, point.y, point.z);
  delay(80);
}
}  // namespace

void setup() {
  Serial.begin(115200);
  delay(400);
  Serial.println();
  Serial.println("AI Capacity Monitor CYD hardware test");

  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, TFT_BACKLIGHT_ON);
  display.init();
#if !defined(CYD_ST7789)
  // Newer USB-C ILI934x CYDs ship with the panel inversion bit opposite the
  // older Micro-USB board. Without this, every color is rendered as its
  // complement (red as cyan, green as magenta, and blue as yellow).
  display.invertDisplay(true);
#endif
  display.setRotation(1);
  drawHardwareTest();
  Serial.printf("Display initialized with %s profile\n", kDisplayProfile);

  touchSpi.begin(kTouchClock, kTouchMiso, kTouchMosi, kTouchChipSelect);
  touch.begin(touchSpi);
  touch.setRotation(1);
  Serial.println("XPT2046 touch controller initialized");

  runWifiScan();
}

void loop() {
  updateTouch();
  delay(20);
}
