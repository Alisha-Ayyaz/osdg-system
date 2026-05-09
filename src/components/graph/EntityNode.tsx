import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ENTITY_COLORS, ENTITY_ICONS, PLATFORM_ICONS, type EntityType, type PlatformType } from '@/lib/osint-types';

interface EntityNodeData {
  label: string;
  entityType: EntityType;
  platform?: PlatformType;
  isLoading?: boolean;
  isGroup?: boolean;
  groupCollapsed?: boolean;
  directFetch?: boolean;
  [key: string]: unknown;
}

const EntityNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as unknown as EntityNodeData;
  const color = ENTITY_COLORS[nodeData.entityType] ?? 'hsl(180, 50%, 50%)';
  const icon = nodeData.isGroup
    ? (nodeData.groupCollapsed ? '📁' : '📂')
    : nodeData.platform
      ? PLATFORM_ICONS[nodeData.platform]
      : ENTITY_ICONS[nodeData.entityType];
  const sizeCls = nodeData.isGroup ? 'w-14 h-14 text-2xl' : 'w-12 h-12 text-xl';

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-0 !h-0" />
      <div
        className={`flex flex-col items-center gap-1 cursor-pointer transition-transform ${
          selected ? 'scale-110' : 'hover:scale-105'
        } ${nodeData.isLoading ? 'animate-pulse' : ''}`}
        title={nodeData.isGroup ? `Double-click to ${nodeData.groupCollapsed ? 'expand' : 'collapse'}` : undefined}
      >
        <div
          className={`${sizeCls} rounded-full flex items-center justify-center shadow-lg border-2 ${nodeData.isGroup ? 'border-dashed' : ''}`}
          style={{
            backgroundColor: `${color}22`,
            borderColor: selected ? color : `${color}88`,
            boxShadow: selected ? `0 0 20px ${color}66, 0 0 40px ${color}22` : `0 0 10px ${color}33`,
          }}
        >
          {icon}
        </div>
        <span
          className="text-[10px] font-mono max-w-[110px] truncate text-center px-1.5 py-0.5 rounded"
          style={{ color, backgroundColor: `${color}15` }}
        >
          {nodeData.label}
        </span>
        {nodeData.directFetch && (
          <span
            className="text-[8px] font-mono px-1.5 py-[1px] rounded border"
            style={{ color, borderColor: `${color}88`, backgroundColor: `${color}10` }}
          >
            ⚡ DIRECT API
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-0 !h-0" />
    </>
  );
});

EntityNode.displayName = 'EntityNode';
export default EntityNode;
