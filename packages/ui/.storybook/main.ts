import type { StorybookConfig } from "@storybook/react-vite";
import path from "path";

const config: StorybookConfig = {
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  addons: ["@storybook/addon-essentials", "@chromatic-com/storybook"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  staticDirs: ["../src/styles"],
  viteFinal: async config => {
    if (config.resolve) {
      config.resolve.alias = {
        ...config.resolve.alias,
        "@": path.resolve(__dirname, "../src/"),
      };
    }
    return config;
  },
};
export default config;
