-- CreateEnum
CREATE TYPE "DateStatus" AS ENUM ('ACTIVE', 'HISTORICAL', 'PROJECTED');

-- CreateTable
CREATE TABLE "Portfolio" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "totalValue" DECIMAL(15,2) NOT NULL,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Portfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricalValuation" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "value" DECIMAL(15,2) NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "dateStatus" "DateStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HistoricalValuation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Portfolio_userId_idx" ON "Portfolio"("userId");

-- CreateIndex
CREATE INDEX "Portfolio_userId_isPinned_idx" ON "Portfolio"("userId", "isPinned");

-- CreateIndex
CREATE INDEX "HistoricalValuation_portfolioId_timestamp_idx" ON "HistoricalValuation"("portfolioId", "timestamp");

-- CreateIndex
CREATE INDEX "HistoricalValuation_portfolioId_dateStatus_timestamp_idx" ON "HistoricalValuation"("portfolioId", "dateStatus", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "HistoricalValuation_portfolioId_timestamp_key" ON "HistoricalValuation"("portfolioId", "timestamp");

-- AddForeignKey
ALTER TABLE "Portfolio" ADD CONSTRAINT "Portfolio_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalValuation" ADD CONSTRAINT "HistoricalValuation_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
