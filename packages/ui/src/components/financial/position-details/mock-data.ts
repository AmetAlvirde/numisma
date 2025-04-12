import {
  Asset,
  AssetLocationType,
  AssetType,
  CapitalTier,
  JournalEntry,
  Order,
  OrderPurpose,
  OrderStatus,
  OrderType,
  Position,
  PositionDetails,
  PositionLifecycle,
  PositionStatus,
  SizeUnit,
  StopLossOrder,
  TakeProfitOrder,
  Thesis,
  TimeFrame,
  TradeSide,
  WalletType,
} from "@/types";

export interface PositionDetailsComponentProps {
  position: Position;
  relatedPortfolioName?: string;
  onEditPosition?: () => void;
  onAddJournalEntry?: () => void;
  onEditThesis?: () => void;
  onClosePosition?: () => void;
  onRefreshData?: () => void;
  onBackToPortfolio?: () => void;
  className?: string;
  isLoading?: boolean;
}

// Mock asset
const mockBitcoinAsset: Asset = {
  id: "asset_btc",
  name: "Bitcoin",
  ticker: "BTC",
  assetType: AssetType.CRYPTO,
  description: "The original cryptocurrency",
  locationType: AssetLocationType.EXCHANGE,
  exchange: "Binance",
  wallet: "spot",
  network: "Bitcoin",
  iconUrl: "https://cryptologos.cc/logos/bitcoin-btc-logo.png",
  category: "Layer 1",
  marketData: {
    currentPrice: 62350,
    priceChangePercentage24h: 2.5,
    marketCap: 1274000000000,
    volume24h: 28500000000,
    lastUpdated: new Date(),
  },
};

const mockEthereumAsset: Asset = {
  id: "asset_eth",
  name: "Ethereum",
  ticker: "ETH",
  assetType: AssetType.CRYPTO,
  description: "Decentralized computing platform",
  locationType: AssetLocationType.EXCHANGE,
  exchange: "Binance",
  wallet: "spot",
  network: "Ethereum",
  iconUrl: "https://cryptologos.cc/logos/ethereum-eth-logo.png",
  category: "Layer 1",
  marketData: {
    currentPrice: 2780,
    priceChangePercentage24h: -1.8,
    marketCap: 327000000000,
    volume24h: 15800000000,
    lastUpdated: new Date(),
  },
};

const mockSolanaAsset: Asset = {
  id: "asset_sol",
  name: "Solana",
  ticker: "SOL",
  assetType: AssetType.CRYPTO,
  description: "High-performance blockchain",
  locationType: AssetLocationType.EXCHANGE,
  exchange: "Bitget",
  wallet: "futures",
  network: "Solana",
  iconUrl: "https://cryptologos.cc/logos/solana-sol-logo.png",
  category: "Layer 1",
  marketData: {
    currentPrice: 138.6,
    priceChangePercentage24h: -3.2,
    marketCap: 62000000000,
    volume24h: 4100000000,
    lastUpdated: new Date(),
  },
};

// Mock orders for BTC position
const btcEntryOrders: Order[] = [
  {
    id: "order_btc_1",
    positionId: "pos_btc_1" as any,
    dateOpen: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // 15 days ago
    averagePrice: 58752,
    totalCost: 11750.4,
    status: OrderStatus.FILLED,
    type: OrderType.LIMIT,
    purpose: OrderPurpose.ENTRY,
    fee: 11.75,
    feeUnit: "USDT",
    filled: 0.2,
  },
  {
    id: "order_btc_2",
    positionId: "pos_btc_1" as any,
    dateOpen: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), // 8 days ago
    averagePrice: 61250,
    totalCost: 6125,
    status: OrderStatus.FILLED,
    type: OrderType.LIMIT,
    purpose: OrderPurpose.ENTRY,
    fee: 6.13,
    feeUnit: "USDT",
    filled: 0.1,
  },
];

const btcStopLoss: StopLossOrder[] = [
  {
    id: "order_btc_sl",
    positionId: "pos_btc_1" as any,
    status: OrderStatus.SUBMITTED,
    type: OrderType.TRIGGER,
    purpose: OrderPurpose.STOP_LOSS,
    trigger: 55000,
    unit: SizeUnit.PERCENTAGE,
    size: 1.0, // 100% of position
    isTrailing: false,
    maxSlippage: 0.5,
    strategy: "full",
  },
];

