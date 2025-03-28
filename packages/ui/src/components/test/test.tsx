import React from "react";

interface TestProps {
  text?: string;
  onClick?: () => void;
}

export const Test: React.FC<TestProps> = ({ text = "Click me!", onClick }) => {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
    >
      {text}
    </button>
  );
};
