import { PrismaClient, DateStatus } from "./generated/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting database seeding...");

  // Create sample user
  const hashedPassword = await hash("desiredPassword", 12);

  const user = await prisma.user.upsert({
    where: { email: "demo@numisma.app" },
    update: {},
    create: {
      email: "demo@numisma.app",
      name: "Demo User",
      password: hashedPassword,
    },
  });

  console.log(`👤 Created user: ${user.name} (${user.email})`);

  // Create sample portfolios
  const portfolios = [
    {
      name: "Growth Portfolio",
      description: "High-growth tech stocks and emerging markets",
      totalValue: 145672.89,
      isPinned: true,
    },
    {
      name: "Income Portfolio",
      description: "Dividend-focused stocks and bonds",
      totalValue: 98765.43,
      isPinned: false,
    },
    {
      name: "Balanced Portfolio",
      description: "Diversified mix of stocks and bonds",
      totalValue: 234567.89,
      isPinned: false,
    },
  ];

  for (const portfolioData of portfolios) {
    // Check if portfolio already exists for this user
    const existingPortfolio = await prisma.portfolio.findFirst({
      where: {
        userId: user.id,
        name: portfolioData.name,
      },
    });

    const portfolio = existingPortfolio
      ? await prisma.portfolio.update({
          where: { id: existingPortfolio.id },
          data: {
            totalValue: portfolioData.totalValue,
            isPinned: portfolioData.isPinned,
            description: portfolioData.description,
          },
        })
      : await prisma.portfolio.create({
          data: {
            name: portfolioData.name,
            description: portfolioData.description,
            totalValue: portfolioData.totalValue,
            isPinned: portfolioData.isPinned,
            userId: user.id,
          },
        });

    console.log(
      `📊 Created portfolio: ${portfolio.name} ($${portfolio.totalValue})`
    );

    // Create historical valuations for the last 30 days
    const historicalData = generateHistoricalData(
      Number(portfolioData.totalValue),
      30
    );

    for (const data of historicalData) {
      await prisma.historicalValuation.upsert({
        where: {
          portfolioId_timestamp: {
            portfolioId: portfolio.id,
            timestamp: data.timestamp,
          },
        },
        update: {
          value: data.value,
        },
        create: {
          portfolioId: portfolio.id,
          value: data.value,
          timestamp: data.timestamp,
          dateStatus: DateStatus.HISTORICAL,
        },
      });
    }

    // Add current day valuation
    await prisma.historicalValuation.upsert({
      where: {
        portfolioId_timestamp: {
          portfolioId: portfolio.id,
          timestamp: new Date(),
        },
      },
      update: {
        value: portfolioData.totalValue,
      },
      create: {
        portfolioId: portfolio.id,
        value: portfolioData.totalValue,
        timestamp: new Date(),
        dateStatus: DateStatus.ACTIVE,
      },
    });

    console.log(
      `📈 Created ${historicalData.length + 1} historical valuations for ${
        portfolio.name
      }`
    );
  }

  console.log("✅ Database seeding completed successfully!");
}

function generateHistoricalData(currentValue: number, days: number) {
  const data = [];
  const baseValue = currentValue;

  for (let i = days; i > 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);

    // Generate realistic volatility (±5% daily change max)
    const volatility = (Math.random() - 0.5) * 0.05;
    const dayMultiplier = 1 + volatility;

    // Create a general upward trend over time with some volatility
    const trendMultiplier = 1 + (days - i) * 0.002; // ~0.2% daily growth trend

    const value = baseValue * trendMultiplier * dayMultiplier;

    data.push({
      timestamp: date,
      value: Math.round(value * 100) / 100, // Round to 2 decimal places
    });
  }

  return data;
}

main()
  .catch(e => {
    console.error("❌ Error during seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
