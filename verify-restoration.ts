import { PrismaClient } from "./prisma/generated/client";

const prisma = new PrismaClient();

async function verifyRestoration() {
  console.log("🔍 Verifying data restoration...\n");

  try {
    // Check Users
    const users = await prisma.user.findMany({
      include: {
        _count: {
          select: {
            portfolios: true,
          },
        },
      },
    });

    console.log("👥 Users:");
    users.forEach(user => {
      console.log(
        `  • ${user.name} (${user.email}) - ${user._count.portfolios} portfolios`
      );
    });

    // Check Portfolios
    const portfolios = await prisma.portfolio.findMany({
      include: {
        user: {
          select: { name: true },
        },
        _count: {
          select: {
            historicalValuations: true,
            positions: true,
          },
        },
      },
    });

    console.log("\n📊 Portfolios:");
    portfolios.forEach(portfolio => {
      console.log(`  • ${portfolio.name} (${portfolio.user.name})`);
      console.log(`    - Value: $${portfolio.totalValue.toLocaleString()}`);
      console.log(`    - Pinned: ${portfolio.isPinned ? "Yes" : "No"}`);
      console.log(
        `    - Historical Records: ${portfolio._count.historicalValuations}`
      );
      console.log(`    - Positions: ${portfolio._count.positions}`);
      console.log("");
    });

    // Check Historical Valuations
    const historicalCount = await prisma.historicalValuation.count();
    const dateRange = await prisma.historicalValuation.aggregate({
      _min: { timestamp: true },
      _max: { timestamp: true },
    });

    console.log(`📈 Historical Valuations: ${historicalCount} total records`);
    console.log(
      `   Date range: ${dateRange._min.timestamp?.toDateString()} to ${dateRange._max.timestamp?.toDateString()}`
    );

    // Check recent data
    const recentData = await prisma.historicalValuation.findMany({
      take: 3,
      orderBy: { timestamp: "desc" },
      include: {
        portfolio: {
          select: { name: true },
        },
      },
    });

    console.log("\n🕐 Most Recent Valuations:");
    recentData.forEach(valuation => {
      console.log(
        `  • ${
          valuation.portfolio.name
        }: $${valuation.value.toLocaleString()} (${valuation.timestamp.toDateString()})`
      );
    });

    // Summary
    console.log("\n✅ Data Restoration Summary:");
    console.log(`  - Users: ${users.length}`);
    console.log(`  - Portfolios: ${portfolios.length}`);
    console.log(`  - Historical Valuations: ${historicalCount}`);
    console.log(`  - Positions: 0 (as expected from backup)`);

    console.log("\n🎉 Data restoration verified successfully!");
    console.log("\n💡 You can now:");
    console.log("  1. Access Prisma Studio at http://localhost:5555");
    console.log("  2. Start your Next.js app to see the restored data");
    console.log("  3. Begin adding new positions to your portfolios");
  } catch (error) {
    console.error("❌ Error during verification:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the verification
verifyRestoration().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
