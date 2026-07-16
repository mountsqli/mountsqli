"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

interface PostDetail {
  id: string;
  title: string;
  slug: string;
  body: string;
  excerpt: string;
  status: string;
  view_count: number;
  created_at: string;
  author: { id: string; username: string; profile?: { website: string; company: string } };
  comments: { id: string; body: string; created_at: string; author: { username: string } }[];
  post_categories: { category: { id: string; name: string; color: string } }[];
}

export default function PostDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [post, setPost] = useState<PostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/posts?id=${params.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        if (!d || Array.isArray(d)) setError("Not found");
        else setPost(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [params.id]);

  const handleDelete = async () => {
    if (!confirm("Delete this post?")) return;
    const res = await fetch(`/api/posts/${params.id}`, { method: "DELETE" });
    if (res.ok) router.push("/posts");
    else alert("Delete failed");
  };

  if (loading) return <div className="text-center py-20 text-gray-400 animate-pulse">Loading...</div>;
  if (error || !post) return <div className="text-center py-20">
    <div className="text-red-400 text-lg">{error || "Post not found"}</div>
    <a href="/posts" className="text-blue-400 hover:underline mt-4 inline-block">← Back to Posts</a>
  </div>;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back + Actions */}
      <div className="flex items-center justify-between">
        <a href="/posts" className="text-sm text-gray-500 hover:text-gray-300 transition-colors">← Back to Posts</a>
        <div className="flex gap-2">
          <button onClick={handleDelete} className="px-3 py-1.5 text-sm rounded-lg bg-red-600/10 text-red-400 border border-red-800/30 hover:bg-red-600/20 transition-colors">Delete</button>
        </div>
      </div>

      {/* Post */}
      <article className="space-y-4">
        <div className="flex items-center gap-3">
          {post.post_categories?.map((pc) => (
            <span key={pc.category.id} className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: `${pc.category.color}15`, color: pc.category.color }}>
              {pc.category.name}
            </span>
          ))}
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            post.status === "published" ? "bg-green-500/10 text-green-400" : "bg-yellow-500/10 text-yellow-400"
          }`}>{post.status}</span>
        </div>

        <h1 className="text-3xl font-bold">{post.title}</h1>

        {post.excerpt && <p className="text-gray-400 text-lg">{post.excerpt}</p>}

        <div className="flex items-center gap-4 text-sm text-gray-500 border-b border-gray-800 pb-4">
          <span>By {post.author?.username || "Unknown"}</span>
          <span>{new Date(post.created_at).toLocaleDateString()}</span>
          <span>{post.view_count.toLocaleString()} views</span>
        </div>

        <div className="prose prose-invert max-w-none text-gray-300 leading-relaxed whitespace-pre-wrap">
          {post.body}
        </div>
      </article>

      {/* Comments */}
      <div className="border-t border-gray-800 pt-6">
        <h2 className="text-lg font-semibold mb-4">Comments ({post.comments?.length || 0})</h2>
        {post.comments?.length === 0 ? (
          <p className="text-gray-500">No comments yet</p>
        ) : (
          <div className="space-y-4">
            {post.comments?.map((c) => (
              <div key={c.id} className="rounded-xl border border-gray-800 p-4 bg-gray-900/30">
                <div className="flex items-center gap-2 text-sm mb-2">
                  <span className="font-medium text-blue-400">{c.author?.username}</span>
                  <span className="text-gray-600">·</span>
                  <span className="text-gray-500">{new Date(c.created_at).toLocaleDateString()}</span>
                </div>
                <p className="text-gray-300">{c.body}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