const btcTakeProfit: TakeProfitOrder[] = [
  {
    id: "order_btc_tp1",
    positionId: "pos_btc_1" as any,
    status: OrderStatus.SUBMITTED,
    type: OrderType.LIMIT,
    purpose: OrderPurpose.TAKE_PROFIT,
    trigger: 68000,
    unit: SizeUnit.PERCENTAGE,
    size: 0.5, // 50% of position
    targetPercentage: 15.5,
    tier: 1,
    moveStopToBreakeven: true,
  },
  {
    id: "order_btc_tp2",
    positionId: "pos_btc_1" as any,
    status: OrderStatus.SUBMITTED,
    type: OrderType.LIMIT,
    purpose: OrderPurpose.TAKE_PROFIT,
    trigger: 72000,
    unit: SizeUnit.PERCENTAGE,
    size: 0.5, // Remaining 50%
    targetPercentage: 22.5,
    tier: 2,
  },
];

// BTC position details
const btcPositionDetails: PositionDetails = {
  status: PositionStatus.ACTIVE,
  side: TradeSide.LONG,
  timeFrame: TimeFrame.ONE_DAY,
  dateOpened: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
  dateClosed: null,
  orders: btcEntryOrders,
  stopLoss: btcStopLoss,
  takeProfit: btcTakeProfit,
  averageEntryPrice: 59585,
  totalSize: 0.3,
  totalCost: 17875.4,
  realizedProfitLoss: 0,
  isLeveraged: false,
  unrealizedProfitLoss: 829.5, // current price - average price * total size
  currentReturn: 4.64, // unrealized PL / total cost * 100
  targetPrice: 68000,
  stopPrice: 55000,
  riskRewardRatio: 2.77, // (target - entry) / (entry - stop)
};

// BTC thesis
const btcThesis: Thesis = {
  reasoning:
    "Bitcoin is in a strong uptrend following the halving event. With increased institutional adoption and ETF inflows, we expect continued momentum through Q2 2024.",
  invalidation:
    "A break below the 200-day moving average would invalidate this thesis, as would significant regulatory headwinds or a broader market crash.",
  fulfillment:
    "Target of $68,000 represents the previous all-time high, which should act as a significant psychological level. Second target at $72,000 represents a 22.5% gain from entry.",
  technicalAnalysis:
    "Price is above all major moving averages (50, 100, 200 day). RSI shows room for growth without being overbought. Volume profile shows strong accumulation.",
  fundamentalAnalysis:
    "Bitcoin supply shock from halving, combined with ETF inflows averaging $200M daily. Miners are accumulating rather than selling.",
  timeHorizon: "3-6 months (medium-term swing trade)",
  riskRewardRatio: "2.77:1",
};

// BTC journal entries
const btcJournalEntries: JournalEntry[] = [
  {
    id: "journal_btc_1",
    positionId: "pos_btc_1",
    thought:
      "Entered initial 0.2 BTC position after seeing strong bounce from the 50-day moving average. Volume is picking up and sentiment seems to be shifting positive after weeks of consolidation.",
    timestamp: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
    userId: "user_1",
    sentiment: "bullish",
  },
  {
    id: "journal_btc_2",
    positionId: "pos_btc_1",
    thought:
      "Added to position with another 0.1 BTC as price confirmed the uptrend with a higher high. ETF inflows have been consistently strong this week which supports the thesis.",
    timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    userId: "user_1",
    sentiment: "bullish",
  },
  {
    id: "journal_btc_3",
    positionId: "pos_btc_1",
    thought:
      "Considering moving up my stop loss as we've had 3 consecutive green daily candles. The market is getting a bit overheated in the short term, so want to protect profits while still giving the position room to breathe.",
    attachments: ["https://example.com/chart1.png"],
    timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    userId: "user_1",
    sentiment: "neutral",
    isKeyLearning: true,
  },
];

// Mock BTC Position
export const mockBtcPosition: Position = {
  id: "pos_btc_1",
  name: "BTC Halving Momentum",
  riskLevel: 6,
  portfolioId: "portfolio_1" as any,
  walletType: WalletType.HOT,
  capitalTier: CapitalTier.C1,
  strategy: "Post-halving accumulation",
  lifecycle: PositionLifecycle.ACTIVE,
  thesis: btcThesis,
  journal: btcJournalEntries,
  asset: mockBitcoinAsset,
  positionDetails: btcPositionDetails,
  tags: ["halving", "momentum", "swing"],
  userId: "user_1",
  dateCreated: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
  dateUpdated: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
  currentValue: 18705, // Current market price * total size
  alertsEnabled: true,
  preTrackingStatus: { isPreTracking: false, dateOpened: null },
};

