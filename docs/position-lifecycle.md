# Numisma Position Lifecycle Management

## Overview

Position lifecycle management is a core feature of Numisma, providing traders with a structured approach to tracking their investments from planning through closure. The system models the complete journey of a trading position, including lifecycle state transitions, capital tier evolution, and risk management adjustments.

## Lifecycle States

<div class="mermaid">
stateDiagram-v2
    [*] --> Planned: Create new position
    
    Planned --> Building: First order filled
    Planned --> Cancelled: User cancels
    Cancelled --> [*]
    
    Building --> Active: All entries complete
    Building --> Active: User marks as complete
    
    Active --> Active: Adjust SL/TP
    Active --> Active: Take partial profits
    Active --> Closed: All position exited
    
    Closed --> [*]
</div>

### 1. Planned

The "Planned" state represents a position that has been designed but not yet executed.

**Characteristics:**
- Entry orders are created but not filled
- Risk parameters are established
- Trading thesis is documented
- No capital has been deployed

**Transitions:**
- To "Building" when the first order is filled
- To "Cancelled" if the trader decides not to execute the position

### 2. Building

The "Building" state represents a position that is being progressively established.

**Characteristics:**
- At least one entry order has been filled
- Some capital has been deployed
- Additional entry orders may be pending
- Dollar-cost averaging (DCA) may be in progress

**Transitions:**
- To "Active" when all planned entries are complete
- To "Active" when the trader manually marks entry as complete
- To "Closed" if the position is exited during the building phase

### 3. Active

The "Active" state represents a fully established position that is being actively managed.

**Characteristics:**
- All planned entries are complete
- Capital is fully deployed according to the strategy
- Stop-loss and take-profit levels are actively managed
- Capital tier may evolve through partial exits

**Transitions:**
- To "Closed" when the position is fully exited
- Remains "Active" during partial exits

### 4. Closed

The "Closed" state represents a position that has been fully exited.

**Characteristics:**
- All capital has been withdrawn
- Final P&L has been calculated
- Performance metrics are finalized
- Historical analysis is available

**Transitions:**
- Terminal state (no further transitions)

## Capital Tier Evolution

<div class="mermaid">
graph LR
    C1(C1: Initial Investment) -->|Recover Principal| C2(C2: House Money)
    C2 -->|Secure Profits| C3(C3: Risk-Free Growth)
    C3 -->|Additional Profits| C4(C4: Compound Growth)
</div>

### 1. C1: Initial Investment

The C1 tier represents a position funded with fresh capital from external sources.

**Characteristics:**
- Full principal at risk
- Maximum risk level
- No prior profits secured

**Transition:**
- To C2 when principal is recovered through partial exits

### 2. C2: House Money

The C2 tier represents a position where the original principal has been recovered.

**Characteristics:**
- Original principal recovered
- Playing with profits ("house money")
- Reduced psychological risk
- Can afford more ambitious targets

**Transition:**
- To C3 when significant profits are secured beyond principal

### 3. C3: Risk-Free Growth

The C3 tier represents a position where both principal and significant profits have been secured.

**Characteristics:**
- Principal plus substantial profits recovered
- Remaining position is "pure profit"
- Very low psychological risk
- Can use aggressive positioning

**Transition:**
- To C4 when additional compound growth is secured

### 4. C4/C5: Compound Growth

The C4 and C5 tiers represent positions with multiple rounds of profit taking.

**Characteristics:**
- Multiple profit-taking rounds completed
- Represents multi-generation compound growth
- Maximum flexibility for risk-taking
- Optimal psychological position

## Implementation Details

### 1. Lifecycle State Management

