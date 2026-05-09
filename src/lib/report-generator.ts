import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
  PageBreak,
  LevelFormat,
} from 'docx';
import { saveAs } from 'file-saver';
import type { Edge } from '@xyflow/react';
import { type OsintEntity, ENTITY_ICONS } from './osint-types';

const COLOR_PRIMARY = '0E7490';
const COLOR_MUTED = '6B7280';
const COLOR_BORDER = 'CCCCCC';
const COLOR_GOOD = '15803D';
const COLOR_WARN = 'B45309';
const COLOR_BAD = 'B91C1C';

const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: COLOR_BORDER };
const cellBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

const TABLE_WIDTH = 9360;
const COL_LABEL = 3000;
const COL_VALUE = TABLE_WIDTH - COL_LABEL;

// ---------- text builders ----------
const h1 = (text: string) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, bold: true, color: COLOR_PRIMARY, size: 32 })],
    spacing: { before: 360, after: 200 },
  });
const h2 = (text: string) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, bold: true, color: COLOR_PRIMARY, size: 26 })],
    spacing: { before: 280, after: 140 },
  });
const h3 = (text: string) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text, bold: true, size: 22 })],
    spacing: { before: 200, after: 100 },
  });
const p = (text: string, opts: { italic?: boolean; muted?: boolean } = {}) =>
  new Paragraph({
    children: [
      new TextRun({
        text,
        italics: opts.italic,
        color: opts.muted ? COLOR_MUTED : undefined,
        size: 22,
      }),
    ],
    spacing: { after: 120 },
  });
const bullet = (text: string) =>
  new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    children: [new TextRun({ text, size: 22 })],
    spacing: { after: 60 },
  });
const spacer = () => new Paragraph({ children: [new TextRun('')], spacing: { after: 120 } });

function kvCell(text: string, bold = false, shaded = false, color?: string) {
  return new TableCell({
    borders: cellBorders,
    width: { size: bold ? COL_LABEL : COL_VALUE, type: WidthType.DXA },
    shading: shaded ? { fill: 'F1F5F9', type: ShadingType.CLEAR, color: 'auto' } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text: text || '—', bold, size: 20, color })] })],
  });
}
function kvTable(rows: Array<[string, string, string?]>) {
  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: [COL_LABEL, COL_VALUE],
    rows: rows.map(
      ([k, v, color]) =>
        new TableRow({ children: [kvCell(k, true, true), kvCell(v, false, false, color)] }),
    ),
  });
}

const formatHeader = (e: OsintEntity) => `${ENTITY_ICONS[e.type] ?? '•'} ${e.label}`;

function metaRows(meta?: Record<string, string>): Array<[string, string]> {
  if (!meta) return [];
  return Object.entries(meta)
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
    .map(([k, v]) => [k.replace(/_/g, ' '), String(v)] as [string, string]);
}

// ---------- source-aware grouping ----------
const SOURCE_KEYWORDS = {
  shodan: ['shodan'],
  censys: ['censys'],
  virustotal: ['virustotal', 'virus total'],
  twitter: ['twitter', 'tweet', 'nitter', '@'],
  youtube: ['youtube'],
  etherscan: ['etherscan', 'eth'],
  blockchain: ['blockchain.com', 'bitcoin', 'btc'],
  abuseipdb: ['abuseipdb', 'abuse'],
  scamadviser: ['scamadviser', 'trust score'],
  alienvault: ['alienvault', 'otx'],
  opensanctions: ['opensanctions', 'sanction'],
  polyswarm: ['polyswarm'],
  mitre: ['mitre', 'att&ck', 'attck'],
  crtsh: ['crt.sh'],
  unshorten: ['unshorten'],
  ipinfo: ['ipinfo'],
  maxmind: ['maxmind'],
  peeringdb: ['peeringdb'],
  google: ['google'],
  zet: ['zet passive', 'zet massive', 'zetalytics', 'passive dns'],
};

function matchesSource(e: OsintEntity, keys: string[]): boolean {
  const hay =
    `${e.label} ${e.type} ${Object.entries(e.metadata ?? {})
      .map(([k, v]) => `${k}:${v}`)
      .join(' ')}`.toLowerCase();
  return keys.some((k) => hay.includes(k));
}

