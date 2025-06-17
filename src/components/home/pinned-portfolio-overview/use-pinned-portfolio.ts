import { useState, useCallback, useMemo } from "react";
import { mockPortfolioOverview, mockAvailablePortfolios } from "./mock-data";

export function usePinnedPortfolio() {
  const [isChangeDialogOpen, setIsChangeDialogOpen] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [pinnedPortfolio, setPinnedPortfolio] = useState(mockPortfolioOverview);

  const isPositive = useMemo(
    () => pinnedPortfolio.dayChange > 0,
    [pinnedPortfolio.dayChange]
  );

  const handleChangePinnedPortfolio = useCallback(() => {
    setIsDropdownOpen(false);
    // Use requestAnimationFrame to ensure dropdown closes before dialog opens
    requestAnimationFrame(() => {
      setIsChangeDialogOpen(true);
    });
  }, []);

  const handleAddPinnedPortfolio = useCallback(() => {
    setIsDropdownOpen(false);
    // Use requestAnimationFrame to ensure dropdown closes before dialog opens
    requestAnimationFrame(() => {
      setIsAddDialogOpen(true);
    });
  }, []);

  const handlePortfolioSelect = useCallback(
    (portfolioId: string) => {
      try {
        const selectedPortfolio = mockAvailablePortfolios.find(
          p => p.id === portfolioId
        );

        if (!selectedPortfolio) {
          console.error("Portfolio not found:", portfolioId);
          return;
        }

        if (isChangeDialogOpen) {
          // Update the current portfolio
          setPinnedPortfolio(prev => ({
            ...selectedPortfolio,
            dayChange: 2847.32, // Mock data
            dayChangePercent: 1.99, // Mock data
            topHoldings: ["AAPL", "GOOGL", "TSLA"], // Mock data
          }));
          setIsChangeDialogOpen(false);
        } else if (isAddDialogOpen) {
          // TODO: Implement adding a new portfolio card
          console.log("Adding new portfolio:", selectedPortfolio);
          setIsAddDialogOpen(false);
        }
      } catch (error) {
        console.error("Error selecting portfolio:", error);
      }
    },
    [isChangeDialogOpen, isAddDialogOpen]
  );

  return {
    // State
    pinnedPortfolio,
    isPositive,
    isChangeDialogOpen,
    setIsChangeDialogOpen,
    isAddDialogOpen,
    setIsAddDialogOpen,
    isDropdownOpen,
    setIsDropdownOpen,

    // Handlers
    handleChangePinnedPortfolio,
    handleAddPinnedPortfolio,
    handlePortfolioSelect,
  };
}
