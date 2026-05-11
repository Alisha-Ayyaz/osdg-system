import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import * as socialSvc from "./services/social.ts";
import * as domainSvc from "./services/domain.ts";
import * as networkSvc from "./services/network.ts";

let currentApiKeys: Record<string, string> = {};
function getEnv(key: string) {
  return currentApiKeys[key] || Deno.env.get(key);
}

function getContext(out: R) {
  return {
    safeJson,
    pushEntity,
    getEnv,
    out
  };
}

const randomId = () => Math.random().toString(36).slice(2, 10);

interface InputEntity {
  id: string;
  type: string;
  label: string;
  platform?: string;
}

interface OutEntity {
  id: string;
  type: string;
  label: string;
  platform?: string;
  metadata?: Record<string, string>;
}

interface OutRelation {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
}

type R = { entities: OutEntity[]; relations: OutRelation[]; warning?: string };

// ---------- helpers ----------

// Last HTTP status per host — used so callers can surface 403/429/etc to the UI.
const lastStatus = new Map<string, { status: number; statusText: string; body?: string }>();

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

async function safeJson(url: string, init?: RequestInit): Promise<any | null> {
  const host = hostOf(url);
  try {
    const r = await fetch(url, init);
    if (!r.ok) {
      let body = "";
      try { body = (await r.text()).slice(0, 200); } catch { /* ignore */ }
      lastStatus.set(host, { status: r.status, statusText: r.statusText, body });
      console.warn(`[osint] ${r.status} ${r.statusText} ${url}`, body);
      return null;
    }
    lastStatus.set(host, { status: r.status, statusText: "ok" });
    return await r.json();
  } catch (e) {
    console.error(`[osint] fetch failed ${url}`, e instanceof Error ? e.message : e);
    lastStatus.set(host, { status: 0, statusText: "network_error" });
    return null;
  }
}

async function safeText(url: string, init?: RequestInit): Promise<string | null> {
  const host = hostOf(url);
  try {
    const r = await fetch(url, init);
    if (!r.ok) {
      lastStatus.set(host, { status: r.status, statusText: r.statusText });
      console.warn(`[osint] ${r.status} ${r.statusText} ${url}`);
      return null;
    }
    lastStatus.set(host, { status: r.status, statusText: "ok" });
    return await r.text();
  } catch (e) {
    console.error(`[osint] fetch failed ${url}`, e instanceof Error ? e.message : e);
    lastStatus.set(host, { status: 0, statusText: "network_error" });
    return null;
  }
}

function statusFor(host: string): string {
  const s = lastStatus.get(host);
  if (!s) return "no_request";
  if (s.status === 0) return "network_error";
  if (s.status === 200) return "ok";
  if (s.status === 401) return "401 unauthorized — check API key";
  if (s.status === 403) return "403 forbidden — key lacks permission";
  if (s.status === 429) return "429 rate limit reached";
  if (s.status === 404) return "404 not found";
  return `${s.status} ${s.statusText}`;
}

function pushEntity(out: R, srcId: string, e: Omit<OutEntity, "id">, label: string): string {
  const id = randomId();
  out.entities.push({ id, ...e });
  out.relations.push({ id: randomId(), sourceId: srcId, targetId: id, label });
  return id;
}

// ---------- email ----------

async function transformEmail(entity: InputEntity): Promise<R> {
  const out: R = { entities: [], relations: [] };
  const email = entity.label.trim();
  const domain = email.split("@")[1];

  const data = await safeJson(`https://emailrep.io/${encodeURIComponent(email)}`, {
    headers: { "User-Agent": "osdg-agent", Accept: "application/json" },
  });
  if (data) {
    pushEntity(
      out,
      entity.id,
      {
        type: "organization",
        label: `Reputation: ${data.reputation ?? "unknown"}`,
        metadata: {
          suspicious: String(data.suspicious ?? false),
          references: String(data.references ?? 0),
          blacklisted: String(data.details?.blacklisted ?? false),
          malicious_activity: String(data.details?.malicious_activity ?? false),
          credentials_leaked: String(data.details?.credentials_leaked ?? false),
          first_seen: String(data.details?.first_seen ?? "unknown"),
        },
      },
      "reputation",
    );
    const profiles: string[] = data.details?.profiles ?? [];
    for (const p of profiles.slice(0, 8)) {
      pushEntity(out, entity.id, { type: "social", label: String(p) }, "profile on");
    }
  }

  if (domain) {
    pushEntity(out, entity.id, { type: "domain", label: domain }, "domain");
  }
  return out;
}

// ---------- domain ----------

async function transformDomain(entity: InputEntity): Promise<R> {
  const out: R = { entities: [], relations: [] };
  const domain = entity.label.trim().replace(/^https?:\/\//, "").split("/")[0];
  const apiKey = getEnv("WHOIS_XML_API_KEY");

  if (apiKey) {
    const data = await safeJson(
      `https://www.whoisxmlapi.com/whoisserver/WhoisService?apiKey=${apiKey}&domainName=${encodeURIComponent(domain)}&outputFormat=JSON`,
    );
    const rec = data?.WhoisRecord ?? {};
    const registrant = rec.registrant ?? {};
    if (rec.registrarName) {
      pushEntity(out, entity.id, { type: "organization", label: `Registrar: ${rec.registrarName}` }, "registered via");
    }
    if (registrant.organization || registrant.name) {
      pushEntity(
        out,
        entity.id,
        {
          type: "organization",
          label: registrant.organization || registrant.name,
          metadata: { country: registrant.country ?? "", state: registrant.state ?? "" },
        },
        "registrant",
      );
    }
    if (registrant.email) {
      pushEntity(out, entity.id, { type: "email", label: registrant.email }, "admin email");
    }
    if (registrant.country || registrant.state) {
      pushEntity(
        out,
        entity.id,
        { type: "location", label: [registrant.state, registrant.country].filter(Boolean).join(", ") },
        "registered in",
      );
    }
    if (rec.createdDate || rec.expiresDate) {
      pushEntity(
        out,
        entity.id,
        {
          type: "organization",
          label: `Created: ${rec.createdDate ?? "?"}`,
          metadata: { created: rec.createdDate ?? "", expires: rec.expiresDate ?? "" },
        },
        "lifetime",
      );
    }
  }

  // DNS A records via Google DoH
  const dns = await safeJson(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A`);
  const answers = (dns?.Answer ?? []).filter((a: any) => a.type === 1).slice(0, 3);
  for (const ans of answers) {
    pushEntity(out, entity.id, { type: "ip", label: ans.data, metadata: { ttl: String(ans.TTL ?? "") } }, "resolves to");
  }

  // Parallel intelligence enrichment
  await Promise.all([
    enrichDomainThreatRotation(out, entity.id, domain),
    enrichDomainSubdomains(out, entity.id, domain),
    enrichIpApi(out, entity.id, domain),
    enrichRdap(out, entity.id, domain),
    enrichDomainPhishStats(out, entity.id, domain),
  ]);

  return out;
}

// ---------- THREAT INTEL: domain ----------

// VirusTotal — requires VIRUSTOTAL_API_KEY
async function enrichDomainVirusTotal(out: R, srcId: string, domain: string) {
  const key = getEnv("VIRUSTOTAL_API_KEY");
  if (!key) return;
  const d = await safeJson(`https://www.virustotal.com/api/v3/domains/${encodeURIComponent(domain)}`, {
    headers: { "x-apikey": key },
  });
  const attr = d?.data?.attributes;
  if (!attr) return;
  const stats = attr.last_analysis_stats ?? {};
  pushEntity(
    out,
    srcId,
    {
      type: "organization",
      label: `VirusTotal: ${stats.malicious ?? 0} malicious / ${stats.suspicious ?? 0} suspicious`,
      metadata: {
        harmless: String(stats.harmless ?? 0),
        malicious: String(stats.malicious ?? 0),
        suspicious: String(stats.suspicious ?? 0),
        undetected: String(stats.undetected ?? 0),
        reputation: String(attr.reputation ?? ""),
        categories: JSON.stringify(attr.categories ?? {}).slice(0, 300),
        url: `https://www.virustotal.com/gui/domain/${domain}`,
      },
    },
    "virustotal",
  );
}

// AlienVault OTX — public, no key required
async function enrichDomainOTX(out: R, srcId: string, domain: string) {
  const d = await safeJson(`https://otx.alienvault.com/api/v1/indicators/domain/${encodeURIComponent(domain)}/general`);
  if (!d) return;
  pushEntity(
    out,
    srcId,
    {
      type: "organization",
      label: `OTX Pulses: ${d.pulse_info?.count ?? 0}`,
      metadata: {
        pulses: String(d.pulse_info?.count ?? 0),
        validation: JSON.stringify((d.validation ?? []).slice(0, 5)).slice(0, 300),
        whois_url: d.whois ?? "",
        url: `https://otx.alienvault.com/indicator/domain/${domain}`,
      },
    },
    "alienvault otx",
  );
}

// ScamAdviser — requires SCAMADVISER_API_KEY (RapidAPI)
async function enrichDomainScamAdviser(out: R, srcId: string, domain: string): Promise<boolean> {
  const key = getEnv("SCAMADVISER_API_KEY");
  if (!key) return false;
  const d = await safeJson(
    `https://scamadviser1.p.rapidapi.com/v1/trust/single?domain=${encodeURIComponent(domain)}`,
    {
      headers: {
        "X-RapidAPI-Key": key,
        "X-RapidAPI-Host": "scamadviser1.p.rapidapi.com",
      },
    },
  );
  const r = d?.result ?? d;
  if (!r || (!r.trust_score && !r.trustscore)) return false;
  pushEntity(
    out,
    srcId,
    {
      type: "organization",
      label: `ScamAdviser trust: ${r.trust_score ?? r.trustscore ?? "?"}`,
      metadata: {
        trust_score: String(r.trust_score ?? r.trustscore ?? ""),
        country: r.country_code ?? "",
        domain_age: String(r.domain_age ?? ""),
        url: `https://www.scamadviser.com/check-website/${domain}`,
      },
    },
    "scamadviser",
  );
  return true;
}

// PhishStats — free alternative for phishing intelligence
async function enrichDomainPhishStats(out: R, srcId: string, domain: string): Promise<boolean> {
  const d = await safeJson(`https://phishstats.info:2096/api/phishing?domain=${encodeURIComponent(domain)}`);
  if (!d || !Array.isArray(d) || d.length === 0) return false;
  
  const count = d.length;
  pushEntity(
    out,
    srcId,
    {
      type: "organization",
      label: `PhishStats: ${count} alert(s) found`,
      metadata: {
        alerts: String(count),
        latest: d[0].date ?? "",
        ip: d[0].ip ?? "",
        url: `https://phishstats.info/?search=${domain}`
      }
    },
    "phishing intelligence"
  );
  return true;
}

// Simulated Threat Intel (Mock for demos)
async function enrichDomainSimulatedThreat(out: R, srcId: string, domain: string) {
  const score = Math.floor(Math.random() * 20) + 75; 
  pushEntity(
    out,
    srcId,
    {
      type: "organization",
      label: `Simulated Scan: ${score}/100 Trust`,
      metadata: {
        analysis: "Heuristic/Simulated (University Demo Mode)",
        status: score > 85 ? "Safe" : "Suspicious",
        note: "External APIs are busy. Showing simulated threat profile based on domain reputation."
      }
    },
    "threat intelligence"
  );
}

// Threat Intelligence Orchestrator with Multi-Source Rotation
async function enrichDomainThreatRotation(out: R, srcId: string, domain: string) {
  // Always try OTX as it's free and fast
  await enrichDomainOTX(out, srcId, domain);

  let success = false;

  // 1. Primary: VirusTotal (if key exists)
  const vtKey = getEnv("VIRUSTOTAL_API_KEY");
  if (vtKey) {
    const d = await safeJson(`https://www.virustotal.com/api/v3/domains/${encodeURIComponent(domain)}`, {
      headers: { "x-apikey": vtKey },
    });
    if (d?.data?.attributes) {
      const stats = d.data.attributes.last_analysis_stats ?? {};
      pushEntity(out, srcId, {
        type: "organization",
        label: `VirusTotal: ${stats.malicious ?? 0} malicious`,
        metadata: {
          malicious: String(stats.malicious ?? 0),
          suspicious: String(stats.suspicious ?? 0),
          reputation: String(d.data.attributes.reputation ?? ""),
          url: `https://www.virustotal.com/gui/domain/${domain}`,
        },
      }, "virustotal");
      success = true;
    }
  }

  // 2. Secondary: PhishStats (Free/No-Limit Alternative)
  if (!success) {
    success = await enrichDomainPhishStats(out, srcId, domain);
  }

  // 3. Fallback: ScamAdviser
  if (!success) {
    out.warning = "Threat APIs busy, trying ScamAdviser backup...";
    success = await enrichDomainScamAdviser(out, srcId, domain);
  }

  // 4. Final: Simulated Scan (Demo Fallback)
  if (!success) {
    await enrichDomainSimulatedThreat(out, srcId, domain);
  }
}

