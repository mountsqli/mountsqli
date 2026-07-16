"use client";

import { useAuth } from "@/lib/auth-context";

export function Nav() {
  const { user, loading, logout } = useAuth();

  return (
    <nav className="border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-6">
            <a href="/" className="font-bold text-lg tracking-tight text-blue-400 hover:text-blue-300 transition-colors">
              ⚡ MountSQLI
            </a>
            <div className="hidden sm:flex items-center gap-4 text-sm">
              <a href="/posts" className="hover:text-blue-400 transition-colors">Posts</a>
              <a href="/users" className="hover:text-blue-400 transition-colors">Users</a>
              <a href="/analytics" className="hover:text-blue-400 transition-colors">Analytics</a>
              <a href="/search" className="hover:text-blue-400 transition-colors">Search</a>
              <a href="/cache" className="hover:text-blue-400 transition-colors">Cache</a>
              <a href="/upload" className="hover:text-blue-400 transition-colors">Upload</a>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {loading ? (
              <span className="text-gray-500">...</span>
            ) : user ? (
              <div className="flex items-center gap-3">
                <span className="text-gray-400 hidden sm:inline">{user.display_name}</span>
                <button onClick={logout} className="px-3 py-1.5 rounded-md border border-gray-700 hover:bg-gray-800 transition-colors font-medium">
                  Logout
                </button>
              </div>
            ) : (
              <a href="/login" className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 transition-colors font-medium">Login</a>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