```typescript
/**
 * Check if a lifecycle transition is valid
 */
export function isValidTransition(
  from: PositionLifecycle,
  to: PositionLifecycle
): boolean {
  switch (from) {
    case 'planned':
      return ['building', 'cancelled'].includes(to);
    
    case 'building':
      return ['active', 'closed'].includes(to);
    
    case 'active':
      return to === 'closed';
    
    case 'closed':
    case 'cancelled':
      return false;
    
    default:
      return false;
  }
}

/**
 * Transition a position to a new lifecycle state
 */
export function transitionLifecycle(
  position: Position,
  newState: PositionLifecycle,
  userId: string,
  notes?: string,
  relatedOrderIds?: string[]
): Position {
  // Validate the transition
  if (!isValidTransition(position.lifecycle, newState)) {
    throw new Error(`Invalid transition from ${position.lifecycle} to ${newState}`);
  }
  
  // Create transition record
  const transition: LifecycleTransition = {
    from: position.lifecycle,
    to: newState,
    timestamp: new Date(),
    userId,
    notes,
    relatedOrderIds
  };
  
  // Return updated position
  return {
    ...position,
    lifecycle: newState,
    lifecycleHistory: [...position.lifecycleHistory, transition]
  };
}
```

### 2. Order Execution Impact on Lifecycle

```typescript
/**
 * Handle order execution and its impact on position lifecycle
 */
export function handleOrderExecution(
  position: Position,
  order: Order,
  executionDetails: {
    price: number;
    quantity: number;
    timestamp: Date;
  },
  userId: string
): Position {
  // Update the order
  const updatedOrder: Order = {
    ...order,
    status: 'filled',
    dateFilled: executionDetails.timestamp,
    averagePrice: executionDetails.price,
    filled: executionDetails.quantity,
    totalCost: executionDetails.price * executionDetails.quantity
  };
  
  // Find and replace the order in the position
  const updatedOrders = position.positionDetails.orders.map(o => 
    o.id === order.id ? updatedOrder : o
  );
  
  // Update position with the new order
  let updatedPosition: Position = {
    ...position,
    positionDetails: {
      ...position.positionDetails,
      orders: updatedOrders
    }
  };
  
  // Check if this is the first filled order for a planned position
  if (position.lifecycle === 'planned' && !position.positionDetails.orders.some(o => o.status === 'filled')) {
    // Transition to building state
    updatedPosition = transitionLifecycle(
      updatedPosition,
      'building',
      userId,
      'First order filled',
      [order.id]
    );
  }
  
  // Check if all orders are now filled for a building position
  const allEntryOrdersFilled = updatedPosition.positionDetails.orders
    .filter(o => o.purpose === 'entry')
    .every(o => o.status === 'filled' || o.status === 'cancelled');
  
  if (updatedPosition.lifecycle === 'building' && allEntryOrdersFilled) {
    // Transition to active state
    updatedPosition = transitionLifecycle(
      updatedPosition,
      'active',
      userId,
      'All entry orders filled',
      [order.id]
    );
  }
  
  // Handle full position exit
  if (
    (order.purpose === 'exit' || order.purpose === 'stopLoss' || order.purpose === 'takeProfit') &&
    isPositionFullyExited(updatedPosition)
  ) {
    // Transition to closed state
    updatedPosition = transitionLifecycle(
      updatedPosition,
      'closed',
      userId,
      'Position fully exited',
      [order.id]
    );
    
    // Set dateClosed
    updatedPosition.positionDetails.dateClosed = executionDetails.timestamp;
  }
  
  return updatedPosition;
}
```

### 3. Capital Tier Management

