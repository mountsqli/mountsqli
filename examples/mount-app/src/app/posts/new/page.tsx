"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function NewPostPage() {
  const router = useRouter();
  const [users, setUsers] = useState<any[]>([]);
  const [form, setForm] = useState({ title: "", body: "", excerpt: "", user_id: "", status: "draft" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/users?limit=100")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setUsers(d); });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.user_id) return;
    setSaving(true);
    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setSaving(false);
    if (res.ok) router.push(`/posts/${data.id}`);
    else alert("Failed to create post: " + (data.error || "Unknown"));
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">New Post</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Title *</label>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500" required />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Excerpt</label>
          <input value={form.excerpt} onChange={(e) => setForm({ ...form, excerpt: e.target.value })} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500" />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Body</label>
          <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={8} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500 font-mono text-sm" />
        </div>
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-sm text-gray-400 mb-1">Author *</label>
            <select value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500" required>
              <option value="">Select author</option>
              {users.map((u: any) => (
                <option key={u.id} value={u.id}>{u.username}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-sm text-gray-400 mb-1">Status</label>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500">
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={saving} className="px-6 py-2 bg-blue-600 rounded-lg font-medium hover:bg-blue-500 disabled:opacity-50 transition-colors">
            {saving ? "Creating..." : "Create Post"}
          </button>
          <a href="/posts" className="px-6 py-2 border border-gray-700 rounded-lg font-medium hover:bg-gray-800 transition-colors">Cancel</a>
        </div>
      </form>
    </div>
  );
}
