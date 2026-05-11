import { useState } from 'react';
import { Search, Plus, Download, Trash2, Zap, Eye, ChevronDown, Save, ArrowLeft, FileText } from 'lucide-react';

import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  type OsintEntity,
  type EntityType,
  ENTITY_COLORS,
  ENTITY_ICONS,
} from '@/lib/osint-types';
import ApiDashboard from '@/components/ApiDashboard';

interface InvestigationSidebarProps {
  selectedEntity: OsintEntity | null;
  allEntities: OsintEntity[];
  isTransforming: boolean;
  onAddEntity: (label: string, type: EntityType) => void;
  onRunTransform: (entity: OsintEntity) => void;
  onClearGraph: () => void;
  onExport: () => void;
  onGenerateReport: () => void;
  isGeneratingReport?: boolean;
  onSave?: () => void;
  onBack?: () => void;
  investigationName?: string;
}

const entityTypes: { type: EntityType; label: string }[] = [
  { type: 'person', label: 'Person' },
  { type: 'email', label: 'Email' },
  { type: 'phone', label: 'Phone' },
  { type: 'domain', label: 'Domain' },
  { type: 'ip', label: 'IP' },
  { type: 'hash', label: 'Hash' },
  { type: 'eth_wallet', label: 'ETH Wallet' },
  { type: 'btc_wallet', label: 'BTC Wallet' },
  { type: 'short_url', label: 'Short URL' },
  { type: 'twitter_profile', label: 'Twitter' },
  { type: 'facebook_profile', label: 'Facebook' },
  { type: 'linkedin_profile', label: 'LinkedIn' },
  { type: 'instagram_profile', label: 'Instagram' },
  { type: 'web_search', label: 'Web Search' },
  { type: 'youtube', label: 'YouTube' },
  { type: 'organization', label: 'Organization' },
];