```typescript
/**
 * Calculate the appropriate capital tier based on recovered amount
 */
export function calculateCapitalTier(
  initialInvestment: number,
  recoveredAmount: number
): CapitalTier {
  // Calculate recovery ratio
  const recoveryRatio = recoveredAmount / initialInvestment;
  
  if (recoveryRatio >= 3.0) {
    return 'C5';
  } else if (recoveryRatio >= 2.0) {
    return 'C4';
  } else if (recoveryRatio >= 1.5) {
    return 'C3';
  } else if (recoveryRatio >= 1.0) {
    return 'C2';
  } else {
    return 'C1';
  }
}

/**
 * Handle take profit execution and its impact on capital tier
 */
export function handleTakeProfitExecution(
  position: Position,
  order: TakeProfitOrder,
  executionDetails: {
    price: number;
    quantity: number;
    timestamp: Date;
  },
  userId: string
): Position {
  // First, handle the order execution
  let updatedPosition = handleOrderExecution(
    position,
    order,
    executionDetails,
    userId
  );
  
  // Calculate the amount recovered
  const recoveredAmount = executionDetails.price * executionDetails.quantity;
  
  // Update total recovered amount
  const totalRecovered = (updatedPosition.positionDetails.recoveredAmount || 0) + recoveredAmount;
  updatedPosition = {
    ...updatedPosition,
    positionDetails: {
      ...updatedPosition.positionDetails,
      recoveredAmount: totalRecovered,
      currentInvestment: Math.max(0, updatedPosition.positionDetails.initialInvestment - totalRecovered),
      closedPercentage: calculateClosedPercentage(updatedPosition)
    }
  };
  
  // Calculate the new capital tier
  const newCapitalTier = calculateCapitalTier(
    updatedPosition.positionDetails.initialInvestment,
    totalRecovered
  );
  
  // If the capital tier has changed, record the transition
  if (newCapitalTier !== updatedPosition.capitalTier) {
    const capitalTierTransition: CapitalTierTransition = {
      from: updatedPosition.capitalTier,
      to: newCapitalTier,
      timestamp: executionDetails.timestamp,
      amountSecured: recoveredAmount,
      relatedOrderId: order.id,
      notes: `Capital tier upgraded to ${newCapitalTier} after securing ${formatCurrency(recoveredAmount)}`
    };
    
    updatedPosition = {
      ...updatedPosition,
      capitalTier: newCapitalTier,
      capitalTierHistory: [...updatedPosition.capitalTierHistory, capitalTierTransition]
    };
  }
  
  return updatedPosition;
}
```

## Position Lifecycle User Flows

### 1. Creating a Planned Position

<div class="mermaid">
sequenceDiagram
    participant User
    participant UI as Position Form
    participant API as Position API
    participant DB as Database
    
    User->>UI: Open new position form
    UI->>User: Display position form
    
    User->>UI: Enter position details (name, asset, etc.)
    User->>UI: Define entry strategy
    User->>UI: Set stop-loss parameters
    User->>UI: Document trading thesis
    
    User->>UI: Submit position
    UI->>API: Create position request
    API->>DB: Save position with "planned" lifecycle
    DB->>API: Return saved position
    API->>UI: Return success
    UI->>User: Display position details
</div>

```typescript
// Component for creating a planned position
export const CreatePositionForm: React.FC = () => {
  const [formData, setFormData] = useState<CreatePositionData>({
    name: '',
    asset: {
      name: '',
      ticker: '',
      pair: '',
      location: 'exchange'
    },
    riskLevel: 5,
    walletType: 'hot',
    strategy: '',
    positionDetails: {
      side: 'buy',
      fractal: '1D',
      orders: []
    }
  });
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      // Create the position with "planned" lifecycle
      const position = await createPosition({
        ...formData,
        lifecycle: 'planned',
        lifecycleHistory: [
          {
            from: 'planned',
            to: 'planned',
            timestamp: new Date(),
            userId: 'current-user',
            notes: 'Initial position creation'
          }
        ],
        capitalTier: 'C1',
        capitalTierHistory: [
          {
            from: 'C1',
            to: 'C1',
            timestamp: new Date(),
            amountSecured: 0,
            relatedOrderId: 'creation',
            notes: 'Initial capital tier'
          }
        ]
      });
      
      // Navigate to position details
      navigate(`/positions/${position.id}`);
    } catch (error) {
      console.error('Error creating position:', error);
    }
  };
  
  // Render form...
};
```

### 2. Transitioning to Building State

