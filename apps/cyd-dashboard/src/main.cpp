#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <SPI.h>
#include <TFT_eSPI.h>
#include <time.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiManager.h>
#include <XPT2046_Touchscreen.h>

namespace {
constexpr uint8_t kTouchIrq = 36;
constexpr uint8_t kTouchMosi = 32;
constexpr uint8_t kTouchMiso = 39;
constexpr uint8_t kTouchClock = 25;
constexpr uint8_t kTouchChipSelect = 33;
constexpr uint32_t kPollIntervalMs = 60 * 1000;
constexpr uint32_t kHttpTimeoutMs = 7000;
constexpr uint32_t kDoubleTapWindowMs = 320;
constexpr uint32_t kBrightnessOverlayMs = 1200;
constexpr uint32_t kMqttReconnectIntervalMs = 5000;
constexpr uint8_t kBacklightChannel = 0;
constexpr uint8_t kBrightnessLevels[] = {255, 128, 48, 12};
constexpr uint8_t kBrightnessPercents[] = {100, 50, 20, 5};
constexpr const char* kSetupAccessPoint = "Capacity Monitor Setup";
constexpr const char* kSnapshotCachePath = "/snapshot.json";
constexpr const char* kOfficeMqttHost = "192.168.50.84";
constexpr uint16_t kOfficeMqttPort = 1883;
constexpr const char* kOfficeBrightnessTopic = "perkinslab/cyd/tonys-office/brightness";
#if __has_include("mqtt_credentials.h")
#include "mqtt_credentials.h"
#endif
#ifndef MQTT_USERNAME
#define MQTT_USERNAME ""
#endif
#ifndef MQTT_PASSWORD
#define MQTT_PASSWORD ""
#endif

// This panel has limited contrast and a strong blue cast. A mostly neutral,
// near-black palette reads more cleanly than dark blue surfaces on the actual
// hardware, with color reserved for state and progress.
constexpr uint16_t kBackground = TFT_BLACK;
constexpr uint16_t kPanel = 0x1082;
constexpr uint16_t kBorder = 0x4208;
constexpr uint16_t kPrimary = TFT_WHITE;
constexpr uint16_t kMuted = 0xBDF7;
constexpr uint16_t kCyan = TFT_CYAN;
constexpr uint16_t kGreen = TFT_GREEN;
constexpr uint16_t kAmber = TFT_ORANGE;
constexpr uint16_t kRed = TFT_RED;
constexpr uint16_t kTrack = 0x2945;
// The reset window needs to remain legible beside the green capacity bar on
// the inexpensive CYD panel.  A saturated magenta and a four-pixel stroke
// survive the panel's blue cast far better than the original muted violet.
constexpr uint16_t kTimeTrack = 0x500A;
constexpr uint16_t kTime = TFT_MAGENTA;

struct DeviceSettings {
  String endpoint;
  String token;
  String mqttHost = kOfficeMqttHost;
  uint16_t mqttPort = kOfficeMqttPort;
  String mqttTopic = kOfficeBrightnessTopic;
  String mqttUsername;
  String mqttPassword;
  uint8_t rotation = 1;
  uint8_t brightnessIndex = 0;

