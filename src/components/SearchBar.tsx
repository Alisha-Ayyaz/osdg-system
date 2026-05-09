import { Search } from "lucide-react";
import { motion } from "framer-motion";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSearch: () => void;
  isScanning: boolean;
}

const SearchBar = ({ value, onChange, onSearch, isScanning }: SearchBarProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="w-full max-w-2xl mx-auto"
    >
      <div className="relative group">
        <div className="absolute -inset-0.5 rounded-lg bg-gradient-to-r from-primary/50 via-neon-green/30 to-neon-blue/50 opacity-40 group-hover:opacity-70 blur transition-opacity" />
        <div className="relative flex items-center gap-3 glass-card rounded-lg px-5 py-4">
          <Search className="h-5 w-5 text-primary shrink-0" />
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSearch()}
            placeholder="Enter name, handle, email, or phone..."
            className="flex-1 bg-transparent text-foreground font-mono text-sm placeholder:text-muted-foreground outline-none"
          />
          <button
            onClick={onSearch}
            disabled={isScanning || !value.trim()}
            className="px-5 py-2 rounded-md bg-primary text-primary-foreground font-mono text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isScanning ? "SCANNING..." : "SCAN"}
          </button>
        </div>
      </div>
    </motion.div>
  );
};

export default SearchBar;
