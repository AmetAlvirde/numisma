import { Meta, StoryObj } from "@storybook/react";
import { Button } from "@/components/ui/button";

const meta = {
  title: "Button",
  component: Button,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: { type: "select" },
      options: ["default", "secondary"],
    },
  },
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

// Button Variants

// <Button variant="default">Default</Button>
export const Default: Story = {
  args: {
    variant: "default",
    children: "Default",
  },
};

// <Button variant="secondary">Secondary</Button>
export const Secondary: Story = {
  args: {
    variant: "secondary",
    children: "Secondary",
  },
};
