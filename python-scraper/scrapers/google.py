import uuid
import time
import asyncio
import undetected_chromedriver as uc
from bs4 import BeautifulSoup
from utils.proxy_manager import proxy_manager
from models import TransformRequest, TransformResponse, OsintEntity, OsintRelation

def sync_scrape_google(request: TransformRequest) -> TransformResponse:
    query = request.value
    url = f"https://www.google.com/search?q={query}"
    
    response = TransformResponse(
        success=False,
        source="google",
        entities=[],
        relations=[]
    )
    
    options = uc.ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    
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
        
        search_id = str(uuid.uuid4())
        search_entity = OsintEntity(
            id=search_id,
            type="web_search",
            label=f"Search: {query}",
            metadata={"query": query}
        )
        response.entities.append(search_entity)
        
        results = soup.select("div.g")
        for index, result in enumerate(results[:3]):
            try:
                title_el = result.select_one("h3")
                link_el = result.select_one("a")
                
                if title_el and link_el:
                    title = title_el.get_text(strip=True)
                    link = link_el.get("href")
                    
                    if title and link:
                        result_id = str(uuid.uuid4())
                        result_entity = OsintEntity(
                            id=result_id,
                            type="domain",
                            label=title[:30] + "...",
                            metadata={"url": link, "title": title}
                        )
                        response.entities.append(result_entity)
                        
                        response.relations.append(OsintRelation(
                            id=str(uuid.uuid4()),
                            sourceId=search_id,
                            targetId=result_id,
                            label="result"
                        ))
            except Exception:
                continue
                
        response.success = True
    except Exception as e:
        response.error = str(e)
    finally:
        if driver:
            driver.quit()
            
    return response

async def scrape_google(request: TransformRequest) -> TransformResponse:
    return await asyncio.to_thread(sync_scrape_google, request)
