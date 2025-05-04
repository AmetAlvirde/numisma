import type { Meta, StoryObj } from "@storybook/react";
import React from "react";

// Define the structure for our color data
interface ColorInfo {
  name: string;
  variable: string;
  value: string; // Now stores the var(--...) string
  description: string;
}

// Single source of truth for color variables
const colorInfoList: ColorInfo[] = [
  {
    name: "Background",
    variable: "--background",
    value: "var(--background)",
    description: "The main background color for the application body.",
  },
  {
    name: "Foreground",
    variable: "--foreground",
    value: "var(--foreground)",
    description: "The default text color used across the application.",
  },
  {
    name: "Card",
    variable: "--card",
    value: "var(--card)",
    description: "Background color for Card components.",
  },
  {
    name: "Card Foreground",
    variable: "--card-foreground",
    value: "var(--card-foreground)",
    description: "Text color for Card components.",
  },
  {
    name: "Popover",
    variable: "--popover",
    value: "var(--popover)",
    description:
      "Background color for floating elements like Popover, DropdownMenu, Tooltip.",
  },
  {
    name: "Popover Foreground",
    variable: "--popover-foreground",
    value: "var(--popover-foreground)",
    description:
      "Text color for floating elements like Popover, DropdownMenu, Tooltip.",
  },
  {
    name: "Primary",
    variable: "--primary",
    value: "var(--primary)",
    description:
      "Primary brand color for main interactive elements (e.g., default Button).",
  },
  {
    name: "Primary Foreground",
    variable: "--primary-foreground",
    value: "var(--primary-foreground)",
    description: "Text color for elements with the primary background color.",
  },
  {
    name: "Secondary",
    variable: "--secondary",
    value: "var(--secondary)",
    description:
      "Secondary brand color for less prominent interactive elements.",
  },
  {
    name: "Secondary Foreground",
    variable: "--secondary-foreground",
    value: "var(--secondary-foreground)",
    description: "Text color for elements with the secondary background color.",
  },
  {
    name: "Muted",
    variable: "--muted",
    value: "var(--muted)",
    description:
      "Muted color for less important text, disabled states, or subtle backgrounds/borders.",
  },
  {
    name: "Muted Foreground",
    variable: "--muted-foreground",
    value: "var(--muted-foreground)",
    description:
      "Text color for elements with the muted background or for less important text.",
  },
  {
    name: "Accent",
    variable: "--accent",
    value: "var(--accent)",
    description:
      "Accent color for subtle highlights, focus states, or specific component parts.",
  },
  {
    name: "Accent Foreground",
    variable: "--accent-foreground",
    value: "var(--accent-foreground)",
    description: "Text color for elements with the accent background color.",
  },
  {
    name: "Destructive",
    variable: "--destructive",
    value: "var(--destructive)",
    description:
      "Color used for destructive actions (e.g., delete buttons, error states).",
  },
  {
    name: "Border",
    variable: "--border",
    value: "var(--border)",
    description:
      "Default border color for components like Card, Input, Separator.",
  },
  {
    name: "Input",
    variable: "--input",
    value: "var(--input)",
    description: "Specific border color for Input components.",
  },
  {
    name: "Ring",
    variable: "--ring",
    value: "var(--ring)",
    description:
      "Color for the focus ring outline around interactive elements.",
  },
  {
    name: "Chart 1",
    variable: "--chart-1",
    value: "var(--chart-1)",
    description: "Color 1 for data visualizations.",
  },
  {
    name: "Chart 2",
    variable: "--chart-2",
    value: "var(--chart-2)",
    description: "Color 2 for data visualizations.",
  },
  {
    name: "Chart 3",
    variable: "--chart-3",
    value: "var(--chart-3)",
    description: "Color 3 for data visualizations.",
  },
  {
    name: "Chart 4",
    variable: "--chart-4",
    value: "var(--chart-4)",
    description: "Color 4 for data visualizations.",
  },
  {
    name: "Chart 5",
    variable: "--chart-5",
    value: "var(--chart-5)",
    description: "Color 5 for data visualizations.",
  },
  {
    name: "Sidebar",
    variable: "--sidebar",
    value: "var(--sidebar)",
    description: "Base background color for the sidebar component.",
  },
  {
    name: "Sidebar Foreground",
    variable: "--sidebar-foreground",
    value: "var(--sidebar-foreground)",
    description: "Base text color for the sidebar component.",
  },
  {
    name: "Sidebar Primary",
    variable: "--sidebar-primary",
    value: "var(--sidebar-primary)",
    description:
      "Primary interaction color within the sidebar (e.g., active item background).",
  },
  {
    name: "Sidebar Primary Foreground",
    variable: "--sidebar-primary-foreground",
    value: "var(--sidebar-primary-foreground)",
    description:
      "Text color for primary interaction elements within the sidebar.",
  },
  {
    name: "Sidebar Accent",
    variable: "--sidebar-accent",
    value: "var(--sidebar-accent)",
    description: "Accent color within the sidebar (e.g., hover states).",
  },
  {
    name: "Sidebar Accent Foreground",
    variable: "--sidebar-accent-foreground",
    value: "var(--sidebar-accent-foreground)",
    description: "Text color for accent elements within the sidebar.",
  },
  {
    name: "Sidebar Border",
    variable: "--sidebar-border",
    value: "var(--sidebar-border)",
    description: "Border color used within or around the sidebar.",
  },
  {
    name: "Sidebar Ring",
    variable: "--sidebar-ring",
    value: "var(--sidebar-ring)",
    description:
      "Focus ring color for interactive elements within the sidebar.",
  },
];

// Component to display a single color item
const ColorDisplayItem: React.FC<{ color: ColorInfo }> = ({ color }) => (
  <div className="mb-4 rounded-md border p-4 bg-card text-card-foreground">
    <div className="flex items-center gap-4">
      <div
        className="h-10 w-10 shrink-0 rounded border"
        style={{ backgroundColor: color.value }} // Uses the var(--...) string
      />
      <div className="flex-grow">
        <div className="font-semibold">{color.name}</div>
        <div className="text-sm text-muted-foreground">{color.variable}</div>
        {/* Remove the display of the hardcoded value */}
        {/* <div className="text-sm text-muted-foreground">{color.value}</div> */}
      </div>
    </div>
    <p className="mt-2 text-sm">{color.description}</p>
  </div>
);

// Component to display the full palette
const ColorPaletteDisplay: React.FC = () => {
  return (
    <div className="p-4 bg-background text-foreground min-h-screen">
      {/* Light Theme Section - Shows by default, hidden in dark mode */}
      <div className="block dark:hidden">
        <h2 className="mb-4 text-xl font-bold">Light Theme (:root)</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {colorInfoList.map(
            (
              color // Use the single list
            ) => (
              <ColorDisplayItem key={color.variable} color={color} />
            )
          )}
        </div>
      </div>

      {/* Dark Theme Section - Hidden by default, shown in dark mode */}
      <div className="hidden dark:block">
        <h2 className="mb-4 text-xl font-bold">Dark Theme (.dark)</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {colorInfoList.map(
            (
              color // Use the single list
            ) => (
              <ColorDisplayItem key={color.variable} color={color} />
            )
          )}
        </div>
      </div>
    </div>
  );
};

// Storybook Meta configuration
const meta: Meta<typeof ColorPaletteDisplay> = {
  title: "Design System/Color System",
  component: ColorPaletteDisplay,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;

// Default Story
type Story = StoryObj<typeof ColorPaletteDisplay>;

export const ColorSystem: Story = {};
