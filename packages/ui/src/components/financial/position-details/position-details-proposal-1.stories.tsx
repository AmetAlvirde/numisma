import type { Meta, StoryObj } from "@storybook/react";
import { PositionDetailsProposal1 } from "./position-details-proposal-1";
import { mockBtcPosition, mockEthPosition } from "./mock-data";

const meta: Meta<typeof PositionDetailsProposal1> = {
  component: PositionDetailsProposal1,
  title: "Financial/Position Details/Proposal 1",
  parameters: {
    layout: "padded",
  },
};

export default meta;
type Story = StoryObj<typeof PositionDetailsProposal1>;

export const Default: Story = {
  args: {
    position: mockBtcPosition,
    relatedPortfolioName: "Crypto Portfolio",
    onEditPosition: () => console.log("Edit position clicked"),
    onAddJournalEntry: () => console.log("Add journal entry clicked"),
    onEditThesis: () => console.log("Edit thesis clicked"),
    onClosePosition: () => console.log("Close position clicked"),
    onRefreshData: () => console.log("Refresh data clicked"),
    onBackToPortfolio: () => console.log("Back to portfolio clicked"),
  },
};

export const Loading: Story = {
  args: {
    ...Default.args,
    isLoading: true,
  },
};

export const NoThesis: Story = {
  args: {
    ...Default.args,
    position: {
      ...mockBtcPosition,
      thesis: undefined,
    },
  },
};

export const ClosedPosition: Story = {
  args: {
    ...Default.args,
    position: {
      ...mockEthPosition,
      lifecycle: "CLOSED",
      positionDetails: {
        ...mockEthPosition.positionDetails,
        status: "CLOSED",
        dateClosed: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
      },
    },
  },
};

export const Mobile: Story = {
  args: {
    ...Default.args,
  },
  parameters: {
    viewport: {
      defaultViewport: "mobile1",
    },
  },
};
