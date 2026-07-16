"use client";

import { useState } from "react";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    setResults(data);
    setLoading(false);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Search</h1>
      <p className="text-gray-500 text-sm">Full-text search across posts, users, and comments using MountSQLI LIKE queries.</p>

      <form onSubmit={handleSearch} className="flex gap-3">
        <input
          value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search posts, users, comments..."
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 focus:outline-none focus:border-blue-500"
          autoFocus
        />
        <button type="submit" disabled={loading} className="px-5 py-2.5 bg-blue-600 rounded-lg font-medium hover:bg-blue-500 disabled:opacity-50 transition-colors">
          {loading ? "..." : "Search"}
        </button>
      </form>

      {searched && !loading && (
        <div className="space-y-6">
          {/* Posts */}
          {results.posts?.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Posts ({results.posts.length})</h2>
              <div className="space-y-2">
                {results.posts.map((p: any) => (
                  <a key={p.id} href={`/posts/${p.id}`} className="block rounded-xl border border-gray-800 px-4 py-3 hover:border-gray-700 transition-colors">
                    <div className="font-medium">{p.title}</div>
                    {p.excerpt && <div className="text-sm text-gray-500 mt-0.5 line-clamp-1">{p.excerpt}</div>}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Users */}
          {results.users?.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Users ({results.users.length})</h2>
              <div className="space-y-2">
                {results.users.map((u: any) => (
                  <a key={u.id} href={`/users/${u.id}`} className="block rounded-xl border border-gray-800 px-4 py-3 hover:border-gray-700 transition-colors">
                    <div className="font-medium">{u.display_name} <span className="text-gray-500">@{u.username}</span></div>
                    <div className="text-sm text-gray-500">{u.email}</div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Comments */}
          {results.comments?.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Comments ({results.comments.length})</h2>
              <div className="space-y-2">
                {results.comments.map((c: any) => (
                  <div key={c.id} className="rounded-xl border border-gray-800 px-4 py-3">
                    <div className="text-sm text-gray-300 line-clamp-2">{c.body}</div>
                    <div className="text-xs text-gray-500 mt-1">Post: {c.post_id?.slice(0, 8)}...</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!results.posts?.length && !results.users?.length && !results.comments?.length && (
            <div className="text-center py-10 text-gray-500">No results found for "{query}"</div>
          )}
        </div>
      )}
    </div>
  );
}
