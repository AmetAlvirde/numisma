/**
 * app/settings/backup/page.tsx - Backup settings page
 */
"use client";

import { BackupManager } from "@/components/backup/backup-manager";

export default function BackupPage() {
  // TODO: Get actual user ID from auth context
  const userId = "test-user";

  return (
    <div className="container py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Backup Settings</h1>
        <p className="text-muted-foreground mt-2">
          Manage your data backups and restorations.
        </p>
      </div>
      <BackupManager userId={userId} />
    </div>
  );
}
