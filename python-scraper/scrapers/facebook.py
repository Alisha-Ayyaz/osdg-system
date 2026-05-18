import uuid
from playwright.async_api import async_playwright
from utils.proxy_manager import proxy_manager
from models import TransformRequest, TransformResponse, OsintEntity, OsintRelation

async def scrape_facebook(request: TransformRequest) -> TransformResponse:
    username = request.value.replace("https://www.facebook.com/", "").strip("/")
    url = f"https://www.facebook.com/{username}"
    
    response = TransformResponse(
        success=False,
        source="facebook",
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
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        
        page = await context.new_page()
        
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            
            title = await page.title()
            name = title.split(" | ")[0] if " | " in title else username
            
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
                type="facebook_profile",
                label=f"Facebook: {name}",
                platform="facebook",
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
