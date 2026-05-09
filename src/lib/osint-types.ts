export type EntityType = 'person' | 'email' | 'phone' | 'domain' | 'social' | 'organization' | 'location' | 'ip' | 'hash' | 'eth_wallet' | 'btc_wallet' | 'short_url' | 'twitter_profile' | 'facebook_profile' | 'linkedin_profile' | 'instagram_profile' | 'web_search' | 'youtube' | 'mitre_technique' | 'sanction';
export type PlatformType = 'twitter' | 'linkedin' | 'youtube' | 'google' | 'facebook' | 'instagram';

export interface OsintEntity {
  id: string;
  type: EntityType;
  label: string;
  platform?: PlatformType;
  metadata?: Record<string, string>;
  directFetch?: boolean;
}

export interface OsintRelation {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
}

export interface TransformResult {
  entities: OsintEntity[];
  relations: OsintRelation[];
}

const MOCK_TRANSFORMS: Record<EntityType, () => TransformResult> = {
  person: () => ({ entities: [], relations: [] }),
  email: () => ({ entities: [], relations: [] }),
  social: () => ({ entities: [], relations: [] }),
  domain: () => ({ entities: [], relations: [] }),
  phone: () => ({ entities: [], relations: [] }),
  organization: () => ({ entities: [], relations: [] }),
  location: () => ({ entities: [], relations: [] }),
  ip: () => ({ entities: [], relations: [] }),
  hash: () => ({ entities: [], relations: [] }),
  eth_wallet: () => ({ entities: [], relations: [] }),
  btc_wallet: () => ({ entities: [], relations: [] }),
  short_url: () => ({ entities: [], relations: [] }),
  twitter_profile: () => ({ entities: [], relations: [] }),
  facebook_profile: () => ({ entities: [], relations: [] }),
  linkedin_profile: () => ({ entities: [], relations: [] }),
  instagram_profile: () => ({ entities: [], relations: [] }),
  web_search: () => ({ entities: [], relations: [] }),
  youtube: () => ({ entities: [], relations: [] }),
  mitre_technique: () => ({ entities: [], relations: [] }),
  sanction: () => ({ entities: [], relations: [] }),
};

import { supabase } from '@/integrations/supabase/client';

export interface TransformOutcome extends TransformResult {
  warning?: string; // user-facing soft message (e.g. rate limit)
}

export type StageStatus = 'loading' | 'done' | 'empty' | 'error';
export interface StageEvent {
  name: string;
  status: StageStatus;
  count?: number;
  error?: string;
}
export interface StreamEvents {
  onPlan?: (stages: string[]) => void;
  onStage?: (event: StageEvent) => void;
  onPartial?: (partial: { name: string; entities: OsintEntity[]; relations: OsintRelation[] }) => void;
}

const RATE_LIMIT_PATTERNS = [
  /rate.?limit/i,
  /\b429\b/,
  /too many requests/i,
  /quota/i,
  /unauthorized/i,
  /\b401\b/,
  /\b403\b/,
];

function classifyError(msg: string): string {
  if (RATE_LIMIT_PATTERNS.some((re) => re.test(msg))) {
    return 'API limit reached or key invalid — partial data shown.';
  }
  return msg;
}

export async function runTransform(
  entity: OsintEntity,
  events?: StreamEvents,
): Promise<TransformOutcome> {
  try {
    const projectId = (import.meta as any).env?.VITE_SUPABASE_PROJECT_ID;
    const url = `https://${projectId}.supabase.co/functions/v1/osint-transform`;
    const { data: { session } } = await supabase.auth.getSession();
    const anonKey = (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
    const token = session?.access_token ?? anonKey;

    let customApiKeys = {};
    try {
      const stored = localStorage.getItem('osdg_api_configs');
      if (stored) {
        const configs = JSON.parse(stored);
        customApiKeys = configs.reduce((acc: any, c: any) => {
          acc[c.name] = c.key;
          return acc;
        }, {});
      }
    } catch (e) {
      console.warn('Failed to parse api configs for request');
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
      },
      body: JSON.stringify({ entity, apiKeys: customApiKeys }),
    });

    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const entities: OsintEntity[] = [];
    const relations: OsintRelation[] = [];
    let warning: string | undefined;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.type === 'plan') {
            events?.onPlan?.(evt.stages ?? []);
          } else if (evt.type === 'stage') {
            events?.onStage?.({ name: evt.name, status: 'loading' });
          } else if (evt.type === 'partial') {
            const ents = (evt.entities ?? []) as OsintEntity[];
            const rels = (evt.relations ?? []) as OsintRelation[];
            entities.push(...ents);
            relations.push(...rels);
            events?.onPartial?.({ name: evt.name, entities: ents, relations: rels });
            events?.onStage?.({
              name: evt.name,
              status: evt.status as StageStatus,
              count: ents.length,
              error: evt.error,
            });
            if (evt.error && !warning) warning = classifyError(String(evt.error));
          }
        } catch (e) {
          console.warn('bad ndjson line:', line, e);
        }
      }
    }

    return { entities, relations, warning };
  } catch (err) {
    console.error('runTransform failed:', err);
    return {
      entities: [],
      relations: [],
      warning: classifyError(err instanceof Error ? err.message : String(err)),
    };
  }
}

export const ENTITY_COLORS: Record<EntityType, string> = {
  person: 'hsl(174, 80%, 50%)',
  email: 'hsl(210, 90%, 55%)',
  phone: 'hsl(150, 70%, 45%)',
  domain: 'hsl(280, 70%, 55%)',
  social: 'hsl(45, 90%, 55%)',
  organization: 'hsl(0, 70%, 55%)',
  location: 'hsl(120, 60%, 45%)',
  ip: 'hsl(200, 50%, 50%)',
  hash: 'hsl(30, 90%, 55%)',
  eth_wallet: 'hsl(255, 70%, 60%)',
  btc_wallet: 'hsl(38, 95%, 55%)',
  short_url: 'hsl(330, 70%, 55%)',
  twitter_profile: 'hsl(203, 89%, 53%)',
  facebook_profile: 'hsl(221, 44%, 41%)',
  linkedin_profile: 'hsl(201, 100%, 35%)',
  instagram_profile: 'hsl(320, 70%, 55%)',
  web_search: 'hsl(220, 80%, 60%)',
  youtube: 'hsl(0, 85%, 55%)',
  mitre_technique: 'hsl(15, 85%, 55%)',
  sanction: 'hsl(355, 85%, 50%)',
};

export const ENTITY_ICONS: Record<EntityType, string> = {
  person: '👤',
  email: '📧',
  phone: '📱',
  domain: '🌐',
  social: '💬',
  organization: '🏢',
  location: '📍',
  ip: '🖥️',
  hash: '🔐',
  eth_wallet: 'Ξ',
  btc_wallet: '₿',
  short_url: '🔗',
  twitter_profile: '🐦',
  facebook_profile: '📘',
  linkedin_profile: '💼',
  instagram_profile: '📷',
  web_search: '🔍',
  youtube: '▶️',
  mitre_technique: '🎯',
  sanction: '⚖️',
};

export const PLATFORM_ICONS: Record<PlatformType, string> = {
  twitter: '🐦',
  linkedin: '💼',
  youtube: '▶️',
  google: '🔍',
  facebook: '👥',
  instagram: '📷',
};
