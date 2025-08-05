import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HomeHeader } from "./home-header";

// Mock the Avatar component
vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <div className={className} data-testid="avatar">
      {children}
    </div>
  ),
  AvatarImage: ({ src, alt }: { src?: string; alt?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} data-testid="avatar-image" />
  ),
  AvatarFallback: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="avatar-fallback">{children}</div>
  ),
}));

describe("HomeHeader", () => {
  const mockSession = {
    user: {
      name: "John Doe",
      email: "john@example.com",
      image: "https://example.com/avatar.jpg",
    },
    expires: "2024-12-31",
  };

  beforeEach(() => {
    // Mock Date to ensure consistent period calculation
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-03-15")); // Q1/W11
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders title correctly", () => {
    render(<HomeHeader title="Test Title" session={mockSession} />);

    expect(screen.getByText("Test Title")).toBeInTheDocument();
  });

  it("displays current period in correct format", () => {
    render(<HomeHeader title="Overview" session={mockSession} />);

    expect(screen.getByText(/Q\d+\/W\d+/)).toBeInTheDocument();
  });

  it("renders user avatar with correct props", () => {
    render(<HomeHeader title="Overview" session={mockSession} />);

    const avatarImage = screen.getByTestId("avatar-image");
    expect(avatarImage).toHaveAttribute("src", mockSession.user.image);
    expect(avatarImage).toHaveAttribute("alt", mockSession.user.name);
  });

  it("shows user initials in fallback when no image", () => {
    const sessionWithoutImage = {
      ...mockSession,
      user: { ...mockSession.user, image: null },
    };

    render(<HomeHeader title="Overview" session={sessionWithoutImage} />);

    expect(screen.getByTestId("avatar-fallback")).toHaveTextContent("J");
  });

  it("handles session without user name gracefully", () => {
    const sessionWithoutName = {
      ...mockSession,
      user: { ...mockSession.user, name: null },
    };

    render(<HomeHeader title="Overview" session={sessionWithoutName} />);

    expect(screen.getByTestId("avatar-fallback")).toHaveTextContent("U");
  });

  it("displays Q1 for March dates", () => {
    vi.setSystemTime(new Date("2024-03-15"));
    render(<HomeHeader title="Overview" session={mockSession} />);

    expect(screen.getByText(/Q1\/W/)).toBeInTheDocument();
  });

  it("displays Q2 for June dates", () => {
    vi.setSystemTime(new Date("2024-06-15"));
    render(<HomeHeader title="Overview" session={mockSession} />);

    expect(screen.getByText(/Q2\/W/)).toBeInTheDocument();
  });

  it("displays Q3 for September dates", () => {
    vi.setSystemTime(new Date("2024-09-15"));
    render(<HomeHeader title="Overview" session={mockSession} />);

    expect(screen.getByText(/Q3\/W/)).toBeInTheDocument();
  });

  it("displays Q4 for December dates", () => {
    vi.setSystemTime(new Date("2024-12-15"));
    render(<HomeHeader title="Overview" session={mockSession} />);

    expect(screen.getByText(/Q4\/W/)).toBeInTheDocument();
  });
});
