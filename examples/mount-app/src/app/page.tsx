"use client";

import { useEffect, useState } from "react";

interface DashboardData {
  stats: { users: number; posts: number; comments: number; total_views: number };
  top_posts: { id: string; title: string; views: number; author: string }[];
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/analytics?section=dashboard")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setData(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-20 text-gray-400 text-lg animate-pulse">Loading dashboard...</div>;
  if (error) return <div className="text-center py-20 text-red-400">{error}</div>;
  if (!data) return <div className="text-center py-20 text-gray-400">No data</div>;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <span className="text-sm text-gray-500">MountSQLI · Postgres</span>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Users", value: data.stats.users, color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
          { label: "Posts", value: data.stats.posts, color: "bg-green-500/10 text-green-400 border-green-500/20" },
          { label: "Comments", value: data.stats.comments, color: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
          { label: "Total Views", value: data.stats.total_views, color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
        ].map((s) => (
          <div key={s.label} className={`rounded-xl border p-5 ${s.color}`}>
            <div className="text-sm opacity-80">{s.label}</div>
            <div className="text-3xl font-bold mt-1">{s.value.toLocaleString()}</div>
          </div>
        ))}
      </div>

      {/* Top Posts */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/50">
        <div className="px-6 py-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold">Top Posts</h2>
        </div>
        <div className="divide-y divide-gray-800">
          {data.top_posts.map((post, i) => (
            <a key={post.id} href={`/posts/${post.id}`} className="flex items-center justify-between px-6 py-3.5 hover:bg-gray-800/40 transition-colors">
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-500 w-5">{i + 1}</span>
                <span className="font-medium">{post.title}</span>
                <span className="text-sm text-gray-500">by {post.author}</span>
              </div>
              <span className="text-sm text-gray-400">{post.views.toLocaleString()} views</span>
            </a>
          ))}
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { href: "/posts", label: "View Posts", desc: "Browse all posts with filters" },
          { href: "/posts/new", label: "New Post", desc: "Create a new blog post" },
          { href: "/users", label: "Users", desc: "User management" },
          { href: "/analytics", label: "Analytics", desc: "Stats, windows, CTE, unions" },
        ].map((link) => (
          <a key={link.href} href={link.href} className="rounded-xl border border-gray-800 p-4 hover:border-blue-500/30 hover:bg-gray-900/80 transition-all">
            <div className="font-medium text-blue-400">{link.label}</div>
            <div className="text-sm text-gray-500 mt-1">{link.desc}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
