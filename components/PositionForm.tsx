"use client";
import { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  Position,
  WalletType,
  PositionStatus,
  OrderType,
  OrderStatus,
  SizeUnit,
  Order,
  StopLossOrder,
  TakeProfitOrder,
} from "../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { PositionConfirmation } from "./PositionConfirmation";

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
  const [focusedInputs, setFocusedInputs] = useState<Set<string>>(new Set());
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
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

  const [showConfirmation, setShowConfirmation] = useState(false);

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
      setShowConfirmation(true);
    }
  };

  const handleConfirm = async () => {
    try {
      const response = await fetch("/api/positions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error("Failed to save position");
      }

      const result = await response.json();
      if (result.success) {
        onSubmit(formData as Position);
        setShowConfirmation(false);
      } else {
        throw new Error(result.error || "Failed to save position");
      }
    } catch (error) {
      console.error("Error saving position:", error);
      // You might want to show an error toast or message here
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
    <>
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
              <div className="grid grid-cols-1 gap-4">
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
                    <p className="text-sm text-red-500">
                      {errors["asset.name"]}
                    </p>
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
                    <p className="text-sm text-red-500">
                      {errors["asset.pair"]}
                    </p>
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
                      className={
                        errors["asset.location"] ? "border-red-500" : ""
                      }
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
              <div className="grid grid-cols-3 gap-4">
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

              <div className="space-y-2">
                <Label htmlFor="positionDetails.dateOpened">Date Opened</Label>
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Input
                      id="positionDetails.dateOpened"
                      name="positionDetails.dateOpened"
                      type="datetime-local"
                      value={
                        formData.positionDetails?.dateOpened &&
                        formData.positionDetails.dateOpened !== "genesis"
                          ? new Date(
                              formData.positionDetails.dateOpened as
                                | string
                                | Date
                            )
                              .toISOString()
                              .slice(0, 16)
                          : ""
                      }
                      onChange={e => {
                        const date = e.target.value
                          ? new Date(e.target.value)
                          : undefined;
                        setFormData(prev => ({
                          ...prev,
                          positionDetails: {
                            ...prev.positionDetails!,
                            dateOpened: date,
                          },
                        }));
                      }}
                      disabled={
                        formData.positionDetails?.dateOpened === "genesis"
                      }
                      aria-describedby="dateOpened-description"
                      className={cn(
                        errors["positionDetails.dateOpened"]
                          ? "border-red-500"
                          : "",
                        formData.positionDetails?.dateOpened === "genesis"
                          ? "opacity-50 cursor-not-allowed bg-muted"
                          : ""
                      )}
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="isGenesis"
                      checked={
                        formData.positionDetails?.dateOpened === "genesis"
                      }
                      onCheckedChange={(checked: boolean) => {
                        setFormData(prev => ({
                          ...prev,
                          positionDetails: {
                            ...prev.positionDetails!,
                            dateOpened: checked ? "genesis" : undefined,
                          },
                        }));
                      }}
                      aria-describedby="isGenesis-description"
                    />
                    <div className="grid gap-1.5 leading-none">
                      <Label
                        htmlFor="isGenesis"
                        className="text-sm font-normal leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        I don't know when this position was opened
                      </Label>
                      <p
                        id="isGenesis-description"
                        className="text-sm text-muted-foreground"
                      >
                        Select this if you can't remember or don't know the
                        exact date
                      </p>
                    </div>
                  </div>
                  <p
                    id="dateOpened-description"
                    className="text-sm text-muted-foreground"
                  >
                    {formData.positionDetails?.dateOpened === "genesis"
                      ? "Date is set to genesis (unknown)"
                      : "Select the date when this position was opened"}
                  </p>
                </div>
                {errors["positionDetails.dateOpened"] && (
                  <p className="text-sm text-red-500" role="alert">
                    {errors["positionDetails.dateOpened"]}
                  </p>
                )}
              </div>
            </div>

            {/* Orders Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Entry Orders</h3>
              <div className="space-y-4">
                {formData.positionDetails?.orders.map((order, index) => (
                  <div
                    key={order.id}
                    className="p-4 border rounded-lg space-y-4"
                  >
                    <div className="flex justify-between items-center">
                      <h4 className="font-medium">Order {index + 1}</h4>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          setFormData(prev => ({
                            ...prev,
                            positionDetails: {
                              ...prev.positionDetails!,
                              orders: prev.positionDetails!.orders.filter(
                                o => o.id !== order.id
                              ),
                            },
                          }));
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Type</Label>
                        <Select
                          value={order.type}
                          onValueChange={(value: OrderType) => {
                            const newOrders = [
                              ...(formData.positionDetails?.orders || []),
                            ];
                            newOrders[index] = { ...order, type: value };
                            setFormData(prev => ({
                              ...prev,
                              positionDetails: {
                                ...prev.positionDetails!,
                                orders: newOrders,
                              },
                            }));
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="market">Market</SelectItem>
                            <SelectItem value="limit">Limit</SelectItem>
                            <SelectItem value="trigger">Trigger</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Status</Label>
                        <Select
                          value={order.status}
                          onValueChange={(value: OrderStatus) => {
                            const newOrders = [
                              ...(formData.positionDetails?.orders || []),
                            ];
                            newOrders[index] = { ...order, status: value };
                            setFormData(prev => ({
                              ...prev,
                              positionDetails: {
                                ...prev.positionDetails!,
                                orders: newOrders,
                              },
                            }));
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="submitted">Submitted</SelectItem>
                            <SelectItem value="filled">Filled</SelectItem>
                            <SelectItem value="cancelled">Cancelled</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Price</Label>
                        <Input
                          type="number"
                          value={order.averagePrice || ""}
                          onChange={e => {
                            const newOrders = [
                              ...(formData.positionDetails?.orders || []),
                            ];
                            newOrders[index] = {
                              ...order,
                              averagePrice: parseFloat(e.target.value),
                            };
                            setFormData(prev => ({
                              ...prev,
                              positionDetails: {
                                ...prev.positionDetails!,
                                orders: newOrders,
                              },
                            }));
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Amount</Label>
                        <div className="space-y-1">
                          <div className="flex gap-2">
                            <Input
                              type="text"
                              value={
                                inputValues[`order-${order.id}`] ||
                                order.filled ||
                                ""
                              }
                              onChange={e => {
                                const value = e.target.value;
                                setInputValues(prev => ({
                                  ...prev,
                                  [`order-${order.id}`]: value,
                                }));
                              }}
                              onFocus={() => {
                                setFocusedInputs(prev =>
                                  new Set(prev).add(`order-${order.id}`)
                                );
                              }}
                              onBlur={e => {
                                const value = e.target.value;
                                if (value === "") {
                                  const newOrders = [
                                    ...(formData.positionDetails?.orders || []),
                                  ];
                                  newOrders[index] = {
                                    ...order,
                                    filled: undefined,
                                  };
                                  setFormData(prev => ({
                                    ...prev,
                                    positionDetails: {
                                      ...prev.positionDetails!,
                                      orders: newOrders,
                                    },
                                  }));
                                } else {
                                  const numValue = parseFloat(value);
                                  if (!isNaN(numValue)) {
                                    const newOrders = [
                                      ...(formData.positionDetails?.orders ||
                                        []),
                                    ];
                                    newOrders[index] = {
                                      ...order,
                                      filled: numValue,
                                    };
                                    setFormData(prev => ({
                                      ...prev,
                                      positionDetails: {
                                        ...prev.positionDetails!,
                                        orders: newOrders,
                                      },
                                    }));
                                  }
                                }
                                setFocusedInputs(prev => {
                                  const newSet = new Set(prev);
                                  newSet.delete(`order-${order.id}`);
                                  return newSet;
                                });
                              }}
                              className="flex-1"
                            />
                            <Select
                              value={order.unit || "base"}
                              onValueChange={(value: SizeUnit) => {
                                const newOrders = [
                                  ...(formData.positionDetails?.orders || []),
                                ];
                                newOrders[index] = { ...order, unit: value };
                                setFormData(prev => ({
                                  ...prev,
                                  positionDetails: {
                                    ...prev.positionDetails!,
                                    orders: newOrders,
                                  },
                                }));
                              }}
                            >
                              <SelectTrigger className="w-[120px]">
                                <SelectValue placeholder="Select unit" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="base">Base</SelectItem>
                                <SelectItem value="quote">Quote</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {order.averagePrice &&
                            order.filled &&
                            !focusedInputs.has(`order-${order.id}`) && (
                              <p className="text-sm text-muted-foreground mt-2 text-left">
                                {order.unit === "base"
                                  ? `≈ ${(
                                      order.filled * order.averagePrice
                                    ).toFixed(2)} ${
                                      formData.asset?.pair.split("/")[1]
                                    }`
                                  : `≈ ${(
                                      order.filled / order.averagePrice
                                    ).toFixed(8)} ${
                                      formData.asset?.pair.split("/")[0]
                                    }`}
                              </p>
                            )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const newOrder: Order = {
                      id: uuidv4(),
                      type: "market",
                      status: "submitted",
                      unit: "base",
                    };
                    setFormData(prev => ({
                      ...prev,
                      positionDetails: {
                        ...prev.positionDetails!,
                        orders: [
                          ...(prev.positionDetails?.orders || []),
                          newOrder,
                        ],
                      },
                    }));
                  }}
                >
                  Add Entry Order
                </Button>
              </div>
            </div>

            {/* Stop Loss Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Stop Loss Orders</h3>
              <div className="space-y-4">
                {formData.positionDetails?.stopLoss?.map((order, index) => (
                  <div
                    key={order.id}
                    className="p-4 border rounded-lg space-y-4"
                  >
                    <div className="flex justify-between items-center">
                      <h4 className="font-medium">Stop Loss {index + 1}</h4>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          setFormData(prev => ({
                            ...prev,
                            positionDetails: {
                              ...prev.positionDetails!,
                              stopLoss: prev.positionDetails!.stopLoss?.filter(
                                o => o.id !== order.id
                              ),
                            },
                          }));
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Type</Label>
                        <Select
                          value={order.type}
                          onValueChange={(value: OrderType) => {
                            const newOrders = [
                              ...(formData.positionDetails?.stopLoss || []),
                            ];
                            newOrders[index] = { ...order, type: value };
                            setFormData(prev => ({
                              ...prev,
                              positionDetails: {
                                ...prev.positionDetails!,
                                stopLoss: newOrders,
                              },
                            }));
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="trigger">Trigger</SelectItem>
                            <SelectItem value="limit">Limit</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Status</Label>
                        <Select
                          value={order.status}
                          onValueChange={(value: OrderStatus) => {
                            const newOrders = [
                              ...(formData.positionDetails?.stopLoss || []),
                            ];
                            newOrders[index] = { ...order, status: value };
                            setFormData(prev => ({
                              ...prev,
                              positionDetails: {
                                ...prev.positionDetails!,
                                stopLoss: newOrders,
                              },
                            }));
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="submitted">Submitted</SelectItem>
                            <SelectItem value="filled">Filled</SelectItem>
                            <SelectItem value="cancelled">Cancelled</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>Price</Label>
                        <Input
                          type="number"
                          value={order.trigger || ""}
                          onChange={e => {
                            const newOrders = [
                              ...(formData.positionDetails?.stopLoss || []),
                            ];
                            newOrders[index] = {
                              ...order,
                              trigger: parseFloat(e.target.value),
                            };
                            setFormData(prev => ({
                              ...prev,
                              positionDetails: {
                                ...prev.positionDetails!,
                                stopLoss: newOrders,
                              },
                            }));
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Size</Label>
                        <Input
                          type="text"
                          value={
                            inputValues[`stopLoss-${order.id}`] ||
                            order.size ||
                            ""
                          }
                          onChange={e => {
                            const value = e.target.value;
                            setInputValues(prev => ({
                              ...prev,
                              [`stopLoss-${order.id}`]: value,
                            }));
                          }}
                          onFocus={() => {
                            setFocusedInputs(prev =>
                              new Set(prev).add(`stopLoss-${order.id}`)
                            );
                          }}
                          onBlur={e => {
                            const value = e.target.value;
                            if (value === "") {
                              const newOrders = [
                                ...(formData.positionDetails?.stopLoss || []),
                              ];
                              newOrders[index] = {
                                ...order,
                                size: 0,
                              };
                              setFormData(prev => ({
                                ...prev,
                                positionDetails: {
                                  ...prev.positionDetails!,
                                  stopLoss: newOrders,
                                },
                              }));
                            } else {
                              const numValue = parseFloat(value);
                              if (!isNaN(numValue)) {
                                const newOrders = [
                                  ...(formData.positionDetails?.stopLoss || []),
                                ];
                                newOrders[index] = {
                                  ...order,
                                  size: numValue,
                                };
                                setFormData(prev => ({
                                  ...prev,
                                  positionDetails: {
                                    ...prev.positionDetails!,
                                    stopLoss: newOrders,
                                  },
                                }));
                              }
                            }
                            setFocusedInputs(prev => {
                              const newSet = new Set(prev);
                              newSet.delete(`stopLoss-${order.id}`);
                              return newSet;
                            });
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Unit</Label>
                        <Select
                          value={order.unit}
                          onValueChange={(value: SizeUnit) => {
                            const newOrders = [
                              ...(formData.positionDetails?.stopLoss || []),
                            ];
                            newOrders[index] = { ...order, unit: value };
                            setFormData(prev => ({
                              ...prev,
                              positionDetails: {
                                ...prev.positionDetails!,
                                stopLoss: newOrders,
                              },
                            }));
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select unit" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="percentage">
                              Percentage
                            </SelectItem>
                            <SelectItem value="base">Base</SelectItem>
                            <SelectItem value="quote">Quote</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const newOrder: StopLossOrder = {
                      id: uuidv4(),
                      type: "trigger",
                      status: "submitted",
                      unit: "percentage",
                      size: 0,
                    };
                    setFormData(prev => ({
                      ...prev,
                      positionDetails: {
                        ...prev.positionDetails!,
                        stopLoss: [
                          ...(prev.positionDetails?.stopLoss || []),
                          newOrder,
                        ],
                      },
                    }));
                  }}
                >
                  Add Stop Loss
                </Button>
              </div>
            </div>

            {/* Take Profit Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Take Profit Orders</h3>
              <div className="space-y-4">
                {formData.positionDetails?.takeProfit?.map((order, index) => (
                  <div
                    key={order.id}
                    className="p-4 border rounded-lg space-y-4"
                  >
                    <div className="flex justify-between items-center">
                      <h4 className="font-medium">Take Profit {index + 1}</h4>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          setFormData(prev => ({
                            ...prev,
                            positionDetails: {
                              ...prev.positionDetails!,
                              takeProfit:
                                prev.positionDetails!.takeProfit?.filter(
                                  o => o.id !== order.id
                                ),
                            },
                          }));
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Type</Label>
                        <Select
                          value={order.type}
                          onValueChange={(value: OrderType) => {
                            const newOrders = [
                              ...(formData.positionDetails?.takeProfit || []),
                            ];
                            newOrders[index] = { ...order, type: value };
                            setFormData(prev => ({
                              ...prev,
                              positionDetails: {
                                ...prev.positionDetails!,
                                takeProfit: newOrders,
                              },
                            }));
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="trigger">Trigger</SelectItem>
                            <SelectItem value="limit">Limit</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Status</Label>
                        <Select
                          value={order.status}
                          onValueChange={(value: OrderStatus) => {
                            const newOrders = [
                              ...(formData.positionDetails?.takeProfit || []),
                            ];
                            newOrders[index] = { ...order, status: value };
                            setFormData(prev => ({
                              ...prev,
                              positionDetails: {
                                ...prev.positionDetails!,
                                takeProfit: newOrders,
                              },
                            }));
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="submitted">Submitted</SelectItem>
                            <SelectItem value="filled">Filled</SelectItem>
                            <SelectItem value="cancelled">Cancelled</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>Price</Label>
                        <Input
                          type="number"
                          value={order.trigger || ""}
                          onChange={e => {
                            const newOrders = [
                              ...(formData.positionDetails?.takeProfit || []),
                            ];
                            newOrders[index] = {
                              ...order,
                              trigger: parseFloat(e.target.value),
                            };
                            setFormData(prev => ({
                              ...prev,
                              positionDetails: {
                                ...prev.positionDetails!,
                                takeProfit: newOrders,
                              },
                            }));
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Size</Label>
                        <Input
                          type="text"
                          value={
                            inputValues[`takeProfit-${order.id}`] ||
                            order.size ||
                            ""
                          }
                          onChange={e => {
                            const value = e.target.value;
                            setInputValues(prev => ({
                              ...prev,
                              [`takeProfit-${order.id}`]: value,
                            }));
                          }}
                          onFocus={() => {
                            setFocusedInputs(prev =>
                              new Set(prev).add(`takeProfit-${order.id}`)
                            );
                          }}
                          onBlur={e => {
                            const value = e.target.value;
                            if (value === "") {
                              const newOrders = [
                                ...(formData.positionDetails?.takeProfit || []),
                              ];
                              newOrders[index] = {
                                ...order,
                                size: 0,
                              };
                              setFormData(prev => ({
                                ...prev,
                                positionDetails: {
                                  ...prev.positionDetails!,
                                  takeProfit: newOrders,
                                },
                              }));
                            } else {
                              const numValue = parseFloat(value);
                              if (!isNaN(numValue)) {
                                const newOrders = [
                                  ...(formData.positionDetails?.takeProfit ||
                                    []),
                                ];
                                newOrders[index] = {
                                  ...order,
                                  size: numValue,
                                };
                                setFormData(prev => ({
                                  ...prev,
                                  positionDetails: {
                                    ...prev.positionDetails!,
                                    takeProfit: newOrders,
                                  },
                                }));
                              }
                            }
                            setFocusedInputs(prev => {
                              const newSet = new Set(prev);
                              newSet.delete(`takeProfit-${order.id}`);
                              return newSet;
                            });
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Unit</Label>
                        <Select
                          value={order.unit}
                          onValueChange={(value: SizeUnit) => {
                            const newOrders = [
                              ...(formData.positionDetails?.takeProfit || []),
                            ];
                            newOrders[index] = { ...order, unit: value };
                            setFormData(prev => ({
                              ...prev,
                              positionDetails: {
                                ...prev.positionDetails!,
                                takeProfit: newOrders,
                              },
                            }));
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select unit" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="percentage">
                              Percentage
                            </SelectItem>
                            <SelectItem value="base">Base</SelectItem>
                            <SelectItem value="quote">Quote</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const newOrder: TakeProfitOrder = {
                      id: uuidv4(),
                      type: "trigger",
                      status: "submitted",
                      unit: "percentage",
                      size: 0,
                    };
                    setFormData(prev => ({
                      ...prev,
                      positionDetails: {
                        ...prev.positionDetails!,
                        takeProfit: [
                          ...(prev.positionDetails?.takeProfit || []),
                          newOrder,
                        ],
                      },
                    }));
                  }}
                >
                  Add Take Profit
                </Button>
              </div>
            </div>

            <Button type="submit" className="w-full">
              Add Position
            </Button>
          </form>
        </CardContent>
      </Card>

      <PositionConfirmation
        position={formData as Position}
        isOpen={showConfirmation}
        onClose={() => setShowConfirmation(false)}
        onConfirm={handleConfirm}
      />
    </>
  );
};
