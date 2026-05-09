import { useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import EntityNode from './EntityNode';
import { type OsintEntity, type OsintRelation, runTransform, ENTITY_COLORS } from '@/lib/osint-types';
import React from 'react';

interface InvestigationGraphProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange<Node>;
  onEdgesChange: OnEdgesChange<Edge>;
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  onEntitySelect: (entity: OsintEntity | null) => void;
  onTransformStart: () => void;
  onTransformEnd: (entity: OsintEntity, result: { entities: OsintEntity[]; relations: OsintRelation[] }) => void;
  onTransformRequest?: (entity: OsintEntity, pos: { x: number; y: number }) => Promise<void> | void;
}

const nodeTypes = { entity: EntityNode };

const InvestigationGraph = ({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  setNodes,
  setEdges,
  onEntitySelect,
  onTransformStart,
  onTransformEnd,
  onTransformRequest,
}: InvestigationGraphProps) => {

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const entity: OsintEntity = {
        id: node.id,
        type: (node.data as any).entityType,
        label: (node.data as any).label,
        platform: (node.data as any).platform,
        metadata: (node.data as any).metadata,
      };
      onEntitySelect(entity);
    },
    [onEntitySelect]
  );

  const onNodeDoubleClick = useCallback(
    async (_: React.MouseEvent, node: Node) => {
      const data: any = node.data;

      // Group folder node → toggle visibility of its children
      if (data?.isGroup) {
        const childIds: string[] = data.groupChildren ?? [];
        const nextCollapsed = !data.groupCollapsed;
        setNodes((nds) =>
          nds.map((n) => {
            if (n.id === node.id) return { ...n, data: { ...n.data, groupCollapsed: nextCollapsed } };
            if (childIds.includes(n.id)) return { ...n, hidden: nextCollapsed };
            return n;
          }),
        );
        setEdges((eds) =>
          eds.map((e) =>
            e.source === node.id && childIds.includes(e.target)
              ? { ...e, hidden: nextCollapsed }
              : e,
          ),
        );
        return;
      }

      const entity: OsintEntity = {
        id: node.id,
        type: data.entityType,
        label: data.label,
        platform: data.platform,
        metadata: data.metadata,
      };

      const sourceNode = nodes.find((n) => n.id === node.id);
      const pos = { x: sourceNode?.position.x ?? 0, y: sourceNode?.position.y ?? 0 };

      // Prefer the parent's streaming handler when provided so progress + incremental
      // node updates flow through one place.
      if (onTransformRequest) {
        await onTransformRequest(entity, pos);
        return;
      }

      onTransformStart();

      setNodes((nds) =>
        nds.map((n) =>
          n.id === node.id ? { ...n, data: { ...n.data, isLoading: true } } : n
        )
      );

      const result = await runTransform(entity);

      setNodes((nds) =>
        nds.map((n) =>
          n.id === node.id ? { ...n, data: { ...n.data, isLoading: false } } : n
        )
      );

      const radius = 180;
      const angleStep = (2 * Math.PI) / Math.max(result.entities.length, 1);

      const newNodes: Node[] = result.entities.map((e, i) => ({
        id: e.id,
        type: 'entity',
        position: {
          x: pos.x + radius * Math.cos(angleStep * i - Math.PI / 2),
          y: pos.y + radius * Math.sin(angleStep * i - Math.PI / 2),
        },
        data: {
          label: e.label,
          entityType: e.type,
          platform: e.platform,
          metadata: e.metadata,
        },
      }));

      const newEdges: Edge[] = result.relations.map((r) => ({
        id: r.id,
        source: r.sourceId,
        target: r.targetId,
        label: r.label,
        animated: true,
        style: { stroke: ENTITY_COLORS[entity.type] + '88' },
        labelStyle: { fill: 'hsl(180, 10%, 60%)', fontSize: 9, fontFamily: 'JetBrains Mono' },
        labelBgStyle: { fill: 'hsl(220, 18%, 7%)', fillOpacity: 0.85 },
        labelBgPadding: [4, 2] as [number, number],
      }));

      setNodes((nds) => [...nds, ...newNodes]);
      setEdges((eds) => [...eds, ...newEdges]);

      onTransformEnd(entity, result);
    },
    [nodes, setNodes, setEdges, onTransformStart, onTransformEnd, onTransformRequest]
  );

  const onPaneClick = useCallback(() => {
    onEntitySelect(null);
  }, [onEntitySelect]);

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        className="bg-background"
      >
        <Background variant={BackgroundVariant.Dots} gap={30} size={1} color="hsl(220, 15%, 15%)" />
        <Controls
          className="!bg-card !border-border !shadow-lg [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-secondary"
        />
        <MiniMap
          nodeColor={(n) => ENTITY_COLORS[(n.data as any)?.entityType] || '#888'}
          className="!bg-card !border-border"
          maskColor="hsl(220, 20%, 4%, 0.8)"
        />
      </ReactFlow>
    </div>
  );
};

export default InvestigationGraph;
