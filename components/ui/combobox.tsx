import * as React from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";

interface ComboboxProps {
  options: string[];
  value: string;
  onValueChange: (value: string) => void;
  onAddOption?: (value: string) => void;
  placeholder?: string;
  className?: string;
  error?: boolean;
}

export function Combobox({
  options = [],
  value,
  onValueChange,
  onAddOption,
  placeholder = "Select an option...",
  className,
  error,
}: ComboboxProps) {
  const [isAddingNew, setIsAddingNew] = React.useState(false);
  const [newOption, setNewOption] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleAddOption = () => {
    if (newOption.trim() && onAddOption) {
      onAddOption(newOption.trim());
      setNewOption("");
      setIsAddingNew(false);
    }
  };

  const handleAddNewClick = () => {
    setOpen(false);
    setIsAddingNew(true);
  };

  // Focus input when isAddingNew becomes true
  React.useEffect(() => {
    if (isAddingNew && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isAddingNew]);

  return (
    <div className="space-y-2">
      <Select
        value={value}
        onValueChange={onValueChange}
        open={open}
        onOpenChange={setOpen}
      >
        <SelectTrigger
          className={cn("w-full", error && "border-red-500", className)}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map(option => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
          <div className="p-2">
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={handleAddNewClick}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add new option
            </Button>
          </div>
        </SelectContent>
      </Select>
      {isAddingNew && (
        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            value={newOption}
            onChange={e => setNewOption(e.target.value)}
            placeholder="Enter new option..."
            className="flex-1"
          />
          <Button
            size="icon"
            onClick={handleAddOption}
            disabled={!newOption.trim()}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setIsAddingNew(false);
              setNewOption("");
            }}
          >
            ✕
          </Button>
        </div>
      )}
    </div>
  );
}
