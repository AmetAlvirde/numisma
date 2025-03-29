import { Meta, StoryObj } from "@storybook/react";
import { AssetBadge } from "./asset-badge";

const meta = {
  title: "Asset Badge",
  component: AssetBadge,
  tags: ["autodocs"],
  argTypes: {
    ticker: {
      control: { type: "text" },
    },
    assetType: {
      control: { type: "text" },
    },
    iconUrl: {
      control: { type: "text" },
    },
  },
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof AssetBadge>;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    ticker: "BTC",
    assetType: "crypto",
    iconUrl:
      "https://assets.coingecko.com/coins/images/1/large/bitcoin.png?1747033579",
  },
};

export default meta;
