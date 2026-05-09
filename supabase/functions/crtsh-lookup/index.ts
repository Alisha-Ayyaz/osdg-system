// crt.sh subdomain / certificate history lookup
// Public endpoint, no API key required.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface CrtRow {
  issuer_ca_id: number;
  issuer_name: string;
  common_name: string;
  name_value: string;
  id: number;
  entry_timestamp: string;
  not_before: string;
  not_after: string;
  serial_number: string;
}

interface CertOut {
  id: number;
  common_name: string;
  issuer: string;
  not_before: string;
  not_after: string;
  serial: string;
}

interface SubOut {
  subdomain: string;
  first_seen: string;
  last_seen: string;
  cert_count: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { domain } = await req.json();
    const clean = String(domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!clean || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(clean)) {
      return new Response(JSON.stringify({ error: "Invalid domain" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = `https://crt.sh/?q=${encodeURIComponent("%." + clean)}&output=json`;
    const r = await fetch(url, { headers: { "User-Agent": "OSDG/1.0" } });
    if (!r.ok) {
      return new Response(
        JSON.stringify({ error: `crt.sh ${r.status}`, domain: clean, certificates: [], subdomains: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const text = await r.text();
    let rows: CrtRow[] = [];
    try { rows = JSON.parse(text); } catch { rows = []; }

    // Subdomain aggregation
    const subMap = new Map<string, SubOut>();
    for (const row of rows) {
      const names = (row.name_value || "").split(/\n+/).map((n) => n.trim().toLowerCase()).filter(Boolean);
      for (const n of names) {
        if (n.startsWith("*.")) continue;
        if (!n.endsWith(clean)) continue;
        const existing = subMap.get(n);
        if (!existing) {
          subMap.set(n, {
            subdomain: n,
            first_seen: row.not_before,
            last_seen: row.not_after,
            cert_count: 1,
          });
        } else {
          existing.cert_count += 1;
          if (row.not_before < existing.first_seen) existing.first_seen = row.not_before;
          if (row.not_after > existing.last_seen) existing.last_seen = row.not_after;
        }
      }
    }

    const subdomains = Array.from(subMap.values()).sort((a, b) =>
      a.subdomain.localeCompare(b.subdomain),
    );

    const certificates: CertOut[] = rows.slice(0, 200).map((r) => ({
      id: r.id,
      common_name: r.common_name,
      issuer: r.issuer_name,
      not_before: r.not_before,
      not_after: r.not_after,
      serial: r.serial_number,
    }));

    return new Response(
      JSON.stringify({
        domain: clean,
        total_certs: rows.length,
        total_subdomains: subdomains.length,
        subdomains,
        certificates,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