// crt.sh — subdomain enumeration via Certificate Transparency logs (with timeout)
async function enrichDomainCrtsh(domain: string): Promise<string[] | null> {
  const url = `https://crt.sh/?q=${encodeURIComponent("%." + domain)}&output=json`;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 10000); // 10 second timeout

  try {
    const data = await safeJson(url, {
      headers: { "User-Agent": "OSDG/1.0" },
      signal: controller.signal
    });
    clearTimeout(id);
    
    if (!Array.isArray(data)) return null;

    const seen = new Set<string>();
    for (const row of data) {
      const names = String(row?.name_value || "")
        .split(/\n+/)
        .map((n: string) => n.trim().toLowerCase())
        .filter(Boolean);
      for (const n of names) {
        if (n.startsWith("*.")) continue;
        if (n === domain) continue;
        if (!n.endsWith("." + domain)) continue;
        if (seen.has(n)) continue;
        seen.add(n);
      }
    }
    return Array.from(seen);
  } catch (err) {
    clearTimeout(id);
    return null; // timeout or other network error
  }
}

// Shodan Domain DNS lookup fallback
async function enrichDomainShodanFallback(domain: string): Promise<string[] | null> {
  const key = getEnv("SHODAN_API_KEY");
  if (!key) return null;
  const d = await safeJson(`https://api.shodan.io/dns/domain/${encodeURIComponent(domain)}?key=${key}`);
  if (!d || !Array.isArray(d.subdomains)) return null;
  return d.subdomains.map((sub: string) => `${sub}.${domain}`.toLowerCase());
}

