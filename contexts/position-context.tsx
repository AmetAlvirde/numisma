/**
 * position-context.tsx - Global position state management
 *
 * This file implements the position context using React Context API
 * to manage global position state across the application.
 */

import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
} from "react";
import type { Position, Order, PositionDetails } from "@/types/numisma-types";

/**
 * Position state interface
 */
interface PositionState {
  positions: Position[];
  selectedPositionId: string | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Position action types
 */
type PositionAction =
  | { type: "SET_POSITIONS"; payload: Position[] }
  | { type: "ADD_POSITION"; payload: Position }
  | { type: "UPDATE_POSITION"; payload: Position }
  | { type: "DELETE_POSITION"; payload: string }
  | { type: "SELECT_POSITION"; payload: string }
  | { type: "ADD_ORDER"; payload: { positionId: string; order: Order } }
  | {
      type: "UPDATE_ORDER";
      payload: { positionId: string; orderId: string; order: Order };
    }
  | { type: "DELETE_ORDER"; payload: { positionId: string; orderId: string } }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null };

/**
 * Initial state
 */
const initialState: PositionState = {
  positions: [],
  selectedPositionId: null,
  isLoading: false,
  error: null,
};

/**
 * Position reducer
 */
function positionReducer(
  state: PositionState,
  action: PositionAction
): PositionState {
  switch (action.type) {
    case "SET_POSITIONS":
      return {
        ...state,
        positions: action.payload,
        error: null,
      };

    case "ADD_POSITION":
      return {
        ...state,
        positions: [...state.positions, action.payload],
        error: null,
      };

    case "UPDATE_POSITION":
      return {
        ...state,
        positions: state.positions.map(position =>
          position.id === action.payload.id ? action.payload : position
        ),
        error: null,
      };

    case "DELETE_POSITION":
      return {
        ...state,
        positions: state.positions.filter(
          position => position.id !== action.payload
        ),
        selectedPositionId:
          state.selectedPositionId === action.payload
            ? null
            : state.selectedPositionId,
        error: null,
      };

    case "SELECT_POSITION":
      return {
        ...state,
        selectedPositionId: action.payload,
        error: null,
      };

    case "ADD_ORDER":
      return {
        ...state,
        positions: state.positions.map(position =>
          position.id === action.payload.positionId
            ? {
                ...position,
                positionDetails: {
                  ...position.positionDetails,
                  orders: [
                    ...position.positionDetails.orders,
                    action.payload.order,
                  ],
                },
              }
            : position
        ),
        error: null,
      };

    case "UPDATE_ORDER":
      return {
        ...state,
        positions: state.positions.map(position =>
          position.id === action.payload.positionId
            ? {
                ...position,
                positionDetails: {
                  ...position.positionDetails,
                  orders: position.positionDetails.orders.map(order =>
                    order.id === action.payload.orderId
                      ? action.payload.order
                      : order
                  ),
                },
              }
            : position
        ),
        error: null,
      };

    case "DELETE_ORDER":
      return {
        ...state,
        positions: state.positions.map(position =>
          position.id === action.payload.positionId
            ? {
                ...position,
                positionDetails: {
                  ...position.positionDetails,
                  orders: position.positionDetails.orders.filter(
                    order => order.id !== action.payload.orderId
                  ),
                },
              }
            : position
        ),
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
 * Position context interface
 */
interface PositionContextType extends PositionState {
  setPositions: (positions: Position[]) => void;
  addPosition: (position: Position) => void;
  updatePosition: (position: Position) => void;
  deletePosition: (id: string) => void;
  selectPosition: (id: string) => void;
  addOrder: (positionId: string, order: Order) => void;
  updateOrder: (positionId: string, orderId: string, order: Order) => void;
  deleteOrder: (positionId: string, orderId: string) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
}

/**
 * Create position context
 */
const PositionContext = createContext<PositionContextType | undefined>(
  undefined
);

/**
 * Position provider component
 */
export function PositionProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(positionReducer, initialState);

  const setPositions = useCallback((positions: Position[]) => {
    dispatch({ type: "SET_POSITIONS", payload: positions });
  }, []);

  const addPosition = useCallback((position: Position) => {
    dispatch({ type: "ADD_POSITION", payload: position });
  }, []);

  const updatePosition = useCallback((position: Position) => {
    dispatch({ type: "UPDATE_POSITION", payload: position });
  }, []);

  const deletePosition = useCallback((id: string) => {
    dispatch({ type: "DELETE_POSITION", payload: id });
  }, []);

  const selectPosition = useCallback((id: string) => {
    dispatch({ type: "SELECT_POSITION", payload: id });
  }, []);

  const addOrder = useCallback((positionId: string, order: Order) => {
    dispatch({ type: "ADD_ORDER", payload: { positionId, order } });
  }, []);

  const updateOrder = useCallback(
    (positionId: string, orderId: string, order: Order) => {
      dispatch({
        type: "UPDATE_ORDER",
        payload: { positionId, orderId, order },
      });
    },
    []
  );

  const deleteOrder = useCallback((positionId: string, orderId: string) => {
    dispatch({ type: "DELETE_ORDER", payload: { positionId, orderId } });
  }, []);

  const setLoading = useCallback((isLoading: boolean) => {
    dispatch({ type: "SET_LOADING", payload: isLoading });
  }, []);

  const setError = useCallback((error: string | null) => {
    dispatch({ type: "SET_ERROR", payload: error });
  }, []);

  const value = {
    ...state,
    setPositions,
    addPosition,
    updatePosition,
    deletePosition,
    selectPosition,
    addOrder,
    updateOrder,
    deleteOrder,
    setLoading,
    setError,
  };

  return (
    <PositionContext.Provider value={value}>
      {children}
    </PositionContext.Provider>
  );
}

/**
 * Custom hook to use the position context
 */
export function usePosition() {
  const context = useContext(PositionContext);
  if (context === undefined) {
    throw new Error("usePosition must be used within a PositionProvider");
  }
  return context;
}
