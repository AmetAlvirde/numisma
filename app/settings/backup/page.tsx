/**
 * app/settings/backup/page.tsx - Backup settings page
 */
"use client";

import { saveAlphaTesterData } from "@/lib/alpha-tester-data";

export default function BackupPage() {
  // TODO: Get actual user ID from auth context
  const userId = "test-user";
  console.log("Saving alpha tester data");
  saveAlphaTesterData();
  console.log("finished saving alpha tester data");

  return (
    <div className="container py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Backup Settings</h1>
        <p className="text-muted-foreground mt-2">
          Manage your data backups and restorations.
        </p>
      </div>
    </div>
  );
}
