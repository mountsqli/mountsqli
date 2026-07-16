"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface PostSummary {
  id: string;
  title: string;
  status: string;
  view_count: number;
  created_at: string;
}

export default function PostsPage() {
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const fetchPosts = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (categoryFilter) params.set("category_id", categoryFilter);
    params.set("limit", "50");

    fetch(`/api/posts?${params}`)
      .then((r) => r.json())
      .then((d) => { if (!d.error) setPosts(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchPosts(); }, [statusFilter, categoryFilter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Posts</h1>
        <Link href="/posts/new" className="px-4 py-2 bg-blue-600 rounded-lg text-sm font-medium hover:bg-blue-500 transition-colors">
          + New Post
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm">
          <option value="">All Status</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </select>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm">
          <option value="">All Categories</option>
          <option value="technology">Technology</option>
          <option value="design">Design</option>
          <option value="science">Science</option>
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center py-16 text-gray-500 animate-pulse">Loading...</div>
      ) : posts.length === 0 ? (
        <div className="text-center py-16 text-gray-500">No posts found</div>
      ) : (
        <div className="grid gap-3">
          {posts.map((post) => (
            <Link key={post.id} href={`/posts/${post.id}`} className="flex items-center justify-between rounded-xl border border-gray-800 px-5 py-4 hover:border-gray-700 hover:bg-gray-900/50 transition-colors">
              <div>
                <div className="font-medium">{post.title}</div>
                <div className="text-sm text-gray-500 mt-0.5">{new Date(post.created_at).toLocaleDateString()}</div>
              </div>
              <div className="flex items-center gap-4">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  post.status === "published" ? "bg-green-500/10 text-green-400" :
                  post.status === "draft" ? "bg-yellow-500/10 text-yellow-400" :
                  "bg-gray-500/10 text-gray-400"
                }`}>{post.status}</span>
                <span className="text-sm text-gray-500">{post.view_count} views</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