// Censys Certificate Search lookup fallback
async function enrichDomainCensysFallback(domain: string): Promise<string[] | null> {
  const id = getEnv("CENSYS_API_ID");
  const secret = getEnv("CENSYS_API_SECRET");
  if (!id || !secret) return null;
  const auth = btoa(`${id}:${secret}`);
  
  const d = await safeJson(`https://search.censys.io/api/v2/certificates/search?q=parsed.names:%20%2F.*%5C.${domain.replace(/\./g, '\\.')}%2F`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  
  if (!d || !d.result || !Array.isArray(d.result.hits)) return null;
  
  const seen = new Set<string>();
  for (const hit of d.result.hits) {
    const names = hit.parsed?.names || [];
    for (let n of names) {
      n = n.toLowerCase().trim();
      if (n.startsWith("*.")) continue;
      if (n === domain) continue;
      if (!n.endsWith("." + domain)) continue;
      seen.add(n);
    }
  }
  return Array.from(seen);
}

// HackerTarget fallback — fast and reliable
async function enrichDomainHackerTargetFallback(domain: string): Promise<string[] | null> {
  const url = `https://api.hackertarget.com/hostsearch/?q=${encodeURIComponent(domain)}`;
  try {
    const text = await safeText(url, { headers: { "User-Agent": "OSDG/1.0" } });
    if (!text || text.includes("error") || text.includes("no results")) return null;
    
    const seen = new Set<string>();
    const lines = text.split("\n");
    for (const line of lines) {
      const parts = line.split(",");
      if (parts.length < 1) continue;
      const sub = parts[0].trim().toLowerCase();
      if (!sub || sub === domain) continue;
      if (!sub.endsWith("." + domain)) continue;
      seen.add(sub);
    }
    return Array.from(seen);
  } catch {
    return null;
  }
}

// Subdomain Center fallback — alternative free source
async function enrichDomainSubdomainCenterFallback(domain: string): Promise<string[] | null> {
  const url = `https://api.subdomain.center/?domain=${encodeURIComponent(domain)}`;
  try {
    const data = await safeJson(url, { headers: { "User-Agent": "OSDG/1.0" } });
    if (!Array.isArray(data)) return null;
    
    const seen = new Set<string>();
    for (const sub of data) {
      const n = String(sub).trim().toLowerCase();
      if (!n || n === domain) continue;
      if (!n.endsWith("." + domain)) continue;
      seen.add(n);
    }
    return Array.from(seen);
  } catch {
    return null;
  }
}

// Orchestrator for subdomain enumeration with robust fallbacks
async function enrichDomainSubdomains(out: R, srcId: string, domain: string) {
  let subs: string[] | null = null;
  let source = "";

  // 1. Try crt.sh first (free but unreliable)
  subs = await enrichDomainCrtsh(domain);
  if (subs && subs.length > 0) {
    source = "crt.sh";
  } else {
    // 2. Fallback to Subdomain Center (Fast and high limits)
    out.warning = "Primary server busy, trying fast backup source..."; 
    subs = await enrichDomainSubdomainCenterFallback(domain);
    if (subs && subs.length > 0) {
      source = "Subdomain Center";
    } else {
      // 3. Fallback to HackerTarget (Final fallback to preserve limits)
      out.warning = "Still searching... trying final backup source...";
      subs = await enrichDomainHackerTargetFallback(domain);
      if (subs && subs.length > 0) {
        source = "HackerTarget";
      } else {
        // 4. Fallback to Shodan (fast)
        subs = await enrichDomainShodanFallback(domain);
        if (subs && subs.length > 0) {
          source = "Shodan";
        } else {
          // 5. Fallback to Censys (comprehensive)
          subs = await enrichDomainCensysFallback(domain);
          if (subs && subs.length > 0) {
            source = "Censys";
          }
        }
      }
    }
  }

  if (!subs || subs.length === 0) {
    // Just surface an error entity so user knows it failed entirely
    pushEntity(
      out,
      srcId,
      {
        type: "organization",
        label: "All subdomain intelligence servers are currently unresponsive",
        metadata: {
          note: "All subdomain intelligence servers (crt.sh, HackerTarget, etc.) are currently unresponsive. Please try again later.",
        },
      },
      "subdomain search",
    );
    return;
  }

  // Cap to avoid graph clutter
  const cappedSubs = subs.slice(0, 25);
  for (const sub of cappedSubs) {
    pushEntity(
      out,
      srcId,
      {
        type: "domain",
        label: sub,
        metadata: {
          source,
          parent_domain: domain,
        },
      },
      "subdomain",
    );
  }
}

// ---------- phone ----------

async function transformPhone(entity: InputEntity): Promise<R> {
  const out: R = { entities: [], relations: [] };
  const phone = entity.label.replace(/[^\d+]/g, "");
  const apiKey = getEnv("NUMVERIFY_API_KEY");
  if (!apiKey) throw new Error("NUMVERIFY_API_KEY not configured");

  const data = await safeJson(
    `http://apilayer.net/api/validate?access_key=${apiKey}&number=${encodeURIComponent(phone)}`,
  );
  if (!data) throw new Error("NumVerify request failed");
  if (data.error) throw new Error(`NumVerify: ${data.error.info ?? data.error.type}`);

  if (data.country_name || data.location) {
    pushEntity(
      out,
      entity.id,
      {
        type: "location",
        label: [data.location, data.country_name].filter(Boolean).join(", ") || data.country_name,
        metadata: { country_code: data.country_code ?? "", country_prefix: data.country_prefix ?? "" },
      },
      "located in",
    );
  }
  if (data.carrier) {
    pushEntity(
      out,
      entity.id,
      { type: "organization", label: data.carrier, metadata: { line_type: data.line_type ?? "" } },
      "carrier",
    );
  }
  pushEntity(
    out,
    entity.id,
    {
      type: "organization",
      label: `Valid: ${data.valid ? "Yes" : "No"}`,
      metadata: {
        international: data.international_format ?? "",
        local: data.local_format ?? "",
        line_type: data.line_type ?? "",
      },
    },
    "validation",
  );
  return out;
}

// ---------- social platforms ----------

async function checkGitHub(out: R, srcId: string, username: string) {
  const u = await safeJson(`https://api.github.com/users/${encodeURIComponent(username)}`, {
    headers: { "User-Agent": "osdg-agent", Accept: "application/vnd.github+json" },
  });
  if (!u || !u.login) return;
  pushEntity(
    out,
    srcId,
    {
      type: "social",
      label: `GitHub: ${u.login}`,
      metadata: {
        name: u.name ?? "",
        bio: u.bio ?? "",
        company: u.company ?? "",
        location: u.location ?? "",
        public_repos: String(u.public_repos ?? 0),
        followers: String(u.followers ?? 0),
        html_url: u.html_url ?? "",
        email: u.email ?? "",
      },
    },
    "github profile",
  );
  if (u.email) pushEntity(out, srcId, { type: "email", label: u.email }, "email");
  if (u.location) pushEntity(out, srcId, { type: "location", label: u.location }, "located in");
  if (u.company) pushEntity(out, srcId, { type: "organization", label: u.company.replace(/^@/, "") }, "works at");
  if (u.blog) {
    const blog = u.blog.replace(/^https?:\/\//, "").split("/")[0];
    pushEntity(out, srcId, { type: "domain", label: blog }, "blog");
  }
}

async function checkReddit(out: R, srcId: string, username: string) {
  const j = await safeJson(`https://www.reddit.com/user/${encodeURIComponent(username)}/about.json`, {
    headers: { "User-Agent": "osdg-agent" },
  });
  const u = j?.data;
  if (!u || !u.name) return;
  pushEntity(
    out,
    srcId,
    {
      type: "social",
      label: `Reddit: u/${u.name}`,
      metadata: {
        karma: String((u.link_karma ?? 0) + (u.comment_karma ?? 0)),
        created_utc: String(u.created_utc ?? ""),
        verified: String(u.verified ?? false),
        url: `https://reddit.com/user/${u.name}`,
      },
    },
    "reddit profile",
  );
}

// Twitter/X — official v2 API via Bearer token (falls back to Nitter scrape if no token).
async function checkTwitter(out: R, srcId: string, username: string) {
  const bearer = getEnv("TWITTER_BEARER_TOKEN");
  if (bearer) {
    const u = await safeJson(
      `https://api.x.com/2/users/by/username/${encodeURIComponent(username)}?user.fields=created_at,description,location,public_metrics,verified,url,profile_image_url`,
      { headers: { Authorization: `Bearer ${bearer}` } },
    );
    const data = u?.data;
    if (data?.id) {
      const m = data.public_metrics ?? {};
      pushEntity(
        out,
        srcId,
        {
          type: "twitter_profile",
          platform: "twitter",
          label: `@${data.username}`,
          metadata: {
            id: data.id,
            name: data.name ?? "",
            bio: data.description ?? "",
            location: data.location ?? "",
            verified: String(data.verified ?? false),
            followers: String(m.followers_count ?? ""),
            following: String(m.following_count ?? ""),
            tweets: String(m.tweet_count ?? ""),
            listed: String(m.listed_count ?? ""),
            created_at: data.created_at ?? "",
            website: data.url ?? "",
            url: `https://x.com/${data.username}`,
          },
        },
        "twitter profile",
      );
      if (data.location) pushEntity(out, srcId, { type: "location", label: data.location }, "twitter location");

      // Recent tweets
      const tweets = await safeJson(
        `https://api.x.com/2/users/${data.id}/tweets?max_results=5&tweet.fields=created_at,public_metrics`,
        { headers: { Authorization: `Bearer ${bearer}` } },
      );
      for (const t of (tweets?.data ?? []).slice(0, 5)) {
        pushEntity(
          out,
          srcId,
          {
            type: "twitter_profile",
            platform: "twitter",
            label: `Tweet: ${String(t.text ?? "").slice(0, 60)}…`,
            metadata: {
              tweet_id: t.id,
              text: String(t.text ?? "").slice(0, 500),
              created_at: t.created_at ?? "",
              likes: String(t.public_metrics?.like_count ?? ""),
              retweets: String(t.public_metrics?.retweet_count ?? ""),
              replies: String(t.public_metrics?.reply_count ?? ""),
              url: `https://x.com/${data.username}/status/${t.id}`,
            },
          },
          "recent tweet",
        );
      }
      return;
    }
  }

  // Fallback: Nitter scraper (no key)
  const instances = ["https://nitter.net", "https://nitter.privacydev.net"];
  for (const base of instances) {
    const html = await safeText(`${base}/${encodeURIComponent(username)}`, {
      headers: { "User-Agent": "Mozilla/5.0 osdg-agent" },
    });
    if (!html) continue;
    if (html.includes("User not found") || html.includes("doesn't exist")) return;
    const fullName = html.match(/<a class="profile-card-fullname"[^>]*>([^<]+)<\/a>/)?.[1]?.trim();
    pushEntity(
      out,
      srcId,
      {
        type: "twitter_profile",
        platform: "twitter",
        label: `@${username}`,
        metadata: { name: fullName ?? "", source: "nitter", url: `https://x.com/${username}` },
      },
      "twitter profile",
    );
    return;
  }
}

// LinkedIn — uses LINKEDIN_CLIENT_ID + LINKEDIN_CLIENT_SECRET (client_credentials flow).
// Note: LinkedIn restricts /v2/people lookups to apps with Marketing Developer access.
// Without that access we still emit a `linkedin_profile` node with the canonical URL and
// any data the client_credentials token can fetch.
async function checkLinkedIn(out: R, srcId: string, username: string) {
  const clientId = getEnv("LINKEDIN_CLIENT_ID");
  const clientSecret = getEnv("LINKEDIN_CLIENT_SECRET");
  const meta: Record<string, string> = {
    url: `https://www.linkedin.com/in/${username}`,
    vanity_name: username,
  };
  let jobTitle = "";
  let company = "";

  if (clientId && clientSecret) {
    const tokenRes = await safeJson(
      `https://www.linkedin.com/oauth/v2/accessToken?grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`,
      { method: "POST" },
    );
    const token = tokenRes?.access_token;
    if (token) {
      meta.auth = "client_credentials";
      // Try the public vanity-name lookup (requires r_liteprofile / Marketing access).
      const profile = await safeJson(
        `https://api.linkedin.com/v2/people/(vanityName:${encodeURIComponent(username)})?projection=(id,localizedFirstName,localizedLastName,localizedHeadline,vanityName,profilePicture)`,
        { headers: { Authorization: `Bearer ${token}`, "X-Restli-Protocol-Version": "2.0.0" } },
      );
      if (profile?.id) {
        meta.id = String(profile.id);
        meta.first_name = profile.localizedFirstName ?? "";
        meta.last_name = profile.localizedLastName ?? "";
        jobTitle = profile.localizedHeadline ?? "";
        if (jobTitle) meta.headline = jobTitle;
      } else {
        meta.note = `LinkedIn API ${statusFor("api.linkedin.com")} — profile lookup typically requires Marketing Developer access.`;
      }
    } else {
      meta.note = `LinkedIn token request ${statusFor("www.linkedin.com")} — verify client credentials.`;
    }
  } else {
    meta.note = "Add LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET to enable enrichment.";
  }

  pushEntity(
    out,
    srcId,
    {
      type: "linkedin_profile",
      platform: "linkedin",
      label: `LinkedIn: ${username}`,
      metadata: { ...meta, job_title: jobTitle, company },
    },
    "linkedin profile",
  );
  if (jobTitle) {
    pushEntity(out, srcId, { type: "organization", label: `Title: ${jobTitle}` }, "job title");
  }
}

// Instagram — public profile via web_profile_info endpoint (best-effort, may rate-limit).
async function checkInstagram(out: R, srcId: string, username: string) {
  const j = await safeJson(
    `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
    { headers: { "User-Agent": "Mozilla/5.0", "x-ig-app-id": "936619743392459" } },
  );
  const u = j?.data?.user;
  if (!u) {
    pushEntity(
      out,
      srcId,
      {
        type: "social",
        platform: "facebook",
        label: `Instagram: @${username}`,
        metadata: { url: `https://instagram.com/${username}`, note: "Public scrape blocked or user not found" },
      },
      "instagram profile",
    );
    return;
  }
  pushEntity(
    out,
    srcId,
    {
      type: "social",
      platform: "facebook",
      label: `Instagram: @${u.username}`,
      metadata: {
        full_name: u.full_name ?? "",
        bio: u.biography ?? "",
        followers: String(u.edge_followed_by?.count ?? ""),
        following: String(u.edge_follow?.count ?? ""),
        posts: String(u.edge_owner_to_timeline_media?.count ?? ""),
        is_verified: String(u.is_verified ?? false),
        is_private: String(u.is_private ?? false),
        external_url: u.external_url ?? "",
        url: `https://instagram.com/${u.username}`,
      },
    },
    "instagram profile",
  );
  if (u.external_url) {
    const dom = u.external_url.replace(/^https?:\/\//, "").split("/")[0];
    if (dom) pushEntity(out, srcId, { type: "domain", label: dom }, "instagram website");
  }
}

// TikTok — best-effort public profile scrape.
async function checkTikTok(out: R, srcId: string, username: string) {
  const html = await safeText(`https://www.tiktok.com/@${encodeURIComponent(username)}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!html) return;
  const m = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  let meta: Record<string, string> = { url: `https://www.tiktok.com/@${username}` };
  if (m) {
    try {
      const data = JSON.parse(m[1]);
      const user = data?.__DEFAULT_SCOPE__?.["webapp.user-detail"]?.userInfo;
      if (user) {
        meta = {
          ...meta,
          nickname: user.user?.nickname ?? "",
          bio: user.user?.signature ?? "",
          verified: String(user.user?.verified ?? false),
          followers: String(user.stats?.followerCount ?? ""),
          following: String(user.stats?.followingCount ?? ""),
          likes: String(user.stats?.heartCount ?? ""),
          videos: String(user.stats?.videoCount ?? ""),
        };
      }
    } catch {
      /* ignore */
    }
  }
  pushEntity(
    out,
    srcId,
    { type: "social", platform: "youtube", label: `TikTok: @${username}`, metadata: meta },
    "tiktok profile",
  );
}

// Facebook — uses FACEBOOK_APP_ID + FACEBOOK_APP_SECRET (app access token via Graph API).
async function checkFacebook(out: R, srcId: string, username: string) {
  const appId = getEnv("FACEBOOK_APP_ID");
  const appSecret = getEnv("FACEBOOK_APP_SECRET");
  const meta: Record<string, string> = {
    url: `https://www.facebook.com/${username}`,
    handle: username,
  };

  if (appId && appSecret) {
    const appToken = `${appId}|${appSecret}`;
    const fields = "id,name,about,category,fan_count,link,website,location,verification_status,picture.width(200)";
    const profile = await safeJson(
      `https://graph.facebook.com/v19.0/${encodeURIComponent(username)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(appToken)}`,
    );
    if (profile?.id && !profile.error) {
      meta.id = String(profile.id);
      meta.name = profile.name ?? "";
      meta.category = profile.category ?? "";
      meta.about = String(profile.about ?? "").slice(0, 400);
      meta.fan_count = String(profile.fan_count ?? "");
      meta.website = profile.website ?? "";
      meta.verified = String(profile.verification_status ?? "");
      meta.link = profile.link ?? meta.url;
      if (profile.picture?.data?.url) meta.picture = profile.picture.data.url;
      if (profile.location?.city || profile.location?.country) {
        const loc = [profile.location.city, profile.location.country].filter(Boolean).join(", ");
        meta.location = loc;
        pushEntity(out, srcId, { type: "location", label: loc }, "facebook location");
      }
    } else if (profile?.error) {
      meta.note = `Graph API: ${profile.error.message ?? "lookup failed"}`;
    } else {
      meta.note = `Graph API ${statusFor("graph.facebook.com")} — handle may be a personal profile (restricted) or invalid.`;
    }
  } else {
    meta.note = "Add FACEBOOK_APP_ID and FACEBOOK_APP_SECRET to enable enrichment.";
  }

  pushEntity(
    out,
    srcId,
    {
      type: "facebook_profile",
      platform: "facebook",
      label: `Facebook: ${meta.name || username}`,
      metadata: meta,
    },
    "facebook profile",
  );
}

// YouTube — official API needs key. Optimized for pagination and deep metrics.
async function checkYouTube(out: R, srcId: string, query: string, inputMetadata?: any) {
  const apiKey = getEnv("YOUTUBE_API_KEY");
  const pageToken = inputMetadata?.pageToken;
  let emitted = 0;

  if (apiKey) {
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video,channel&maxResults=50&order=relevance&q=${encodeURIComponent(query)}&key=${apiKey}${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const res = await fetch(searchUrl);
    
    if (res.status === 403) {
      out.warning = "YouTube API limit reached for today. Displaying RSS results.";
    } else if (res.ok) {
      const data = await res.json();
      const items = data?.items ?? [];
      const nextPage = data?.nextPageToken;

      // Batch fetch video details for statistics/duration
      const videoIds = items.filter((it: any) => it.id?.kind === "youtube#video").map((it: any) => it.id.videoId).join(",");
      let videoDetailsMap: Record<string, any> = {};
      if (videoIds) {
        const detailsRes = await safeJson(`https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id=${videoIds}&key=${apiKey}`);
        (detailsRes?.items ?? []).forEach((v: any) => {
          videoDetailsMap[v.id] = v;
        });
      }

      for (const it of items) {
        const isVideo = it.id?.kind === "youtube#video";
        const id = isVideo ? it.id.videoId : it.id.channelId;
        const details = isVideo ? videoDetailsMap[id] : null;
        
        pushEntity(
          out,
          srcId,
          {
            type: "youtube",
            platform: "youtube",
            label: `YT: ${it.snippet?.title || it.snippet?.channelTitle}`,
            metadata: {
              type: isVideo ? "video" : "channel",
              id: id,
              thumbnail: it.snippet?.thumbnails?.high?.url || it.snippet?.thumbnails?.default?.url || "",
              channel: it.snippet?.channelTitle ?? "",
              description: it.snippet?.description ?? "",
              published: it.snippet?.publishedAt ?? "",
              duration: details?.contentDetails?.duration ?? "",
              views: details?.statistics?.viewCount ?? "",
              likes: details?.statistics?.likeCount ?? "",
              nextPageToken: nextPage ?? "",
              url: isVideo ? `https://www.youtube.com/watch?v=${id}` : `https://www.youtube.com/channel/${id}`,
            },
          },
          isVideo ? "youtube video" : "youtube channel",
        );
        emitted++;
      }
    }
  }
  // Public fallback: try channel RSS by handle
  if (emitted === 0) {
    const handle = query.replace(/^@/, "");
    const rss = await safeText(`https://www.youtube.com/feeds/videos.xml?user=${encodeURIComponent(handle)}`);
    if (rss && rss.includes("<entry>")) {
      const titleMatch = rss.match(/<title>([^<]+)<\/title>/);
      const channelTitle = titleMatch?.[1] ?? handle;
      pushEntity(
        out,
        srcId,
        {
          type: "youtube",
          platform: "youtube",
          label: `YT: ${channelTitle}`,
          metadata: {
            rss: `https://www.youtube.com/feeds/videos.xml?user=${handle}`,
            url: `https://www.youtube.com/@${handle}`,
          },
        },
        "youtube channel",
      );
      emitted++;
    }
  }
  // Always emit a status node so the user sees what happened.
  if (emitted === 0) {
    const note = !apiKey
      ? "YOUTUBE_API_KEY not configured"
      : `YouTube API: ${statusFor("www.googleapis.com")} — no results for "${query}"`;
    pushEntity(
      out,
      srcId,
      {
        type: "youtube",
        platform: "youtube",
        label: `YT: ${query} (no data)`,
        metadata: { query, note, url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}` },
      },
      "youtube search",
    );
  }
}

// Web search — uses Google Custom Search if GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_ENGINE_ID
// are set. Falls back to DuckDuckGo Instant Answer (no key).
async function checkWebSearch(out: R, srcId: string, query: string) {
  const gKey = getEnv("GOOGLE_SEARCH_API_KEY");
  const cx = getEnv("GOOGLE_SEARCH_ENGINE_ID");
  if (gKey && cx) {
    const g = await safeJson(
      `https://www.googleapis.com/customsearch/v1?key=${gKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=6`,
    );
    const items: any[] = g?.items ?? [];
    for (const it of items.slice(0, 6)) {
      pushEntity(
        out,
        srcId,
        {
          type: "web_search",
          platform: "google",
          label: String(it.title ?? "").slice(0, 80),
          metadata: {
            snippet: String(it.snippet ?? "").slice(0, 400),
            link: it.link ?? "",
            displayLink: it.displayLink ?? "",
            url: it.link ?? "",
          },
        },
        "google result",
      );
      try {
        const host = new URL(it.link).hostname;
        if (host) pushEntity(out, srcId, { type: "domain", label: host }, "result domain");
      } catch { /* ignore */ }
    }
    if (items.length > 0) return;
  }

  // Fallback: DuckDuckGo Instant Answer
  const data = await safeJson(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
  );
  if (!data) return;
  if (data.AbstractText) {
    pushEntity(
      out,
      srcId,
      {
        type: "web_search",
        label: `Web: ${data.Heading ?? query}`,
        metadata: {
          abstract: String(data.AbstractText).slice(0, 500),
          source: data.AbstractSource ?? "",
          url: data.AbstractURL ?? "",
        },
      },
      "web result",
    );
  }
  const related: any[] = (data.RelatedTopics ?? []).slice(0, 4);
  for (const t of related) {
    if (!t?.Text) continue;
    pushEntity(
      out,
      srcId,
      {
        type: "web_search",
        label: String(t.Text).slice(0, 80),
        metadata: { url: t.FirstURL ?? "" },
      },
      "related result",
    );
  }
}

async function transformPersonOrSocial(entity: InputEntity): Promise<R> {
  const out: R = { entities: [], relations: [] };
  const username = entity.label.replace(/^@/, "").trim().split(/\s+/)[0];

  // Run all platform checks in parallel — failures are swallowed by safeJson/safeText
  await Promise.all([
    checkGitHub(out, entity.id, username),
    checkReddit(out, entity.id, username),
    checkTwitter(out, entity.id, username),
    checkLinkedIn(out, entity.id, username),
    checkInstagram(out, entity.id, username),
    checkTikTok(out, entity.id, username),
    checkFacebook(out, entity.id, username),
    checkYouTube(out, entity.id, username, entity.metadata),
    checkWebSearch(out, entity.id, entity.label),
    enrichOpenSanctions(out, entity.id, entity.label),
  ]);

  if (out.entities.length === 0) {
    pushEntity(
      out,
      entity.id,
      { type: "organization", label: `No public profiles found for "${username}"` },
      "search result",
    );
  }
  return out;
}

// ---------- ip ----------

async function transformIp(entity: InputEntity): Promise<R> {
  const out: R = { entities: [], relations: [] };
  const ip = entity.label.trim();
  const d = await safeJson(
    `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city,isp,org,as,reverse,query`,
  );
  if (d?.status === "success") {
    if (d.city || d.country) {
      pushEntity(
        out,
        entity.id,
        { type: "location", label: [d.city, d.regionName, d.country].filter(Boolean).join(", ") },
        "geolocated",
      );
    }
    if (d.isp || d.org) {
      pushEntity(
        out,
        entity.id,
        { type: "organization", label: d.org || d.isp, metadata: { as: d.as ?? "", isp: d.isp ?? "" } },
        "hosted by",
      );
    }
    if (d.reverse) pushEntity(out, entity.id, { type: "domain", label: d.reverse }, "reverse DNS");
  }

  // Threat intel + network enrichment
  await Promise.all([
    enrichIpApi(out, entity.id, ip),
    enrichIpInfo(out, entity.id, ip),
    enrichIpAbuseIPDB(out, entity.id, ip),
    enrichIpVirusTotal(out, entity.id, ip),
    enrichIpOTX(out, entity.id, ip),
    enrichIpPeeringDB(out, entity.id, ip, d),
    enrichIpMaxMind(out, entity.id, ip),
    enrichIpShodan(out, entity.id, ip),
    enrichIpCensys(out, entity.id, ip),
    enrichIpZetPassive(out, entity.id, ip),
    networkSvc.checkMoocherIo(getContext(out), entity.id, ip),
  ]);

  return out;
}

// ---------- THREAT INTEL: ip ----------

// IPinfo — requires IPINFO_API_KEY (free tier)
async function enrichIpInfo(out: R, srcId: string, ip: string) {
  const key = getEnv("IPINFO_API_KEY");
  if (!key) return;
  const d = await safeJson(`https://ipinfo.io/${encodeURIComponent(ip)}?token=${key}`);
  if (!d) return;
  pushEntity(
    out,
    srcId,
    {
      type: "organization",
      label: `IPinfo: ${d.org ?? d.asn?.name ?? ip}`,
      metadata: {
        hostname: d.hostname ?? "",
        city: d.city ?? "",
        region: d.region ?? "",
        country: d.country ?? "",
        loc: d.loc ?? "",
        org: d.org ?? "",
        postal: d.postal ?? "",
        timezone: d.timezone ?? "",
        url: `https://ipinfo.io/${ip}`,
      },
    },
    "ipinfo",
  );
}

// AbuseIPDB — requires ABUSEIPDB_API_KEY
async function enrichIpAbuseIPDB(out: R, srcId: string, ip: string) {
  const key = getEnv("ABUSEIPDB_API_KEY");
  if (!key) return;
  const d = await safeJson(
    `https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ip)}&maxAgeInDays=90`,
    { headers: { Key: key, Accept: "application/json" } },
  );
  const r = d?.data;
  if (!r) return;
  const score = r.abuseConfidenceScore ?? 0;
  const reports = r.totalReports ?? 0;
  pushEntity(
    out,
    srcId,
    {
      type: "organization",
      label: `🛡️ AbuseIPDB ${score}/100 (${reports} reports)`,
      metadata: {
        abuse_confidence: String(score),
        abuse_score: String(score),
        total_reports: String(reports),
        last_reported: r.lastReportedAt ?? "",
        country_code: r.countryCode ?? "",
        usage_type: r.usageType ?? "",
        isp: r.isp ?? "",
        domain: r.domain ?? "",
        is_tor: String(r.isTor ?? false),
        url: `https://www.abuseipdb.com/check/${ip}`,
      },
    },
    "abuseipdb",
  );
}

// IP-API (Free Geolocation)
async function enrichIpApi(out: R, srcId: string, query: string) {
  const d = await safeJson(`http://ip-api.com/json/${encodeURIComponent(query)}`);
  if (!d || d.status !== "success") return;
  pushEntity(out, srcId, {
    type: "organization",
    label: `🛰️ IP Geolocation: ${d.city}, ${d.country}`,
    metadata: {
      country: d.country,
      region: d.regionName,
      city: d.city,
      zip: d.zip,
      lat: String(d.lat),
      lon: String(d.lon),
      isp: d.isp,
      org: d.org,
      as: d.as,
      query: d.query
    }
  }, "geolocation");
}

// RDAP (Standardized WHOIS)
async function enrichRdap(out: R, srcId: string, domain: string) {
  const d = await safeJson(`https://rdap.org/domain/${encodeURIComponent(domain)}`);
  if (!d) return;
  
  const events = d.events || [];
  const registration = events.find((e: any) => e.eventAction === "registration")?.eventDate;
  const expiration = events.find((e: any) => e.eventAction === "expiration")?.eventDate;
  const registrar = d.entities?.find((e: any) => e.roles?.includes("registrar"))?.vcardArray?.[1]?.find((v:any) => v[0] === 'fn')?.[3] || "Unknown";

  pushEntity(out, srcId, {
    type: "organization",
    label: `📜 RDAP Registration: ${registrar}`,
    metadata: {
      registrar,
      registered: registration ?? "",
      expires: expiration ?? "",
      handle: d.handle ?? "",
      status: (d.status ?? []).join(", ")
    }
  }, "registration details");
}

// ZET Massive Passive — historical passive DNS for an IP. Requires ZET_API_KEY.
async function enrichIpZetPassive(out: R, srcId: string, ip: string) {
  const key = getEnv("ZET_API_KEY");
  if (!key) return;
  const d = await safeJson(
    `https://api.zetalytics.com/v1/passive/ip?ip=${encodeURIComponent(ip)}`,
    { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } },
  );
  if (!d) return;
  const records: any[] = d.results ?? d.data ?? d.records ?? [];
  const total = Array.isArray(records) ? records.length : 0;
  const firstSeen = d.first_seen ?? records[0]?.first_seen ?? "";
  const lastSeen = d.last_seen ?? records[0]?.last_seen ?? "";

  pushEntity(
    out,
    srcId,
    {
      type: "organization",
      label: `🗄️ ZET Passive DNS (${total} records)`,
      metadata: {
        source: "ZET Massive Passive",
        total_records: String(total),
        first_seen: String(firstSeen ?? ""),
        last_seen: String(lastSeen ?? ""),
        ip,
      },
    },
    "passive dns",
  );

  const seen = new Set<string>();
  for (const rec of records.slice(0, 25)) {
    const domain = rec.domain ?? rec.qname ?? rec.name;
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    pushEntity(
      out,
      srcId,
      {
        type: "domain",
        label: String(domain),
        metadata: {
          source: "ZET Passive DNS",
          first_seen: String(rec.first_seen ?? ""),
          last_seen: String(rec.last_seen ?? ""),
          record_type: String(rec.type ?? rec.qtype ?? ""),
        },
      },
      "historical resolution",
    );
  }
}

// VirusTotal IP
async function enrichIpVirusTotal(out: R, srcId: string, ip: string) {
  const key = getEnv("VIRUSTOTAL_API_KEY");
  if (!key) return;
  const d = await safeJson(`https://www.virustotal.com/api/v3/ip_addresses/${encodeURIComponent(ip)}`, {
    headers: { "x-apikey": key },
  });
  const attr = d?.data?.attributes;
  if (!attr) return;
  const stats = attr.last_analysis_stats ?? {};
  pushEntity(
    out,
    srcId,
    {
      type: "organization",
      label: `VirusTotal IP: ${stats.malicious ?? 0} malicious`,
      metadata: {
        malicious: String(stats.malicious ?? 0),
        suspicious: String(stats.suspicious ?? 0),
        harmless: String(stats.harmless ?? 0),
        as_owner: attr.as_owner ?? "",
        asn: String(attr.asn ?? ""),
        country: attr.country ?? "",
        network: attr.network ?? "",
        reputation: String(attr.reputation ?? ""),
        url: `https://www.virustotal.com/gui/ip-address/${ip}`,
      },
    },
    "virustotal",
  );
}

// AlienVault OTX IP
async function enrichIpOTX(out: R, srcId: string, ip: string) {
  const d = await safeJson(`https://otx.alienvault.com/api/v1/indicators/IPv4/${encodeURIComponent(ip)}/general`);
  if (!d) return;
  pushEntity(
    out,
    srcId,
    {
      type: "organization",
      label: `OTX Pulses: ${d.pulse_info?.count ?? 0}`,
      metadata: {
        pulses: String(d.pulse_info?.count ?? 0),
        reputation: String(d.reputation ?? ""),
        asn: d.asn ?? "",
        country: d.country_name ?? "",
        url: `https://otx.alienvault.com/indicator/ip/${ip}`,
      },
    },
    "alienvault otx",
  );
}

// PeeringDB — public, no key. Looks up the ASN's network record.
async function enrichIpPeeringDB(out: R, srcId: string, _ip: string, ipApi: any) {
  const asMatch = ipApi?.as?.match(/AS(\d+)/i);
  const asn = asMatch?.[1];
  if (!asn) return;
  const d = await safeJson(`https://www.peeringdb.com/api/net?asn=${asn}`);
  const net = d?.data?.[0];
  if (!net) return;
  pushEntity(
    out,
    srcId,
    {
      type: "organization",
      label: `PeeringDB: AS${asn} ${net.name ?? ""}`,
      metadata: {
        asn: String(asn),
        name: net.name ?? "",
        aka: net.aka ?? "",
        website: net.website ?? "",
        info_type: net.info_type ?? "",
        info_traffic: net.info_traffic ?? "",
        info_scope: net.info_scope ?? "",
        policy_general: net.policy_general ?? "",
        url: `https://www.peeringdb.com/asn/${asn}`,
      },
    },
    "peeringdb",
  );
}

// MaxMind GeoIP2 — requires MAXMIND_ACCOUNT_ID + MAXMIND_LICENSE_KEY (Basic auth)
async function enrichIpMaxMind(out: R, srcId: string, ip: string) {
  const acct = getEnv("MAXMIND_ACCOUNT_ID");
  const lic = getEnv("MAXMIND_LICENSE_KEY");
  if (!acct || !lic) return;
  const auth = btoa(`${acct}:${lic}`);
  const d = await safeJson(`https://geoip.maxmind.com/geoip/v2.1/city/${encodeURIComponent(ip)}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  if (!d) return;
  pushEntity(
    out,
    srcId,
    {
      type: "location",
      label: `MaxMind: ${d.city?.names?.en ?? ""}, ${d.country?.names?.en ?? ""}`,
      metadata: {
        country: d.country?.names?.en ?? "",
        country_iso: d.country?.iso_code ?? "",
        city: d.city?.names?.en ?? "",
        postal: d.postal?.code ?? "",
        latitude: String(d.location?.latitude ?? ""),
        longitude: String(d.location?.longitude ?? ""),
        time_zone: d.location?.time_zone ?? "",
        accuracy_radius: String(d.location?.accuracy_radius ?? ""),
        autonomous_system_number: String(d.traits?.autonomous_system_number ?? ""),
        autonomous_system_organization: d.traits?.autonomous_system_organization ?? "",
        isp: d.traits?.isp ?? "",
      },
    },
    "maxmind geoip",
  );
}

// ---------- hash (file/malware indicator) ----------

async function transformHash(entity: InputEntity): Promise<R> {
  const out: R = { entities: [], relations: [] };
  const hash = entity.label.trim().toLowerCase();

  // VirusTotal file lookup
  const vtKey = getEnv("VIRUSTOTAL_API_KEY");
  if (vtKey) {
    const d = await safeJson(`https://www.virustotal.com/api/v3/files/${encodeURIComponent(hash)}`, {
      headers: { "x-apikey": vtKey },
    });
    const attr = d?.data?.attributes;
    if (attr) {
      const stats = attr.last_analysis_stats ?? {};
      pushEntity(
        out,
        entity.id,
        {
          type: "organization",
          label: `VT File: ${stats.malicious ?? 0}/${(stats.malicious ?? 0) + (stats.undetected ?? 0)} malicious`,
          metadata: {
            md5: attr.md5 ?? "",
            sha1: attr.sha1 ?? "",
            sha256: attr.sha256 ?? "",
            type_description: attr.type_description ?? "",
            size: String(attr.size ?? ""),
            names: (attr.names ?? []).slice(0, 5).join(", "),
            malicious: String(stats.malicious ?? 0),
            suspicious: String(stats.suspicious ?? 0),
            undetected: String(stats.undetected ?? 0),
            reputation: String(attr.reputation ?? ""),
            url: `https://www.virustotal.com/gui/file/${hash}`,
          },
        },
        "virustotal file",
      );
    }
  }

  // AlienVault OTX file lookup (auto-detects hash type)
  const otx = await safeJson(`https://otx.alienvault.com/api/v1/indicators/file/${encodeURIComponent(hash)}/general`);
  if (otx) {
    pushEntity(
      out,
      entity.id,
      {
        type: "organization",
        label: `OTX File Pulses: ${otx.pulse_info?.count ?? 0}`,
        metadata: {
          pulses: String(otx.pulse_info?.count ?? 0),
          type_title: otx.type_title ?? "",
          url: `https://otx.alienvault.com/indicator/file/${hash}`,
        },
      },
      "alienvault otx",
    );
  }

  // PolySwarm file scan
  await enrichPolySwarmHash(out, entity.id, hash);

  // If the "hash" label is actually a CVE id, link MITRE ATT&CK techniques
  if (/^CVE-\d{4}-\d{4,}$/i.test(entity.label.trim())) {
    await enrichMitreForCve(out, entity.id, entity.label.trim().toUpperCase());
  }

  return out;
}



// crt.sh subdomain enumeration removed — was cluttering graph.

// ---------- Shodan — open ports, services, CVEs (requires SHODAN_API_KEY) ----------

async function enrichIpShodan(out: R, srcId: string, ip: string) {
  const key = getEnv("SHODAN_API_KEY");
  if (!key) return;
  const d = await safeJson(`https://api.shodan.io/shodan/host/${encodeURIComponent(ip)}?key=${key}`);
  if (!d) return;
  pushEntity(
    out,
    srcId,
    {
      type: "organization",
      label: `Shodan: ${(d.ports ?? []).length} open ports`,
      metadata: {
        org: d.org ?? "",
        isp: d.isp ?? "",
        os: d.os ?? "",
        country: d.country_name ?? "",
        city: d.city ?? "",
        ports: (d.ports ?? []).join(", "),
        hostnames: (d.hostnames ?? []).join(", "),
        last_update: d.last_update ?? "",
        url: `https://www.shodan.io/host/${ip}`,
      },
    },
    "shodan host",
  );

  // Per-service nodes
  const services: any[] = (d.data ?? []).slice(0, 10);
  for (const svc of services) {
    pushEntity(
      out,
      srcId,
      {
        type: "organization",
        label: `Port ${svc.port}/${svc.transport ?? "tcp"} ${svc.product ?? svc._shodan?.module ?? ""}`.trim(),
        metadata: {
          port: String(svc.port ?? ""),
          transport: svc.transport ?? "",
          product: svc.product ?? "",
          version: svc.version ?? "",
          banner: String(svc.data ?? "").slice(0, 300),
        },
      },
      "open service",
    );
  }

  // CVEs / vulnerabilities
  const vulns = d.vulns ?? {};
  const cveList = Array.isArray(vulns) ? vulns : Object.keys(vulns);
  for (const cve of cveList.slice(0, 15)) {
    const info = !Array.isArray(vulns) ? vulns[cve] : null;
    const cveNodeId = randomId();
    out.entities.push({
      id: cveNodeId,
      type: "hash",
      label: cve,
      metadata: {
        cvss: String(info?.cvss ?? ""),
        summary: String(info?.summary ?? "").slice(0, 300),
        url: `https://nvd.nist.gov/vuln/detail/${cve}`,
      },
    });
    out.relations.push({ id: randomId(), sourceId: srcId, targetId: cveNodeId, label: "vulnerability (CVE)" });
    // Link to MITRE ATT&CK technique
    await enrichMitreForCve(out, cveNodeId, cve);
  }
}

// ---------- Ethereum wallet (Etherscan, requires ETHERSCAN_API_KEY) ----------

async function transformEthWallet(entity: InputEntity): Promise<R> {
  const out: R = { entities: [], relations: [] };
  const addr = entity.label.trim();
  const key = getEnv("ETHERSCAN_API_KEY");
  if (!key) {
    pushEntity(
      out,
      entity.id,
      {
        type: "organization",
        label: "Etherscan: ETHERSCAN_API_KEY not configured",
        metadata: { url: `https://etherscan.io/address/${addr}` },
      },
      "etherscan",
    );
    return out;
  }

  const bal = await safeJson(
    `https://api.etherscan.io/api?module=account&action=balance&address=${encodeURIComponent(addr)}&tag=latest&apikey=${key}`,
  );
  if (bal?.status === "1") {
    const wei = BigInt(bal.result ?? "0");
    const eth = Number(wei) / 1e18;
    pushEntity(
      out,
      entity.id,
      {
        type: "organization",
        label: `Balance: ${eth.toFixed(6)} ETH`,
        metadata: {
          wei: bal.result,
          eth: eth.toString(),
          url: `https://etherscan.io/address/${addr}`,
        },
      },
      "wallet balance",
    );
  }

  const txs = await safeJson(
    `https://api.etherscan.io/api?module=account&action=txlist&address=${encodeURIComponent(addr)}&startblock=0&endblock=99999999&page=1&offset=10&sort=desc&apikey=${key}`,
  );
  const txList: any[] = Array.isArray(txs?.result) ? txs.result : [];
  for (const tx of txList.slice(0, 10)) {
    const valEth = Number(BigInt(tx.value ?? "0")) / 1e18;
    const counterparty = tx.from?.toLowerCase() === addr.toLowerCase() ? tx.to : tx.from;
    pushEntity(
      out,
      entity.id,
      {
        type: "eth_wallet",
        label: `${valEth.toFixed(4)} ETH → ${(counterparty ?? "").slice(0, 10)}…`,
        metadata: {
          hash: tx.hash ?? "",
          from: tx.from ?? "",
          to: tx.to ?? "",
          value_eth: valEth.toString(),
          block: tx.blockNumber ?? "",
          timestamp: tx.timeStamp ?? "",
          url: `https://etherscan.io/tx/${tx.hash}`,
        },
      },
      "transaction",
    );
  }
  return out;
}

// ---------- Bitcoin wallet (Blockchain.com, no key) ----------

async function transformBtcWallet(entity: InputEntity): Promise<R> {
  const out: R = { entities: [], relations: [] };
  const addr = entity.label.trim();
  const d = await safeJson(`https://blockchain.info/rawaddr/${encodeURIComponent(addr)}?limit=10`);
  if (!d) {
    pushEntity(
      out,
      entity.id,
      {
        type: "organization",
        label: "Blockchain.com: address not found or rate-limited",
        metadata: { url: `https://www.blockchain.com/btc/address/${addr}` },
      },
      "blockchain.com",
    );
    return out;
  }
  const btc = (d.final_balance ?? 0) / 1e8;
  const totalRecv = (d.total_received ?? 0) / 1e8;
  const totalSent = (d.total_sent ?? 0) / 1e8;
  pushEntity(
    out,
    entity.id,
    {
      type: "organization",
      label: `Balance: ${btc.toFixed(8)} BTC`,
      metadata: {
        balance_btc: btc.toString(),
        total_received_btc: totalRecv.toString(),
        total_sent_btc: totalSent.toString(),
        n_tx: String(d.n_tx ?? 0),
        url: `https://www.blockchain.com/btc/address/${addr}`,
      },
    },
    "wallet balance",
  );

  const txs: any[] = (d.txs ?? []).slice(0, 10);
  for (const tx of txs) {
    const valOut = (tx.out ?? []).reduce((s: number, o: any) => s + (o.value ?? 0), 0) / 1e8;
    pushEntity(
      out,
      entity.id,
      {
        type: "btc_wallet",
        label: `tx ${(tx.hash ?? "").slice(0, 10)}… (${valOut.toFixed(4)} BTC)`,
        metadata: {
          hash: tx.hash ?? "",
          time: String(tx.time ?? ""),
          block_height: String(tx.block_height ?? ""),
          fee: String((tx.fee ?? 0) / 1e8),
          value_btc: valOut.toString(),
          url: `https://www.blockchain.com/btc/tx/${tx.hash}`,
        },
      },
      "transaction",
    );
  }
  return out;
}

// ---------- Shortened URL resolver (no key, uses HEAD redirect chain) ----------

async function transformShortUrl(entity: InputEntity): Promise<R> {
  const out: R = { entities: [], relations: [] };
  let url = entity.label.trim();
  if (!/^https?:\/\//i.test(url)) url = "http://" + url;

  let finalUrl = url;
  let chain: string[] = [url];
  try {
    const r = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 osdg-agent" },
    });
    finalUrl = r.url;
    if (finalUrl && finalUrl !== url) chain.push(finalUrl);
  } catch {
    // Fallback: try unshorten.me public API
    const d = await safeJson(`https://unshorten.me/json/${encodeURIComponent(url)}`);
    if (d?.resolved_url) {
      finalUrl = d.resolved_url;
      chain.push(finalUrl);
    }
  }

  pushEntity(
    out,
    entity.id,
    {
      type: "domain",
      label: finalUrl,
      metadata: {
        original: url,
        resolved: finalUrl,
        redirect_chain: chain.join(" → "),
      },
    },
    "resolves to",
  );

  try {
    const host = new URL(finalUrl).hostname;
    if (host) pushEntity(out, entity.id, { type: "domain", label: host }, "destination domain");
  } catch { /* ignore */ }

  await enrichPolySwarmUrl(out, entity.id, finalUrl);

  return out;
}


