/**
 * backup-manager.test.tsx - Tests for backup manager component
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BackupManager } from "../backup-manager";
import { backupService } from "@/services/database/backup-service";

// Mock the backup service
vi.mock("@/services/database/backup-service", () => ({
  backupService: {
    createBackup: vi.fn(),
    restoreBackup: vi.fn(),
    getBackupMetadata: vi.fn(),
  },
}));

describe("BackupManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders backup manager component", () => {
    render(<BackupManager userId="test-user" />);

    expect(screen.getByText("Data Backup & Restore")).toBeInTheDocument();
    expect(screen.getByText("Create Backup")).toBeInTheDocument();
    expect(screen.getByText("Restore Backup")).toBeInTheDocument();
  });

  it("creates a backup when create button is clicked", async () => {
    const mockBackup = "mock-backup-data";
    vi.mocked(backupService.createBackup).mockResolvedValue(mockBackup);

    render(<BackupManager userId="test-user" />);

    const createButton = screen.getByText("Create Backup");
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(backupService.createBackup).toHaveBeenCalledWith("test-user");
    });
  });

  it("handles backup creation error", async () => {
    const error = new Error("Backup failed");
    vi.mocked(backupService.createBackup).mockRejectedValue(error);

    render(<BackupManager userId="test-user" />);

    const createButton = screen.getByText("Create Backup");
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(screen.getByText("Backup failed")).toBeInTheDocument();
    });
  });

  it("loads backup metadata when file is selected", async () => {
    const mockMetadata = {
      version: "1.0.0",
      timestamp: new Date().toISOString(),
      userId: "test-user",
      dataVersion: "1.0.0",
      portfolioCount: 1,
      positionCount: 1,
      assetCount: 1,
      orderCount: 1,
    };

    vi.mocked(backupService.getBackupMetadata).mockResolvedValue(mockMetadata);

    render(<BackupManager userId="test-user" />);

    const fileInput = screen.getByLabelText("Select Backup File");
    const file = new File(["mock-backup-data"], "backup.json", {
      type: "application/json",
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(backupService.getBackupMetadata).toHaveBeenCalled();
      expect(screen.getByText("Backup Details")).toBeInTheDocument();
      expect(screen.getByText("Version: 1.0.0")).toBeInTheDocument();
    });
  });

  it("handles invalid backup file", async () => {
    const error = new Error("Invalid backup");
    vi.mocked(backupService.getBackupMetadata).mockRejectedValue(error);

    render(<BackupManager userId="test-user" />);

    const fileInput = screen.getByLabelText("Select Backup File");
    const file = new File(["invalid-data"], "backup.json", {
      type: "application/json",
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("Invalid backup file")).toBeInTheDocument();
    });
  });

  it("restores backup when restore button is clicked", async () => {
    const mockMetadata = {
      version: "1.0.0",
      timestamp: new Date().toISOString(),
      userId: "test-user",
      dataVersion: "1.0.0",
      portfolioCount: 1,
      positionCount: 1,
      assetCount: 1,
      orderCount: 1,
    };

    vi.mocked(backupService.getBackupMetadata).mockResolvedValue(mockMetadata);
    vi.mocked(backupService.restoreBackup).mockResolvedValue(undefined);

    render(<BackupManager userId="test-user" />);

    // First select a file to enable the restore button
    const fileInput = screen.getByLabelText("Select Backup File");
    const file = new File(["mock-backup-data"], "backup.json", {
      type: "application/json",
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("Backup Details")).toBeInTheDocument();
    });

    // Then click the restore button
    const restoreButton = screen.getByText("Restore Backup");
    fireEvent.click(restoreButton);

    await waitFor(() => {
      expect(backupService.restoreBackup).toHaveBeenCalled();
    });
  });

  it("handles restore error", async () => {
    const mockMetadata = {
      version: "1.0.0",
      timestamp: new Date().toISOString(),
      userId: "test-user",
      dataVersion: "1.0.0",
      portfolioCount: 1,
      positionCount: 1,
      assetCount: 1,
      orderCount: 1,
    };

    const error = new Error("Restore failed");
    vi.mocked(backupService.getBackupMetadata).mockResolvedValue(mockMetadata);
    vi.mocked(backupService.restoreBackup).mockRejectedValue(error);

    render(<BackupManager userId="test-user" />);

    // First select a file to enable the restore button
    const fileInput = screen.getByLabelText("Select Backup File");
    const file = new File(["mock-backup-data"], "backup.json", {
      type: "application/json",
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("Backup Details")).toBeInTheDocument();
    });

    // Then click the restore button
    const restoreButton = screen.getByText("Restore Backup");
    fireEvent.click(restoreButton);

    await waitFor(() => {
      expect(screen.getByText("Restore failed")).toBeInTheDocument();
    });
  });
});
