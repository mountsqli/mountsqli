"use client";

import { useEffect, useState } from "react";

export default function UploadPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [userId, setUserId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    fetch("/api/users?limit=100")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setUsers(d); })
      .catch(() => {});
  }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !userId) return;
    setUploading(true);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("user_id", userId);

    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const data = await res.json();
    setResult(data);
    setUploading(false);
  };

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-2xl font-bold">File Upload</h1>
      <p className="text-gray-500 text-sm">Upload files via MountSQLI storage subsystem. Files are tracked in the <code className="text-blue-400">files</code> table.</p>

      <form onSubmit={handleUpload} className="space-y-4 rounded-xl border border-gray-800 p-6">
        <div>
          <label className="block text-sm text-gray-400 mb-1">File *</label>
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-600 file:text-white hover:file:bg-blue-500" />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Uploaded by *</label>
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" required>
            <option value="">Select user</option>
            {users.map((u: any) => <option key={u.id} value={u.id}>{u.username}</option>)}
          </select>
        </div>
        <button type="submit" disabled={uploading || !file || !userId} className="w-full py-2.5 bg-blue-600 rounded-lg font-medium hover:bg-blue-500 disabled:opacity-50 transition-colors">
          {uploading ? "Uploading..." : "Upload"}
        </button>
      </form>

      {result && (
        <div className="rounded-xl border border-gray-800 p-4">
          <div className="text-sm font-medium mb-2 text-green-400">Uploaded!</div>
          <pre className="text-xs text-gray-400 overflow-x-auto">{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
