import "../src/app/globals.css";
import type { Preview, Decorator } from "@storybook/react";
import { withThemeByClassName } from "@storybook/addon-themes";
import React from "react";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
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
    backgrounds: {
      disable: true,
    },
  },
  decorators: [
    withThemeByClassName({
      themes: {
        light: "",
        dark: "dark",
      },
      defaultTheme: "light",
    }),
  ],
};

export default preview;
