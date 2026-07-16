"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const { user, login, logout } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    setError(null);
    const err = await login(username.trim(), password);
    setLoading(false);
    if (err) setError(err);
    else router.push("/");
  };

  const handleLogout = async () => {
    await logout();
  };

  // Already logged in — show session info
  if (user) {
    return (
      <div className="max-w-sm mx-auto space-y-6 pt-12">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Signed In</h1>
        </div>
        <div className="rounded-xl border border-gray-800 p-6 space-y-4">
          <div className="flex items-center justify-center gap-3">
            <span className="text-green-400 text-lg">✓</span>
            <span className="text-lg font-medium">{user.display_name}</span>
          </div>
          <div className="text-sm text-gray-500 text-center">@{user.username} · {user.role}</div>
          <button onClick={handleLogout} className="w-full py-2 border border-red-800/30 text-red-400 rounded-lg font-medium hover:bg-red-600/10 transition-colors">
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto space-y-6 pt-12">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Sign In</h1>
        <p className="text-gray-500 text-sm mt-1">Use any seeded user — password is <code className="text-blue-400">password123</code></p>
      </div>

      <form onSubmit={handleLogin} className="space-y-4 rounded-xl border border-gray-800 p-6">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Username</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. alice" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500" autoFocus />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password123" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500" />
        </div>
        {error && <div className="text-sm text-red-400">{error}</div>}
        <button type="submit" disabled={loading} className="w-full py-2 bg-blue-600 rounded-lg font-medium hover:bg-blue-500 disabled:opacity-50 transition-colors">
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}
