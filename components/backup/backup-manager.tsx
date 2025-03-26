/**
 * backup-manager.tsx - Component for managing data backups
 */
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast, ToastContainer } from "@/components/ui/use-toast";
import { backupService } from "@/services/database/backup-service";
import { Download, Upload, AlertCircle } from "lucide-react";

interface BackupMetadata {
  version: string;
  timestamp: string;
  userId: string;
  dataVersion: string;
  portfolioCount: number;
  positionCount: number;
  assetCount: number;
  orderCount: number;
}

interface BackupManagerProps {
  userId: string;
}

export function BackupManager({ userId }: BackupManagerProps) {
  const { toast, toasts } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [backupMetadata, setBackupMetadata] = useState<BackupMetadata | null>(
    null
  );

  const handleCreateBackup = async () => {
    try {
      setIsLoading(true);
      const backup = await backupService.createBackup(userId);

      // Create a blob and download link
      const blob = new Blob([backup], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `numisma-backup-${new Date().toISOString()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Backup created",
        description: "Your data has been successfully backed up.",
      });
    } catch (error) {
      console.error("Failed to create backup:", error);
      toast({
        title: "Backup failed",
        description: "Failed to create backup. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setIsLoading(true);
      const reader = new FileReader();
      reader.onload = async e => {
        const content = e.target?.result as string;
        try {
          const metadata = await backupService.getBackupMetadata(content);
          setBackupMetadata(metadata);
        } catch (error) {
          console.error("Failed to read backup metadata:", error);
          toast({
            title: "Invalid backup file",
            description: "The selected file is not a valid Numisma backup.",
            variant: "destructive",
          });
        }
      };
      reader.readAsText(file);
    } catch (error) {
      console.error("Failed to read file:", error);
      toast({
        title: "File read failed",
        description: "Failed to read the selected file. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestoreBackup = async () => {
    const file =
      document.querySelector<HTMLInputElement>("#backup-file")?.files?.[0];
    if (!file) return;

    try {
      setIsLoading(true);
      const reader = new FileReader();
      reader.onload = async e => {
        const content = e.target?.result as string;
        try {
          await backupService.restoreBackup(content);
          toast({
            title: "Backup restored",
            description: "Your data has been successfully restored.",
          });
        } catch (error) {
          console.error("Failed to restore backup:", error);
          toast({
            title: "Restore failed",
            description: "Failed to restore backup. Please try again.",
            variant: "destructive",
          });
        }
      };
      reader.readAsText(file);
    } catch (error) {
      console.error("Failed to read file:", error);
      toast({
        title: "File read failed",
        description: "Failed to read the selected file. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>Data Backup & Restore</CardTitle>
          <CardDescription>
            Create backups of your data or restore from a previous backup.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Create Backup Section */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Create Backup</h3>
            <p className="text-sm text-muted-foreground">
              Create a backup of your current data. This will include all your
              portfolios, positions, assets, and orders.
            </p>
            <Button
              onClick={handleCreateBackup}
              disabled={isLoading}
              className="w-full"
            >
              <Download className="mr-2 h-4 w-4" />
              Create Backup
            </Button>
          </div>

          {/* Restore Backup Section */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Restore Backup</h3>
            <p className="text-sm text-muted-foreground">
              Restore your data from a previous backup. This will replace your
              current data.
            </p>
            <div className="space-y-2">
              <Label htmlFor="backup-file">Select Backup File</Label>
              <Input
                id="backup-file"
                type="file"
                accept=".json"
                onChange={handleFileChange}
                disabled={isLoading}
              />
            </div>

            {backupMetadata && (
              <div className="rounded-lg border p-4 space-y-2">
                <h4 className="font-medium">Backup Details</h4>
                <div className="text-sm space-y-1">
                  <p>
                    <span className="font-medium">Version:</span>{" "}
                    {backupMetadata.version}
                  </p>
                  <p>
                    <span className="font-medium">Created:</span>{" "}
                    {new Date(backupMetadata.timestamp).toLocaleString()}
                  </p>
                  <p>
                    <span className="font-medium">Portfolios:</span>{" "}
                    {backupMetadata.portfolioCount}
                  </p>
                  <p>
                    <span className="font-medium">Positions:</span>{" "}
                    {backupMetadata.positionCount}
                  </p>
                  <p>
                    <span className="font-medium">Assets:</span>{" "}
                    {backupMetadata.assetCount}
                  </p>
                  <p>
                    <span className="font-medium">Orders:</span>{" "}
                    {backupMetadata.orderCount}
                  </p>
                </div>
              </div>
            )}

            <Button
              onClick={handleRestoreBackup}
              disabled={isLoading || !backupMetadata}
              variant="destructive"
              className="w-full"
            >
              <Upload className="mr-2 h-4 w-4" />
              Restore Backup
            </Button>

            {backupMetadata && (
              <div className="flex items-center text-sm text-yellow-600 bg-yellow-50 p-3 rounded-lg">
                <AlertCircle className="mr-2 h-4 w-4" />
                <p>
                  Warning: Restoring a backup will replace your current data.
                  This action cannot be undone.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      <ToastContainer toasts={toasts} />
    </>
  );
}
