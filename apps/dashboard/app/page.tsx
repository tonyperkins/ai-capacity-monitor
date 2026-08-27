"use client";

import { useEffect, useState } from "react";

const lastSyncedAt = new Date("2026-07-16T08:57:00-05:00").getTime();

function elapsedSince(timestamp: number) {
  const totalSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = `${hours ? `${hours}:` : ""}${String(minutes).padStart(hours ? 2 : 1, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${clock} ago`;
}

const credits = [
  { key: "kilo-credit", provider: "Kilo Balance", value: "$6.13", note: "Remaining credits", tone: "lime" },
  { key: "openai-api-credit", provider: "OpenAI API Balance", value: "$7.61", note: "Prepaid API credit", tone: "cyan" },
  { key: "claude-usage-credit", provider: "Claude.ai Balance", value: "$10.93", note: "Usage-credit balance", tone: "amber" },
  { key: "claude-api-credit", provider: "Claude API Balance", value: "$5.90", note: "Remaining balance", tone: "violet" },
];

const quotas = [
  { key: "chatgpt-weekly", provider: "ChatGPT Plus", label: "Weekly usage", remaining: 94, reset: "Resets Jul 23 · 7:45 AM", tone: "cyan" },
  { key: "claude-session", provider: "Claude Pro", label: "Current session", remaining: 100, reset: "Starts when a message is sent", tone: "violet" },
  { key: "claude-weekly", provider: "Claude Pro", label: "Weekly · all models", remaining: 100, reset: "Starts when a message is sent", tone: "violet" },
  { key: "claude-fable", provider: "Claude Pro", label: "Weekly · Fable", remaining: 100, reset: "Likely temporary", tone: "violet" },
  { key: "claude-usage-cap", provider: "Claude usage", label: "Monthly spending cap", remaining: 29, reset: "Resets Aug 1 · $39.07 spent of $55", tone: "amber" },
];

export default function Home() {
  const [elapsed, setElapsed] = useState("");
  const [live, setLive] = useState<Record<string, { display: string; value: number; resetText?: string }>>({});
  const [latest, setLatest] = useState<number>(lastSyncedAt);

  useEffect(() => {
    const updateElapsed = () => setElapsed(elapsedSince(lastSyncedAt));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        const next = Object.fromEntries(payload.metrics.map((metric: { key: string; display: string; value: number; resetText?: string }) => [metric.key, metric]));
        setLive(next);
        if (payload.collectedAt) setLatest(new Date(payload.collectedAt).getTime());
      } catch { /* The first deployment has no collected rows yet. */ }
    };
    load(); const timer = window.setInterval(load, 15000); return () => window.clearInterval(timer);
  }, []);
  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">◌</span><span>CAPACITY</span></div>
        <div className="topbar-right"><span className="live-dot" /> <span>LOCAL STATUS</span><span className="divider" /><span>CDT</span></div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">AI account observability</p>
          <h1>Capacity <em>at a glance.</em></h1>
          <p className="subhead">Live credits, subscription limits, and reset windows across your AI accounts.</p>
        </div>
      </section>

      <section className="sync-row">
        <span className="sync-pulse" /> Last synced {new Date(latest).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })} {elapsed && <span className="elapsed">({elapsedSince(latest)})</span>}
        <span className="sync-detail">Collector checks open tabs every 2 minutes</span>
      </section>

      <section className="section-heading"><div><p className="eyebrow">Funds on hand</p><h2>Credit balances</h2></div><p className="section-note">Funds are not interchangeable between providers.</p></section>
      <section className="credit-grid">
        {credits.map((credit) => <article className={`credit-card ${credit.tone}`} key={credit.provider}>
          <div className="card-top"><span className="provider-dot" /><span>{credit.provider}</span><button aria-label={`More about ${credit.provider}`}>⋮</button></div>
          <strong>{live[credit.key]?.display ?? (latest === lastSyncedAt ? credit.value : "—")}</strong><p>{live[credit.key] ? credit.note : "Awaiting a reading"}</p><div className="card-rule" /></article>)}
      </section>

      <section className="section-heading quota-head"><div><p className="eyebrow">Plan access</p><h2>Subscription limits</h2></div><p className="section-note">Remaining capacity before the next reset.</p></section>
      <section className="quota-grid">
        {quotas.map((quota) => <article className="quota-card" key={`${quota.provider}-${quota.label}`}>
          <div className="quota-meta"><span>{quota.provider}</span><span className={`tiny-dot ${quota.tone}`} /></div>
          <h3>{quota.label}</h3>
          <div className="quota-number"><strong>{live[quota.key]?.display ?? (latest === lastSyncedAt ? `${quota.remaining}%` : "—")}</strong><span>remaining</span></div>
          <div className="meter" aria-label={`${quota.label}: ${live[quota.key]?.value ?? 0}% remaining`}><span className={quota.tone} style={{ width: `${live[quota.key]?.value ?? 0}%` }} /></div>
          <p>{live[quota.key]?.resetText ?? (live[quota.key] ? quota.reset : "Awaiting a reading")}</p>
        </article>)}
      </section>

      <section className="bottom-grid">
        <article className="history-card">
          <div className="history-top"><div><p className="eyebrow">Coming online with the collector</p><h2>Balance history</h2></div><span>Last 7 days</span></div>
          <div className="history-bars" aria-label="History placeholder">
            {[34, 41, 37, 53, 48, 66, 57, 73, 69, 81, 76, 92].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
          </div>
          <div className="history-axis"><span>Today</span><span>History starts after the first automated collection</span></div>
        </article>
        <article className="next-card"><p className="eyebrow">Provider coverage</p><h2>Ready for expansion</h2><ul><li><span>01</span> xAI credits & plan quotas</li><li><span>02</span> Gemini credits & plan quotas</li><li><span>03</span> Threshold alerts and panel summary</li></ul></article>
      </section>

      <footer><span>CAPACITY MONITOR · V0.1</span><span>Browser-backed collection will populate the historical record.</span></footer>
    </main>
  );
}
