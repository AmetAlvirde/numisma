import "./App.css";
import { Button } from "@/components/ui/button";
import { PositionsList } from "./components/positionsList";
import { Position, WalletType, PositionStatus, OrderStatus } from "./types";

const positions: Position[] = [
  {
    id: "1",
    name: "Position 1",
    riskLevel: 5,
    portfolio: "Portfolio 1",
    walletType: "hot" as WalletType,
    seedCapitalTier: "C1",
    strategy: "Strategy 1",
    asset: {
      name: "BTC",
      ticker: "BTC",
      pair: "BTC/USD",
      location: "exchange",
      exchange: "Binance",
      wallet: "1234567890",
    },
    positionDetails: {
      status: "active" as PositionStatus,
      side: "buy",
      fractal: "1D",
      orders: [
        {
          id: "1",
          dateOpen: "2021-01-01",
          averagePrice: 10000,
          totalCost: 10000,
          status: "submitted" as OrderStatus,
          type: "market",
        },
      ],
      stopLoss: [
        {
          id: "1",
          dateOpen: "2021-01-01",
          averagePrice: 10000,
          totalCost: 10000,
          status: "submitted" as OrderStatus,
          type: "trigger",
          unit: "percentage",
          size: 0.1,
        },
      ],
      takeProfit: [
        {
          id: "1",
          dateOpen: "2021-01-01",
          averagePrice: 10000,
          totalCost: 10000,
          status: "submitted" as OrderStatus,
          type: "trigger",
          unit: "percentage",
          size: 0.1,
        },
      ],
    },
  },
];

const currentPrices = {
  BTC: 85000,
  ETH: 2000,
};

const handlePositionClick = (position: Position) => {
  console.log(position);
};

function App() {
  return (
    <>
      <Button>Click me</Button>
      <PositionsList
        positions={positions}
        currentPrices={currentPrices}
        onPositionClick={handlePositionClick}
      />
    </>
  );
}

export default App;
