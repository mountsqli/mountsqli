"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface UserRow {
  id: string;
  username: string;
  email: string;
  display_name: string;
  role: string;
  points: number;
  active: boolean;
  created_at: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/users?limit=50")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setUsers(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Users</h1>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-500 animate-pulse">Loading...</div>
      ) : users.length === 0 ? (
        <div className="text-center py-16 text-gray-500">No users found</div>
      ) : (
        <div className="rounded-xl border border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-900/80">
              <tr className="text-gray-400">
                <th className="text-left px-4 py-3 font-medium">Username</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Email</th>
                <th className="text-left px-4 py-3 font-medium">Role</th>
                <th className="text-right px-4 py-3 font-medium">Points</th>
                <th className="text-center px-4 py-3 font-medium">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-900/30 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/users/${u.id}`} className="font-medium text-blue-400 hover:underline">
                      {u.username}
                    </Link>
                    <div className="text-gray-500 text-xs mt-0.5">{u.display_name}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-400 hidden md:table-cell">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      u.role === "admin" ? "bg-purple-500/10 text-purple-400" :
                      u.role === "moderator" ? "bg-blue-500/10 text-blue-400" : "bg-gray-500/10 text-gray-400"
                    }`}>{u.role}</span>
                  </td>
                  <td className="px-4 py-3 text-right">{u.points.toLocaleString()}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block w-2 h-2 rounded-full ${u.active ? "bg-green-500" : "bg-gray-600"}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
