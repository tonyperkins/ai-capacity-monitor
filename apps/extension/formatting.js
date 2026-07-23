function formatMetric(metric, locale = navigator.language) {
  if (!metric) return "—";
  if (metric.availability === "unlimited") return metric.display ?? "Unlimited";
  if (metric.unit === "usd") return new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(metric.value / 100);
  if (metric.unit === "percent") return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(metric.value / 100);
  if (metric.unit === "count") return new Intl.NumberFormat(locale).format(metric.value);
  return metric.display ?? "—";
}

function formatShortTime(value, locale = navigator.language) {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(time);
}

function timeRemainingPercent(metric, total, now = new Date()) {
  if (!total || !metric?.resetText) return null;
  const countdown = [...metric.resetText.matchAll(/(\d+)\s*(day|days|d|hour|hours|hr|hrs|h|min|mins|minute|minutes|m)/gi)].reduce((milliseconds, match) => milliseconds + Number(match[1]) * ({ d: 86400000, day: 86400000, days: 86400000, h: 3600000, hr: 3600000, hrs: 3600000, hour: 3600000, hours: 3600000, m: 60000, min: 60000, mins: 60000, minute: 60000, minutes: 60000 }[match[2].toLowerCase()] ?? 0), 0);
  if (countdown) return Math.max(0, Math.min(100, countdown / total * 100));
  const dateText = metric.resetText.replace(/^Resets\s*/i, "");
  const weekdayMatch = /^([A-Za-z]{3,9})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(dateText);
  if (weekdayMatch) {
    const weekdays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const targetDay = weekdays.findIndex((day) => weekdayMatch[1].toLowerCase().startsWith(day));
    if (targetDay >= 0) {
      let hour = Number(weekdayMatch[2]) % 12;
      if (weekdayMatch[4].toLowerCase() === "pm") hour += 12;
      const reset = new Date(now);
      reset.setHours(hour, Number(weekdayMatch[3]), 0, 0);
      let daysUntil = (targetDay - reset.getDay() + 7) % 7;
      if (daysUntil === 0 && reset <= now) daysUntil = 7;
      reset.setDate(reset.getDate() + daysUntil);
      return Math.max(0, Math.min(100, (reset.getTime() - now.getTime()) / total * 100));
    }
  }
  const dateOnly = /^[A-Za-z]{3,9}\s+\d{1,2}$/.test(dateText);
  const reset = new Date(dateOnly ? `${dateText}, ${now.getFullYear()}` : dateText);
  if (Number.isNaN(reset.getTime())) return null;
  if (reset.getTime() < now.getTime() && dateOnly) reset.setFullYear(reset.getFullYear() + 1);
  return Math.max(0, Math.min(100, (reset.getTime() - now.getTime()) / total * 100));
}
