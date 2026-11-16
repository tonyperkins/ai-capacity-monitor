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
  // Optional extras from the collector. provider_id groups a provider's limits,
  // parent is the key of the limit this one counts toward.
  std::string provider_id, group, parent;
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
  size_t skipped = 0;  // metrics this display could not understand
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
// One metric this display understands, or false. An unknown kind or unit, a
// value out of range and a repeated key are all "not understood".
inline bool parse_metric(JsonObjectConst item, const std::set<std::string>& keys, Metric& m) {
  m.key = item["key"] | ""; m.provider = item["provider"] | "";
  m.label = item["label"] | ""; m.kind = item["kind"] | ""; m.unit = item["unit"] | "";
  if (m.key.empty() || m.provider.empty() || m.label.empty() || keys.count(m.key)
      || !item["value"].is<double>()) return false;
  m.value = item["value"].as<double>();
  if (!std::isfinite(m.value)) return false;
  if (m.kind == "quota") return m.unit == "percent" && m.value >= 0 && m.value <= 100;
  if (m.kind == "credit") return (m.unit == "usd" || m.unit == "count") && std::floor(m.value) == m.value;
  return false;
}
// Accepts a snapshot.v1 payload. A metric the display does not understand is
// skipped and counted, so one new kind of reading cannot blank the screen. The
// payload is rejected only when the envelope is wrong or nothing in it is usable.
inline bool parse(JsonObjectConst root, Snapshot& output) {
  if (std::string(root["version"] | "") != "1" || !root["metrics"].is<JsonArrayConst>()) return false;
  Snapshot next;
  next.collected = epoch(root["collectedAt"] | "");
  if (!next.collected || root["metrics"].size() > 64) return false;
  std::set<std::string> keys;
  for (JsonObjectConst item : root["metrics"].as<JsonArrayConst>()) {
    Metric m;
    if (!parse_metric(item, keys, m)) { ++next.skipped; continue; }
    keys.insert(m.key);
    m.provider_id = item["providerId"] | ""; m.group = item["group"] | ""; m.parent = item["parent"] | "";
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
  if (next.metrics.empty() && next.skipped) return false;
  if (next.skipped && next.issues.size()<32)
    next.issues.push_back(std::to_string(next.skipped)+(next.skipped==1?" reading is":" readings are")+" in a form this display does not understand yet, and hidden.");
  next.issue_count=std::max(next.issue_count,next.issues.size());
  if(next.issue_count && next.issues.empty()) next.issues.push_back("A provider reading needs attention. Check the collector's log on your computer.");
  output = std::move(next);
  return true;
}
// --- Provider summaries, used by the Rings and Dispatch faces ---------------
// Limits are whatever the collector reports, so a provider is summarised by
// rule, never by a list of expected names:
//   primary = its tightest long-window limit (a week or more, or no stated window)
//   quick   = its tightest short-window limit (session, 5-hour, daily), if any
constexpr uint64_t LONG_WINDOW_MS = 6ULL*24*60*60*1000;
constexpr double HOLD_PERCENT = 10;  // at or under this, stop sending new work
struct Provider { std::string id, name; const Metric* primary = nullptr; const Metric* quick = nullptr; };
inline bool long_window(const Metric& m) { return m.window_ms == 0 || m.window_ms >= LONG_WINDOW_MS; }
// Pointers stay valid only while the snapshot is unchanged.
inline std::vector<Provider> providers(const Snapshot& snapshot) {
  std::vector<Provider> out;
  for (const auto& m : snapshot.metrics) {
    if (m.kind != "quota" || m.unlimited) continue;
    const std::string& id = m.provider_id.empty() ? m.provider : m.provider_id;
    auto it = std::find_if(out.begin(), out.end(), [&](const Provider& p) { return p.id == id; });
    if (it == out.end()) { out.push_back({id, m.provider}); it = out.end()-1; }
    auto*& slot = long_window(m) ? it->primary : it->quick;
    if (!slot || m.value < slot->value) slot = &m;
  }
  for (auto& p : out) if (!p.primary) { p.primary = p.quick; p.quick = nullptr; }
  return out;
}
inline std::string window_name(uint64_t ms) {
  const auto hours = ms/3600000;
  if (!hours) return "";
  if (hours == 24) return "day";
  char out[16];
  snprintf(out, sizeof(out), hours < 24 ? "%lluh" : "%llud", (unsigned long long)(hours < 24 ? hours : hours/24));
  return out;
}
// Dispatch order: where to send the next job. Capacity that expires soonest
// unused ranks first (percent left per hour until its reset). Providers whose
// reading is stale come after fresh ones, and providers on hold come last.
struct Pick { Provider provider; double spare = -1; bool hold = false; };
inline std::vector<Pick> dispatch(const Snapshot& snapshot, time_t now) {
  std::vector<Pick> out;
  for (const auto& p : providers(snapshot)) {
    Pick pick; pick.provider = p;
    const auto& m = *p.primary;
    pick.hold = m.value <= HOLD_PERCENT || (p.quick && p.quick->value <= HOLD_PERCENT);
    if (m.reset && now > 1700000000 && m.reset > now) pick.spare = m.value / std::max(1.0, double(m.reset-now)/3600);
    out.push_back(pick);
  }
  std::stable_sort(out.begin(), out.end(), [](const Pick& a, const Pick& b) {
    if (a.hold != b.hold) return !a.hold;
    const bool stale_a = a.provider.primary->attention(), stale_b = b.provider.primary->attention();
    if (stale_a != stale_b) return !stale_a;
    if ((a.spare >= 0) != (b.spare >= 0)) return a.spare >= 0;
    if (a.spare >= 0 && a.spare != b.spare) return a.spare > b.spare;
    return a.provider.primary->value > b.provider.primary->value;
  });
  return out;
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