// Mock ETH position details
const ethPositionDetails: PositionDetails = {
  status: PositionStatus.ACTIVE,
  side: TradeSide.LONG,
  timeFrame: TimeFrame.FOUR_HOURS,
  dateOpened: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
  dateClosed: null,
  orders: [
    {
      id: "order_eth_1",
      positionId: "pos_eth_1" as any,
      dateOpen: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      averagePrice: 2650,
      totalCost: 13250,
      status: OrderStatus.FILLED,
      type: OrderType.MARKET,
      purpose: OrderPurpose.ENTRY,
      fee: 13.25,
      feeUnit: "USDT",
      filled: 5,
    },
  ],
  stopLoss: [
    {
      id: "order_eth_sl",
      positionId: "pos_eth_1" as any,
      status: OrderStatus.SUBMITTED,
      type: OrderType.TRIGGER,
      purpose: OrderPurpose.STOP_LOSS,
      trigger: 2450,
      unit: SizeUnit.PERCENTAGE,
      size: 1.0,
      isTrailing: false,
    },
  ],
  takeProfit: [
    {
      id: "order_eth_tp",
      positionId: "pos_eth_1" as any,
      status: OrderStatus.SUBMITTED,
      type: OrderType.LIMIT,
      purpose: OrderPurpose.TAKE_PROFIT,
      trigger: 3200,
      unit: SizeUnit.PERCENTAGE,
      size: 1.0,
      targetPercentage: 20.75,
    },
  ],
  averageEntryPrice: 2650,
  totalSize: 5,
  totalCost: 13250,
  realizedProfitLoss: 0,
  isLeveraged: false,
  unrealizedProfitLoss: 650, // (2780 - 2650) * 5
  currentReturn: 4.9, // 650 / 13250 * 100
  targetPrice: 3200,
  stopPrice: 2450,
  riskRewardRatio: 2.75,
};

// Mock ETH thesis
const ethThesis: Thesis = {
  reasoning:
    "Ethereum is showing strength after successful Dencun upgrade. Reduced gas fees and increased scalability are driving adoption.",
  invalidation:
    "Break below support at $2,450 would invalidate the thesis. Also watching for any major technical issues with the recent upgrade.",
  fulfillment:
    "Target of $3,200 based on previous resistance level and 1.618 Fibonacci extension.",
  technicalAnalysis:
    "Consolidating in bull flag pattern after strong rally. MACD showing potential for continued upside momentum.",
  fundamentalAnalysis:
    "ETH burning mechanism creating supply constraints. DeFi and NFT activity increasing post-upgrade.",
  timeHorizon: "4-8 weeks",
  riskRewardRatio: "2.75:1",
};

// Mock ETH Position
export const mockEthPosition: Position = {
  id: "pos_eth_1",
  name: "ETH Post-Dencun Breakout",
  riskLevel: 5,
  portfolioId: "portfolio_1" as any,
  walletType: WalletType.HOT,
  capitalTier: CapitalTier.C2,
  strategy: "Technical breakout",
  lifecycle: PositionLifecycle.ACTIVE,
  thesis: ethThesis,
  journal: [],
  asset: mockEthereumAsset,
  positionDetails: ethPositionDetails,
  tags: ["ethereum", "upgrade", "breakout"],
  userId: "user_1",
  dateCreated: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
  dateUpdated: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
  currentValue: 13900, // 5 ETH * $2,780
  alertsEnabled: true,
  preTrackingStatus: { isPreTracking: false, dateOpened: null },
};