<div class="mermaid">
sequenceDiagram
    participant User
    participant UI as Position Details
    participant API as Order API
    participant Service as Position Service
    participant DB as Database
    
    User->>UI: View planned position
    UI->>User: Display position with entry orders
    
    User->>UI: Click "Execute Order"
    UI->>API: Execute order request
    API->>Service: Process order execution
    
    Service->>Service: Update order status to "filled"
    Service->>Service: Calculate if transition needed
    Service->>Service: Transition to "building" state
    
    Service->>DB: Save updated position
    DB->>Service: Return updated position
    Service->>API: Return success
    API->>UI: Update position display
    UI->>User: Show "Building" status
</div>

```typescript
// Service function for executing an order
export async function executeOrder(
  positionId: string,
  orderId: string,
  executionDetails: {
    price: number;
    quantity: number;
    timestamp?: Date;
  },
  userId: string
): Promise<Position> {
  // Get the position
  const position = await getPosition(positionId);
  if (!position) {
    throw new Error(`Position not found: ${positionId}`);
  }
  
  // Find the order
  const order = position.positionDetails.orders.find(o => o.id === orderId);
  if (!order) {
    throw new Error(`Order not found: ${orderId}`);
  }
  
  // Handle the order execution
  const updatedPosition = handleOrderExecution(
    position,
    order,
    {
      ...executionDetails,
      timestamp: executionDetails.timestamp || new Date()
    },
    userId
  );
  
  // Save the updated position
  return savePosition(updatedPosition);
}
```

### 3. Transitioning to Active State

<div class="mermaid">
sequenceDiagram
    participant User
    participant UI as Position Details
    participant API as Position API
    participant Service as Position Service
    participant DB as Database
    
    User->>UI: View position in building state
    UI->>User: Display position with partial entries
    
    alt All Orders Filled
        Note over Service: System automatically transitions
        Service->>Service: Detect all entry orders filled
        Service->>Service: Transition to "active" state
    else Manual Completion
        User->>UI: Click "Mark Entry Complete"
        UI->>API: Complete entry request
        API->>Service: Process entry completion
        Service->>Service: Transition to "active" state
    end
    
    Service->>DB: Save updated position
    DB->>Service: Return updated position
    Service->>API: Return success
    API->>UI: Update position display
    UI->>User: Show "Active" status
</div>

```typescript
// Service function for manually completing position entry
export async function completePositionEntry(
  positionId: string,
  userId: string,
  notes?: string
): Promise<Position> {
  // Get the position
  const position = await getPosition(positionId);
  if (!position) {
    throw new Error(`Position not found: ${positionId}`);
  }
  
  // Verify position is in building state
  if (position.lifecycle !== 'building') {
    throw new Error(`Cannot complete entry for position in ${position.lifecycle} state`);
  }
  
  // Transition to active state
  const updatedPosition = transitionLifecycle(
    position,
    'active',
    userId,
    notes || 'Entry manually completed by user'
  );
  
  // Save the updated position
  return savePosition(updatedPosition);
}
```

### 4. Capital Tier Evolution Through Partial Exits

<div class="mermaid">
sequenceDiagram
    participant User
    participant UI as Position Details
    participant API as Order API
    participant Service as Position Service
    participant DB as Database
    
    User->>UI: View active position
    UI->>User: Display position with take-profit orders
    
    User->>UI: Click "Execute Take Profit"
    UI->>API: Execute take profit request
    API->>Service: Process take profit execution
    
    Service->>Service: Update take profit order status
    Service->>Service: Calculate recovered amount
    Service->>Service: Update capital tier if needed
    
    Service->>DB: Save updated position
    DB->>Service: Return updated position
    Service->>API: Return success
    API->>UI: Update position display
    UI->>User: Show new capital tier and profit taken
</div>