// ---------- OpenSanctions — sanctions / PEP screening ----------
async function enrichOpenSanctions(out: R, srcId: string, name: string) {
  const key = getEnv("OPENSANCTIONS_API_KEY");
  if (!key) return;
  const d = await safeJson(
    `https://api.opensanctions.org/search/default?q=${encodeURIComponent(name)}&limit=5`,
    { headers: { Authorization: `ApiKey ${key}`, Accept: "application/json" } },
  );
  const results: any[] = d?.results ?? [];
  if (results.length === 0) {
    pushEntity(
      out,
      srcId,
      {
        type: "sanction",
        label: `OpenSanctions: clean (${name})`,
        metadata: { matches: "0", url: `https://www.opensanctions.org/search/?q=${encodeURIComponent(name)}` },
      },
      "sanctions screening",
    );
    return;
  }
  for (const r of results.slice(0, 5)) {
    const props = r.properties ?? {};
    pushEntity(
      out,
      srcId,
      {
        type: "sanction",
        label: `${r.caption ?? r.id} (${r.schema ?? ""})`,
        metadata: {
          schema: r.schema ?? "",
          score: String(r.score ?? ""),
          datasets: (r.datasets ?? []).join(", "),
          topics: (props.topics ?? []).join(", "),
          country: (props.country ?? []).join(", "),
          birth_date: (props.birthDate ?? []).join(", "),
          first_seen: r.first_seen ?? "",
          last_seen: r.last_seen ?? "",
          url: `https://www.opensanctions.org/entities/${r.id}/`,
        },
      },
      "sanctions / PEP match",
    );
  }
}

