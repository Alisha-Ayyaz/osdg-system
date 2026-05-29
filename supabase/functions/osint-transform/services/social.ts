// services/social.ts

export async function checkPythonScraper(ctx: any, entity: any): Promise<boolean> {
  const { pushEntity, pushRelation, getEnv, out } = ctx;
  
  // Configuration for the new Python FastAPI Scraper Service
  const scraperUrl = getEnv("PYTHON_SCRAPER_URL"); 
  const apiKey = getEnv("PYTHON_SCRAPER_API_KEY");

  // Determine platform based on entity type or existing platform
  let platform = entity.platform || "";
  if (!platform) {
      if (entity.type === "twitter_profile") platform = "twitter";
      else if (entity.type === "linkedin_profile") platform = "linkedin";
      else if (entity.type === "facebook_profile") platform = "facebook";
      else if (entity.type === "instagram_profile") platform = "instagram";
      else if (entity.type === "web_search") platform = "google";
  }

  // === INTERNAL MOCK FLOW FOR UI TESTING ===
  if (!scraperUrl || scraperUrl.trim() === '') {
      console.log(`[Mock Mode] Simulating ${platform || 'social'} scrape for 2 seconds...`);
      // Simulate 2-second scraping delay to show scanning animation
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const username = entity.label.replace('@', '').split(' ')[0].toLowerCase() || "unknown";
      const mockPlatform = platform || "twitter";
      
      // Generate rich fake nodes for the canvas
      pushEntity(out, entity.id, {
          type: `${mockPlatform}_profile`,
          platform: mockPlatform,
          label: `@${username}_official`,
          metadata: {
              url: `https://${mockPlatform}.com/${username}`,
              bio: `This is a simulated ${mockPlatform} bio for testing the UI. Focused on OSINT and cybersecurity!`,
              followers: `${Math.floor(Math.random() * 50) + 1}K`,
              verified: "true"
          }
      }, "has profile");
      
      pushEntity(out, entity.id, {
          type: "location",
          label: ["San Francisco, CA", "London, UK", "Berlin, DE"][Math.floor(Math.random() * 3)],
          metadata: { source: `${mockPlatform} location extraction` }
      }, "located in");
      
      pushEntity(out, entity.id, {
          type: "post",
          platform: mockPlatform,
          label: `Recent ${mockPlatform} post: Exploring the power of graph databases in OSINT...`,
          metadata: { likes: String(Math.floor(Math.random() * 500)), date: new Date().toISOString() }
      }, "recent post");
      
      pushEntity(out, entity.id, {
          type: "domain",
          label: `${username}-intel.com`,
          metadata: { source: "bio link extraction" }
      }, "bio link");

      // Return true to indicate successful "scrape" and prevent fallback to external APIs
      return true;
  }
  // === END MOCK FLOW ===

  const payload = {
    entityType: entity.type,
    value: entity.label,
    platform: platform,
    transformType: "profile", // Default for now
    options: {}
  };

  try {
    const response = await fetch(scraperUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey || ''
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
        console.error(`Python scraper returned ${response.status}: ${await response.text()}`);
        return false;
    }

    const data = await response.json();
    
    if (!data.success || !Array.isArray(data.entities)) {
        return false;
    }

    // Process and push the entities returned by the Python service
    for (const newEntity of data.entities) {
        pushEntity(
            out,
            entity.id, // the source entity that triggered this transform
            {
                type: newEntity.type,
                label: newEntity.label,
                platform: newEntity.platform,
                metadata: newEntity.metadata
            },
            `from ${data.source} scraper`
        );
    }
    
    if (Array.isArray(data.relations) && typeof pushRelation === 'function') {
        for (const rel of data.relations) {
            pushRelation(out, rel.sourceId, rel.targetId, rel.label);
        }
    }
    
    return true;

  } catch (error) {
    console.error("Failed to fetch from Python Scraper:", error);
    return false;
  }
}
