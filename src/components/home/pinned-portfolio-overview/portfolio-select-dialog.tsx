import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

interface Portfolio {
  id: string;
  name: string;
  totalValue: number;
}

interface PortfolioSelectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  portfolios: Portfolio[];
  selectedPortfolioId?: string;
  onSelect: (portfolioId: string) => void;
  title: string;
  description: string;
}

export function PortfolioSelectDialog({
  open,
  onOpenChange,
  portfolios,
  selectedPortfolioId: _selectedPortfolioId,
  onSelect,
  title,
  description,
}: PortfolioSelectDialogProps) {
  const handleSelect = (portfolioId: string) => {
    onSelect(portfolioId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Command className="rounded-lg border shadow-md">
          <CommandInput placeholder="Search portfolios..." />
          <CommandList>
            <CommandEmpty>No portfolios found.</CommandEmpty>
            <CommandGroup>
              {portfolios.map(portfolio => (
                <CommandItem
                  key={portfolio.id}
                  value={portfolio.name}
                  onSelect={() => handleSelect(portfolio.id)}
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{portfolio.name}</span>
                    <span className="text-sm text-muted-foreground">
                      ${portfolio.totalValue.toLocaleString()}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            type="button"
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
