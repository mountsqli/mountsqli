"use client";

import { useEffect, useState } from "react";

export default function CachePage() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    fetch("/api/cache")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setStats(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const handleClear = async () => {
    const res = await fetch("/api/cache", { method: "DELETE" });
    if (res.ok) { alert("Cache cleared"); refresh(); }
  };

  const handleSet = async () => {
    const key = prompt("Cache key:");
    if (!key) return;
    const value = prompt("Value (JSON):");
    if (!value) return;
    const ttl = Number(prompt("TTL (seconds):") || "300");
    const res = await fetch("/api/cache", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value: JSON.parse(value), ttl }),
    });
    if (res.ok) alert("Cached!"); else alert("Failed");
    refresh();
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Cache</h1>
      <p className="text-gray-500 text-sm">MountSQLI multi-level cache with Redis L2. Hit rates, key inspection, manual set/clear.</p>

      <div className="flex gap-3">
        <button onClick={handleSet} className="px-4 py-2 bg-blue-600 rounded-lg text-sm font-medium hover:bg-blue-500 transition-colors">Set Cache Key</button>
        <button onClick={handleClear} className="px-4 py-2 border border-red-800/30 text-red-400 rounded-lg text-sm font-medium hover:bg-red-600/10 transition-colors">Clear All</button>
        <button onClick={refresh} className="px-4 py-2 border border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors">Refresh</button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-500 animate-pulse">Loading cache stats...</div>
      ) : stats ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: "Total Hits", value: stats.totalHits, color: "text-green-400" },
              { label: "Total Misses", value: stats.totalMisses, color: "text-yellow-400" },
              { label: "Hit Rate", value: `${(stats.hitRate * 100).toFixed(1)}%`, color: "text-blue-400" },
              { label: "Evictions", value: stats.evictions ?? 0, color: "text-red-400" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-gray-800 p-4">
                <div className="text-sm text-gray-500">{s.label}</div>
                <div className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</div>
              </div>
            ))}
          </div>

          {stats.topKeys?.length > 0 && (
            <div className="rounded-xl border border-gray-800">
              <div className="px-5 py-3 border-b border-gray-800 text-sm font-medium text-gray-400">Top Cache Keys</div>
              <div className="divide-y divide-gray-800">
                {stats.topKeys.map((k: any) => (
                  <div key={k.key} className="px-5 py-2.5 flex items-center justify-between text-sm">
                    <span className="font-mono text-xs text-gray-300 truncate max-w-xs">{k.key}</span>
                    <span className="text-gray-500">{k.hits} hits · {k.ttl}s TTL</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <pre className="bg-gray-900 rounded-xl p-4 text-xs text-gray-500 overflow-x-auto">
            {JSON.stringify(stats, null, 2)}
          </pre>
        </div>
      ) : (
        <div className="text-center py-16 text-gray-500">Cache not available</div>
      )}
    </div>
  );
}
