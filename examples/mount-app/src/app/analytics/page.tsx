"use client";

import { useEffect, useState } from "react";

function fetchJson(url: string) { return fetch(url).then((r) => r.json()); }

const sections = [
  { key: "aggregates", label: "Aggregates (Count/Sum/Avg/Min/Max)" },
  { key: "window&fn=ranking", label: "Window: ROW_NUMBER + DENSE_RANK" },
  { key: "window&fn=lag", label: "Window: LAG + LEAD" },
  { key: "group-by&by=status", label: "GROUP BY Status" },
  { key: "group-by&by=author", label: "GROUP BY Author (HAVING post_count > 1)" },
  { key: "select-expr", label: "Raw SQL selectExpr" },
  { key: "union", label: "UNION Set Operation" },
  { key: "distinct-on", label: "DISTINCT ON (Postgres)" },
  { key: "cte", label: "CTE (WITH author_counts)" },
];

export default function AnalyticsPage() {
  const [activeSection, setActiveSection] = useState("aggregates");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchJson(`/api/analytics?section=${activeSection}`)
      .then((d) => { if (d.error) setError(d.error); else setData(d); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [activeSection]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Analytics</h1>
      <p className="text-gray-500 text-sm">Powerful SQL analytics powered by MountSQLI query builder — aggregates, window functions, GROUP BY, CTE, UNION, DISTINCT ON.</p>

      <div className="flex gap-2 flex-wrap">
        {sections.map((s) => (
          <button key={s.key} onClick={() => setActiveSection(s.key)} className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${activeSection === s.key ? "bg-blue-600 border-blue-500 text-white" : "border-gray-700 hover:border-gray-600"}`}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900/50">
        <div className="px-5 py-3 border-b border-gray-800 text-sm font-medium text-gray-400">
          {sections.find((s) => s.key === activeSection)?.label}
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-500 animate-pulse">Running query...</div>
        ) : error ? (
          <div className="p-8 text-center text-red-400">{error}</div>
        ) : (
          <pre className="p-5 overflow-x-auto text-sm text-gray-300 font-mono">
            {JSON.stringify(data, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
