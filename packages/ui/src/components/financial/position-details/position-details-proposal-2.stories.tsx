import type { Meta, StoryObj } from "@storybook/react";
import { PositionDetailsProposal2 } from "./position-details-proposal-2";
import { mockBtcPosition, mockEthPosition } from "./mock-data";
import { PositionLifecycle, PositionStatus } from "@numisma/types";
const meta: Meta<typeof PositionDetailsProposal2> = {
  component: PositionDetailsProposal2,
  title: "Financial/Position Details/Proposal 2",
  parameters: {
    layout: "padded",
  },
};

export default meta;
type Story = StoryObj<typeof PositionDetailsProposal2>;

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
      lifecycle: PositionLifecycle.CLOSED,
      positionDetails: {
        ...mockEthPosition.positionDetails,
        status: PositionStatus.CLOSED,
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
