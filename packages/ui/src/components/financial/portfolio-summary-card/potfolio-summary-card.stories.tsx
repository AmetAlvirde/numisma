import { Meta, StoryObj } from "@storybook/react";
import { PortfolioSummaryCard } from "./portfolio-summary-card";

const meta = {
  title: "Portfolio Summary Card",
  component: PortfolioSummaryCard,
  tags: ["autodocs"],
  argTypes: {
    name: {
      control: { type: "text" },
    },
    totalValue: {
      control: { type: "number" },
    },
    profitLoss: {
      control: { type: "number" },
    },
    percentageReturn: {
      control: { type: "number" },
    },
    assetCount: {
      control: { type: "number" },
    },
    currency: {
      control: { type: "text" },
    },
  },
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof PortfolioSummaryCard>;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    name: "My Portfolio",
    totalValue: 10000,
    profitLoss: 100,
    percentageReturn: 0.01,
    assetCount: 10,
    currency: "USD",
  },
};

export default meta;