function entitiesBy(entities: OsintEntity[], sourceKey: keyof typeof SOURCE_KEYWORDS) {
  return entities.filter((e) => matchesSource(e, SOURCE_KEYWORDS[sourceKey]));
}

// ---------- risk score ----------
function computeRiskScore(entities: OsintEntity[]): {
  score: number;
  band: 'LOW' | 'MEDIUM' | 'HIGH';
  color: string;
  drivers: string[];
} {
  const drivers: string[] = [];
  let score = 0;
  let count = 0;

  for (const e of entities) {
    if (e.label.includes('Leak-Check') && e.metadata?.breaches_found) {
      const bCount = Number(e.metadata.breaches_found);
      if (bCount > 0) {
        score += Math.min(100, bCount * 25);
        count++;
        drivers.push(`Leak-Check: ${bCount} breach(es) detected`);
      }
    }
  }

  for (const e of entitiesBy(entities, 'abuseipdb')) {
    const conf = Number(e.metadata?.abuse_confidence ?? e.metadata?.['abuse confidence'] ?? NaN);
    if (!Number.isNaN(conf)) {
      score += conf;
      count++;
      drivers.push(`AbuseIPDB confidence: ${conf}/100 (${e.label})`);
    }
  }
  for (const e of entitiesBy(entities, 'scamadviser')) {
    const trust = Number(e.metadata?.trust_score ?? e.metadata?.['trust score'] ?? NaN);
    if (!Number.isNaN(trust)) {
      const inverted = 100 - trust;
      score += inverted;
      count++;
      drivers.push(`ScamAdviser trust: ${trust}/100 → risk ${inverted}`);
    }
  }
  for (const e of entitiesBy(entities, 'virustotal')) {
    const mal = Number(e.metadata?.malicious ?? NaN);
    if (!Number.isNaN(mal) && mal > 0) {
      const v = Math.min(100, mal * 20);
      score += v;
      count++;
      drivers.push(`VirusTotal: ${mal} engines flagged malicious`);
    }
  }

  if (count === 0) {
    return {
      score: 0,
      band: 'LOW',
      color: COLOR_MUTED,
      drivers: ['No reputation data available — score defaults to LOW.'],
    };
  }
  const final = Math.round(score / count);
  const band = final >= 70 ? 'HIGH' : final >= 35 ? 'MEDIUM' : 'LOW';
  const color = band === 'HIGH' ? COLOR_BAD : band === 'MEDIUM' ? COLOR_WARN : COLOR_GOOD;
  return { score: final, band, color, drivers };
}

// ---------- target detection ----------
function pickPrimaryTarget(entities: OsintEntity[]): OsintEntity | null {
  const priority: OsintEntity['type'][] = [
    'domain',
    'ip',
    'eth_wallet',
    'btc_wallet',
    'person',
    'email',
    'organization',
  ];
  for (const t of priority) {
    const match = entities.find((e) => e.type === t);
    if (match) return match;
  }
  return entities[0] ?? null;
}

// ---------- entity → table block ----------
function entityBlock(e: OsintEntity): (Paragraph | Table)[] {
  const baseRows: Array<[string, string, string?]> = [
    ['Type', e.type],
    ['Label', e.label],
  ];
  if (e.platform) baseRows.push(['Platform', e.platform]);
  for (const r of metaRows(e.metadata)) baseRows.push(r);
  return [h3(formatHeader(e)), kvTable(baseRows), spacer()];
}