```typescript
// Service function for executing a take profit order
export async function executeTakeProfit(
  positionId: string,
  takeProfitId: string,
  executionDetails: {
    price: number;
    quantity: number;
    timestamp?: Date;
  },
  userId: string
): Promise<Position> {
  // Get the position
  const position = await getPosition(positionId);
  if (!position) {
    throw new Error(`Position not found: ${positionId}`);
  }
  
  // Find the take profit order
  const takeProfitOrder = position.positionDetails.takeProfit?.find(tp => tp.id === takeProfitId);
  if (!takeProfitOrder) {
    throw new Error(`Take profit order not found: ${takeProfitId}`);
  }
  
  // Handle the take profit execution
  const updatedPosition = handleTakeProfitExecution(
    position,
    takeProfitOrder,
    {
      ...executionDetails,
      timestamp: executionDetails.timestamp || new Date()
    },
    userId
  );
  
  // Save the updated position
  return savePosition(updatedPosition);
}
```

### 5. Closing a Position

<div class="mermaid">
sequenceDiagram
    participant User
    participant UI as Position Details
    participant API as Order API
    participant Service as Position Service
    participant DB as Database
    
    User->>UI: View active position
    UI->>User: Display position with exit options
    
    User->>UI: Click "Close Position"
    UI->>API: Close position request
    API->>Service: Process position closure
    
    Service->>Service: Create exit order for remaining quantity
    Service->>Service: Execute exit order
    Service->>Service: Transition to "closed" state
    Service->>Service: Calculate final metrics
    
    Service->>DB: Save updated position
    DB->>Service: Return updated position
    Service->>API: Return success
    API->>UI: Update position display
    UI->>User: Show position closed with performance summary
</div>

```typescript
// Service function for closing a position
export async function closePosition(
  positionId: string,
  closeDetails: {
    price: number;
    timestamp?: Date;
    notes?: string;
  },
  userId: string
): Promise<Position> {
  // Get the position
  const position = await getPosition(positionId);
  if (!position) {
    throw new Error(`Position not found: ${positionId}`);
  }
  
  // Verify position is not already closed
  if (position.lifecycle === 'closed') {
    throw new Error('Position is already closed');
  }
  
  // Calculate remaining quantity
  const remainingQuantity = calculateRemainingQuantity(position);
  if (remainingQuantity <= 0) {
    throw new Error('Position has no remaining quantity to close');
  }
  
  // Create exit order
  const exitOrder: Order = {
    id: generateId(),
    dateOpen: new Date(),
    dateFilled: closeDetails.timestamp || new Date(),
    averagePrice: closeDetails.price,
    totalCost: closeDetails.price * remainingQuantity,
    status: 'filled',
    type: 'market',
    purpose: 'exit',
    filled: remainingQuantity,
    unit: 'base',
    notes: closeDetails.notes || 'Final position exit'
  };
  
  // Update position with exit order
  let updatedPosition: Position = {
    ...position,
    positionDetails: {
      ...position.positionDetails,
      orders: [...position.positionDetails.orders, exitOrder],
      dateClosed: closeDetails.timestamp || new Date(),
      closedPercentage: 100
    }
  };
  
  // Transition to closed state
  updatedPosition = transitionLifecycle(
    updatedPosition,
    'closed',
    userId,
    closeDetails.notes || 'Position manually closed',
    [exitOrder.id]
  );
  
  // Calculate final metrics
  updatedPosition = calculatePositionMetrics(updatedPosition);
  
  // Save the updated position
  return savePosition(updatedPosition);
}
```

## UI Components for Lifecycle Management

### 1. Lifecycle Status Badge

