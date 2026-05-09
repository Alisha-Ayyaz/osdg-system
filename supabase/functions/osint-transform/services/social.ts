// services/social.ts

export async function checkFacebookPagesScraper(ctx: any, entityId: string, username: string) {
  const { safeJson, pushEntity, getEnv, out } = ctx;
  
  // Example RapidAPI configuration for a Facebook Pages Scraper
  const apiKey = getEnv("FB_PAGES_SCRAPER_API_KEY");
  const apiEndpoint = getEnv("FB_PAGES_SCRAPER_ENDPOINT") || "https://facebook-pages-scraper2.p.rapidapi.com/pages";

  if (!apiKey) return;

  const data = await safeJson(`${apiEndpoint}?query=${encodeURIComponent(username)}`, {
    headers: {
      "X-RapidAPI-Key": apiKey,
      "X-RapidAPI-Host": new URL(apiEndpoint).host,
    }
  });

  if (!data || !Array.isArray(data.data)) return;

  for (const page of data.data.slice(0, 5)) {
    pushEntity(
      out,
      entityId,
      {
        type: "facebook_profile",
        label: `FB Page: ${page.name ?? username}`,
        platform: "facebook",
        metadata: {
          about: String(page.about ?? "").slice(0, 200),
          followers: String(page.followers ?? ""),
          category: page.category ?? "",
          url: page.url ?? `https://facebook.com/${page.username ?? username}`
        }
      },
      "facebook page match"
    );
  }
}