// =====================================================
export async function generateOsintReport(opts: {
  investigationName?: string;
  entities: OsintEntity[];
  edges: Edge[];
}) {
  const { investigationName, entities, edges } = opts;
  const generatedAt = new Date();
  const target = pickPrimaryTarget(entities);
  const risk = computeRiskScore(entities);

  const grouped = entities.reduce<Record<string, OsintEntity[]>>((acc, e) => {
    (acc[e.type] ||= []).push(e);
    return acc;
  }, {});
  const typeOrder: OsintEntity['type'][] = [
    'person', 'organization', 'email', 'phone', 'domain', 'ip',
    'eth_wallet', 'btc_wallet', 'short_url', 'twitter_profile',
    'facebook_profile', 'linkedin_profile',
    'youtube', 'web_search', 'social', 'sanction', 'mitre_technique',
    'hash', 'location',
  ];
  const typeCounts = typeOrder
    .filter((t) => grouped[t]?.length)
    .map((t) => [t.toUpperCase(), String(grouped[t].length)] as [string, string]);
  const entityById = new Map(entities.map((e) => [e.id, e]));

  const children: (Paragraph | Table)[] = [];

  // ---- Cover ----
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'OSDG INTELLIGENCE REPORT', bold: true, size: 44, color: COLOR_PRIMARY })],
      spacing: { before: 600, after: 200 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: investigationName ?? 'Untitled Investigation', size: 28 })],
      spacing: { after: 200 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `Generated ${generatedAt.toLocaleString()}`, size: 22, color: COLOR_MUTED })],
      spacing: { after: 200 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'Risk Score: ', bold: true, size: 26 }),
        new TextRun({ text: `${risk.score}/100 (${risk.band})`, bold: true, size: 26, color: risk.color }),
      ],
      spacing: { after: 600 },
    }),
  );

  // ---- 1. Entity Summary ----
  children.push(h1('1. Entity Summary'));
  if (target) {
    children.push(p('Primary investigation target:'));
    children.push(...entityBlock(target));
  } else {
    children.push(p('No primary target identified.', { muted: true }));
  }
  children.push(h3('Entity Breakdown'));
  children.push(kvTable(typeCounts.length ? typeCounts : [['Entities', '0']]));
  children.push(spacer());

  // ---- 2. Intelligence Brief ----
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(h1('2. Intelligence Brief'));
  children.push(p('Technical and reputation data from Shodan, Censys, and VirusTotal.', { muted: true }));

  const intelSources: Array<[string, OsintEntity[]]> = [
    ['Shodan', entitiesBy(entities, 'shodan')],
    ['Censys', entitiesBy(entities, 'censys')],
    ['VirusTotal', entitiesBy(entities, 'virustotal')],
    ['AbuseIPDB', entitiesBy(entities, 'abuseipdb')],
    ['ZET Massive Passive (Passive DNS)', entitiesBy(entities, 'zet')],
    ['AlienVault OTX', entitiesBy(entities, 'alienvault')],
    ['PolySwarm', entitiesBy(entities, 'polyswarm')],
    ['MITRE ATT&CK', entitiesBy(entities, 'mitre')],
  ];
  let intelHas = false;
  for (const [name, list] of intelSources) {
    if (!list.length) continue;
    intelHas = true;
    children.push(h2(`${name} (${list.length})`));
    for (const e of list) children.push(...entityBlock(e));
  }
  if (!intelHas) children.push(p('No intelligence data collected.', { muted: true }));

  // ---- 3. Social & Financial Footprint ----
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(h1('3. Social & Financial Footprint'));
  children.push(
    p('Public social activity (Twitter, YouTube) and on-chain wallet data (Etherscan, Blockchain.com).', {
      muted: true,
    }),
  );

  const sfSources: Array<[string, OsintEntity[]]> = [
    ['Twitter / X', entities.filter((e) => e.type === 'twitter_profile' || matchesSource(e, SOURCE_KEYWORDS.twitter))],
    ['Facebook', entities.filter((e) => e.type === 'facebook_profile' || (e.platform === 'facebook'))],
    ['LinkedIn', entities.filter((e) => e.type === 'linkedin_profile' || (e.platform === 'linkedin'))],
    ['YouTube', entities.filter((e) => e.type === 'youtube' || matchesSource(e, SOURCE_KEYWORDS.youtube))],
    ['Other Social', entities.filter((e) => e.type === 'social')],
    ['Etherscan / ETH', entities.filter((e) => e.type === 'eth_wallet' || matchesSource(e, SOURCE_KEYWORDS.etherscan))],
    ['Blockchain.com / BTC', entities.filter((e) => e.type === 'btc_wallet' || matchesSource(e, SOURCE_KEYWORDS.blockchain))],
  ];
  // de-dup across the SF buckets
  const seen = new Set<string>();
  let sfHas = false;
  for (const [name, listRaw] of sfSources) {
    const list = listRaw.filter((e) => !seen.has(e.id));
    list.forEach((e) => seen.add(e.id));
    if (!list.length) continue;
    sfHas = true;
    children.push(h2(`${name} (${list.length})`));
    for (const e of list) children.push(...entityBlock(e));
  }
  if (!sfHas) children.push(p('No social or financial signals collected.', { muted: true }));

  // ---- 4. Risk Score ----
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(h1('4. Risk Score'));
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: 'Combined safety rating: ', bold: true, size: 26 }),
        new TextRun({
          text: `${risk.score}/100 — ${risk.band}`,
          bold: true,
          size: 28,
          color: risk.color,
        }),
      ],
      spacing: { after: 200 },
    }),
  );
  children.push(p('Computed from AbuseIPDB confidence, ScamAdviser trust (inverted), and VirusTotal engine hits.'));
  children.push(h3('Drivers'));
  for (const d of risk.drivers) children.push(bullet(d));
  children.push(spacer());

  // ---- 5. Full Entity Catalog ----
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(h1('5. Full Entity Catalog'));
  for (const t of typeOrder) {
    const list = grouped[t];
    if (!list || list.length === 0) continue;
    children.push(h2(`${ENTITY_ICONS[t] ?? '•'} ${t.toUpperCase()} (${list.length})`));
    for (const e of list) children.push(...entityBlock(e));
  }

  // ---- 6. Relationships ----
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(h1('6. Relationship Map'));
  if (edges.length === 0) {
    children.push(p('No relationships were recorded.', { muted: true }));
  } else {
    children.push(p(`A total of ${edges.length} directional relationships were observed:`));
    for (const edge of edges) {
      const src = entityById.get(edge.source);
      const tgt = entityById.get(edge.target);
      const label = (edge as any).label ?? 'related to';
      children.push(
        bullet(
          `${src ? formatHeader(src) : edge.source}  ──[ ${label} ]──►  ${tgt ? formatHeader(tgt) : edge.target}`,
        ),
      );
    }
  }

  // ---- 7. Sources ----
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(h1('7. Sources & Methodology'));
  children.push(p('All 26 integrated open-source intelligence and threat-intel data providers:'));
  [
    'WHOIS XML API — domain registration data',
    'NumVerify — phone validation',
    'EmailRep.io — email reputation & breach exposure',
    'GitHub Public API — developer profile lookup',
    'Reddit Public API — Reddit profile metadata',
    'Twitter / X API v2 — profiles & recent tweets',
    'Instagram public profile endpoint',
    'TikTok Fast & Reliable — extended social metadata',
    'YouTube Data API v3 — channel & video metadata',
    'Facebook Pages Scraper — public page insights',
    'LinkedIn Real-Time Scraper — professional profile data',
    'Google Custom Search API — web mentions',
    'DuckDuckGo Instant Answer — fallback web search',
    'WHOIS Pro & WhoisFreaks — advanced domain ownership details',
    'Leak-Check.Net — data breach & credential exposure alerts',
    'Domain & IP Intelligence — threat risk & reputation scoring',
    'Email Verifier / Checker — deliverability & catch-all status',
    'The Harvester — OSDG email and subdomain enumeration',
    'Moocher.io — network threat & malicious actor intelligence',
    'Google DNS-over-HTTPS — domain resolution',
    'crt.sh — Certificate Transparency / subdomain enumeration',
    'ip-api.com — IP geolocation & ISP',
    'IPinfo — IP intelligence',
    'MaxMind GeoIP — geolocation',
    'PeeringDB — network / ASN data',
    'Shodan — exposed services & CVEs',
    'Censys — host/service deep scan',
    'VirusTotal — multi-engine reputation',
    'AbuseIPDB — abuse confidence score',
    'ScamAdviser — trust / scam rating',
    'AlienVault OTX — threat pulses',
    'PolySwarm — file hash & URL scanning',
    'MITRE ATT&CK — technique mapping',
    'OpenSanctions — sanctions / PEP screening',
    'Etherscan — ETH wallet balance & transactions',
    'Blockchain.com — BTC wallet balance & transactions',
    'ZET Massive Passive — historical passive DNS lookups for IP addresses',
    'Unshorten.me — short-URL resolution',

  ].forEach((s) => children.push(bullet(s)));

  children.push(spacer());
  children.push(
    p(
      'All data is derived from publicly accessible sources at the time of generation. Accuracy depends on the upstream provider and may change over time.',
      { italic: true, muted: true },
    ),
  );

  const doc = new Document({
    creator: 'OSDG',
    title: `OSDG Report — ${investigationName ?? 'Investigation'}`,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const safeName = (investigationName ?? 'osdg-report').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
  saveAs(blob, `${safeName}-${Date.now()}.docx`);
}