```tsx
import React from 'react';
import { Badge } from '@/components/ui/badge';

interface LifecycleBadgeProps {
  lifecycle: PositionLifecycle;
  size?: 'sm' | 'md' | 'lg';
}

export const LifecycleBadge: React.FC<LifecycleBadgeProps> = ({
  lifecycle,
  size = 'md'
}) => {
  // Determine badge variant based on lifecycle
  const getVariant = (): ('default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive') => {
    switch (lifecycle) {
      case 'planned':
        return 'secondary';
      case 'building':
        return 'warning';
      case 'active':
        return 'success';
      case 'closed':
        return 'outline';
      case 'cancelled':
        return 'destructive';
      default:
        return 'default';
    }
  };
  
  // Determine size classes
  const sizeClasses = {
    sm: 'text-xs py-0 px-2',
    md: 'text-sm py-0.5 px-2.5',
    lg: 'text-base py-1 px-3'
  }[size];
  
  return (
    <Badge variant={getVariant()} className={sizeClasses}>
      {lifecycle.charAt(0).toUpperCase() + lifecycle.slice(1)}
    </Badge>
  );
};
```

### 2. Capital Tier Indicator

```tsx
import React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface CapitalTierIndicatorProps {
  tier: CapitalTier;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

export const CapitalTierIndicator: React.FC<CapitalTierIndicatorProps> = ({
  tier,
  size = 'md',
  showLabel = true
}) => {
  // Determine color based on tier
  const getColor = (): string => {
    switch (tier) {
      case 'C1':
        return 'bg-red-500 text-white';
      case 'C2':
        return 'bg-yellow-500 text-white';
      case 'C3':
        return 'bg-green-500 text-white';
      case 'C4':
        return 'bg-blue-500 text-white';
      case 'C5':
        return 'bg-purple-500 text-white';
      default:
        return 'bg-gray-500 text-white';
    }
  };
  
  // Determine size classes
  const sizeClasses = {
    sm: 'w-5 h-5 text-xs',
    md: 'w-6 h-6 text-sm',
    lg: 'w-8 h-8 text-base'
  }[size];
  
  // Get description text
  const getDescription = (): string => {
    switch (tier) {
      case 'C1':
        return 'Initial Capital: Full principal at risk';
      case 'C2':
        return 'House Money: Principal recovered, playing with profits';
      case 'C3':
        return 'Risk-Free Growth: Principal + significant profits secured';
      case 'C4':
        return 'Compound Growth: Multiple profit-taking rounds completed';
      case 'C5':
        return 'Advanced Compound Growth: Maximized profit-taking strategy';
      default:
        return '';
    }
  };
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center">
          <div className={`${sizeClasses} ${getColor()} rounded-full flex items-center justify-center font-medium`}>
            {tier.charAt(1)}
          </div>
          {showLabel && (
            <span className="ml-1.5 text-sm text-gray-700">{tier}</span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-sm">{getDescription()}</p>
      </TooltipContent>
    </Tooltip>
  );
};
```

### 3. Lifecycle Transition Control

