"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface UserProfile {
  id: string;
  username: string;
  email: string;
  display_name: string;
  bio: string;
  role: string;
  points: number;
  active: boolean;
  metadata: any;
  created_at: string;
}

export default function UserDetailPage() {
  const params = useParams();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/users/${params.id}`)
      .then((r) => r.json())
      .then((d) => { if (!d.error) setUser(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) return <div className="text-center py-20 text-gray-400 animate-pulse">Loading...</div>;
  if (!user) return <div className="text-center py-20 text-gray-500">User not found</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <a href="/users" className="text-sm text-gray-500 hover:text-gray-300">← Back to Users</a>

      <div className="rounded-xl border border-gray-800 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{user.display_name}</h1>
            <div className="text-gray-500">@{user.username}</div>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            user.role === "admin" ? "bg-purple-500/10 text-purple-400" : "bg-gray-500/10 text-gray-400"
          }`}>{user.role}</span>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Email</span>
            <div>{user.email}</div>
          </div>
          <div>
            <span className="text-gray-500">Points</span>
            <div>{user.points.toLocaleString()}</div>
          </div>
          <div>
            <span className="text-gray-500">Status</span>
            <div className={user.active ? "text-green-400" : "text-gray-500"}>{user.active ? "Active" : "Inactive"}</div>
          </div>
          <div>
            <span className="text-gray-500">Joined</span>
            <div>{new Date(user.created_at).toLocaleDateString()}</div>
          </div>
        </div>

        {user.bio && <div>
          <div className="text-sm text-gray-500 mb-1">Bio</div>
          <p className="text-gray-300">{user.bio}</p>
        </div>}

        {user.metadata && <div>
          <div className="text-sm text-gray-500 mb-1">Metadata (JSON)</div>
          <pre className="bg-gray-900 rounded-lg p-3 text-xs text-gray-400 overflow-x-auto">{JSON.stringify(user.metadata, null, 2)}</pre>
        </div>}
      </div>
    </div>
  );
}
