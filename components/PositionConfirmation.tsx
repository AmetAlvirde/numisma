import { Position, Order, StopLossOrder, TakeProfitOrder } from "../types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ScrollArea } from "./ui/scroll-area";

interface PositionConfirmationProps {
  position: Position;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function PositionConfirmation({
  position,
  isOpen,
  onClose,
  onConfirm,
}: PositionConfirmationProps) {
  const formatDate = (date: Date | "genesis" | undefined) => {
    if (date === "genesis") return "Genesis (Unknown)";
    if (!date) return "Not set";
    return new Date(date).toLocaleString();
  };
  const formatOrder = (order: Order | StopLossOrder | TakeProfitOrder) => {
    const size = "size" in order ? order.size : order.filled;
    const unit = order.unit || "base";
    const price = order.averagePrice || order.trigger;
    const quote = position.asset.pair.split("/")[1];
    const base = position.asset.pair.split("/")[0];

    let sizeDisplay = "";
    if (unit === "percentage") {
      sizeDisplay = `${size}%`;
    } else if (unit === "base") {
      sizeDisplay = `${size} ${base}`;
    } else {
      sizeDisplay = `${size} ${quote}`;
    }

    return {
      type: order.type,
      status: order.status,
      price: price ? `${price} ${quote}` : "Market",
      size: sizeDisplay,
    };
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Confirm Position Details</DialogTitle>
          <DialogDescription>
            Please review the position details before confirming
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-6">
            {/* Basic Information */}
            <Card>
              <CardHeader>
                <CardTitle>Basic Information</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Position Name
                  </p>
                  <p>{position.name}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Risk Level
                  </p>
                  <p>{position.riskLevel}/10</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Portfolio
                  </p>
                  <p>{position.portfolio}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Wallet Type
                  </p>
                  <p>{position.walletType}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Seed Capital Tier
                  </p>
                  <p>{position.seedCapitalTier}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Strategy
                  </p>
                  <p>{position.strategy}</p>
                </div>
              </CardContent>
            </Card>

            {/* Asset Information */}
            <Card>
              <CardHeader>
                <CardTitle>Asset Information</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Asset Name
                  </p>
                  <p>{position.asset.name}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Ticker
                  </p>
                  <p>{position.asset.ticker}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Trading Pair
                  </p>
                  <p>{position.asset.pair}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Location
                  </p>
                  <p>{position.asset.location}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Exchange
                  </p>
                  <p>{position.asset.exchange}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Wallet
                  </p>
                  <p>{position.asset.wallet}</p>
                </div>
              </CardContent>
            </Card>

            {/* Position Details */}
            <Card>
              <CardHeader>
                <CardTitle>Position Details</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Status
                  </p>
                  <p>{position.positionDetails.status}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Side
                  </p>
                  <p>{position.positionDetails.side}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Time Frame
                  </p>
                  <p>{position.positionDetails.fractal}</p>
                </div>
                <div className="col-span-3">
                  <p className="text-sm font-medium text-muted-foreground">
                    Date Opened
                  </p>
                  <p>
                    {position.positionDetails.dateOpened === "genesis"
                      ? "genesis"
                      : formatDate(position.positionDetails.dateOpened as Date)}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Entry Orders */}
            {position.positionDetails.orders.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Entry Orders</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {position.positionDetails.orders.map((order, index) => {
                      const formatted = formatOrder(order);
                      return (
                        <div
                          key={order.id}
                          className="grid grid-cols-4 gap-4 p-4 border rounded-lg"
                        >
                          <div>
                            <p className="text-sm font-medium text-muted-foreground">
                              Order {index + 1}
                            </p>
                            <p>{formatted.type}</p>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-muted-foreground">
                              Status
                            </p>
                            <p>{formatted.status}</p>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-muted-foreground">
                              Price
                            </p>
                            <p>{formatted.price}</p>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-muted-foreground">
                              Size
                            </p>
                            <p>{formatted.size}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Stop Loss Orders */}
            {position.positionDetails?.stopLoss &&
              position.positionDetails.stopLoss.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Stop Loss Orders</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {position.positionDetails.stopLoss.map((order, index) => {
                        const formatted = formatOrder(order);
                        return (
                          <div
                            key={order.id}
                            className="grid grid-cols-4 gap-4 p-4 border rounded-lg"
                          >
                            <div>
                              <p className="text-sm font-medium text-muted-foreground">
                                Stop Loss {index + 1}
                              </p>
                              <p>{formatted.type}</p>
                            </div>
                            <div>
                              <p className="text-sm font-medium text-muted-foreground">
                                Status
                              </p>
                              <p>{formatted.status}</p>
                            </div>
                            <div>
                              <p className="text-sm font-medium text-muted-foreground">
                                Price
                              </p>
                              <p>{formatted.price}</p>
                            </div>
                            <div>
                              <p className="text-sm font-medium text-muted-foreground">
                                Size
                              </p>
                              <p>{formatted.size}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

            {/* Take Profit Orders */}
            {position.positionDetails?.takeProfit &&
              position.positionDetails.takeProfit.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Take Profit Orders</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {position.positionDetails.takeProfit.map(
                        (order, index) => {
                          const formatted = formatOrder(order);
                          return (
                            <div
                              key={order.id}
                              className="grid grid-cols-4 gap-4 p-4 border rounded-lg"
                            >
                              <div>
                                <p className="text-sm font-medium text-muted-foreground">
                                  Take Profit {index + 1}
                                </p>
                                <p>{formatted.type}</p>
                              </div>
                              <div>
                                <p className="text-sm font-medium text-muted-foreground">
                                  Status
                                </p>
                                <p>{formatted.status}</p>
                              </div>
                              <div>
                                <p className="text-sm font-medium text-muted-foreground">
                                  Price
                                </p>
                                <p>{formatted.price}</p>
                              </div>
                              <div>
                                <p className="text-sm font-medium text-muted-foreground">
                                  Size
                                </p>
                                <p>{formatted.size}</p>
                              </div>
                            </div>
                          );
                        }
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Confirm Position</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
