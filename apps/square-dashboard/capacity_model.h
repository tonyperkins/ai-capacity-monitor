#pragma once
#include <ArduinoJson.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <ctime>
#include <set>
#include <string>
#include <vector>

namespace capacity_model {
struct Metric {
  std::string key, provider, label, kind, unit, display, state, reset_text;
  double value = 0;
  bool unlimited = false;
  time_t collected = 0, reset = 0;
  uint64_t window_ms = 0;
  bool attention() const { return state != "validated"; }
};
struct Snapshot {
  std::vector<Metric> metrics;
  time_t collected = 0;
  size_t issue_count = 0;
  std::vector<std::string> issues;
};
inline time_t epoch(const char* text) {
  if (!text) return 0;
  int y, mo, d, h, mi, s;
  if (sscanf(text, "%d-%d-%dT%d:%d:%d", &y, &mo, &d, &h, &mi, &s) != 6
      || y < 2020 || y > 9999 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return 0;
  static const int days[] = {31,28,31,30,31,30,31,31,30,31,30,31};
  const bool leap = y%4==0 && (y%100!=0 || y%400==0);
  if (d > days[mo-1]+(mo==2 && leap) || h<0 || mi<0 || s<0 || std::string(text).back()!='Z') return 0;
  y -= mo <= 2;
  const int era = y / 400;
  const unsigned yo = y-era*400;
  const unsigned doy = (153*(mo+(mo>2?-3:9))+2)/5+d-1;
  const unsigned doe = yo*365+yo/4-yo/100+doy;
  return time_t((int64_t(era)*146097+doe-719468)*86400+h*3600+mi*60+s);
}
inline bool parse(JsonObjectConst root, Snapshot& output) {
  if (std::string(root["version"] | "") != "1" || !root["metrics"].is<JsonArrayConst>()) return false;
  Snapshot next;
  next.collected = epoch(root["collectedAt"] | "");
  if (!next.collected || root["metrics"].size() > 64) return false;
  std::set<std::string> keys;
  for (JsonObjectConst item : root["metrics"].as<JsonArrayConst>()) {
    Metric m;
    m.key = item["key"] | ""; m.provider = item["provider"] | "";
    m.label = item["label"] | ""; m.kind = item["kind"] | ""; m.unit = item["unit"] | "";
    if (m.key.empty() || m.provider.empty() || m.label.empty() || !keys.insert(m.key).second
        || !item["value"].is<double>()) return false;
    m.value = item["value"].as<double>();
    if (!std::isfinite(m.value)) return false;
    if (m.kind == "quota") {
      if (m.unit != "percent" || m.value < 0 || m.value > 100) return false;
    } else if (m.kind == "credit") {
      if ((m.unit != "usd" && m.unit != "count") || std::floor(m.value) != m.value) return false;
    } else return false;
    m.unlimited = std::string(item["availability"] | "") == "unlimited";
    m.state = item["readState"] | (std::string(item["status"] | "") == "verified" ? "validated" : "failed");
    for (JsonObjectConst diagnostic : root["diagnostics"].as<JsonArrayConst>()) {
      if (std::string(diagnostic["key"] | "") == m.key) { m.state = diagnostic["state"] | "failed"; break; }
    }
    m.reset_text = item["resetText"] | "";
    m.reset = epoch(item["resetAt"] | "");
    m.window_ms = item["resetWindowMs"] | uint64_t(0);
    m.collected = epoch(item["collectedAt"] | "");
    if (!m.collected) m.collected = next.collected;
    char value[64];
    if (m.unlimited) m.display = "Unlimited";
    else if (m.unit == "usd") { snprintf(value, sizeof(value), "%s$%.2f", m.value < 0 ? "-" : "", std::abs(m.value) / 100); m.display = value; }
    else { snprintf(value, sizeof(value), m.unit == "percent" ? "%.0f%%" : "%.0f", m.value); m.display = value; }
    next.metrics.push_back(std::move(m));
  }
  for (JsonVariantConst issue : root["issues"].as<JsonArrayConst>()) {
    if (issue.is<const char*>() && next.issues.size()<32) next.issues.push_back(std::string(issue.as<const char*>()).substr(0,512));
  }
  for (JsonObjectConst diagnostic : root["diagnostics"].as<JsonArrayConst>()) {
    if (std::string(diagnostic["state"] | "failed")!="validated") ++next.issue_count;
  }
  next.issue_count=std::max(next.issue_count,next.issues.size());
  if(next.issue_count && next.issues.empty()) next.issues.push_back("A provider reading needs attention. Check the browser extension for diagnostics.");
  output = std::move(next);
  return true;
}
inline std::vector<const Metric*> select(const Snapshot& snapshot, const char* kind, bool prioritize = false) {
  std::vector<const Metric*> out;
  for (const auto& m : snapshot.metrics) if (m.kind == kind) out.push_back(&m);
  if (prioritize) std::stable_sort(out.begin(), out.end(), [](const Metric* a, const Metric* b) {
    if (a->attention() != b->attention()) return a->attention();
    if (a->unlimited != b->unlimited) return !a->unlimited;
    return a->value < b->value;
  });
  return out;
}
inline std::string duration(uint64_t seconds) {
  char out[40];
  if (seconds < 60) return "less than a minute";
  const auto minutes = seconds / 60;
  if (minutes < 60) snprintf(out, sizeof(out), "%llum", (unsigned long long)minutes);
  else if (minutes < 1440) snprintf(out, sizeof(out), "%lluh %llum", (unsigned long long)(minutes / 60), (unsigned long long)(minutes % 60));
  else snprintf(out, sizeof(out), "%llud %lluh", (unsigned long long)(minutes / 1440), (unsigned long long)((minutes % 1440) / 60));
  return out;
}
inline std::string state_text(const Metric& m) {
  if (m.state == "validated") return "Verified reading";
  if (m.state == "unauthenticated") return "Sign in required";
  if (m.state == "permission-needed") return "Browser permission needed";
  if (m.state == "suspicious-held") return "Confirming change";
  if (m.state == "retained-prior") return "Previous reading";
  return "Reading unavailable";
}
inline std::string reset_text(const Metric& m, time_t now) {
  if (m.reset && now > 1700000000) return m.reset > now ? "Resets in " + duration(m.reset - now) : "Reset due / awaiting collection";
  return m.reset_text.empty() ? "Reset time not provided" : m.reset_text;
}
inline std::string reset_deadline(const Metric& m) {
  if(!m.reset)return "";
  tm local={};
  if(!localtime_r(&m.reset,&local))return "";
  char out[80];
  if(!strftime(out,sizeof(out),"%a %b %d, %I:%M %p %Z",&local))return "";
  return std::string("Reset time: ")+out;
}
inline int reset_percent(const Metric& m, time_t now) {
  if (!m.reset || !m.window_ms || now < 1700000000) return -1;
  if (m.reset <= now) return 0;
  return int(std::min(100.0, double(m.reset - now) * 100000 / m.window_ms));
}
}