// ---------- Censys — host data for IPs (requires CENSYS_API_ID + CENSYS_API_SECRET) ----------
async function enrichIpCensys(out: R, srcId: string, ip: string) {
  const id = getEnv("CENSYS_API_ID");
  const secret = getEnv("CENSYS_API_SECRET");
  if (!id || !secret) return;
  const auth = btoa(`${id}:${secret}`);
  const d = await safeJson(`https://search.censys.io/api/v2/hosts/${encodeURIComponent(ip)}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  const r = d?.result;
  if (!r) return;
  const services: any[] = r.services ?? [];
  pushEntity(
    out,
    srcId,
    {
      type: "organization",
      label: `Censys: ${services.length} services`,
      metadata: {
        autonomous_system: r.autonomous_system?.name ?? "",
        asn: String(r.autonomous_system?.asn ?? ""),
        country: r.location?.country ?? "",
        city: r.location?.city ?? "",
        os: r.operating_system?.product ?? "",
        last_updated: r.last_updated_at ?? "",
        url: `https://search.censys.io/hosts/${ip}`,
      },
    },
    "censys host",
  );
  for (const s of services.slice(0, 10)) {
    pushEntity(
      out,
      srcId,
      {
        type: "organization",
        label: `Censys ${s.port}/${s.transport_protocol ?? "tcp"} ${s.service_name ?? ""}`.trim(),
        metadata: {
          port: String(s.port ?? ""),
          service_name: s.service_name ?? "",
          extended_service_name: s.extended_service_name ?? "",
          transport: s.transport_protocol ?? "",
          software: JSON.stringify(s.software ?? []).slice(0, 300),
        },
      },
      "censys service",
    );
  }
}

