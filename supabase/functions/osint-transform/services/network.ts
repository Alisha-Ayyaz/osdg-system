// services/network.ts

// The Harvester
export async function checkTheHarvester(ctx: any, entityId: string, domain: string) {
  const { safeJson, pushEntity, getEnv, out } = ctx;
  const apiKey = getEnv("THEHARVESTER_API_KEY");
  if (!apiKey) return;

  const data = await safeJson(`https://api.theharvester.io/v1/search?domain=${encodeURIComponent(domain)}&apiKey=${apiKey}`);
  if (!data || !data.results) return;

  const emails = data.results.emails ?? [];
  const hosts = data.results.hosts ?? [];

  pushEntity(
    out,
    entityId,
    {
      type: "organization",
      label: `The Harvester: ${emails.length} emails, ${hosts.length} hosts`,
      metadata: {
        emails_found: String(emails.length),
        hosts_found: String(hosts.length)
      }
    },
    "harvester intelligence"
  );
}

// Moocher.io
export async function checkMoocherIo(ctx: any, entityId: string, ip: string) {
  const { safeJson, pushEntity, getEnv, out } = ctx;
  const apiKey = getEnv("MOOCHER_IO_API_KEY");
  if (!apiKey) return;

  const data = await safeJson(`https://api.moocher.io/v1/ip/${encodeURIComponent(ip)}?apiKey=${apiKey}`);
  if (!data || !data.report) return;

  pushEntity(
    out,
    entityId,
    {
      type: "organization",
      label: `Moocher.io: ${data.report.threat_level ?? "Unknown"} Threat`,
      metadata: {
        threat_level: data.report.threat_level ?? "",
        malicious_activity: String(data.report.malicious_activity ?? false),
        description: data.report.description ?? ""
      }
    },
    "moocher intelligence"
  );
}