// Mock SOL position with leverage
const solPositionDetails: PositionDetails = {
  status: PositionStatus.ACTIVE,
  side: TradeSide.LONG,
  timeFrame: TimeFrame.ONE_HOUR,
  dateOpened: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
  dateClosed: null,
  orders: [
    {
      id: "order_sol_1",
      positionId: "pos_sol_1" as any,
      dateOpen: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      averagePrice: 142.5,
      totalCost: 2850, // 20 SOL * $142.5
      status: OrderStatus.FILLED,
      type: OrderType.MARKET,
      purpose: OrderPurpose.ENTRY,
      fee: 2.85,
      feeUnit: "USDT",
      filled: 20,
    },
  ],
  stopLoss: [
    {
      id: "order_sol_sl",
      positionId: "pos_sol_1" as any,
      status: OrderStatus.SUBMITTED,
      type: OrderType.TRIGGER,
      purpose: OrderPurpose.STOP_LOSS,
      trigger: 135.5,
      unit: SizeUnit.PERCENTAGE,
      size: 1.0,
      isTrailing: true,
      trailingDistance: 5,
      trailingUnit: "percentage",
    },
  ],
  takeProfit: [
    {
      id: "order_sol_tp1",
      positionId: "pos_sol_1" as any,
      status: OrderStatus.SUBMITTED,
      type: OrderType.LIMIT,
      purpose: OrderPurpose.TAKE_PROFIT,
      trigger: 155,
      unit: SizeUnit.PERCENTAGE,
      size: 0.5,
      targetPercentage: 8.77,
      tier: 1,
    },
    {
      id: "order_sol_tp2",
      positionId: "pos_sol_1" as any,
      status: OrderStatus.SUBMITTED,
      type: OrderType.LIMIT,
      purpose: OrderPurpose.TAKE_PROFIT,
      trigger: 165,
      unit: SizeUnit.PERCENTAGE,
      size: 0.5,
      targetPercentage: 15.79,
      tier: 2,
    },
  ],
  averageEntryPrice: 142.5,
  totalSize: 20,
  totalCost: 2850,
  realizedProfitLoss: 0,
  isLeveraged: true,
  leverage: 3,
  unrealizedProfitLoss: -78, // (138.6 - 142.5) * 20
  currentReturn: -2.74, // -78 / 2850 * 100
  targetPrice: 155,
  stopPrice: 135.5,
  riskRewardRatio: 1.79,
};

// Mock SOL thesis
const solThesis: Thesis = {
  reasoning:
    "Solana has been showing strength in the L1 space with growing adoption and transaction volumes. Looking for a short-term bounce after recent pullback.",
  invalidation:
    "Break below $135 would invalidate this trade idea. Also watching for broader market sentiment shifts.",
  fulfillment:
    "First target at $155 represents recent resistance. Second target at $165 aligns with the local high from last month.",
  technicalAnalysis:
    "Price has pulled back to the 50 EMA on the hourly chart, which has been a reliable support level during this uptrend. RSI showing oversold conditions.",
  fundamentalAnalysis:
    "Growing developer activity and increased TVL. Project releases and partnership announcements expected in coming weeks.",
  timeHorizon: "3-5 days",
  riskRewardRatio: "1.8:1",
};

// Mock SOL Position
export const mockSolPosition: Position = {
  id: "pos_sol_1",
  name: "SOL Leveraged Bounce",
  riskLevel: 8,
  portfolioId: "portfolio_1" as any,
  walletType: WalletType.HOT,
  capitalTier: CapitalTier.C2,
  strategy: "Oversold bounce",
  lifecycle: PositionLifecycle.ACTIVE,
  thesis: solThesis,
  journal: [
    {
      id: "journal_sol_1",
      positionId: "pos_sol_1",
      thought:
        "Entered SOL with 3x leverage after seeing it pull back to the 50 EMA. This has been a reliable support level during the current uptrend. Using tight stop loss due to the leverage.",
      timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      userId: "user_1",
      sentiment: "bullish",
    },
  ],
  asset: mockSolanaAsset,
  positionDetails: solPositionDetails,
  tags: ["solana", "leverage", "short-term"],
  userId: "user_1",
  dateCreated: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
  dateUpdated: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
  currentValue: 2772, // 20 SOL * $138.6
  alertsEnabled: true,
  preTrackingStatus: { isPreTracking: false, dateOpened: null },
};

// Component props with mock data
export const mockPositionDetailsProps: PositionDetailsComponentProps = {
  position: mockBtcPosition,
  relatedPortfolioName: "Main Portfolio",
  onEditPosition: () => console.log("Edit position triggered"),
  onAddJournalEntry: () => console.log("Add journal entry triggered"),
  onEditThesis: () => console.log("Edit thesis triggered"),
  onClosePosition: () => console.log("Close position triggered"),
  onRefreshData: () => console.log("Refresh data triggered"),
  onBackToPortfolio: () => console.log("Back to portfolio triggered"),
};

// Props with ETH position
export const mockEthPositionProps: PositionDetailsComponentProps = {
  ...mockPositionDetailsProps,
  position: mockEthPosition,
};

// Props with SOL position
export const mockSolPositionProps: PositionDetailsComponentProps = {
  ...mockPositionDetailsProps,
  position: mockSolPosition,
};

// Loading state
export const loadingPositionDetails: PositionDetailsComponentProps = {
  ...mockPositionDetailsProps,
  isLoading: true,
};