  bool valid() const { return endpoint.startsWith("http://") && token.length() >= 16; }
  bool mqttValid() const { return mqttHost.length() && mqttPort && mqttTopic.length() && mqttUsername.length() && mqttPassword.length(); }
};

TFT_eSPI display;
SPIClass touchSpi(VSPI);
XPT2046_Touchscreen touch(kTouchChipSelect, kTouchIrq);
WiFiClient mqttSocket;
PubSubClient mqtt(mqttSocket);
Preferences preferences;
DeviceSettings settings;
JsonDocument snapshot;
bool hasSnapshot = false;
bool bridgeOnline = false;
uint32_t lastPollAt = 0;
uint32_t lastSuccessAt = 0;
uint32_t lastFooterDrawAt = 0;
time_t snapshotCollectedAt = 0;
uint8_t currentPage = 0;
bool touchWasDown = false;
bool longPressHandled = false;
uint32_t touchStartedAt = 0;
bool tapPending = false;
uint32_t tapPendingAt = 0;
uint32_t brightnessOverlayUntil = 0;
uint32_t lastMqttAttemptAt = 0;
bool hasMqttBrightness = false;
uint8_t mqttBrightness = 0;

bool isPortrait() {
  return display.height() > display.width();
}

String shortened(String value, size_t maximum) {
  if (value.length() <= maximum) return value;
  return value.substring(0, maximum > 1 ? maximum - 1 : 0) + "~";
}

String fitText(String value, int16_t maximumWidth, uint8_t font) {
  if (display.textWidth(value, font) <= maximumWidth) return value;
  while (value.length() > 1 && display.textWidth(value + "~", font) > maximumWidth) value.remove(value.length() - 1);
  return value + "~";
}

bool metricHasIssue(JsonObjectConst metric) {
  return strcmp(metric["readState"] | "validated", "validated") != 0;
}

uint16_t stateColor(JsonObjectConst metric) {
  const char* state = metric["readState"] | "validated";
  return strcmp(state, "validated") == 0 ? kGreen : kAmber;
}

uint16_t capacityColor(JsonObjectConst metric) {
  if (strcmp(metric["readState"] | "validated", "validated") != 0) return kAmber;
  const int percent = metric["value"] | 0;
  if (percent <= 20) return kRed;
  if (percent <= 40) return kAmber;
  return kGreen;
}

String metricDisplay(JsonObjectConst metric) {
  const char* unit = metric["unit"] | "";
  const int value = metric["value"] | 0;
  if (strcmp(unit, "count") == 0) {
    String number = String(abs(value));
    for (int index = number.length() - 3; index > 0; index -= 3) number = number.substring(0, index) + "," + number.substring(index);
    return String(value < 0 ? "-" : "") + number + " cr";
  }
  const char* providerDisplay = metric["display"] | "";
  if (providerDisplay[0]) return providerDisplay;
  if (strcmp(unit, "usd") == 0) {
    char formatted[24];
    snprintf(formatted, sizeof(formatted), "$%d.%02d", value / 100, abs(value % 100));
    return formatted;
  }
  if (strcmp(unit, "percent") == 0) return String(value) + "%";
  return String(value);
}

String compactQuotaName(JsonObjectConst metric) {
  String provider = metric["provider"] | "Limit";
  String label = metric["label"] | "Usage";
  provider.replace("ChatGPT Plus", "ChatGPT");
  provider.replace("Claude Pro", "Claude");
  provider.replace("Claude usage", "Claude");
  provider.replace("Gemini Pro", "Gemini");
  label.replace("\xC2\xB7", " ");
  label.replace("Weekly all models", "Weekly all");
  label.replace("Monthly spending cap", "Monthly cap");
  label.replace("Current session", "Session");
  label.replace("Current usage", "Current");
  label.replace("Weekly usage", "Weekly");
  label.replace("Weekly limit", "Weekly");
  return provider + " - " + label;
}

uint8_t metricCount(const char* kind) {
  if (!hasSnapshot) return 0;
  uint8_t count = 0;
  for (JsonObjectConst metric : snapshot["metrics"].as<JsonArrayConst>()) {
    if (strcmp(metric["kind"] | "", kind) == 0) ++count;
  }
  return count;
}

JsonObjectConst metricAt(const char* kind, uint8_t wanted) {
  uint8_t index = 0;
  for (JsonObjectConst metric : snapshot["metrics"].as<JsonArrayConst>()) {
    if (strcmp(metric["kind"] | "", kind) != 0) continue;
    if (index++ == wanted) return metric;
  }
  return JsonObjectConst();
}

uint8_t balancePageCount() {
  return max<uint8_t>(1, (metricCount("credit") + 5) / 6);
}

uint8_t quotaPageCount() {
  return max<uint8_t>(1, (metricCount("quota") + 5) / 6);
}

uint8_t totalPages() {
  return balancePageCount() + quotaPageCount();
}

time_t utcEpoch(int year, unsigned month, unsigned day, unsigned hour, unsigned minute, unsigned second) {
  year -= month <= 2;
  const int era = (year >= 0 ? year : year - 399) / 400;
  const unsigned yearOfEra = static_cast<unsigned>(year - era * 400);
  const unsigned dayOfYear = (153 * (month > 2 ? month - 3 : month + 9) + 2) / 5 + day - 1;
  const unsigned dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear;
  const int64_t daysSinceEpoch = era * 146097LL + static_cast<int>(dayOfEra) - 719468LL;
  return static_cast<time_t>(daysSinceEpoch * 86400LL + hour * 3600UL + minute * 60UL + second);
}

bool parseUtcTimestamp(const char* value, time_t& result) {
  int year, month, day, hour, minute, second;
  if (!value || sscanf(value, "%d-%d-%dT%d:%d:%d", &year, &month, &day, &hour, &minute, &second) != 6) return false;
  result = utcEpoch(year, month, day, hour, minute, second);
  return true;
}

int resetTimePercent(JsonObjectConst metric) {
  if (!isPortrait()) return -1;
  const uint64_t window = metric["resetWindowMs"].as<uint64_t>();
  time_t resetAt = 0;
  if (!window || !parseUtcTimestamp(metric["resetAt"] | "", resetAt)) return -1;
  const time_t now = time(nullptr);
  if (now < 1700000000) return -1;
  if (now >= resetAt) return 0;
  const uint64_t remaining = static_cast<uint64_t>(resetAt - now) * 100ULL;
  return static_cast<int>(remaining >= window ? 100 : remaining / window);
}

void drawHeader(const String& title) {
  const int16_t width = display.width();
  display.fillRect(0, 0, width, 34, kBackground);
  display.setTextDatum(ML_DATUM);
  display.setTextColor(kCyan, kBackground);
  display.drawString("CAPACITY", 9, 17, 2);
  display.setTextColor(kPrimary, kBackground);
  display.drawString(title, 92, 17, 2);
  display.fillCircle(width - 17, 17, 4, bridgeOnline ? kGreen : hasSnapshot ? kAmber : kRed);
}

uint32_t snapshotAgeSeconds() {
  const time_t now = time(nullptr);
  if (snapshotCollectedAt > 0 && now > 1700000000 && now >= snapshotCollectedAt) return static_cast<uint32_t>(now - snapshotCollectedAt);
  return lastSuccessAt ? (millis() - lastSuccessAt) / 1000 : 0;
}

String freshnessText() {
  if (!hasSnapshot) return "no data";
  const uint32_t age = snapshotAgeSeconds();
  if (age < 60) return String(age) + "s ago";
  if (age < 3600) return String(age / 60) + "m ago";
  if (age < 86400) return String(age / 3600) + "h ago";
  return String(age / 86400) + "d ago";
}

uint8_t issueCount() {
  if (!hasSnapshot || !snapshot["issues"].is<JsonArray>()) return 0;
  return min<size_t>(99, snapshot["issues"].as<JsonArrayConst>().size());
}

void drawPageIndicator() {
  if (!hasSnapshot) return;
  const uint8_t pages = totalPages();
  const int16_t totalWidth = pages * 6 + (pages - 1) * 5 + 10;
  int16_t x = (display.width() - totalWidth) / 2;
  const int16_t y = display.height() - 14;
  for (uint8_t page = 0; page < pages; ++page) {
    if (page == currentPage) {
      display.fillRoundRect(x, y - 3, 16, 6, 3, kCyan);
      x += 16;
    } else {
      display.drawCircle(x + 3, y, 3, kMuted);
      x += 6;
    }
    x += 5;
  }
}

void drawFooter() {
  const int16_t width = display.width();
  const int16_t height = display.height();
  const int16_t top = height - 23;
  const int16_t middle = height - 11;
  display.fillRect(0, top, width, 23, kBackground);
  display.drawFastHLine(4, top, width - 8, kBorder);
  const uint8_t issues = issueCount();
  const uint16_t statusColor = !bridgeOnline ? (hasSnapshot ? kAmber : kRed) : issues ? kAmber : kGreen;
  display.fillCircle(8, middle, 3, statusColor);
  display.setTextColor(kMuted, kBackground);
  display.setTextDatum(ML_DATUM);
  display.drawString(freshnessText(), 15, middle, 1);
  drawPageIndicator();
  const String state = !bridgeOnline ? (hasSnapshot ? "CACHED" : "WAIT") : issues ? String(issues) + " WARN" : "LIVE";
  display.setTextDatum(MR_DATUM);
  display.setTextColor(statusColor, kBackground);
  display.drawString(state, width - 8, middle, 1);
}

void drawBalanceCard(JsonObjectConst metric, int16_t x, int16_t y, int16_t width, int16_t height) {
  if (metric.isNull()) return;
  display.fillRoundRect(x, y, width, height, 6, kPanel);
  display.drawRoundRect(x, y, width, height, 6, kBorder);
  if (metricHasIssue(metric)) display.fillCircle(x + width - 9, y + 9, 3, stateColor(metric));
  display.setTextDatum(TL_DATUM);
  display.setTextColor(kMuted, kPanel);
  display.drawString(shortened(String(metric["provider"] | metric["label"] | "Balance"), isPortrait() ? 32 : 22), x + 8, y + (isPortrait() ? 5 : 8), 1);
  display.setTextColor(kPrimary, kPanel);
  display.drawString(shortened(metricDisplay(metric), 12), x + 8, y + (isPortrait() ? 17 : 27), 4);
}

void drawBalancePage(uint8_t page, uint8_t pageCount) {
  const uint8_t offset = page * 6;
  if (isPortrait()) {
    for (uint8_t index = 0; index < 6; ++index) drawBalanceCard(metricAt("credit", offset + index), 4, 3 + index * 48, 232, 45);
    return;
  }
  drawBalanceCard(metricAt("credit", offset), 3, 3, 155, 68);
  drawBalanceCard(metricAt("credit", offset + 1), 162, 3, 155, 68);
  drawBalanceCard(metricAt("credit", offset + 2), 3, 74, 155, 68);
  drawBalanceCard(metricAt("credit", offset + 3), 162, 74, 155, 68);
  drawBalanceCard(metricAt("credit", offset + 4), 3, 145, 155, 68);
  drawBalanceCard(metricAt("credit", offset + 5), 162, 145, 155, 68);
}

void drawQuotaRow(JsonObjectConst metric, int16_t y) {
  if (metric.isNull()) return;
  const int16_t width = display.width() - 8;
  const int16_t height = isPortrait() ? 45 : 33;
  display.fillRoundRect(4, y, width, height, 5, kPanel);
  display.drawRoundRect(4, y, width, height, 5, kBorder);
  if (metricHasIssue(metric)) display.fillRect(5, y + 6, 3, height - 12, stateColor(metric));
  const String fullName = compactQuotaName(metric);
  const String value = metricDisplay(metric);
  const int resetPercent = resetTimePercent(metric);
  const int16_t valueWidth = display.textWidth(value, 2);
  const int16_t availableNameWidth = display.width() - 30 - valueWidth;
  const int16_t nameWidth = availableNameWidth > 48 ? availableNameWidth : 48;
  const String name = fitText(fullName, nameWidth, 1);
  display.setTextDatum(TL_DATUM);
  display.setTextColor(kMuted, kPanel);
  display.drawString(name, 11, y + 3, 1);
  const char* reset = metric["resetText"] | "";
  if (reset[0]) display.drawString(fitText(reset, display.width() - 22, 1), 11, y + 13, 1);
  display.setTextDatum(TR_DATUM);
  display.setTextColor(kCyan, kPanel);
  display.drawString(value, display.width() - 11, y + 2, 2);
  const bool showResetBar = resetPercent >= 0;
  if (!value.equalsIgnoreCase("Unlimited")) {
    const int percent = constrain(metric["value"] | 0, 0, 100);
    const int16_t barWidth = display.width() - 22;
    // Keep the two indicators visually distinct: capacity above, reset time
    // below, with enough room for both to read on the portrait screen.
    const int16_t barY = y + height - (showResetBar ? 18 : 6);
    display.fillRect(11, barY, barWidth, showResetBar ? 4 : 3, kTrack);
    if (percent > 0) display.fillRect(11, barY, barWidth * percent / 100, showResetBar ? 4 : 3, capacityColor(metric));
  }
  if (showResetBar) {
    const int16_t barWidth = display.width() - 22;
    const int16_t barY = y + height - 7;
    display.fillRect(11, barY, barWidth, 4, kTimeTrack);
    if (resetPercent > 0) display.fillRect(11, barY, barWidth * resetPercent / 100, 4, kTime);
  }
}

void drawQuotaPage(uint8_t page, uint8_t pageCount) {
  const uint8_t offset = page * 6;
  const int16_t spacing = isPortrait() ? 48 : 35;
  for (uint8_t index = 0; index < 6; ++index) drawQuotaRow(metricAt("quota", offset + index), 2 + index * spacing);
}

void renderDashboard() {
  display.fillScreen(kBackground);
  if (!hasSnapshot) {
    drawHeader("WAITING");
    display.setTextDatum(MC_DATUM);
    display.setTextColor(kPrimary, kBackground);
    display.drawString("Waiting for a snapshot", display.width() / 2, display.height() / 2 - 20, 4);
    display.setTextColor(kMuted, kBackground);
    display.drawString("Run collection in the browser extension", display.width() / 2, display.height() / 2 + 15, 2);
    drawFooter();
    return;
  }
  const uint8_t balancePages = balancePageCount();
  const uint8_t quotaPages = quotaPageCount();
  currentPage %= balancePages + quotaPages;
  if (currentPage < balancePages) drawBalancePage(currentPage, balancePages);
  else drawQuotaPage(currentPage - balancePages, quotaPages);
  drawFooter();
}

void drawSetupScreen(const String& detail) {
  display.fillScreen(kBackground);
  drawHeader("SETUP");
  display.setTextDatum(MC_DATUM);
  display.setTextColor(kPrimary, kBackground);
  const int16_t center = display.width() / 2;
  display.drawString("Connect to Wi-Fi", center, isPortrait() ? 105 : 78, 4);
  display.setTextColor(kCyan, kBackground);
  display.drawString(kSetupAccessPoint, center, isPortrait() ? 145 : 112, 2);
  display.setTextColor(kMuted, kBackground);
  display.drawString("Then open 192.168.4.1", center, isPortrait() ? 175 : 140, 2);
  display.drawString(detail, center, isPortrait() ? 210 : 174, 2);
}

void loadSettings() {
  preferences.begin("capacity", true);
  settings.endpoint = preferences.getString("endpoint", "");
  settings.token = preferences.getString("token", "");
  settings.mqttHost = preferences.getString("mqttHost", kOfficeMqttHost);
  settings.mqttPort = preferences.getUShort("mqttPort", kOfficeMqttPort);
  settings.mqttTopic = preferences.getString("mqttTopic", kOfficeBrightnessTopic);
  settings.mqttUsername = preferences.getString("mqttUser", MQTT_USERNAME);
  settings.mqttPassword = preferences.getString("mqttPass", MQTT_PASSWORD);
  if (!settings.mqttUsername.length()) settings.mqttUsername = MQTT_USERNAME;
  if (!settings.mqttPassword.length()) settings.mqttPassword = MQTT_PASSWORD;
  settings.rotation = preferences.getUChar("rotation", 1) % 4;
  settings.brightnessIndex = preferences.getUChar("brightness", 0) % 4;
  preferences.end();
}

void saveSettings(const DeviceSettings& updated) {
  preferences.begin("capacity", false);
  preferences.putString("endpoint", updated.endpoint);
  preferences.putString("token", updated.token);
  preferences.putString("mqttHost", updated.mqttHost);
  preferences.putUShort("mqttPort", updated.mqttPort);
  preferences.putString("mqttTopic", updated.mqttTopic);
  preferences.putString("mqttUser", updated.mqttUsername);
  preferences.putString("mqttPass", updated.mqttPassword);
  preferences.putUChar("rotation", updated.rotation);
  preferences.putUChar("brightness", updated.brightnessIndex);
  preferences.end();
}

void applyBacklight(uint8_t value) {
  ledcWrite(kBacklightChannel, value);
}

void applyBacklight() {
  applyBacklight(hasMqttBrightness ? mqttBrightness : kBrightnessLevels[settings.brightnessIndex]);
}

void drawBrightnessOverlay() {
  const int16_t width = display.width();
  const int16_t height = display.height();
  const int16_t boxWidth = isPortrait() ? 170 : 150;
  const int16_t boxHeight = 48;
  const int16_t x = (width - boxWidth) / 2;
  const int16_t y = (height - boxHeight) / 2;
  display.fillRoundRect(x, y, boxWidth, boxHeight, 7, kBackground);
  display.drawRoundRect(x, y, boxWidth, boxHeight, 7, kCyan);
  display.setTextDatum(MC_DATUM);
  display.setTextColor(kPrimary, kBackground);
  display.drawString("Brightness " + String(kBrightnessPercents[settings.brightnessIndex]) + "%", width / 2, y + 14, 2);
  display.fillRect(x + 14, y + 33, boxWidth - 28, 4, kTrack);
  display.fillRect(x + 14, y + 33, (boxWidth - 28) * kBrightnessPercents[settings.brightnessIndex] / 100, 4, kCyan);
}

void rotateDisplay() {
  settings.rotation = (settings.rotation + 1) % 4;
  preferences.begin("capacity", false);
  preferences.putUChar("rotation", settings.rotation);
  preferences.end();
  display.setRotation(settings.rotation);
  touch.setRotation(settings.rotation);
  renderDashboard();
}

void cycleBrightness() {
  settings.brightnessIndex = (settings.brightnessIndex + 1) % 4;
  preferences.begin("capacity", false);
  preferences.putUChar("brightness", settings.brightnessIndex);
  preferences.end();
  applyBacklight();
  renderDashboard();
  drawBrightnessOverlay();
  brightnessOverlayUntil = millis() + kBrightnessOverlayMs;
}

bool parseMqttBrightness(const byte* payload, unsigned int length, uint8_t& value) {
  if (!payload || !length || length > 3) return false;
  uint16_t parsed = 0;
  for (unsigned int index = 0; index < length; ++index) {
    if (payload[index] < '0' || payload[index] > '9') return false;
    parsed = parsed * 10 + static_cast<uint16_t>(payload[index] - '0');
  }
  if (parsed > 255) return false;
  value = static_cast<uint8_t>(parsed);
  return true;
}

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  if (!topic || settings.mqttTopic != topic) return;
  uint8_t received = 0;
  if (!parseMqttBrightness(payload, length, received)) return;
  hasMqttBrightness = true;
  mqttBrightness = received;
  applyBacklight(received);
  Serial.printf("MQTT brightness: %u\n", received);
}

