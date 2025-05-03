import "../src/app/globals.css";
import type { Preview } from "@storybook/react";

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
  },
};

export default preview;
