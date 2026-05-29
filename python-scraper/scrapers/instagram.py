import uuid
import time
import asyncio
import undetected_chromedriver as uc
from bs4 import BeautifulSoup
from utils.proxy_manager import proxy_manager
from models import TransformRequest, TransformResponse, OsintEntity, OsintRelation

def sync_scrape_instagram(request: TransformRequest) -> TransformResponse:
    username = request.value.replace("https://www.instagram.com/", "").replace("/", "").strip()
    url = f"https://www.instagram.com/{username}/"
    
    response = TransformResponse(
        success=False,
        source="instagram",
        entities=[],
        relations=[]
    )
    
    options = uc.ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--user-agent=Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1")
    
    proxy_settings = proxy_manager.get_proxy()
    if proxy_settings:
        if isinstance(proxy_settings, dict) and 'server' in proxy_settings:
            options.add_argument(f"--proxy-server={proxy_settings['server']}")
        elif isinstance(proxy_settings, str):
            options.add_argument(f"--proxy-server={proxy_settings}")
            
    driver = None
    try:
        driver = uc.Chrome(options=options)
        driver.set_page_load_timeout(30)
        driver.get(url)
        
        # Hydration wait
        time.sleep(1.5)
        html = driver.page_source
        
        soup = BeautifulSoup(html, "html.parser")
        
        title_el = soup.select_one("title")
        title = title_el.get_text(strip=True) if title_el else f"@{username}"
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
        if driver:
            driver.quit()
            
    return response

async def scrape_instagram(request: TransformRequest) -> TransformResponse:
    return await asyncio.to_thread(sync_scrape_instagram, request)
