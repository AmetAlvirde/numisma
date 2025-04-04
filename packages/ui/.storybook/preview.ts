import type { Preview } from "@storybook/react";

import "@/styles/globals.css";
// eslint-disable-next-line no-restricted-imports
import "./storybook-theme.css"; // Import Storybook theme helper styles
// eslint-disable-next-line no-restricted-imports
import {
  getStoredMode,
  getStoredTheme,
  updateMode,
  updateTheme,
} from "./utils";
// eslint-disable-next-line no-restricted-imports
import { DocsContainer } from "./DocsContainer";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: { disable: true }, // Disable Storybook's background addon
    chromatic: { disable: true },
    docs: {
      container: DocsContainer,
    },
    layout: "fullscreen",
    viewport: {
      viewports: {
        xs: {
          name: "xs",
          styles: {
            width: "375px",
            height: "667px",
          },
        },
        sm: {
          name: "sm",
          styles: {
            width: "640px",
            height: "1136px",
          },
        },
        md: {
          name: "md",
          styles: {
            width: "768px",
            height: "1024px",
          },
        },
        lg: {
          name: "lg",
          styles: {
            width: "1024px",
            height: "768px",
          },
        },
        xl: {
          name: "xl",
          styles: {
            width: "1280px",
            height: "800px",
          },
        },
        "2xl": {
          name: "2xl",
          styles: {
            width: "1536px",
            height: "960px",
          },
        },
      },
      defaultViewport: "xs",
    },
  },
  decorators: [
    (Story, context) => {
      const { theme, darkMode } = context.globals;
      updateTheme(theme ?? "neutral");
      updateMode(darkMode ?? "dark");
      return Story();
    },
  ],
  globalTypes: {
    theme: {
      name: "Theme",
      description: "Color theme",
      defaultValue: getStoredTheme(),
      toolbar: {
        icon: "paintbrush",
        items: [
          { value: "neutral", title: "Neutral" },
          { value: "gray", title: "Gray" },
          { value: "slate", title: "Slate" },
          { value: "stone", title: "Stone" },
          { value: "zinc", title: "Zinc" },
        ],
        dynamicTitle: true,
      },
    },
    darkMode: {
      name: "Mode",
      description: "Light or dark mode",
      defaultValue: getStoredMode(),
      toolbar: {
        icon: "circlehollow",
        items: [
          { value: "light", title: "Light", icon: "sun" },
          { value: "dark", title: "Dark", icon: "moon" },
        ],
        dynamicTitle: true,
      },
    },
  },
};

export default preview;
