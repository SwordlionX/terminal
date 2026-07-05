import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function GlobalSearch() {
  return (
    <div className="relative w-64 md:w-80 lg:w-96">
      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        type="search"
        placeholder="Müşteri, işlem veya portföy ara..."
        className="w-full pl-9 h-9 bg-secondary/50 border-none focus-visible:ring-1"
      />
    </div>
  );
}