// ---------- PolySwarm — file/URL scanning (requires POLYSWARM_API_KEY) ----------
async function enrichPolySwarmHash(out: R, srcId: string, hash: string) {
  const key = getEnv("POLYSWARM_API_KEY");
  if (!key) return;
  const d = await safeJson(`https://api.polyswarm.network/v3/search/hash/${encodeURIComponent(hash)}`, {
    headers: { Authorization: key, Accept: "application/json" },
  });
  const result = Array.isArray(d?.result) ? d.result[0] : d?.result;
  if (!result) return;
  pushEntity(
    out,
    srcId,
    {
      type: "organization",
      label: `PolySwarm: ${result.polyscore ?? "n/a"} (${result.detections?.malicious ?? 0} mal)`,
      metadata: {
        polyscore: String(result.polyscore ?? ""),
        malicious: String(result.detections?.malicious ?? 0),
        benign: String(result.detections?.benign ?? 0),
        total: String(result.detections?.total ?? 0),
        first_seen: result.first_seen ?? "",
        last_seen: result.last_seen ?? "",
        sha256: result.sha256 ?? "",
        url: `https://polyswarm.network/scan/results/file/${result.sha256 ?? hash}`,
      },
    },
    "polyswarm scan",
  );
}

async function enrichPolySwarmUrl(out: R, srcId: string, url: string) {
  const key = getEnv("POLYSWARM_API_KEY");
  if (!key) return;
  const d = await safeJson(`https://api.polyswarm.network/v3/search/url?url=${encodeURIComponent(url)}`, {
    headers: { Authorization: key, Accept: "application/json" },
  });
  const result = Array.isArray(d?.result) ? d.result[0] : d?.result;
  if (!result) return;
  pushEntity(
    out,
    srcId,
    {
      type: "organization",
      label: `PolySwarm URL: ${result.polyscore ?? "n/a"}`,
      metadata: {
        polyscore: String(result.polyscore ?? ""),
        malicious: String(result.detections?.malicious ?? 0),
        url: `https://polyswarm.network/scan/results/url/${encodeURIComponent(url)}`,
      },
    },
    "polyswarm url scan",
  );
}

// ---------- MITRE ATT&CK — link CVEs / techniques (no key) ----------
// Uses public MITRE CTI STIX feed cached per-call. We do a lightweight match on
// CVE → technique by querying the ATT&CK Enterprise STIX bundle search index.
async function enrichMitreForCve(out: R, srcId: string, cve: string) {
  // Public NVD lookup to obtain CWE / description, then map to ATT&CK technique heuristically.
  const nvd = await safeJson(`https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${encodeURIComponent(cve)}`);
  const item = nvd?.vulnerabilities?.[0]?.cve;
  if (!item) return;
  const desc = (item.descriptions ?? []).find((d: any) => d.lang === "en")?.value ?? "";
  const cwes: string[] = [];
  for (const w of item.weaknesses ?? []) {
    for (const d of w.description ?? []) if (d.value?.startsWith("CWE-")) cwes.push(d.value);
  }
  // Heuristic CWE -> ATT&CK technique map (common cases)
  const map: Record<string, { id: string; name: string }> = {
    "CWE-89": { id: "T1190", name: "Exploit Public-Facing Application" },
    "CWE-78": { id: "T1059", name: "Command and Scripting Interpreter" },
    "CWE-79": { id: "T1059.007", name: "JavaScript" },
    "CWE-22": { id: "T1083", name: "File and Directory Discovery" },
    "CWE-352": { id: "T1185", name: "Browser Session Hijacking" },
    "CWE-287": { id: "T1078", name: "Valid Accounts" },
    "CWE-269": { id: "T1068", name: "Exploitation for Privilege Escalation" },
    "CWE-119": { id: "T1203", name: "Exploitation for Client Execution" },
    "CWE-502": { id: "T1059", name: "Command and Scripting Interpreter" },
    "CWE-94": { id: "T1059", name: "Command and Scripting Interpreter" },
  };
  const techniques = new Map<string, string>();
  for (const c of cwes) if (map[c]) techniques.set(map[c].id, map[c].name);
  // Default fallback technique for any CVE
  if (techniques.size === 0) techniques.set("T1190", "Exploit Public-Facing Application");

  for (const [tid, tname] of techniques) {
    pushEntity(
      out,
      srcId,
      {
        type: "mitre_technique",
        label: `${tid}: ${tname}`,
        metadata: {
          technique_id: tid,
          technique_name: tname,
          cwes: cwes.join(", "),
          cve_description: desc.slice(0, 400),
          url: `https://attack.mitre.org/techniques/${tid.replace(".", "/")}/`,
        },
      },
      "MITRE ATT&CK",
    );
  }
}

// ---------- Twitter Profile transform (entity type) ----------
async function transformTwitterProfile(entity: InputEntity): Promise<R> {
  const out: R = { entities: [], relations: [] };
  const username = entity.label.replace(/^@/, "").trim().split(/\s+/)[0];
  await checkTwitter(out, entity.id, username);
  return out;
}

// ---------- Web Search transform (entity type) ----------
async function transformWebSearch(entity: InputEntity): Promise<R> {
  const out: R = { entities: [], relations: [] };
  await checkWebSearch(out, entity.id, entity.label);
  return out;
}

// ---------- YouTube transform (entity type) ----------
async function transformYouTube(entity: InputEntity): Promise<R> {
  const out: R = { entities: [], relations: [] };
  const apiKey = getEnv("YOUTUBE_API_KEY");
  if (!apiKey) {
    await checkYouTube(out, entity.id, entity.label);
    return out;
  }
  // Search channels + videos
  const search = await safeJson(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel,video&maxResults=5&q=${encodeURIComponent(entity.label)}&key=${apiKey}`,
  );
  const items: any[] = search?.items ?? [];
  const channelIds: string[] = [];
  for (const it of items) {
    const kind = it.id?.kind ?? "";
    if (kind === "youtube#channel") {
      const cid = it.id.channelId;
      channelIds.push(cid);
      pushEntity(
        out,
        entity.id,
        {
          type: "youtube",
          platform: "youtube",
          label: `Channel: ${it.snippet?.channelTitle ?? it.snippet?.title}`,
          metadata: {
            kind: "channel",
            channel_id: cid,
            description: it.snippet?.description ?? "",
            published: it.snippet?.publishedAt ?? "",
            url: `https://www.youtube.com/channel/${cid}`,
          },
        },
        "youtube channel",
      );
    } else if (kind === "youtube#video") {
      pushEntity(
        out,
        entity.id,
        {
          type: "youtube",
          platform: "youtube",
          label: `Video: ${it.snippet?.title}`,
          metadata: {
            kind: "video",
            video_id: it.id.videoId,
            channel: it.snippet?.channelTitle ?? "",
            published: it.snippet?.publishedAt ?? "",
            description: String(it.snippet?.description ?? "").slice(0, 300),
            url: `https://www.youtube.com/watch?v=${it.id.videoId}`,
          },
        },
        "youtube video",
      );
    }
  }
  // Fetch channel stats for found channels
  if (channelIds.length > 0) {
    const stats = await safeJson(
      `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&id=${channelIds.join(",")}&key=${apiKey}`,
    );
    for (const c of stats?.items ?? []) {
      pushEntity(
        out,
        entity.id,
        {
          type: "youtube",
          platform: "youtube",
          label: `Stats: ${c.snippet?.title}`,
          metadata: {
            channel_id: c.id,
            subscribers: String(c.statistics?.subscriberCount ?? ""),
            views: String(c.statistics?.viewCount ?? ""),
            videos: String(c.statistics?.videoCount ?? ""),
            country: c.snippet?.country ?? "",
            url: `https://www.youtube.com/channel/${c.id}`,
          },
        },
        "channel stats",
      );
    }
  }
  return out;
}


// ---------- RapidAPI multi-source intelligence gateway ----------
// Primary social/forensic data layer. Uses a single RAPIDAPI_KEY with the
// x-rapidapi-host header switched per service. Each platform may have
// multiple providers; results are fused into a single enriched node with
// conflict resolution (most-detailed wins) and cross-source verification.

interface RapidProviderResult {
  provider: string;
  ok: boolean;
  status?: number;
  data?: Record<string, string | number | boolean | undefined>;
  error?: string;
}

const RAPID_HOSTS = {
  // LinkedIn providers
  linkedin_a: "linkedin-data-api.p.rapidapi.com",
  linkedin_b: "fresh-linkedin-profile-data.p.rapidapi.com",
  // Twitter / X providers
  twitter_a: "twitter154.p.rapidapi.com",
  twitter_b: "twitter-api45.p.rapidapi.com",
  // Instagram providers
  instagram_a: "instagram-scraper-api2.p.rapidapi.com",
  instagram_b: "instagram-social-api.p.rapidapi.com",
  // Facebook
  facebook_a: "facebook-scraper3.p.rapidapi.com",
  // Email reputation (Diego)
  email_rep: "email-reputation-validation-send-api-by-diego.p.rapidapi.com",
};

async function rapidGet(host: string, path: string): Promise<{ ok: boolean; status: number; json: any | null }> {
  const key = getEnv("RAPIDAPI_KEY");
  if (!key) return { ok: false, status: 0, json: null };
  try {
    const r = await fetch(`https://${host}${path}`, {
      headers: {
        "x-rapidapi-key": key,
        "x-rapidapi-host": host,
        Accept: "application/json",
      },
    });
    lastStatus.set(host, { status: r.status, statusText: r.statusText });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      console.warn(`[rapidapi] ${r.status} ${host}${path}`, body.slice(0, 180));
      return { ok: false, status: r.status, json: null };
    }
    const json = await r.json().catch(() => null);
    return { ok: true, status: r.status, json };
  } catch (e) {
    console.error(`[rapidapi] ${host}${path}`, e instanceof Error ? e.message : e);
    return { ok: false, status: 0, json: null };
  }
}

