// src/components/financial/portfolio-summary/potfolio-summary.stories.tsx
import { Meta, StoryObj } from "@storybook/react";
import { PortfolioSummary } from "@/components/financial/portfolio-summary";
import {
  mixedPerformance,
  negativePerformance,
} from "@/components/financial/portfolio-summary/mock-data";

const meta = {
  title: "Portfolio Summary",
  component: PortfolioSummary,
  tags: ["autodocs"],
  argTypes: {
    portfolioName: {
      control: { type: "text" },
    },
    totalValue: {
      control: { type: "number" },
    },
    change24h: {
      control: { type: "number" },
    },
    positionCounts: {
      control: { type: "object" },
    },
    ordersFilled: {
      control: { type: "number" },
    },
    recentActivity: {
      control: { type: "object" },
    },
    watchlist: {
      control: { type: "object" },
    },
    exchanges: {
      control: { type: "object" },
    },
    spotPositions: {
      control: { type: "object" },
    },
    futuresPositions: {
      control: { type: "object" },
    },
  },
} satisfies Meta<typeof PortfolioSummary>;

type Story = StoryObj<typeof meta>;

export const WithMixedPerformance: Story = {
  args: {
    ...mixedPerformance,
  },
};

export const WithNegativeChange: Story = {
  args: {
    ...negativePerformance,
  },
};

export default meta;
