import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import type { Node, Edge } from '@xyflow/react';
import type { OsintEntity } from '@/lib/osint-types';

export interface Investigation {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export const useInvestigation = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const [currentInvestigation, setCurrentInvestigation] = useState<Investigation | null>(null);
  const [loadingInvestigations, setLoadingInvestigations] = useState(false);

  const fetchInvestigations = useCallback(async () => {
    if (!user) return;
    setLoadingInvestigations(true);
    const { data, error } = await supabase
      .from('investigations')
      .select('id, name, description, created_at, updated_at')
      .order('updated_at', { ascending: false });

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      setInvestigations(data ?? []);
    }
    setLoadingInvestigations(false);
  }, [user, toast]);

  const createInvestigation = useCallback(async (name: string) => {
    if (!user) return null;
    const { data, error } = await supabase
      .from('investigations')
      .insert({ user_id: user.id, name })
      .select('id, name, description, created_at, updated_at')
      .single();

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return null;
    }
    setCurrentInvestigation(data);
    setInvestigations((prev) => [data, ...prev]);
    return data;
  }, [user, toast]);

  const saveGraphState = useCallback(async (
    investigationId: string,
    nodes: Node[],
    edges: Edge[],
    entities: OsintEntity[]
  ) => {
    if (!user) return;
    const graphState = { nodes, edges, entities };
    const { error } = await supabase
      .from('investigations')
      .update({ graph_state: graphState as any })
      .eq('id', investigationId);

    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Saved', description: 'Investigation saved successfully.' });
    }
  }, [user, toast]);

  const loadGraphState = useCallback(async (investigationId: string) => {
    const { data, error } = await supabase
      .from('investigations')
      .select('*')
      .eq('id', investigationId)
      .single();

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return null;
    }

    setCurrentInvestigation({
      id: data.id,
      name: data.name,
      description: data.description,
      created_at: data.created_at,
      updated_at: data.updated_at,
    });

    return data.graph_state as unknown as { nodes: Node[]; edges: Edge[]; entities: OsintEntity[] } | null;
  }, [toast]);

  const deleteInvestigation = useCallback(async (id: string) => {
    const { error } = await supabase.from('investigations').delete().eq('id', id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      setInvestigations((prev) => prev.filter((inv) => inv.id !== id));
      if (currentInvestigation?.id === id) setCurrentInvestigation(null);
    }
  }, [currentInvestigation, toast]);

  return {
    investigations,
    currentInvestigation,
    loadingInvestigations,
    setCurrentInvestigation,
    fetchInvestigations,
    createInvestigation,
    saveGraphState,
    loadGraphState,
    deleteInvestigation,
  };
};
