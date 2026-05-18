import uuid
from playwright.async_api import async_playwright
from utils.proxy_manager import proxy_manager
from models import TransformRequest, TransformResponse, OsintEntity, OsintRelation

async def scrape_linkedin(request: TransformRequest) -> TransformResponse:
    username = request.value.replace("https://www.linkedin.com/in/", "").strip("/")
    url = f"https://www.linkedin.com/in/{username}"
    
    response = TransformResponse(
        success=False,
        source="linkedin",
        entities=[],
        relations=[]
    )
    
    proxy_settings = proxy_manager.get_proxy()
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            proxy=proxy_settings
        )
        
        # Basic stealth by mimicking user agent
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1920, "height": 1080}
        )
        
        page = await context.new_page()
        
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            
            # This is a very basic example. LinkedIn heavily protects public profiles.
            # In a real scenario, you'd need logged-in session cookies or robust stealth plugins.
            
            # Attempt to extract name
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
                type="linkedin_profile",
                label=f"LinkedIn: {name}",
                platform="linkedin",
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