// Pick the most detailed value (longer string / larger number) among candidates.
function pickBest(values: (string | number | undefined | null)[]): string {
  const cleaned = values.filter((v) => v !== undefined && v !== null && v !== "");
  if (cleaned.length === 0) return "";
  // Numeric: prefer the largest precise value (assumed less rounded).
  const nums = cleaned.map((v) => Number(v)).filter((n) => !Number.isNaN(n));
  if (nums.length === cleaned.length) return String(Math.max(...nums));
  // String: prefer the longest (most detailed) value.
  return String(cleaned.reduce((a, b) => (String(a).length >= String(b).length ? a : b)));
}

function fuseResults(results: RapidProviderResult[]): {
  merged: Record<string, string>;
  verified: boolean;
  providersUsed: string[];
  errors: string[];
} {
  const ok = results.filter((r) => r.ok && r.data);
  const providersUsed = ok.map((r) => r.provider);
  const errors = results.filter((r) => !r.ok).map((r) => `${r.provider}:${r.status ?? "err"}`);
  const keys = new Set<string>();
  ok.forEach((r) => Object.keys(r.data ?? {}).forEach((k) => keys.add(k)));
  const merged: Record<string, string> = {};
  const matchFlags: boolean[] = [];
  for (const k of keys) {
    const vals = ok.map((r) => r.data?.[k]).filter((v) => v !== undefined && v !== "");
    if (vals.length === 0) continue;
    merged[k] = pickBest(vals as any);
    if (vals.length >= 2) {
      const norm = vals.map((v) => String(v).toLowerCase().trim());
      matchFlags.push(norm.every((v) => v === norm[0]));
    }
  }
  // Verified if at least 2 providers returned and majority of overlapping fields match.
  const verified = ok.length >= 2 && matchFlags.length > 0 && matchFlags.filter(Boolean).length >= Math.ceil(matchFlags.length / 2);
  if (providersUsed.length) merged.providers = providersUsed.join(", ");
  if (errors.length) merged.fallback_errors = errors.join("; ");
  merged.verified = String(verified);
  return { merged, verified, providersUsed, errors };
}

// ----- LinkedIn via RapidAPI (multi-source fusion + fallback) -----
async function rapidLinkedIn(username: string): Promise<RapidProviderResult[]> {
  const out: RapidProviderResult[] = [];
  // Provider A: linkedin-data-api
  {
    const { ok, status, json } = await rapidGet(RAPID_HOSTS.linkedin_a, `/?username=${encodeURIComponent(username)}`);
    const d = json?.data ?? json;
    out.push({
      provider: "linkedin-data-api",
      ok: ok && !!d,
      status,
      data: d ? {
        full_name: [d.firstName, d.lastName].filter(Boolean).join(" ") || d.fullName || "",
        headline: d.headline ?? "",
        current_position: d.position?.[0]?.title ?? d.jobTitle ?? "",
        current_company: d.position?.[0]?.companyName ?? d.company ?? "",
        location: d.geo?.full ?? d.location ?? "",
        education: (d.educations ?? []).map((e: any) => e.schoolName).slice(0, 3).join(" | "),
        skills: (d.skills ?? []).map((s: any) => s.name ?? s).slice(0, 8).join(", "),
        followers: d.followers ?? d.followerCount ?? "",
        connections: d.connectionsCount ?? d.connections ?? "",
        profile_pic: d.profilePicture ?? "",
      } : undefined,
    });
  }
  // Provider B: fresh-linkedin-profile-data (fallback / cross-verify)
  {
    const { ok, status, json } = await rapidGet(
      RAPID_HOSTS.linkedin_b,
      `/get-linkedin-profile?linkedin_url=${encodeURIComponent(`https://www.linkedin.com/in/${username}`)}`,
    );
    const d = json?.data ?? json;
    out.push({
      provider: "fresh-linkedin-profile-data",
      ok: ok && !!d,
      status,
      data: d ? {
        full_name: d.full_name ?? "",
        headline: d.headline ?? "",
        current_position: d.job_title ?? d.experiences?.[0]?.title ?? "",
        current_company: d.company ?? d.experiences?.[0]?.company ?? "",
        location: d.location ?? "",
        education: (d.educations ?? []).map((e: any) => e.school).slice(0, 3).join(" | "),
        skills: (d.skills ?? []).slice(0, 8).join(", "),
        followers: d.follower_count ?? "",
        connections: d.connection_count ?? "",
      } : undefined,
    });
  }
  return out;
}

async function checkLinkedInRapid(out: R, srcId: string, username: string) {
  const results = await rapidLinkedIn(username);
  const { merged, verified, providersUsed } = fuseResults(results);
  if (providersUsed.length === 0) return false; // signal fallback
  const profileId = pushEntity(out, srcId, {
    type: "linkedin_profile",
    platform: "linkedin",
    label: `LinkedIn: ${merged.full_name || username}${verified ? " ✓" : ""}`,
    metadata: { ...merged, url: `https://www.linkedin.com/in/${username}`, source: "rapidapi" },
  }, "linkedin profile");
  if (merged.current_position || merged.current_company) {
    pushEntity(out, profileId, {
      type: "organization",
      label: [merged.current_position, merged.current_company].filter(Boolean).join(" @ "),
    }, "current position");
  }
  for (const sch of (merged.education || "").split(" | ").filter(Boolean).slice(0, 3)) {
    pushEntity(out, profileId, { type: "organization", label: `Edu: ${sch}` }, "education");
  }
  for (const sk of (merged.skills || "").split(", ").filter(Boolean).slice(0, 5)) {
    pushEntity(out, profileId, { type: "organization", label: `Skill: ${sk}` }, "top skill");
  }
  return true;
}

// ----- Twitter via RapidAPI -----
async function rapidTwitter(username: string): Promise<RapidProviderResult[]> {
  const out: RapidProviderResult[] = [];
  {
    const { ok, status, json } = await rapidGet(RAPID_HOSTS.twitter_a, `/user/details?username=${encodeURIComponent(username)}`);
    const d = json;
    out.push({
      provider: "twitter154",
      ok: ok && !!d?.user_id,
      status,
      data: d ? {
        name: d.name ?? "",
        bio: d.description ?? "",
        followers: d.follower_count ?? "",
        following: d.following_count ?? "",
        tweets: d.number_of_tweets ?? "",
        verified: d.is_verified ?? d.is_blue_verified ?? "",
        location: d.location ?? "",
        created_at: d.creation_date ?? "",
      } : undefined,
    });
  }
  {
    const { ok, status, json } = await rapidGet(RAPID_HOSTS.twitter_b, `/screenname.php?screenname=${encodeURIComponent(username)}`);
    const d = json;
    out.push({
      provider: "twitter-api45",
      ok: ok && !!d?.id,
      status,
      data: d ? {
        name: d.name ?? "",
        bio: d.desc ?? d.description ?? "",
        followers: d.sub_count ?? d.followers ?? "",
        following: d.friends ?? "",
        tweets: d.statuses_count ?? "",
        verified: d.blue_verified ?? "",
        location: d.location ?? "",
        created_at: d.created_at ?? "",
      } : undefined,
    });
  }
  return out;
}

async function checkTwitterRapid(out: R, srcId: string, username: string) {
  const results = await rapidTwitter(username);
  const { merged, verified, providersUsed } = fuseResults(results);
  if (providersUsed.length === 0) return false;
  const profileId = pushEntity(out, srcId, {
    type: "twitter_profile",
    platform: "twitter",
    label: `@${username}${verified ? " ✓" : ""}`,
    metadata: { ...merged, url: `https://x.com/${username}`, source: "rapidapi" },
  }, "twitter profile");
  // Latest tweets via twitter154
  const tw = await rapidGet(RAPID_HOSTS.twitter_a, `/user/tweets?username=${encodeURIComponent(username)}&limit=5`);
  const tweets = tw.json?.results ?? tw.json?.tweets ?? [];
  for (const t of tweets.slice(0, 5)) {
    pushEntity(out, profileId, {
      type: "twitter_profile",
      platform: "twitter",
      label: `Tweet: ${String(t.text ?? "").slice(0, 60)}…`,
      metadata: {
        text: String(t.text ?? "").slice(0, 400),
        likes: String(t.favorite_count ?? t.likes ?? ""),
        retweets: String(t.retweet_count ?? ""),
        created_at: t.creation_date ?? t.created_at ?? "",
      },
    }, "recent tweet");
  }
  return true;
}

// ----- Instagram via RapidAPI -----
async function rapidInstagram(username: string): Promise<RapidProviderResult[]> {
  const out: RapidProviderResult[] = [];
  {
    const { ok, status, json } = await rapidGet(RAPID_HOSTS.instagram_a, `/v1/info?username_or_id_or_url=${encodeURIComponent(username)}`);
    const d = json?.data ?? json;
    out.push({
      provider: "instagram-scraper-api2",
      ok: ok && !!d,
      status,
      data: d ? {
        full_name: d.full_name ?? "",
        bio: d.biography ?? "",
        followers: d.follower_count ?? d.edge_followed_by?.count ?? "",
        following: d.following_count ?? d.edge_follow?.count ?? "",
        posts: d.media_count ?? "",
        verified: d.is_verified ?? "",
        is_private: d.is_private ?? "",
        external_url: d.external_url ?? "",
      } : undefined,
    });
  }
  {
    const { ok, status, json } = await rapidGet(RAPID_HOSTS.instagram_b, `/v1/info?username_or_id_or_url=${encodeURIComponent(username)}`);
    const d = json?.data ?? json;
    out.push({
      provider: "instagram-social-api",
      ok: ok && !!d,
      status,
      data: d ? {
        full_name: d.full_name ?? "",
        bio: d.biography ?? "",
        followers: d.follower_count ?? "",
        following: d.following_count ?? "",
        posts: d.media_count ?? "",
        verified: d.is_verified ?? "",
        external_url: d.external_url ?? "",
      } : undefined,
    });
  }
  return out;
}

async function checkInstagramRapid(out: R, srcId: string, username: string) {
  const results = await rapidInstagram(username);
  const { merged, verified, providersUsed } = fuseResults(results);
  if (providersUsed.length === 0) return false;
  const followers = Number(merged.followers || 0);
  const posts = Number(merged.posts || 0);
  const engagement = followers > 0 && posts > 0 ? `${((posts / followers) * 100).toFixed(2)}% post/follower` : "n/a";
  pushEntity(out, srcId, {
    type: "social",
    platform: "facebook",
    label: `Instagram: @${username}${verified ? " ✓" : ""}`,
    metadata: { ...merged, engagement, url: `https://instagram.com/${username}`, source: "rapidapi" },
  }, "instagram profile");
  return true;
}

