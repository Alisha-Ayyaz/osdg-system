import { useState } from 'react';
import { Plus, FolderOpen, Trash2, LogOut, Loader2, Eye } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Investigation } from '@/hooks/useInvestigation';

interface InvestigationManagerProps {
  investigations: Investigation[];
  loading: boolean;
  onNew: (name: string) => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onSignOut: () => void;
}

const InvestigationManager = ({
  investigations,
  loading,
  onNew,
  onLoad,
  onDelete,
  onSignOut,
}: InvestigationManagerProps) => {
  const [newName, setNewName] = useState('');

  const handleCreate = () => {
    if (!newName.trim()) return;
    onNew(newName.trim());
    setNewName('');
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-background grid-bg">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-lg mx-4"
      >
        <div className="glass-card rounded-lg p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded bg-primary/10">
                <Eye className="h-5 w-5 text-primary" />
              </div>
              <h1 className="font-mono text-lg font-bold text-foreground">
                <span className="text-primary">OSDG</span>
              </h1>
            </div>
            <Button onClick={onSignOut} variant="ghost" size="sm" className="text-xs font-mono gap-1.5 text-muted-foreground">
              <LogOut className="h-3.5 w-3.5" /> SIGN OUT
            </Button>
          </div>

          {/* New Investigation */}
          <div className="space-y-2">
            <label className="text-[10px] font-mono text-primary tracking-wider">▸ NEW INVESTIGATION</label>
            <div className="flex gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder="Investigation name..."
                className="flex-1 h-9 text-xs font-mono bg-secondary border-border"
              />
              <Button onClick={handleCreate} disabled={!newName.trim()} size="sm" className="h-9 px-3 text-xs font-mono gap-1.5">
                <Plus className="h-3.5 w-3.5" /> CREATE
              </Button>
            </div>
          </div>

          {/* Investigations List */}
          <div className="space-y-2">
            <label className="text-[10px] font-mono text-primary tracking-wider">
              ▸ INVESTIGATIONS ({investigations.length})
            </label>
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : investigations.length === 0 ? (
              <p className="text-xs font-mono text-muted-foreground text-center py-8">
                No investigations yet. Create one to begin.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                <AnimatePresence>
                  {investigations.map((inv) => (
                    <motion.div
                      key={inv.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      className="flex items-center gap-2 p-3 rounded bg-secondary/50 border border-border hover:border-primary/30 transition-colors group"
                    >
                      <FolderOpen className="h-4 w-4 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-mono text-foreground truncate">{inv.name}</p>
                        <p className="text-[10px] font-mono text-muted-foreground">
                          {new Date(inv.updated_at).toLocaleDateString()}
                        </p>
                      </div>
                      <Button
                        onClick={() => onLoad(inv.id)}
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-[10px] font-mono text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        OPEN
                      </Button>
                      <Button
                        onClick={() => onDelete(inv.id)}
                        variant="ghost"
                        size="sm"
                        className="h-7 px-1.5 text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default InvestigationManager;