const InvestigationSidebar = ({
  selectedEntity,
  allEntities,
  isTransforming,
  onAddEntity,
  onRunTransform,
  onClearGraph,
  onExport,
  onGenerateReport,
  isGeneratingReport,
  onSave,
  onBack,
  investigationName,
}: InvestigationSidebarProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<EntityType>('person');
  const [showEntityList, setShowEntityList] = useState(true);

  const handleAddEntity = () => {
    if (!searchQuery.trim()) return;
    onAddEntity(searchQuery.trim(), selectedType);
    setSearchQuery('');
  };

  return (
    <div className="w-80 h-full flex flex-col border-r border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2 mb-2">
          {onBack && (
            <button onClick={onBack} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <div className="p-1.5 rounded bg-primary/10">
            <Eye className="h-4 w-4 text-primary" />
          </div>
          <h1 className="font-mono text-sm font-bold text-foreground">
            <span className="text-primary">OSDG</span>
          </h1>
        </div>
        {investigationName && (
          <p className="text-[10px] font-mono text-primary truncate mb-1">▸ {investigationName}</p>
        )}
        <p className="text-[10px] font-mono text-muted-foreground">
          Double-click nodes to run transforms
        </p>
      </div>

      {/* Add Entity */}
      <div className="p-4 border-b border-border space-y-3">
        <label className="text-[10px] font-mono text-primary tracking-wider">▸ NEW ENTITY</label>
        <div className="flex gap-2">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddEntity()}
            placeholder="Name, email, domain..."
            className="flex-1 h-8 text-xs font-mono bg-secondary border-border"
          />
          <Button
            onClick={handleAddEntity}
            disabled={!searchQuery.trim()}
            size="sm"
            className="h-8 px-2"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {entityTypes.map((et) => (
            <button
              key={et.type}
              onClick={() => setSelectedType(et.type)}
              className={`text-[10px] font-mono px-2 py-1 rounded transition-colors ${
                selectedType === et.type
                  ? 'bg-primary/20 text-primary border border-primary/40'
                  : 'bg-secondary text-muted-foreground border border-border hover:border-primary/30'
              }`}
            >
              {ENTITY_ICONS[et.type]} {et.label}
            </button>
          ))}
        </div>
      </div>

      {/* Selected Entity Details */}
      <AnimatePresence mode="wait">
        {selectedEntity && (
          <motion.div
            key={selectedEntity.id}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-4 border-b border-border"
          >
            <label className="text-[10px] font-mono text-primary tracking-wider">▸ SELECTED ENTITY</label>
            <div className="mt-2 p-3 rounded bg-secondary/50 border border-border space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-lg">{ENTITY_ICONS[selectedEntity.type]}</span>
                <div>
                  <p className="text-sm font-mono text-foreground">{selectedEntity.label}</p>
                  <p className="text-[10px] font-mono text-muted-foreground uppercase">
                    {selectedEntity.type}
                    {selectedEntity.platform && ` • ${selectedEntity.platform}`}
                  </p>
                </div>
              </div>
              {selectedEntity.metadata?.thumbnail && (
                <div className="mb-3 rounded overflow-hidden border border-border/50 shadow-lg">
                  <img src={selectedEntity.metadata.thumbnail} alt="preview" className="w-full aspect-video object-cover" />
                </div>
              )}
              <Button
                onClick={() => onRunTransform(selectedEntity)}
                disabled={isTransforming}
                size="sm"
                className="w-full h-7 text-xs font-mono gap-1.5"
              >
                <Zap className="h-3 w-3" />
                {isTransforming ? 'TRANSFORMING...' : 'RUN TRANSFORMS'}
              </Button>
              {selectedEntity.metadata?.nextPageToken && (
                <Button
                  onClick={() => onRunTransform({
                    ...selectedEntity,
                    metadata: { ...selectedEntity.metadata, pageToken: selectedEntity.metadata.nextPageToken }
                  })}
                  disabled={isTransforming}
                  size="sm"
                  variant="outline"
                  className="w-full h-7 text-[10px] font-mono gap-1.5 mt-2 border-primary/30 text-primary hover:bg-primary/10"
                >
                  <Download className="h-3 w-3" /> LOAD NEXT PAGE
                </Button>
              )}
              {selectedEntity.metadata && Object.keys(selectedEntity.metadata).length > 0 && (
                <div className="mt-2 pt-2 border-t border-border space-y-1 max-h-64 overflow-y-auto">
                  <p className="text-[9px] font-mono text-primary tracking-wider mb-1">▸ METADATA</p>
                  {Object.entries(selectedEntity.metadata).map(([k, v]) => {
                    if (k === 'thumbnail' || k === 'nextPageToken') return null;
                    return (
                      <div key={k} className="text-[10px] font-mono leading-tight">
                        <span className="text-muted-foreground">{k}:</span>{' '}
                        <span className="text-foreground break-all">{String(v).slice(0, 200)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Entity List */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <button
          onClick={() => setShowEntityList(!showEntityList)}
          className="flex items-center justify-between px-4 py-2 text-[10px] font-mono text-primary tracking-wider hover:bg-secondary/50"
        >
          <span>▸ ENTITIES ({allEntities.length})</span>
          <ChevronDown className={`h-3 w-3 transition-transform ${showEntityList ? '' : '-rotate-90'}`} />
        </button>
        {showEntityList && (
          <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-1">
            {allEntities.map((entity) => (
              <div
                key={entity.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono hover:bg-secondary/50 transition-colors cursor-default"
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: ENTITY_COLORS[entity.type] }}
                />
                <span className="text-foreground truncate">{entity.label}</span>
                <span className="text-muted-foreground text-[9px] ml-auto uppercase shrink-0">{entity.type}</span>
              </div>
            ))}
            {allEntities.length === 0 && (
              <p className="text-[10px] font-mono text-muted-foreground text-center py-4">
                Add an entity to begin investigation
              </p>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="p-4 border-t border-border space-y-2">
        <Button
          onClick={onGenerateReport}
          size="sm"
          disabled={allEntities.length === 0 || isGeneratingReport}
          className="w-full h-8 text-xs font-mono gap-1.5"
        >
          <FileText className="h-3 w-3" />
          {isGeneratingReport ? 'GENERATING…' : 'GENERATE REPORT (.DOCX)'}
        </Button>
        <div className="flex gap-2">
          {onSave && (
            <Button
              onClick={onSave}
              size="sm"
              variant="outline"
              className="flex-1 h-8 text-xs font-mono gap-1.5"
            >
              <Save className="h-3 w-3" /> SAVE
            </Button>
          )}
          <Button
            onClick={onExport}
            variant="outline"
            size="sm"
            className="flex-1 h-8 text-xs font-mono gap-1.5"
            disabled={allEntities.length === 0}
          >
            <Download className="h-3 w-3" /> JSON
          </Button>
          <Button
            onClick={onClearGraph}
            variant="outline"
            size="sm"
            className="h-8 px-2 text-destructive hover:text-destructive"
            disabled={allEntities.length === 0}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
        <ApiDashboard />
      </div>
    </div>
  );
};

export default InvestigationSidebar;