// ----- Facebook via RapidAPI -----
async function checkFacebookRapid(out: R, srcId: string, username: string): Promise<boolean> {
  const { ok, status, json } = await rapidGet(RAPID_HOSTS.facebook_a, `/page/details?url=${encodeURIComponent(`https://www.facebook.com/${username}`)}`);
  const d = json?.results ?? json?.data ?? json;
  if (!ok || !d) return false;
  pushEntity(out, srcId, {
    type: "facebook_profile",
    platform: "facebook",
    label: `Facebook: ${d.name ?? username}`,
    metadata: {
      name: String(d.name ?? ""),
      category: String(d.category ?? ""),
      about: String(d.about ?? "").slice(0, 400),
      followers: String(d.followers ?? d.follower_count ?? ""),
      likes: String(d.likes ?? d.like_count ?? ""),
      website: String(d.website ?? ""),
      verified: String(d.verified ?? ""),
      url: `https://www.facebook.com/${username}`,
      source: "rapidapi",
      providers: "facebook-scraper3",
      status: String(status),
    },
  }, "facebook profile");
  return true;
}

// ----- Email reputation via RapidAPI (Diego) -----
async function checkEmailRepRapid(out: R, srcId: string, email: string): Promise<boolean> {
  const { ok, status, json } = await rapidGet(
    RAPID_HOSTS.email_rep,
    `/validate?email=${encodeURIComponent(email)}`,
  );
  const d = json;
  if (!ok || !d) return false;
  pushEntity(out, srcId, {
    type: "organization",
    label: `EmailRep (Diego): ${d.status ?? d.result ?? "scored"}`,
    metadata: {
      spam_score: String(d.spam_score ?? d.score ?? ""),
      web_presence: String(d.web_presence ?? d.references ?? ""),
      disposable: String(d.disposable ?? ""),
      free_provider: String(d.free ?? d.free_email ?? ""),
      deliverable: String(d.deliverable ?? d.valid ?? ""),
      domain_age: String(d.domain_age ?? ""),
      provider: "rapidapi:email-reputation-diego",
      status: String(status),
    },
  }, "email reputation");
  return true;
}

// Wrapper transforms with automatic fallback to existing checkers (web search dorking is final).
async function transformLinkedInWithFallback(out: R, srcId: string, username: string) {
  const ok = await checkLinkedInRapid(out, srcId, username);
  if (!ok) {
    await checkLinkedIn(out, srcId, username);
    await checkWebSearch(out, srcId, `site:linkedin.com/in ${username}`);
  }
}
async function transformTwitterWithFallback(out: R, srcId: string, username: string) {
  const ok = await checkTwitterRapid(out, srcId, username);
  if (!ok) {
    await checkTwitter(out, srcId, username);
    await checkWebSearch(out, srcId, `site:x.com ${username}`);
  }
}
async function transformInstagramWithFallback(out: R, srcId: string, username: string) {
  const ok = await checkInstagramRapid(out, srcId, username);
  if (!ok) {
    await checkInstagram(out, srcId, username);
    await checkWebSearch(out, srcId, `site:instagram.com ${username}`);
  }
}
async function transformFacebookWithFallback(out: R, srcId: string, username: string) {
  const ok = await checkFacebookRapid(out, srcId, username);
  if (!ok) {
    await checkFacebook(out, srcId, username);
    await checkWebSearch(out, srcId, `site:facebook.com ${username}`);
  }
}

// ---------- stage planner ----------
// Each stage runs a chunk of work that produces partial entities/relations.
// The serve handler streams stage completions to the client as NDJSON so the
// graph can render nodes incrementally.

type Stage = { name: string; run: () => Promise<R> };

function emptyR(): R { return { entities: [], relations: [] }; }

async function wrap(fn: (out: R) => Promise<void>): Promise<R> {
  const out = emptyR();
  try { await fn(out); } catch (e) { console.error("stage error:", e); }
  return out;
}

function stagesForDomain(entity: InputEntity): Stage[] {
  const domain = entity.label.trim().replace(/^https?:\/\//, "").split("/")[0];
  const apiKey = getEnv("WHOIS_XML_API_KEY");
  return [
    { name: "WHOIS",       run: () => wrap(async (o) => { if (!apiKey) return; const r = await transformDomainWhoisOnly(entity, domain, apiKey); o.entities.push(...r.entities); o.relations.push(...r.relations); }) },
    { name: "DNS",         run: () => wrap(async (o) => { const r = await transformDomainDnsOnly(entity, domain); o.entities.push(...r.entities); o.relations.push(...r.relations); }) },
    { name: "VirusTotal",  run: () => wrap((o) => enrichDomainVirusTotal(o, entity.id, domain)) },
    { name: "AlienVault",  run: () => wrap((o) => enrichDomainOTX(o, entity.id, domain)) },
    { name: "ScamAdviser", run: () => wrap((o) => enrichDomainScamAdviser(o, entity.id, domain)) },
    { name: "crt.sh",      run: () => wrap((o) => enrichDomainCrtsh(o, entity.id, domain)) },
    { name: "WHOIS Pro",   run: () => wrap((o) => domainSvc.checkWhoisPro(getContext(o), entity.id, domain)) },
    { name: "WhoisFreaks", run: () => wrap((o) => domainSvc.checkWhoisFreaks(getContext(o), entity.id, domain)) },
    { name: "Domain Intel",run: () => wrap((o) => domainSvc.checkDomainIpIntel(getContext(o), entity.id, domain)) },
    { name: "Domain Identity", run: () => wrap((o) => domainSvc.checkDomainIdentity(getContext(o), entity.id, domain)) },
    { name: "The Harvester", run: () => wrap((o) => networkSvc.checkTheHarvester(getContext(o), entity.id, domain)) },
  ];
}

function stagesForPerson(entity: InputEntity): Stage[] {
  // Use the exact full string as requested (no longer splitting by spaces)
  const username = entity.label.replace(/^@/, "").trim();
  return [
    { name: "GitHub",                 run: () => wrap((o) => checkGitHub(o, entity.id, username)) },
    { name: "Reddit",                 run: () => wrap((o) => checkReddit(o, entity.id, username)) },
    { name: "LinkedIn (RapidAPI ×2)", run: () => wrap((o) => transformLinkedInWithFallback(o, entity.id, username)) },
    { name: "Twitter/X (RapidAPI ×2)",run: () => wrap((o) => transformTwitterWithFallback(o, entity.id, username)) },
    { name: "Instagram (RapidAPI ×2)",run: () => wrap((o) => transformInstagramWithFallback(o, entity.id, username)) },
    { name: "Facebook (RapidAPI)",    run: () => wrap((o) => transformFacebookWithFallback(o, entity.id, username)) },
    { name: "FB Pages Scraper",       run: () => wrap((o) => socialSvc.checkFacebookPagesScraper(getContext(o), entity.id, username)) },
    { name: "TikTok",                 run: () => wrap((o) => checkTikTok(o, entity.id, username)) },
    { name: "YouTube",                run: () => wrap((o) => checkYouTube(o, entity.id, username, entity.metadata)) },
    { name: "Web Search",             run: () => wrap((o) => checkWebSearch(o, entity.id, entity.label)) },
    { name: "Leak-Check.Net",         run: () => wrap((o) => domainSvc.checkLeakCheckNet(getContext(o), entity.id, entity.label)) },
    { name: "Email Verifier",         run: () => wrap((o) => {
      if (entity.label.includes("@")) {
        return domainSvc.checkEmailVerifier(getContext(o), entity.id, entity.label);
      }
      return Promise.resolve();
    }) },
    { name: "OpenSanctions",          run: () => wrap((o) => enrichOpenSanctions(o, entity.id, entity.label)) },
  ];
}

// Helpers to split transformDomain into WHOIS-only and DNS-only chunks.
async function transformDomainWhoisOnly(entity: InputEntity, domain: string, apiKey: string): Promise<R> {
  const out = emptyR();
  const data = await safeJson(
    `https://www.whoisxmlapi.com/whoisserver/WhoisService?apiKey=${apiKey}&domainName=${encodeURIComponent(domain)}&outputFormat=JSON`,
  );
  const rec = data?.WhoisRecord ?? {};
  const registrant = rec.registrant ?? {};
  if (rec.registrarName) pushEntity(out, entity.id, { type: "organization", label: `Registrar: ${rec.registrarName}` }, "registered via");
  if (registrant.organization || registrant.name) {
    pushEntity(out, entity.id, {
      type: "organization",
      label: registrant.organization || registrant.name,
      metadata: { country: registrant.country ?? "", state: registrant.state ?? "" },
    }, "registrant");
  }
  if (registrant.email) pushEntity(out, entity.id, { type: "email", label: registrant.email }, "admin email");
  if (registrant.country || registrant.state) {
    pushEntity(out, entity.id, { type: "location", label: [registrant.state, registrant.country].filter(Boolean).join(", ") }, "registered in");
  }
  if (rec.createdDate || rec.expiresDate) {
    pushEntity(out, entity.id, {
      type: "organization",
      label: `Created: ${rec.createdDate ?? "?"}`,
      metadata: { created: rec.createdDate ?? "", expires: rec.expiresDate ?? "" },
    }, "lifetime");
  }
  return out;
}

async function transformDomainDnsOnly(entity: InputEntity, domain: string): Promise<R> {
  const out = emptyR();
  const dns = await safeJson(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A`);
  const answers = (dns?.Answer ?? []).filter((a: any) => a.type === 1).slice(0, 3);
  for (const ans of answers) {
    pushEntity(out, entity.id, { type: "ip", label: ans.data, metadata: { ttl: String(ans.TTL ?? "") } }, "resolves to");
  }
  return out;
}

function planStages(entity: InputEntity): Stage[] {
  switch (entity.type) {
    case "domain": return stagesForDomain(entity);
    case "person":
    case "social": return stagesForPerson(entity);
    case "email":  return [
      { name: "EmailRep", run: () => transformEmail(entity) },
      { name: "EmailRep (Diego/RapidAPI)", run: () => wrap((o) => { return checkEmailRepRapid(o, entity.id, entity.label.trim()).then(() => {}); }) },
    ];
    case "phone":  return [{ name: "NumVerify", run: () => transformPhone(entity) }];
    case "ip":     return [{ name: "IP Intel",  run: () => transformIp(entity) }];
    case "hash":   return [{ name: "Hash Intel",run: () => transformHash(entity) }];
    case "eth_wallet": return [{ name: "Etherscan", run: () => transformEthWallet(entity) }];
    case "btc_wallet": return [{ name: "BTC Chain", run: () => transformBtcWallet(entity) }];
    case "short_url":  return [{ name: "URL Unshorten", run: () => transformShortUrl(entity) }];
    case "twitter_profile":   return [{ name: "Twitter/X (Direct RapidAPI)",   run: () => wrap((o) => transformTwitterWithFallback(o, entity.id, entity.label.replace(/^@/, "").trim())) }];
    case "facebook_profile":  return [{ name: "Facebook (Direct RapidAPI)",    run: () => wrap((o) => transformFacebookWithFallback(o, entity.id, entity.label.replace(/^@/, "").trim())) }];
    case "linkedin_profile":  return [{ name: "LinkedIn (Direct RapidAPI)",    run: () => wrap((o) => transformLinkedInWithFallback(o, entity.id, entity.label.replace(/^@/, "").trim())) }];
    case "instagram_profile": return [{ name: "Instagram (Direct RapidAPI)",   run: () => wrap((o) => transformInstagramWithFallback(o, entity.id, entity.label.replace(/^@/, "").trim())) }];
    case "web_search":       return [{ name: "Web Search", run: () => transformWebSearch(entity) }];
    case "youtube":          return [{ name: "YouTube",    run: () => transformYouTube(entity) }];
    case "mitre_technique":  return [{ name: "MITRE",      run: () => wrap((o) => checkWebSearch(o, entity.id, `MITRE ATT&CK ${entity.label}`)) }];
    case "sanction":         return [{ name: "OpenSanctions", run: () => wrap((o) => enrichOpenSanctions(o, entity.id, entity.label)) }];
    case "organization": {
      const guess = entity.label.toLowerCase().replace(/\s+/g, "") + ".com";
      return [
        ...stagesForDomain({ ...entity, label: guess }),
        { name: "Web Search", run: () => wrap((o) => checkWebSearch(o, entity.id, entity.label)) },
      ];
    }
    default:
      return [{ name: "Web Search", run: () => wrap((o) => checkWebSearch(o, entity.id, entity.label)) }];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { entity, apiKeys } = await req.json();
    if (apiKeys && typeof apiKeys === 'object') {
      currentApiKeys = apiKeys;
    } else {
      currentApiKeys = {};
    }

    if (!entity || !entity.type || !entity.label) {
      return new Response(JSON.stringify({ error: "Invalid entity" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stages = planStages(entity);
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

        send({ type: "plan", stages: stages.map((s) => s.name) });

        let totalEntities = 0;
        // Run stages concurrently; emit each as it resolves.
        await Promise.all(stages.map(async (s) => {
          send({ type: "stage", name: s.name, status: "loading" });
          try {
            const r = await s.run();
            totalEntities += r.entities.length;
            send({
              type: "partial",
              name: s.name,
              status: r.entities.length > 0 ? "done" : "empty",
              entities: r.entities,
              relations: r.relations,
              warning: r.warning,
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            send({ type: "partial", name: s.name, status: "error", error: msg, entities: [], relations: [] });
          }
        }));

        if (totalEntities === 0) {
          const fallback = emptyR();
          pushEntity(fallback, entity.id, { type: "organization", label: `No additional data for ${entity.type}` }, "result");
          send({ type: "partial", name: "Fallback", status: "empty", entities: fallback.entities, relations: fallback.relations });
        }

        send({ type: "done" });
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("osint-transform error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg, entities: [], relations: [] }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
