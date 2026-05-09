import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, CheckCircle2, AlertCircle, CircleDashed } from 'lucide-react';
import type { StageStatus } from '@/lib/osint-types';

export interface ProgressStage {
  name: string;
  status: StageStatus | 'pending';
  count?: number;
  error?: string;
}

interface Props {
  visible: boolean;
  entityLabel?: string;
  stages: ProgressStage[];
}

const TransformProgress = ({ visible, entityLabel, stages }: Props) => {
  const completed = stages.filter((s) => s.status !== 'pending' && s.status !== 'loading').length;
  const total = stages.length || 1;
  const pct = Math.round((completed / total) * 100);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          className="absolute top-4 right-4 z-20 w-72 glass-card rounded-md p-3 border border-border"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono text-primary uppercase tracking-wider">
              Scanning APIs
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">
              {completed}/{total}
            </span>
          </div>
          {entityLabel && (
            <div className="text-[10px] font-mono text-muted-foreground mb-2 truncate">
              → {entityLabel}
            </div>
          )}
          <div className="h-1 w-full bg-secondary rounded overflow-hidden mb-3">
            <motion.div
              className="h-full bg-primary"
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.25 }}
            />
          </div>
          <ul className="space-y-1 max-h-64 overflow-y-auto pr-1">
            {stages.map((s) => (
              <li
                key={s.name}
                className="flex items-center justify-between text-[10px] font-mono"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {s.status === 'loading' && (
                    <Loader2 className="h-3 w-3 text-primary animate-spin shrink-0" />
                  )}
                  {s.status === 'done' && (
                    <CheckCircle2 className="h-3 w-3 text-accent shrink-0" />
                  )}
                  {s.status === 'empty' && (
                    <CircleDashed className="h-3 w-3 text-muted-foreground shrink-0" />
                  )}
                  {s.status === 'error' && (
                    <AlertCircle className="h-3 w-3 text-destructive shrink-0" />
                  )}
                  {s.status === 'pending' && (
                    <CircleDashed className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                  )}
                  <span
                    className={
                      s.status === 'done'
                        ? 'text-foreground truncate'
                        : 'text-muted-foreground truncate'
                    }
                  >
                    {s.name}
                  </span>
                </div>
                <span className="text-muted-foreground/70 shrink-0 ml-2">
                  {s.status === 'done' && s.count !== undefined ? `+${s.count}` : ''}
                  {s.status === 'empty' ? '0' : ''}
                  {s.status === 'error' ? 'err' : ''}
                </span>
              </li>
            ))}
          </ul>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default TransformProgress;
