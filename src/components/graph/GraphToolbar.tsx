import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

interface GraphToolbarProps {
  isTransforming: boolean;
  entityCount: number;
  edgeCount: number;
  lastAction: string | null;
}

const GraphToolbar = ({ isTransforming, entityCount, edgeCount, lastAction }: GraphToolbarProps) => {
  return (
    <div className="absolute top-4 left-4 z-10 flex items-center gap-3">
      {/* Status */}
      <div className="glass-card rounded-md px-3 py-1.5 flex items-center gap-2">
        <AnimatePresence mode="wait">
          {isTransforming ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2"
            >
              <Loader2 className="h-3 w-3 text-primary animate-spin" />
              <span className="text-[10px] font-mono text-primary">SCANNING...</span>
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-accent" />
              <span className="text-[10px] font-mono text-muted-foreground">
                {entityCount} entities • {edgeCount} links
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Last action */}
      <AnimatePresence>
        {lastAction && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            className="glass-card rounded-md px-3 py-1.5 flex items-center gap-2"
          >
            <CheckCircle2 className="h-3 w-3 text-accent" />
            <span className="text-[10px] font-mono text-accent">{lastAction}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default GraphToolbar;
