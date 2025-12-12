import { PrismaClient } from "./prisma/generated/client";
import { readFileSync } from "fs";

const prisma = new PrismaClient();

interface HistoricalData {
  id: string;
  portfolioId: string;
  value: number;
  timestamp: Date;
  dateStatus: "HISTORICAL" | "ACTIVE" | "PROJECTED";
  createdAt: Date;
  updatedAt: Date;
}

function parseHistoricalLine(line: string): HistoricalData | null {
  if (line.startsWith("COPY") || line.trim() === "\\." || line.trim() === "") {
    return null;
  }

  const parts = line.split("\t");
  if (parts.length !== 7) {
    console.warn("Skipping malformed line:", line);
    return null;
  }

  try {
    return {
      id: parts[0],
      portfolioId: parts[1],
      value: parseFloat(parts[2]),
      timestamp: new Date(parts[3]),
      dateStatus: parts[4] as "HISTORICAL" | "ACTIVE" | "PROJECTED",
      createdAt: new Date(parts[5]),
      updatedAt: new Date(parts[6]),
    };
  } catch (error) {
    console.warn("Error parsing line:", line, error);
    return null;
  }
}

async function restoreAllHistoricalData() {
  console.log("🔄 Starting complete historical data restoration...");

  try {
    // Read the historical data file
    const fileContent = readFileSync("./historical-only.sql", "utf-8");
    const lines = fileContent.split("\n");

    const historicalData: HistoricalData[] = [];

    for (const line of lines) {
      const parsed = parseHistoricalLine(line.trim());
      if (parsed) {
        historicalData.push(parsed);
      }
    }

    console.log(
      `📊 Found ${historicalData.length} historical records to restore`
    );

    if (historicalData.length === 0) {
      console.log("⚠️ No historical data found to restore");
      return;
    }

    // Delete existing historical data to avoid conflicts
    console.log("🗑️ Clearing existing historical data...");
    await prisma.historicalValuation.deleteMany({});

    // Insert data in batches to avoid overwhelming the database
    const batchSize = 50;
    const batches = [];

    for (let i = 0; i < historicalData.length; i += batchSize) {
      batches.push(historicalData.slice(i, i + batchSize));
    }

    console.log(
      `📝 Restoring ${historicalData.length} records in ${batches.length} batches...`
    );

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(
        `Processing batch ${i + 1}/${batches.length} (${
          batch.length
        } records)...`
      );

      await prisma.historicalValuation.createMany({
        data: batch,
        skipDuplicates: true,
      });
    }

    console.log("✅ All historical data restored successfully!");

    // Verify the restoration
    const totalCount = await prisma.historicalValuation.count();
    const portfolioBreakdown = await prisma.historicalValuation.groupBy({
      by: ["portfolioId"],
      _count: { id: true },
    });

    console.log("\n📊 Restoration Summary:");
    console.log(`- Total Historical Valuations: ${totalCount}`);
    console.log("\n- Breakdown by Portfolio:");

    for (const item of portfolioBreakdown) {
      const portfolio = await prisma.portfolio.findUnique({
        where: { id: item.portfolioId },
        select: { name: true },
      });
      console.log(
        `  • ${portfolio?.name || "Unknown"}: ${item._count.id} records`
      );
    }
  } catch (error) {
    console.error("❌ Error during historical data restoration:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the restoration
restoreAllHistoricalData().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
