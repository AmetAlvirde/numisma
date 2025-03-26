/**
 * portfolio-context.tsx - Global portfolio state management
 *
 * This file implements the portfolio context using React Context API
 * to manage global portfolio state across the application.
 */

import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
} from "react";
import type { Portfolio } from "@/types/numisma-types";

/**
 * Portfolio state interface
 */
interface PortfolioState {
  portfolios: Portfolio[];
  selectedPortfolioId: string | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Portfolio action types
 */
type PortfolioAction =
  | { type: "SET_PORTFOLIOS"; payload: Portfolio[] }
  | { type: "ADD_PORTFOLIO"; payload: Portfolio }
  | { type: "UPDATE_PORTFOLIO"; payload: Portfolio }
  | { type: "DELETE_PORTFOLIO"; payload: string }
  | { type: "SELECT_PORTFOLIO"; payload: string }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null };

/**
 * Initial state
 */
const initialState: PortfolioState = {
  portfolios: [],
  selectedPortfolioId: null,
  isLoading: false,
  error: null,
};

/**
 * Portfolio reducer
 */
function portfolioReducer(
  state: PortfolioState,
  action: PortfolioAction
): PortfolioState {
  switch (action.type) {
    case "SET_PORTFOLIOS":
      return {
        ...state,
        portfolios: action.payload,
        error: null,
      };

    case "ADD_PORTFOLIO":
      return {
        ...state,
        portfolios: [...state.portfolios, action.payload],
        error: null,
      };

    case "UPDATE_PORTFOLIO":
      return {
        ...state,
        portfolios: state.portfolios.map(portfolio =>
          portfolio.id === action.payload.id ? action.payload : portfolio
        ),
        error: null,
      };

    case "DELETE_PORTFOLIO":
      return {
        ...state,
        portfolios: state.portfolios.filter(
          portfolio => portfolio.id !== action.payload
        ),
        selectedPortfolioId:
          state.selectedPortfolioId === action.payload
            ? null
            : state.selectedPortfolioId,
        error: null,
      };

    case "SELECT_PORTFOLIO":
      return {
        ...state,
        selectedPortfolioId: action.payload,
        error: null,
      };

    case "SET_LOADING":
      return {
        ...state,
        isLoading: action.payload,
      };

    case "SET_ERROR":
      return {
        ...state,
        error: action.payload,
      };

    default:
      return state;
  }
}

/**
 * Portfolio context interface
 */
interface PortfolioContextType extends PortfolioState {
  setPortfolios: (portfolios: Portfolio[]) => void;
  addPortfolio: (portfolio: Portfolio) => void;
  updatePortfolio: (portfolio: Portfolio) => void;
  deletePortfolio: (id: string) => void;
  selectPortfolio: (id: string) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
}

/**
 * Create portfolio context
 */
const PortfolioContext = createContext<PortfolioContextType | undefined>(
  undefined
);

/**
 * Portfolio provider component
 */
export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(portfolioReducer, initialState);

  const setPortfolios = useCallback((portfolios: Portfolio[]) => {
    dispatch({ type: "SET_PORTFOLIOS", payload: portfolios });
  }, []);

  const addPortfolio = useCallback((portfolio: Portfolio) => {
    dispatch({ type: "ADD_PORTFOLIO", payload: portfolio });
  }, []);

  const updatePortfolio = useCallback((portfolio: Portfolio) => {
    dispatch({ type: "UPDATE_PORTFOLIO", payload: portfolio });
  }, []);

  const deletePortfolio = useCallback((id: string) => {
    dispatch({ type: "DELETE_PORTFOLIO", payload: id });
  }, []);

  const selectPortfolio = useCallback((id: string) => {
    dispatch({ type: "SELECT_PORTFOLIO", payload: id });
  }, []);

  const setLoading = useCallback((isLoading: boolean) => {
    dispatch({ type: "SET_LOADING", payload: isLoading });
  }, []);

  const setError = useCallback((error: string | null) => {
    dispatch({ type: "SET_ERROR", payload: error });
  }, []);

  const value = {
    ...state,
    setPortfolios,
    addPortfolio,
    updatePortfolio,
    deletePortfolio,
    selectPortfolio,
    setLoading,
    setError,
  };

  return (
    <PortfolioContext.Provider value={value}>
      {children}
    </PortfolioContext.Provider>
  );
}

/**
 * Custom hook to use the portfolio context
 */
export function usePortfolio() {
  const context = useContext(PortfolioContext);
  if (context === undefined) {
    throw new Error("usePortfolio must be used within a PortfolioProvider");
  }
  return context;
}
