import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function SearchBar({ initialQuery = "" }: { initialQuery?: string }) {
  const [, navigate] = useLocation();
  const [value, setValue] = useState(initialQuery);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    if (!q) return;
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <form onSubmit={onSubmit} className="relative w-full" role="search" data-testid="search-form">
      <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      <Input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search posts, profiles…"
        aria-label="Search"
        className="pl-9 h-11 bg-secondary/30 font-mono"
        data-testid="input-search"
      />
    </form>
  );
}