```tsx
import React from 'react';
import { Button } from '@/components/ui/button';
import { LifecycleBadge } from './LifecycleBadge';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface LifecycleControlProps {
  positionId: string;
  currentState: PositionLifecycle;
  onTransition: (newState: PositionLifecycle, notes: string) => Promise<void>;
  disabled?: boolean;
}

export const LifecycleControl: React.FC<LifecycleControlProps> = ({
  positionId,
  currentState,
  onTransition,
  disabled = false
}) => {
  const [targetState, setTargetState] = React.useState<PositionLifecycle | null>(null);
  const [notes, setNotes] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isOpen, setIsOpen] = React.useState(false);
  
  // Get available transitions based on current state
  const getAvailableTransitions = (): PositionLifecycle[] => {
    switch (currentState) {
      case 'planned':
        return ['building', 'cancelled'];
      case 'building':
        return ['active'];
      case 'active':
        return ['closed'];
      default:
        return [];
    }
  };
  
  // Get display name for a state
  const getDisplayName = (state: PositionLifecycle): string => {
    switch (state) {
      case 'planned':
        return 'Planning';
      case 'building':
        return 'Building Position';
      case 'active':
        return 'Active Management';
      case 'closed':
        return 'Close Position';
      case 'cancelled':
        return 'Cancel Plan';
      default:
        return state;
    }
  };
  
  // Handle transition request
  const handleTransition = async () => {
    if (!targetState) return;
    
    setIsSubmitting(true);
    
    try {
      await onTransition(targetState, notes);
      setIsOpen(false);
      setNotes('');
    } catch (error) {
      console.error('Error transitioning position:', error);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // If no transitions available or disabled, just show the current state
  if (getAvailableTransitions().length === 0 || disabled) {
    return <LifecycleBadge lifecycle={currentState} />;
  }
  
  return (
    <div className="flex items-center space-x-4">
      <LifecycleBadge lifecycle={currentState} />
      
      {getAvailableTransitions().map(state => (
        <Dialog key={state} open={isOpen && targetState === state} onOpenChange={(open) => {
          setIsOpen(open);
          if (!open) setTargetState(null);
        }}>
          <DialogTrigger asChild>
            <Button
              variant={state === 'cancelled' ? 'destructive' : 'outline'}
              size="sm"
              onClick={() => setTargetState(state)}
            >
              {getDisplayName(state)}
            </Button>
          </DialogTrigger>
          
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {getDisplayName(state)} - Position #{positionId.slice(0, 8)}
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4 py-4">
              <p>
                {currentState === 'planned' && state === 'building' && (
                  'This will mark the position as building. Use this when you start executing entry orders.'
                )}
                {currentState === 'planned' && state === 'cancelled' && (
                  'This will cancel the position plan. This action cannot be undone.'
                )}
                {currentState === 'building' && state === 'active' && (
                  'This will mark the position as active, indicating that entry is complete.'
                )}
                {currentState === 'active' && state === 'closed' && (
                  'This will close the position, indicating that all capital has been withdrawn.'
                )}
              </p>
              
              <div className="space-y-2">
                <Label htmlFor="notes">Notes (optional)</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add context about this transition..."
                  rows={3}
                />
              </div>
            </div>
            
            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button
                variant={state === 'cancelled' ? 'destructive' : 'default'}
                onClick={handleTransition}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Processing...' : 'Confirm'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ))}
    </div>
  );
};
```

## Best Practices for Position Lifecycle Management

### 1. Consistent State Transitions

✅ **Do:**
- Use the `transitionLifecycle` function for all state changes
- Validate transitions before executing them
- Record the reason for each transition
- Maintain a complete transition history

❌ **Don't:**
- Directly modify the lifecycle state
- Skip validation checks
- Make transition decisions based solely on UI state

### 2. Capital Tier Evolution

✅ **Do:**
- Calculate capital tiers based on recovered amount
- Record capital tier transitions with related orders
- Use capital tier to inform risk management decisions
- Display capital tier prominently to users

❌ **Don't:**
- Manually set capital tiers without calculation
- Ignore recovered capital when making risk decisions
- Hide capital tier information from traders

### 3. Order Management

✅ **Do:**
- Clearly identify order purposes (entry, exit, take profit, stop loss)
- Link orders to lifecycle transitions
- Track order execution timestamps
- Calculate position metrics based on executed orders

❌ **Don't:**
- Create orphaned orders outside the position structure
- Modify order history after execution
- Use inconsistent timestamp formats

### 4. UI Feedback

✅ **Do:**
- Use visual indicators for lifecycle state
- Provide clear explanations for available transitions
- Confirm destructive actions (like cancellation)
- Show transition history to users

❌ **Don't:**
- Hide transition capabilities from users
- Use ambiguous state terminology
- Allow transitions without confirmation
- Overload the UI with too many transition options

## Summary

Position lifecycle management is a cornerstone feature of Numisma, providing a structured framework for traders to:

1. **Track Investment Journey**: Follow positions from planning through closure
2. **Manage Risk**: Adjust approach based on capital tier evolution
3. **Document Decisions**: Record context behind each lifecycle transition
4. **Analyze Performance**: Compare results across different lifecycle stages

By implementing a comprehensive lifecycle management system, Numisma helps traders maintain discipline, reduce emotional trading, and optimize their investment strategy through a complete position journey.