void maintainMqtt() {
  if (WiFi.status() != WL_CONNECTED || !settings.mqttValid()) return;
  if (mqtt.connected()) {
    mqtt.loop();
    return;
  }
  if (millis() - lastMqttAttemptAt < kMqttReconnectIntervalMs) return;
  lastMqttAttemptAt = millis();
  mqtt.setServer(settings.mqttHost.c_str(), settings.mqttPort);
  mqtt.setSocketTimeout(1);
  const String clientId = "capacity-cyd-" + WiFi.macAddress().substring(9);
  if (mqtt.connect(clientId.c_str(), settings.mqttUsername.c_str(), settings.mqttPassword.c_str())) {
    mqtt.subscribe(settings.mqttTopic.c_str());
    Serial.println("MQTT connected");
  } else {
    Serial.printf("MQTT connect failed: %d\n", mqtt.state());
  }
}

bool connectAndConfigure(bool forcePortal) {
  char endpointValue[161];
  char tokenValue[65] = "";
  char mqttHostValue[65];
  char mqttPortValue[7];
  char mqttTopicValue[129];
  char mqttUserValue[65];
  char mqttPasswordValue[65] = "";
  settings.endpoint.toCharArray(endpointValue, sizeof(endpointValue));
  settings.mqttHost.toCharArray(mqttHostValue, sizeof(mqttHostValue));
  snprintf(mqttPortValue, sizeof(mqttPortValue), "%u", settings.mqttPort);
  settings.mqttTopic.toCharArray(mqttTopicValue, sizeof(mqttTopicValue));
  settings.mqttUsername.toCharArray(mqttUserValue, sizeof(mqttUserValue));
  WiFiManager manager;
  WiFiManagerParameter endpointParameter("endpoint", "Snapshot URL", endpointValue, 160);
  WiFiManagerParameter tokenParameter("token", "Display token", tokenValue, 64, "type='password'");
  WiFiManagerParameter mqttHostParameter("mqtt_host", "MQTT broker host", mqttHostValue, 64);
  WiFiManagerParameter mqttPortParameter("mqtt_port", "MQTT broker port", mqttPortValue, 6);
  WiFiManagerParameter mqttTopicParameter("mqtt_topic", "MQTT brightness topic", mqttTopicValue, 128);
  WiFiManagerParameter mqttUserParameter("mqtt_user", "MQTT username", mqttUserValue, 64);
  WiFiManagerParameter mqttPasswordParameter("mqtt_password", "MQTT password", mqttPasswordValue, 64, "type='password'");
  manager.addParameter(&endpointParameter);
  manager.addParameter(&tokenParameter);
  manager.addParameter(&mqttHostParameter);
  manager.addParameter(&mqttPortParameter);
  manager.addParameter(&mqttTopicParameter);
  manager.addParameter(&mqttUserParameter);
  manager.addParameter(&mqttPasswordParameter);
  manager.setConfigPortalTimeout(300);
  manager.setConnectTimeout(20);
  manager.setTitle("Capacity Monitor");
  if (forcePortal || !settings.valid()) drawSetupScreen("Setup closes after five minutes");
  const bool connected = forcePortal || !settings.valid()
    ? manager.startConfigPortal(kSetupAccessPoint)
    : manager.autoConnect(kSetupAccessPoint);
  if (!connected) return false;
  const String submittedEndpoint = endpointParameter.getValue();
  const String submittedToken = tokenParameter.getValue();
  const String submittedMqttHost = mqttHostParameter.getValue();
  const String submittedMqttPort = mqttPortParameter.getValue();
  const String submittedMqttTopic = mqttTopicParameter.getValue();
  const String submittedMqttUser = mqttUserParameter.getValue();
  const String submittedMqttPassword = mqttPasswordParameter.getValue();
  if (submittedEndpoint.length()) settings.endpoint = submittedEndpoint;
  if (submittedToken.length()) settings.token = submittedToken;
  if (submittedMqttHost.length()) settings.mqttHost = submittedMqttHost;
  const long parsedMqttPort = submittedMqttPort.toInt();
  if (parsedMqttPort > 0 && parsedMqttPort <= 65535) settings.mqttPort = static_cast<uint16_t>(parsedMqttPort);
  if (submittedMqttTopic.length()) settings.mqttTopic = submittedMqttTopic;
  if (submittedMqttUser.length()) settings.mqttUsername = submittedMqttUser;
  if (submittedMqttPassword.length()) settings.mqttPassword = submittedMqttPassword;
  if (settings.valid()) saveSettings(settings);
  return settings.valid();
}

