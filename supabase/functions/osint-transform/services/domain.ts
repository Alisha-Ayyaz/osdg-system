// services/domain.ts

// WHOIS Pro
export async function checkWhoisPro(ctx: any, entityId: string, domain: string) {
  const { safeJson, pushEntity, getEnv, out } = ctx;
  const apiKey = getEnv("WHOIS_PRO_API_KEY");
  if (!apiKey) return;

  const data = await safeJson(`https://api.whoispro.com/v1/whois?domain=${encodeURIComponent(domain)}&apiKey=${apiKey}`);
  if (!data || !data.result) return;

  pushEntity(
    out,
    entityId,
    {
      type: "organization",
      label: `WHOIS Pro: ${data.result.registrar ?? "Unknown Registrar"}`,
      metadata: {
        registrar: data.result.registrar ?? "",
        created: data.result.creation_date ?? "",
        expires: data.result.expiration_date ?? "",
        contact_email: data.result.contact_email ?? ""
      }
    },
    "whois pro data"
  );
}

// WhoisFreaks
export async function checkWhoisFreaks(ctx: any, entityId: string, domain: string) {
  const { safeJson, pushEntity, getEnv, out } = ctx;
  const apiKey = getEnv("WHOISFREAKS_API_KEY");
  if (!apiKey) return;

  const data = await safeJson(`https://api.whoisfreaks.com/v1.0/whois?apiKey=${apiKey}&domainName=${encodeURIComponent(domain)}`);
  if (!data || !data.whois_record) return;

  pushEntity(
    out,
    entityId,
    {
      type: "organization",
      label: `WhoisFreaks: ${data.whois_record.registrar_name ?? "Unknown"}`,
      metadata: {
        registrar_name: data.whois_record.registrar_name ?? "",
        domain_age: String(data.whois_record.domain_age ?? ""),
        status: (data.whois_record.domain_status ?? []).join(", ")
      }
    },
    "whoisfreaks data"
  );
}

// Domain & IP Intelligence
export async function checkDomainIpIntel(ctx: any, entityId: string, target: string) {
  const { safeJson, pushEntity, getEnv, out } = ctx;
  const apiKey = getEnv("DOMAIN_IP_INTEL_API_KEY");
  if (!apiKey) return;

  const data = await safeJson(`https://api.domainipintel.com/v1/analyze?target=${encodeURIComponent(target)}&apiKey=${apiKey}`);
  if (!data || !data.intelligence) return;

  pushEntity(
    out,
    entityId,
    {
      type: "organization",
      label: `Domain Intel: Risk ${data.intelligence.risk_score ?? "Unknown"}`,
      metadata: {
        risk_score: String(data.intelligence.risk_score ?? ""),
        classification: data.intelligence.classification ?? "",
        hosting_provider: data.intelligence.hosting_provider ?? ""
      }
    },
    "domain/ip intelligence"
  );
}

// Domain Identity
export async function checkDomainIdentity(ctx: any, entityId: string, domain: string) {
  const { safeJson, pushEntity, getEnv, out } = ctx;
  const apiKey = getEnv("DOMAIN_IDENTITY_API_KEY");
  if (!apiKey) return;

  const data = await safeJson(`https://api.domainidentity.com/v1/identity?domain=${encodeURIComponent(domain)}&apiKey=${apiKey}`);
  if (!data || !data.identity) return;

  pushEntity(
    out,
    entityId,
    {
      type: "organization",
      label: `Domain Identity: ${data.identity.company_name ?? "Private"}`,
      metadata: {
        company_name: data.identity.company_name ?? "",
        industry: data.identity.industry ?? "",
        founded_year: String(data.identity.founded_year ?? "")
      }
    },
    "domain identity"
  );
}

// Leak-Check.Net
export async function checkLeakCheckNet(ctx: any, entityId: string, query: string) {
  const { safeJson, pushEntity, getEnv, out } = ctx;
  const apiKey = getEnv("LEAKCHECK_NET_API_KEY");
  if (!apiKey) return;

  const data = await safeJson(`https://leakcheck.net/api/public?key=${apiKey}&check=${encodeURIComponent(query)}`);
  if (!data || !data.success || !data.sources) return;

  pushEntity(
    out,
    entityId,
    {
      type: "organization",
      label: `Leak-Check: ${data.sources} breach(es) found`,
      metadata: {
        breaches_found: String(data.sources),
        query: query,
        warning: "This entity appears in public data breaches."
      }
    },
    "breach data"
  );
}

// Email Verifier/Checker
export async function checkEmailVerifier(ctx: any, entityId: string, email: string) {
  const { safeJson, pushEntity, getEnv, out } = ctx;
  const apiKey = getEnv("EMAIL_VERIFIER_API_KEY");
  if (!apiKey) return;

  const data = await safeJson(`https://api.emailverifier.com/v1/verify?email=${encodeURIComponent(email)}&apiKey=${apiKey}`);
  if (!data || !data.verification) return;

  pushEntity(
    out,
    entityId,
    {
      type: "organization",
      label: `Email Verifier: ${data.verification.status ?? "Unknown"}`,
      metadata: {
        status: data.verification.status ?? "",
        deliverable: String(data.verification.deliverable ?? ""),
        catch_all: String(data.verification.catch_all ?? "")
      }
    },
    "email validation"
  );
}
