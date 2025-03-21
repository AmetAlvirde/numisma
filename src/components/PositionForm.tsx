import { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { Position, WalletType, PositionStatus } from "../types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Combobox } from "./ui/combobox";

interface PositionFormProps {
  onSubmit: (position: Position) => void;
}

// Initial options for comboboxes
const PORTFOLIO_OPTIONS = ["Cycle", "Swing", "Short term", "Scalp"];
const SEED_CAPITAL_TIER_OPTIONS = ["C1", "C2", "C3", "C4", "C5"];
const ASSET_NAME_OPTIONS = ["Bitcoin", "Ethereum"];
const TICKER_OPTIONS = ["BTC", "ETH"];
const TRADING_PAIR_OPTIONS = ["BTC/USDT", "ETH/USDT"];
const EXCHANGE_OPTIONS = ["BingX", "Bitget", "Binance", "Bitso"];
const WALLET_OPTIONS = ["Spot", "Futures"];
const TIMEFRAME_OPTIONS = ["1W", "1D", "4H", "1H", "15", "5"];

export const PositionForm: React.FC<PositionFormProps> = ({ onSubmit }) => {
  const [formData, setFormData] = useState<Partial<Position>>({
    id: uuidv4(),
    positionDetails: {
      status: "active",
      side: "buy",
      fractal: "",
      orders: [],
      stopLoss: [],
      takeProfit: [],
    },
    asset: {
      name: "",
      ticker: "",
      pair: "",
      location: "exchange",
      exchange: "",
      wallet: "",
    },
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [options, setOptions] = useState({
    portfolio: PORTFOLIO_OPTIONS,
    seedCapitalTier: SEED_CAPITAL_TIER_OPTIONS,
    assetName: ASSET_NAME_OPTIONS,
    ticker: TICKER_OPTIONS,
    tradingPair: TRADING_PAIR_OPTIONS,
    exchange: EXCHANGE_OPTIONS,
    wallet: WALLET_OPTIONS,
    timeframe: TIMEFRAME_OPTIONS,
  });

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Basic Information Validation
    if (!formData.name?.trim()) {
      newErrors.name = "Position Name is required";
    }
    if (
      !formData.riskLevel ||
      formData.riskLevel < 1 ||
      formData.riskLevel > 10
    ) {
      newErrors.riskLevel = "Risk Level must be between 1 and 10";
    }
    if (!formData.portfolio?.trim()) {
      newErrors.portfolio = "Portfolio is required";
    }
    if (!formData.walletType) {
      newErrors.walletType = "Wallet Type is required";
    }
    if (!formData.seedCapitalTier?.trim()) {
      newErrors.seedCapitalTier = "Seed Capital Tier is required";
    }
    if (!formData.strategy?.trim()) {
      newErrors.strategy = "Strategy is required";
    }

    // Asset Information Validation
    if (!formData.asset?.name?.trim()) {
      newErrors["asset.name"] = "Asset Name is required";
    }
    if (!formData.asset?.ticker?.trim()) {
      newErrors["asset.ticker"] = "Ticker is required";
    }
    if (!formData.asset?.pair?.trim()) {
      newErrors["asset.pair"] = "Trading Pair is required";
    }
    if (!formData.asset?.location) {
      newErrors["asset.location"] = "Location is required";
    }
    if (!formData.asset?.wallet?.trim()) {
      newErrors["asset.wallet"] = "Wallet is required";
    }

    // Position Details Validation
    if (!formData.positionDetails?.status) {
      newErrors["positionDetails.status"] = "Status is required";
    }
    if (!formData.positionDetails?.side) {
      newErrors["positionDetails.side"] = "Side is required";
    }
    if (!formData.positionDetails?.fractal?.trim()) {
      newErrors["positionDetails.fractal"] = "Time Frame is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      onSubmit(formData as Position);
    }
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: "" }));
    }
  };

  const handleAddOption = (field: keyof typeof options, value: string) => {
    setOptions(prev => ({
      ...prev,
      [field]: [...prev[field], value],
    }));
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Add New Position</CardTitle>
        <CardDescription>
          Fill in the details for your new trading position
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Basic Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="id">Position ID</Label>
                <Input
                  id="id"
                  name="id"
                  value={formData.id || ""}
                  disabled
                  className="bg-gray-100"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Position Name</Label>
                <Input
                  id="name"
                  name="name"
                  value={formData.name || ""}
                  onChange={handleInputChange}
                  required
                  className={errors.name ? "border-red-500" : ""}
                />
                {errors.name && (
                  <p className="text-sm text-red-500">{errors.name}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="riskLevel">Risk Level (1-10)</Label>
                <Input
                  id="riskLevel"
                  name="riskLevel"
                  type="number"
                  min="1"
                  max="10"
                  value={formData.riskLevel || ""}
                  onChange={handleInputChange}
                  required
                  className={errors.riskLevel ? "border-red-500" : ""}
                />
                {errors.riskLevel && (
                  <p className="text-sm text-red-500">{errors.riskLevel}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="portfolio">Portfolio</Label>
                <Combobox
                  options={options.portfolio}
                  value={formData.portfolio || ""}
                  onValueChange={value =>
                    setFormData(prev => ({ ...prev, portfolio: value }))
                  }
                  onAddOption={value => handleAddOption("portfolio", value)}
                  error={!!errors.portfolio}
                />
                {errors.portfolio && (
                  <p className="text-sm text-red-500">{errors.portfolio}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="walletType">Wallet Type</Label>
                <Select
                  value={formData.walletType}
                  onValueChange={(value: WalletType) =>
                    setFormData(prev => ({ ...prev, walletType: value }))
                  }
                >
                  <SelectTrigger
                    className={errors.walletType ? "border-red-500" : ""}
                  >
                    <SelectValue placeholder="Select wallet type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hot">Hot Wallet</SelectItem>
                    <SelectItem value="cold">Cold Wallet</SelectItem>
                  </SelectContent>
                </Select>
                {errors.walletType && (
                  <p className="text-sm text-red-500">{errors.walletType}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="seedCapitalTier">Seed Capital Tier</Label>
                <Combobox
                  options={options.seedCapitalTier}
                  value={formData.seedCapitalTier || ""}
                  onValueChange={value =>
                    setFormData(prev => ({ ...prev, seedCapitalTier: value }))
                  }
                  onAddOption={value =>
                    handleAddOption("seedCapitalTier", value)
                  }
                  error={!!errors.seedCapitalTier}
                />
                {errors.seedCapitalTier && (
                  <p className="text-sm text-red-500">
                    {errors.seedCapitalTier}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="strategy">Strategy</Label>
              <Input
                id="strategy"
                name="strategy"
                value={formData.strategy || ""}
                onChange={handleInputChange}
                required
                className={errors.strategy ? "border-red-500" : ""}
              />
              {errors.strategy && (
                <p className="text-sm text-red-500">{errors.strategy}</p>
              )}
            </div>
          </div>

          {/* Asset Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Asset Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="asset.name">Asset Name</Label>
                <Combobox
                  options={options.assetName}
                  value={formData.asset?.name || ""}
                  onValueChange={value =>
                    setFormData(prev => ({
                      ...prev,
                      asset: { ...prev.asset!, name: value },
                    }))
                  }
                  onAddOption={value => handleAddOption("assetName", value)}
                  error={!!errors["asset.name"]}
                />
                {errors["asset.name"] && (
                  <p className="text-sm text-red-500">{errors["asset.name"]}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="asset.ticker">Ticker</Label>
                <Combobox
                  options={options.ticker}
                  value={formData.asset?.ticker || ""}
                  onValueChange={value =>
                    setFormData(prev => ({
                      ...prev,
                      asset: { ...prev.asset!, ticker: value },
                    }))
                  }
                  onAddOption={value => handleAddOption("ticker", value)}
                  error={!!errors["asset.ticker"]}
                />
                {errors["asset.ticker"] && (
                  <p className="text-sm text-red-500">
                    {errors["asset.ticker"]}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="asset.pair">Trading Pair</Label>
                <Combobox
                  options={options.tradingPair}
                  value={formData.asset?.pair || ""}
                  onValueChange={value =>
                    setFormData(prev => ({
                      ...prev,
                      asset: { ...prev.asset!, pair: value },
                    }))
                  }
                  onAddOption={value => handleAddOption("tradingPair", value)}
                  error={!!errors["asset.pair"]}
                />
                {errors["asset.pair"] && (
                  <p className="text-sm text-red-500">{errors["asset.pair"]}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="asset.location">Location</Label>
                <Select
                  value={formData.asset?.location}
                  onValueChange={(value: "exchange" | "ColdStorage") =>
                    setFormData(prev => ({
                      ...prev,
                      asset: {
                        ...prev.asset!,
                        location: value,
                      },
                    }))
                  }
                >
                  <SelectTrigger
                    className={errors["asset.location"] ? "border-red-500" : ""}
                  >
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="exchange">Exchange</SelectItem>
                    <SelectItem value="ColdStorage">Cold Storage</SelectItem>
                  </SelectContent>
                </Select>
                {errors["asset.location"] && (
                  <p className="text-sm text-red-500">
                    {errors["asset.location"]}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="asset.exchange">Exchange</Label>
                <Combobox
                  options={options.exchange}
                  value={formData.asset?.exchange || ""}
                  onValueChange={value =>
                    setFormData(prev => ({
                      ...prev,
                      asset: { ...prev.asset!, exchange: value },
                    }))
                  }
                  onAddOption={value => handleAddOption("exchange", value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="asset.wallet">Wallet</Label>
                <Combobox
                  options={options.wallet}
                  value={formData.asset?.wallet || ""}
                  onValueChange={value =>
                    setFormData(prev => ({
                      ...prev,
                      asset: { ...prev.asset!, wallet: value },
                    }))
                  }
                  onAddOption={value => handleAddOption("wallet", value)}
                  error={!!errors["asset.wallet"]}
                />
                {errors["asset.wallet"] && (
                  <p className="text-sm text-red-500">
                    {errors["asset.wallet"]}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Position Details */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Position Details</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="positionDetails.status">Status</Label>
                <Select
                  value={formData.positionDetails?.status}
                  onValueChange={(value: PositionStatus) =>
                    setFormData(prev => ({
                      ...prev,
                      positionDetails: {
                        ...prev.positionDetails!,
                        status: value,
                      },
                    }))
                  }
                >
                  <SelectTrigger
                    className={
                      errors["positionDetails.status"] ? "border-red-500" : ""
                    }
                  >
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                    <SelectItem value="submitted">Submitted</SelectItem>
                  </SelectContent>
                </Select>
                {errors["positionDetails.status"] && (
                  <p className="text-sm text-red-500">
                    {errors["positionDetails.status"]}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="positionDetails.side">Side</Label>
                <Select
                  value={formData.positionDetails?.side}
                  onValueChange={(value: "buy" | "sell") =>
                    setFormData(prev => ({
                      ...prev,
                      positionDetails: {
                        ...prev.positionDetails!,
                        side: value,
                      },
                    }))
                  }
                >
                  <SelectTrigger
                    className={
                      errors["positionDetails.side"] ? "border-red-500" : ""
                    }
                  >
                    <SelectValue placeholder="Select side" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="buy">Buy</SelectItem>
                    <SelectItem value="sell">Sell</SelectItem>
                  </SelectContent>
                </Select>
                {errors["positionDetails.side"] && (
                  <p className="text-sm text-red-500">
                    {errors["positionDetails.side"]}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="positionDetails.fractal">Time Frame</Label>
              <Combobox
                options={options.timeframe}
                value={formData.positionDetails?.fractal || ""}
                onValueChange={value =>
                  setFormData(prev => ({
                    ...prev,
                    positionDetails: {
                      ...prev.positionDetails!,
                      fractal: value,
                    },
                  }))
                }
                onAddOption={value => handleAddOption("timeframe", value)}
                error={!!errors["positionDetails.fractal"]}
              />
              {errors["positionDetails.fractal"] && (
                <p className="text-sm text-red-500">
                  {errors["positionDetails.fractal"]}
                </p>
              )}
            </div>
          </div>

          <Button type="submit" className="w-full">
            Add Position
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};
