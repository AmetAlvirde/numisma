/**
 * positions-search.tsx - Search component for filtering positions
 *
 * This component provides search functionality to filter positions by name,
 * asset, or other criteria.
 */

"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

interface PositionsSearchProps {
  onSearch?: (query: string) => void;
}

export function PositionsSearch({ onSearch }: PositionsSearchProps) {
  const [query, setQuery] = useState("");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    onSearch?.(value);
  };

  return (
    <div className="relative w-full max-w-sm">
      <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        placeholder="Search positions..."
        value={query}
        onChange={handleChange}
        className="pl-8"
      />
    </div>
  );
}
