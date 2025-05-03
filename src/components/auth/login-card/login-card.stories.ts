import { Meta, StoryObj } from "@storybook/react";
import { LoginCard } from "@/components/auth/login-card/login-card";
const meta = {
  title: "Sign out button",
  component: LoginCard,
  tags: ["autodocs"],
  argTypes: {},
} satisfies Meta<typeof LoginCard>;

type Story = StoryObj<typeof meta>;

export const basic: Story = {
  args: {
    onSubmit: async () => {},
    error: null,
    isLoading: false,
  },
};

export default meta;
