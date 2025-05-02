"use client";

import React from "react";
import { trpc } from "@/trpc/react";

export function UserList() {
  const {
    data: users,
    isLoading,
    isError,
    error,
  } = trpc.listUsers.useQuery(undefined);

  if (isLoading) {
    return (
      <div>
        <h2 className="text-xl font-semibold mb-2">Users</h2>
        <p>Loading users...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div>
        <h2 className="text-xl font-semibold mb-2">Users</h2>
        <p className="text-red-500">Error loading users: {error.message}</p>
      </div>
    );
  }

  // Render user data
  return (
    <div>
      <h2 className="text-xl font-semibold mb-2">Users</h2>
      {users && users.length > 0 ? (
        <ul>
          {users.map(user => (
            <li key={user.id} className="mb-1">
              {user.name} ({user.email})
            </li>
          ))}
        </ul>
      ) : (
        <p>No users found.</p>
      )}
    </div>
  );
}
