import { motion } from "framer-motion";
import { LucideIcon } from "lucide-react";

interface PlatformCardProps {
  name: string;
  icon: LucideIcon;
  color: string;
  status: "idle" | "scanning" | "found" | "not-found";
  resultCount?: number;
  delay?: number;
}

const statusConfig = {
  idle: { label: "READY", className: "text-muted-foreground" },
  scanning: { label: "SCANNING", className: "text-primary animate-pulse-glow" },
  found: { label: "DATA FOUND", className: "text-accent" },
  "not-found": { label: "NO DATA", className: "text-muted-foreground" },
};

const PlatformCard = ({ name, icon: Icon, color, status, resultCount, delay = 0 }: PlatformCardProps) => {
  const config = statusConfig[status];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="glass-card rounded-lg p-5 relative overflow-hidden group hover:border-primary/30 transition-colors"
    >
      {status === "scanning" && (
        <div className="absolute inset-0 scan-line animate-scan pointer-events-none" />
      )}

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-md ${color}`}>
            <Icon className="h-5 w-5" />
          </div>
          <span className="font-mono text-sm font-semibold text-foreground">{name}</span>
        </div>
        <span className={`font-mono text-xs ${config.className}`}>{config.label}</span>
      </div>

      {status === "found" && resultCount !== undefined && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-2"
        >
          <div className="flex justify-between text-xs font-mono">
            <span className="text-muted-foreground">Records found</span>
            <span className="text-accent">{resultCount}</span>
          </div>
          <div className="w-full h-1 bg-secondary rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(resultCount * 10, 100)}%` }}
              transition={{ duration: 1, ease: "easeOut" }}
              className="h-full bg-gradient-to-r from-primary to-accent rounded-full"
            />
          </div>
        </motion.div>
      )}

      {status === "idle" && (
        <div className="h-8 flex items-center">
          <div className="flex gap-1">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default PlatformCard;
