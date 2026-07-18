function formatMetric(metric, locale = navigator.language) {
  if (!metric) return "—";
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
