// services/social.ts

export async function checkPythonScraper(ctx: any, entity: any): Promise<boolean> {
  const { pushEntity, pushRelation, getEnv, out } = ctx;
  
  // Configuration for the new Python FastAPI Scraper Service
  const scraperUrl = getEnv("PYTHON_SCRAPER_URL"); // e.g., https://your-railway-app.up.railway.app/api/transform
  const apiKey = getEnv("PYTHON_SCRAPER_API_KEY");
  
  if (!scraperUrl) {
    console.log("PYTHON_SCRAPER_URL not configured. Skipping Python scraper.");
    return false;
  }

  // Determine platform based on entity type or existing platform
  let platform = entity.platform || "";
  if (!platform) {
      if (entity.type === "twitter_profile") platform = "twitter";
      else if (entity.type === "linkedin_profile") platform = "linkedin";
      else if (entity.type === "facebook_profile") platform = "facebook";
      else if (entity.type === "instagram_profile") platform = "instagram";
      else if (entity.type === "web_search") platform = "google";
  }

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
    
    // Note: The pushEntity function in the Edge Function handles relation creation automatically
    // when you pass the `entity.id` as the source, connecting it with a generic "has_data" or "related" edge.
    // Since the Python service also returns `relations`, we could theoretically push those exact relations
    // if the edge function supports a `pushRelation` ctx method.
    // Assuming `ctx.pushRelation` is available or `pushEntity` is enough.
    
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