bool loadSnapshot(const String& payload) {
  JsonDocument candidate;
  const DeserializationError error = deserializeJson(candidate, payload);
  if (error || strcmp(candidate["version"] | "", "1") != 0 || !candidate["metrics"].is<JsonArray>()) return false;
  snapshot = candidate;
  hasSnapshot = true;
  const char* collectedAt = snapshot["collectedAt"] | "";
  parseUtcTimestamp(collectedAt, snapshotCollectedAt);
  return true;
}

void loadCachedSnapshot() {
  if (!LittleFS.begin(true)) return;
  File cache = LittleFS.open(kSnapshotCachePath, "r");
  if (!cache) return;
  const String payload = cache.readString();
  cache.close();
  loadSnapshot(payload);
}

void saveCachedSnapshot(const String& payload) {
  File cache = LittleFS.open(kSnapshotCachePath, "w");
  if (!cache) return;
  cache.print(payload);
  cache.close();
}

bool fetchSnapshot() {
  lastPollAt = millis();
  if (WiFi.status() != WL_CONNECTED || !settings.valid()) {
    bridgeOnline = false;
    renderDashboard();
    return false;
  }
  HTTPClient request;
  request.setTimeout(kHttpTimeoutMs);
  if (!request.begin(settings.endpoint)) {
    bridgeOnline = false;
    renderDashboard();
    return false;
  }
  request.addHeader("Authorization", "Bearer " + settings.token);
  const int status = request.GET();
  const String payload = status == HTTP_CODE_OK ? request.getString() : "";
  request.end();
  if (status != HTTP_CODE_OK || !loadSnapshot(payload)) {
    Serial.printf("Snapshot fetch failed: HTTP %d\n", status);
    bridgeOnline = false;
    renderDashboard();
    return false;
  }
  saveCachedSnapshot(payload);
  bridgeOnline = true;
  lastSuccessAt = millis();
  Serial.printf("Snapshot PASS: %u metrics\n", metricCount("credit") + metricCount("quota"));
  renderDashboard();
  return true;
}

