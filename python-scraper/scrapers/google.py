import uuid
from playwright.async_api import async_playwright
from utils.proxy_manager import proxy_manager
from models import TransformRequest, TransformResponse, OsintEntity, OsintRelation

async def scrape_google(request: TransformRequest) -> TransformResponse:
    query = request.value
    url = f"https://www.google.com/search?q={query}"
    
    response = TransformResponse(
        success=False,
        source="google",
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
            
            # Simple extraction of top 3 search results
            results = await page.locator("div.g").all()
            
            # Create a main web search entity
            search_id = str(uuid.uuid4())
            search_entity = OsintEntity(
                id=search_id,
                type="web_search",
                label=f"Search: {query}",
                metadata={"query": query}
            )
            response.entities.append(search_entity)
            
            for index, result in enumerate(results[:3]):
                title_el = result.locator("h3")
                link_el = result.locator("a")
                
                if await title_el.count() > 0 and await link_el.count() > 0:
                    title = await title_el.first.inner_text()
                    link = await link_el.first.get_attribute("href")
                    
                    if title and link:
                        result_id = str(uuid.uuid4())
                        result_entity = OsintEntity(
                            id=result_id,
                            type="domain", # Broadly categorizing as domain/website
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
            
            response.success = True
            
        except Exception as e:
            response.error = str(e)
        finally:
            await browser.close()
            
    return response
