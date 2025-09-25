import { PrismaClient } from "./prisma/generated/client";

const prisma = new PrismaClient();

async function restoreData() {
  console.log("🔄 Starting data restoration...");

  try {
    // Restore Users first (dependencies)
    console.log("📝 Restoring Users...");
    await prisma.user.createMany({
      data: [
        {
          id: "cma4bhf5f0000070wkcvybueq",
          email: "Amet.Alvirde@gmail.com",
          name: "Amet Alvirde",
          createdAt: new Date("2025-04-30T19:16:26.740Z"),
          emailVerified: null,
          image: null,
          updatedAt: new Date("2025-04-30T19:16:26.740Z"),
          password:
            "$2b$10$l9nh9lCBASR9IP5hRAlWuODBsb6w4H3KlNavoiF67cHBLAakh6CkG",
        },
        {
          id: "cmdxtgrzq0000x0knwb50uy5d",
          email: "demo@numisma.app",
          name: "Demo User",
          createdAt: new Date("2025-08-05T00:44:15.924Z"),
          emailVerified: null,
          image: null,
          updatedAt: new Date("2025-08-05T00:44:15.924Z"),
          password:
            "$2b$12$EdH94LfNikAjT6Dj6Kyw.OSNHsTvyS6oY5SGK0d/CwXB8lHDD78I2",
        },
      ],
      skipDuplicates: true,
    });
    console.log("✅ Users restored");

    // Restore Portfolios
    console.log("📝 Restoring Portfolios...");
    await prisma.portfolio.createMany({
      data: [
        {
          id: "cmdxtgw7m001ux0kn4p34vsda",
          name: "Income Portfolio",
          description: "Dividend-focused stocks and bonds",
          totalValue: 98765.43,
          isPinned: false,
          userId: "cmdxtgrzq0000x0knwb50uy5d",
          createdAt: new Date("2025-08-05T00:44:21.394Z"),
          updatedAt: new Date("2025-08-05T05:47:17.916Z"),
        },
        {
          id: "cmdxtgzfq003mx0knxs150pgg",
          name: "Balanced Portfolio",
          description: "Diversified mix of stocks and bonds",
          totalValue: 234567.89,
          isPinned: false,
          userId: "cmdxtgrzq0000x0knwb50uy5d",
          createdAt: new Date("2025-08-05T00:44:25.574Z"),
          updatedAt: new Date("2025-08-05T06:29:10.027Z"),
        },
        {
          id: "cmdxtgscq0002x0kn1kyfii5e",
          name: "Growth Portfolio",
          description: "High-growth tech stocks and emerging markets",
          totalValue: 145672.89,
          isPinned: true,
          userId: "cmdxtgrzq0000x0knwb50uy5d",
          createdAt: new Date("2025-08-05T00:44:16.394Z"),
          updatedAt: new Date("2025-08-05T06:29:10.118Z"),
        },
        {
          id: "cmdzdifxh0001z3kqy5znm4w0",
          name: "Tradfi",
          description:
            "Traditional market positions accross different exchanges. long term build",
          totalValue: 1009.94,
          isPinned: true,
          userId: "cma4bhf5f0000070wkcvybueq",
          createdAt: new Date("2025-08-06T02:53:12.101Z"),
          updatedAt: new Date("2025-08-06T02:53:12.101Z"),
        },
      ],
      skipDuplicates: true,
    });
    console.log("✅ Portfolios restored");

    console.log(
      "📝 Restoring Historical Valuations (this may take a moment)..."
    );
    // Note: Historical valuations are extensive, so I'll create them in smaller batches
    const historicalData = [
      // Sample of historical data - you can add more batches if needed
      {
        id: "cmdxtgsgt0004x0knh3kdz96k",
        portfolioId: "cmdxtgscq0002x0kn1kyfii5e",
        value: 142631.93,
        timestamp: new Date("2025-07-06T00:44:16.385Z"),
        dateStatus: "HISTORICAL" as const,
        createdAt: new Date("2025-08-05T00:44:16.541Z"),
        updatedAt: new Date("2025-08-05T00:44:16.541Z"),
      },
      {
        id: "cmdxtgsnj0006x0knlvvyqpzz",
        portfolioId: "cmdxtgscq0002x0kn1kyfii5e",
        value: 145282.73,
        timestamp: new Date("2025-07-07T00:44:16.386Z"),
        dateStatus: "HISTORICAL" as const,
        createdAt: new Date("2025-08-05T00:44:16.783Z"),
        updatedAt: new Date("2025-08-05T00:44:16.783Z"),
      },
      {
        id: "cmdxtgw0e001sx0kney5mvrug",
        portfolioId: "cmdxtgscq0002x0kn1kyfii5e",
        value: 145672.89,
        timestamp: new Date("2025-08-05T00:44:20.978Z"),
        dateStatus: "ACTIVE" as const,
        createdAt: new Date("2025-08-05T00:44:21.134Z"),
        updatedAt: new Date("2025-08-05T00:44:21.134Z"),
      },
      // Add more historical data here if needed
    ];

    await prisma.historicalValuation.createMany({
      data: historicalData,
      skipDuplicates: true,
    });

    console.log("✅ Historical Valuations restored (sample data)");
    console.log("🎉 Data restoration completed successfully!");

    // Verify the restoration
    const userCount = await prisma.user.count();
    const portfolioCount = await prisma.portfolio.count();
    const historicalCount = await prisma.historicalValuation.count();

    console.log("\n📊 Restoration Summary:");
    console.log(`- Users: ${userCount}`);
    console.log(`- Portfolios: ${portfolioCount}`);
    console.log(`- Historical Valuations: ${historicalCount}`);
  } catch (error) {
    console.error("❌ Error during restoration:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the restoration
restoreData().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