bool touchedDuringBoot() {
  const uint32_t deadline = millis() + 1200;
  while (millis() < deadline) {
    if (touch.tirqTouched() && touch.touched()) return true;
    delay(20);
  }
  return false;
}

void updateTouchNavigation() {
  const bool down = touch.tirqTouched() && touch.touched();
  if (down && !touchWasDown) {
    touchStartedAt = millis();
    longPressHandled = false;
  }
  if (down && !longPressHandled && millis() - touchStartedAt >= 1500) {
    longPressHandled = true;
    tapPending = false;
    rotateDisplay();
  }
  if (!down && touchWasDown && !longPressHandled && hasSnapshot) {
    if (tapPending && millis() - tapPendingAt <= kDoubleTapWindowMs) {
      tapPending = false;
      cycleBrightness();
    } else {
      tapPending = true;
      tapPendingAt = millis();
    }
  }
  if (!down && tapPending && millis() - tapPendingAt > kDoubleTapWindowMs) {
    tapPending = false;
    currentPage = (currentPage + 1) % totalPages();
    renderDashboard();
  }
  touchWasDown = down;
}
}  // namespace

void setup() {
  Serial.begin(115200);
  delay(300);
  ledcSetup(kBacklightChannel, 5000, 8);
  ledcWrite(kBacklightChannel, kBrightnessLevels[0]);
  display.init();
#if !defined(CYD_ST7789)
  display.invertDisplay(true);
#endif
  display.setRotation(1);
  touchSpi.begin(kTouchClock, kTouchMiso, kTouchMosi, kTouchChipSelect);
  touch.begin(touchSpi);
  touch.setRotation(1);
  loadSettings();
  mqtt.setCallback(onMqttMessage);
  ledcAttachPin(TFT_BL, kBacklightChannel);
  applyBacklight();
  display.setRotation(settings.rotation);
  touch.setRotation(settings.rotation);
  loadCachedSnapshot();

  const bool forcePortal = touchedDuringBoot();
  if (!connectAndConfigure(forcePortal)) {
    drawSetupScreen("Setup timed out - restart to retry");
    return;
  }
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  fetchSnapshot();
}

void loop() {
  updateTouchNavigation();
  maintainMqtt();
  if (millis() - lastPollAt >= kPollIntervalMs) fetchSnapshot();
  if (millis() - lastFooterDrawAt >= 1000) {
    lastFooterDrawAt = millis();
    drawFooter();
  }
  if (brightnessOverlayUntil && millis() >= brightnessOverlayUntil) {
    brightnessOverlayUntil = 0;
    renderDashboard();
  }
  delay(20);
}
