import { useState, useCallback, useRef, useEffect } from 'react';
import { useNodesState, useEdgesState, type Node, type Edge } from '@xyflow/react';
import InvestigationGraph from '@/components/graph/InvestigationGraph';
import InvestigationSidebar from '@/components/graph/InvestigationSidebar';
import GraphToolbar from '@/components/graph/GraphToolbar';
import TransformProgress, { type ProgressStage } from '@/components/graph/TransformProgress';
import InvestigationManager from '@/components/InvestigationManager';
import {
  type OsintEntity,
  type EntityType,
  type OsintRelation,
  runTransform,
  ENTITY_COLORS,
} from '@/lib/osint-types';
import { useToast } from '@/hooks/use-toast';
import { generateOsintReport } from '@/lib/report-generator';
import { useAuth } from '@/hooks/useAuth';
import { useInvestigation } from '@/hooks/useInvestigation';

const Index = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedEntity, setSelectedEntity] = useState<OsintEntity | null>(null);
  const [allEntities, setAllEntities] = useState<OsintEntity[]>([]);
  const [isTransforming, setIsTransforming] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [showManager, setShowManager] = useState(true);
  const [progressStages, setProgressStages] = useState<ProgressStage[]>([]);
  const [progressEntity, setProgressEntity] = useState<string | undefined>();
  const actionTimeout = useRef<ReturnType<typeof setTimeout>>();
  const transformCache = useRef<Map<string, { entities: OsintEntity[], relations: OsintRelation[] }>>(new Map());
  const { toast } = useToast();
  const { signOut } = useAuth();
  const {
    investigations,
    currentInvestigation,
    loadingInvestigations,
    fetchInvestigations,
    createInvestigation,
    saveGraphState,
    loadGraphState,
    deleteInvestigation,
  } = useInvestigation();

  useEffect(() => {
    fetchInvestigations();
  }, [fetchInvestigations]);

  // Module 4: Session Persistence - Load from localStorage on mount
  useEffect(() => {
    const savedSession = localStorage.getItem('osdg_local_session');
    if (savedSession) {
      try {
        const { nodes: sNodes, edges: sEdges, entities: sEntities } = JSON.parse(savedSession);
        if (sNodes && sNodes.length > 0) {
          setNodes(sNodes);
          setEdges(sEdges || []);
          setAllEntities(sEntities || []);
          setShowManager(false);
          toast({ title: 'Session Resumed', description: 'Restored your previous investigation from local storage.' });
        }
      } catch (e) {
        console.error('Failed to load local session', e);
      }
    }
  }, [setNodes, setEdges, toast]);

  // Module 4: Session Persistence - Save to localStorage on every change
  useEffect(() => {
    const session = { nodes, edges, entities: allEntities };
    localStorage.setItem('osdg_local_session', JSON.stringify(session));
  }, [nodes, edges, allEntities]);

  const showAction = (msg: string) => {
    setLastAction(msg);
    clearTimeout(actionTimeout.current);
    actionTimeout.current = setTimeout(() => setLastAction(null), 3000);
  };

  const handleNewInvestigation = async (name: string) => {
    const inv = await createInvestigation(name);
    if (inv) {
      setNodes([]);
      setEdges([]);
      setAllEntities([]);
      setSelectedEntity(null);
      setShowManager(false);
      showAction(`Created: ${inv.name}`);
    }
  };

  const handleLoadInvestigation = async (id: string) => {
    const state = await loadGraphState(id);
    if (state) {
      setNodes(state.nodes ?? []);
      setEdges(state.edges ?? []);
      setAllEntities(state.entities ?? []);
      setSelectedEntity(null);
      setShowManager(false);
      showAction('Investigation loaded');
    }
  };

  const handleSave = useCallback(async () => {
    if (!currentInvestigation) {
      toast({ title: 'No investigation', description: 'Create or open an investigation first.' });
      return;
    }
    await saveGraphState(currentInvestigation.id, nodes, edges, allEntities);
  }, [currentInvestigation, nodes, edges, allEntities, saveGraphState, toast]);

  const handleAddEntity = useCallback(
    (label: string, type: EntityType) => {
      const id = Math.random().toString(36).slice(2, 10);
      const isDirect = ['twitter_profile', 'linkedin_profile', 'facebook_profile', 'instagram_profile'].includes(type);
      const entity: OsintEntity = { id, type, label, directFetch: isDirect || undefined };
      const offsetX = nodes.length ? nodes[nodes.length - 1].position.x + 200 : 0;
      const newNode: Node = {
        id,
        type: 'entity',
        position: { x: offsetX, y: 250 },
        data: { label, entityType: type, directFetch: isDirect },
      };
      setNodes((nds) => [...nds, newNode]);
      setAllEntities((prev) => [...prev, entity]);
      showAction(`Added ${type}: ${label}${isDirect ? ' (Direct API Fetch)' : ''}`);
    },
    [nodes, setNodes]
  );

  const streamTransform = useCallback(
    async (entity: OsintEntity, sourcePos: { x: number; y: number }) => {
      // 1. Check Session Cache
      const cacheKey = `${entity.type}:${entity.label.toLowerCase()}`;
      if (transformCache.current.has(cacheKey)) {
        const cached = transformCache.current.get(cacheKey)!;
        toast({ title: 'Using Cached Results', description: `Retrieved ${cached.entities.length} subdomains from session memory.` });
        
        // Use local batch placement
        let placed = 0;
        const radius = 240;
        const newNodes: Node[] = cached.entities.map((e, i) => {
          const idx = placed + i;
          const angle = idx * 0.55 - Math.PI / 2;
          const r = radius + Math.floor(idx / 12) * 60;
          return {
            id: e.id,
            type: 'entity',
            position: { x: sourcePos.x + r * Math.cos(angle), y: sourcePos.y + r * Math.sin(angle) },
            data: { label: e.label, entityType: e.type, platform: e.platform, metadata: e.metadata },
          };
        });
        const newEdges: Edge[] = cached.relations.map((r) => ({
          id: r.id,
          source: r.sourceId,
          target: r.targetId,
          label: r.label,
          animated: true,
          style: { stroke: ENTITY_COLORS[entity.type] + '88' },
        }));
        
        setNodes((nds) => [...nds, ...newNodes]);
        setEdges((eds) => [...eds, ...newEdges]);
        setAllEntities((prev) => [...prev, ...cached.entities]);
        return;
      }

      setIsTransforming(true);
      setProgressEntity(entity.label);
      setProgressStages([]);
      setNodes((nds) =>
        nds.map((n) => (n.id === entity.id ? { ...n, data: { ...n.data, isLoading: true } } : n))
      );

      let placed = 0;
      const collectedEntities: OsintEntity[] = [];
      const collectedRelations: OsintRelation[] = [];

      const placeBatch = (ents: OsintEntity[], rels: OsintRelation[]) => {
        if (ents.length === 0 && rels.length === 0) return;
        const radius = 240;
        const newNodes: Node[] = ents.map((e, i) => {
          const idx = placed + i;
          const angle = idx * 0.55 - Math.PI / 2;
          const r = radius + Math.floor(idx / 12) * 60;
          return {
            id: e.id,
            type: 'entity',
            position: {
              x: sourcePos.x + r * Math.cos(angle),
              y: sourcePos.y + r * Math.sin(angle),
            },
            data: {
              label: e.label,
              entityType: e.type,
              platform: e.platform,
              metadata: e.metadata,
            },
          };
        });
        placed += ents.length;
        const newEdges: Edge[] = rels.map((r) => ({
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
        collectedEntities.push(...ents);
        collectedRelations.push(...rels);
      };

      const result = await runTransform(entity, {
        onPlan: (names) => {
          setProgressStages(names.map((name) => ({ name, status: 'pending' as const })));
        },
        onStage: (evt) => {
          setProgressStages((prev) => {
            const exists = prev.some((s) => s.name === evt.name);
            const next = exists
              ? prev.map((s) => (s.name === evt.name ? { ...s, ...evt } : s))
              : [...prev, evt];
            return next;
          });
        },
        onPartial: ({ entities: ents, relations: rels, warning: stageWarning }) => {
          placeBatch(ents, rels);
          if (stageWarning) {
            toast({ 
              title: "Intelligence Update", 
              description: stageWarning,
              duration: 4000 
            });
          }
        },
      });

      // 2. Save to Session Cache
      if (collectedEntities.length > 0) {
        transformCache.current.set(cacheKey, { 
          entities: collectedEntities, 
          relations: collectedRelations 
        });
      }

      setNodes((nds) =>
        nds.map((n) => (n.id === entity.id ? { ...n, data: { ...n.data, isLoading: false } } : n))
      );
      setAllEntities((prev) => [...prev, ...collectedEntities]);
      setIsTransforming(false);
      if (result.warning) {
        toast({ title: 'API Notice', description: result.warning });
      }
      showAction(`Found ${collectedEntities.length} entities from ${entity.label}`);
      // Auto-hide progress shortly after completion
      setTimeout(() => setProgressStages([]), 2500);
    },
    [setNodes, setEdges, toast, setAllEntities]
  );

  const handleTransform = useCallback(
    async (entity: OsintEntity) => {
      const sourceNode = nodes.find((n) => n.id === entity.id);
      const pos = { x: sourceNode?.position.x ?? 0, y: sourceNode?.position.y ?? 0 };
      await streamTransform(entity, pos);
    },
    [nodes, streamTransform]
  );

  const handleClearGraph = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setAllEntities([]);
    localStorage.removeItem('osdg_local_session');
    showAction('Cleared investigation graph');
  }, [setNodes, setEdges, setAllEntities]);

  const handleExport = useCallback(() => {
    const report = {
      generated: new Date().toISOString(),
      tool: 'OSDG',
      entities: allEntities,
      relationships: edges.map((e) => ({
        source: e.source,
        target: e.target,
        label: (e as any).label,
      })),
      summary: {
        totalEntities: allEntities.length,
        totalRelationships: edges.length,
        entityTypes: Object.entries(
          allEntities.reduce((acc, e) => {
            acc[e.type] = (acc[e.type] || 0) + 1;
            return acc;
          }, {} as Record<string, number>)
        ),
      },
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `osdg-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Report Exported', description: `${allEntities.length} entities and ${edges.length} relationships exported.` });
  }, [allEntities, edges, toast]);

  const handleGenerateReport = useCallback(async () => {
    if (allEntities.length === 0) return;
    setIsGeneratingReport(true);
    try {
      await generateOsintReport({
        investigationName: currentInvestigation?.name,
        entities: allEntities,
        edges,
      });
      toast({ title: 'Report Ready', description: 'Word document downloaded.' });
      showAction('Report generated');
    } catch (err) {
      console.error(err);
      toast({
        title: 'Report failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsGeneratingReport(false);
    }
  }, [allEntities, edges, currentInvestigation, toast]);

  const handleTransformStart = useCallback(() => setIsTransforming(true), []);
  const handleTransformEnd = useCallback(
    (entity: OsintEntity, result: { entities: OsintEntity[]; warning?: string }) => {
      setAllEntities((prev) => [...prev, ...result.entities]);
      setIsTransforming(false);
      if (result.warning) {
        toast({ title: 'Limit Reached', description: result.warning });
      }
      showAction(`Found ${result.entities.length} entities from ${entity.label}`);
    },
    [toast]
  );

  if (showManager) {
    return (
      <InvestigationManager
        investigations={investigations}
        loading={loadingInvestigations}
        onNew={handleNewInvestigation}
        onLoad={handleLoadInvestigation}
        onDelete={deleteInvestigation}
        onSignOut={signOut}
      />
    );
  }

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-background">
      <InvestigationSidebar
        selectedEntity={selectedEntity}
        allEntities={allEntities}
        isTransforming={isTransforming}
        onAddEntity={handleAddEntity}
        onRunTransform={handleTransform}
        onClearGraph={handleClearGraph}
        onExport={handleExport}
        onGenerateReport={handleGenerateReport}
        isGeneratingReport={isGeneratingReport}
        onSave={handleSave}
        onBack={() => {
          setShowManager(true);
          fetchInvestigations();
        }}
        investigationName={currentInvestigation?.name}
      />
      <div className="flex-1 relative">
        <GraphToolbar
          isTransforming={isTransforming}
          entityCount={allEntities.length}
          edgeCount={edges.length}
          lastAction={lastAction}
        />
        <TransformProgress
          visible={progressStages.length > 0}
          entityLabel={progressEntity}
          stages={progressStages}
        />
        <InvestigationGraph
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          setNodes={setNodes}
          setEdges={setEdges}
          onEntitySelect={setSelectedEntity}
          onTransformStart={handleTransformStart}
          onTransformEnd={handleTransformEnd}
          onTransformRequest={(entity, pos) => streamTransform(entity, pos)}
        />
      </div>
    </div>
  );
};

export default Index;
