import os
import random
from typing import Optional, Dict

class ProxyManager:
    def __init__(self):
        self.proxies = []
        self._load_proxies()

    def _load_proxies(self):
        # Load from environment variable (comma separated)
        env_proxies = os.getenv("PROXIES", "")
        if env_proxies:
            self.proxies = [p.strip() for p in env_proxies.split(",") if p.strip()]

    def get_proxy(self) -> Optional[Dict[str, str]]:
        if not self.proxies:
            return None
        
        # Select a random proxy
        proxy_url = random.choice(self.proxies)
        
        # Return format expected by Playwright
        return {
            "server": proxy_url
        }

proxy_manager = ProxyManager()
