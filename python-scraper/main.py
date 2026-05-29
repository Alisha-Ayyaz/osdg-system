import os
import json
import hashlib
from fastapi import FastAPI, Depends, HTTPException, Security
from fastapi.security import APIKeyHeader
from dotenv import load_dotenv
import redis.asyncio as redis
from contextlib import asynccontextmanager

from models import TransformRequest, TransformResponse
from scrapers.twitter import scrape_twitter
from scrapers.linkedin import scrape_linkedin
from scrapers.facebook import scrape_facebook
from scrapers.instagram import scrape_instagram
from scrapers.google import scrape_google

load_dotenv()

# Setup API Key authentication
API_KEY = os.getenv("API_KEY")
api_key_header = APIKeyHeader(name="X-API-Key")

async def get_api_key(api_key_header: str = Security(api_key_header)):
    if API_KEY and api_key_header != API_KEY:
        raise HTTPException(status_code=403, detail="Could not validate credentials")
    return api_key_header

# Setup Redis Cache
redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
redis_client = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client
    try:
        redis_client = redis.from_url(redis_url, encoding="utf-8", decode_responses=True)
        # Test connection
        await redis_client.ping()
        print("Connected to Redis successfully.")
    except Exception as e:
        print(f"Failed to connect to Redis: {e}")
        redis_client = None
    yield
    if redis_client:
        await redis_client.close()

app = FastAPI(title="OSDG Social Media Scraper Service", lifespan=lifespan)

def get_cache_key(request: TransformRequest) -> str:
    # Create a deterministic string to hash
    req_str = f"{request.entityType}:{request.value}:{request.platform}:{request.transformType}"
    return f"osdg:cache:{hashlib.md5(req_str.encode()).hexdigest()}"

@app.post("/api/transform", response_model=TransformResponse)
async def transform_endpoint(request: TransformRequest, api_key: str = Depends(get_api_key)):
    # Check Cache
    if redis_client:
        cache_key = get_cache_key(request)
        cached_result = await redis_client.get(cache_key)
        if cached_result:
            print(f"Cache hit for {request.value} on {request.platform}")
            return TransformResponse.model_validate_json(cached_result)

    # Route to appropriate scraper
    response = None
    
    try:
        import asyncio
        platform = request.platform.lower() if request.platform else ""
        entity_type = request.entityType.lower() if request.entityType else ""
        
        if entity_type == "person" and (platform == "" or platform == "all"):
            # Run all concurrently
            results = await asyncio.gather(
                scrape_twitter(request),
                scrape_linkedin(request),
                scrape_instagram(request),
                scrape_facebook(request),
                scrape_google(request),
                return_exceptions=True
            )
            
            response = TransformResponse(
                success=True,
                source="all",
                entities=[],
                relations=[],
                rawData={}
            )
            
            for res in results:
                if isinstance(res, TransformResponse) and res.success:
                    response.entities.extend(res.entities)
                    response.relations.extend(res.relations)
                elif isinstance(res, Exception):
                    print(f"Scraper error: {res}")
        else:
            if platform == "twitter" or "twitter" in entity_type:
                response = await scrape_twitter(request)
            elif platform == "linkedin" or "linkedin" in entity_type:
                response = await scrape_linkedin(request)
            elif platform == "facebook" or "facebook" in entity_type:
                response = await scrape_facebook(request)
            elif platform == "instagram" or "instagram" in entity_type:
                response = await scrape_instagram(request)
            elif platform == "google" or entity_type == "web_search":
                response = await scrape_google(request)
            else:
                response = await scrape_google(request)
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal scraper error: {str(e)}")

    if not response:
        raise HTTPException(status_code=400, detail="Unsupported platform or transform type")

    if not response.success:
        raise HTTPException(status_code=500, detail=response.error or "Scraping failed")

    # Save to Cache if successful
    if redis_client:
        cache_key = get_cache_key(request)
        # Cache for 24 hours
        await redis_client.setex(cache_key, 86400, response.model_dump_json())

    return response


@app.get("/health")
async def health_check():
    return {"status": "ok"}
