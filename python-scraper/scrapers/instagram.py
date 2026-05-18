import uuid
from playwright.async_api import async_playwright
from utils.proxy_manager import proxy_manager
from models import TransformRequest, TransformResponse, OsintEntity, OsintRelation

async def scrape_instagram(request: TransformRequest) -> TransformResponse:
    username = request.value.replace("https://www.instagram.com/", "").replace("/", "").strip()
    url = f"https://www.instagram.com/{username}/"
    
    response = TransformResponse(
        success=False,
        source="instagram",
        entities=[],
        relations=[]
    )
    
    proxy_settings = proxy_manager.get_proxy()
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            proxy=proxy_settings
        )
        
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1" # Mobile UA often works better for IG
        )
        
        page = await context.new_page()
        
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            
            title = await page.title()
            name = title.split(" (@")[0] if " (@" in title else username
            
            person_id = str(uuid.uuid4())
            person_entity = OsintEntity(
                id=person_id,
                type="person",
                label=name,
                metadata={"title": title}
            )
            response.entities.append(person_entity)
            
            profile_id = str(uuid.uuid4())
            profile_entity = OsintEntity(
                id=profile_id,
                type="instagram_profile",
                label=f"@{username}",
                platform="instagram",
                metadata={"url": url}
            )
            response.entities.append(profile_entity)
            
            response.relations.append(OsintRelation(
                id=str(uuid.uuid4()),
                sourceId=person_id,
                targetId=profile_id,
                label="has_profile"
            ))
            
            response.success = True
            
        except Exception as e:
            response.error = str(e)
        finally:
            await browser.close()
            
    return response
