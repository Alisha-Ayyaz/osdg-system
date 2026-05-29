# OSDG Social Media Scraper Service

This is a Python FastAPI service designed to handle heavy social media scraping (Twitter, LinkedIn, Facebook, Instagram, Google) for the OSDG (Open Source Data Gathering) project.

---

## 1. Local Setup Steps

To run the scraper service locally, follow these steps:

1. **Install Python 3.11+** if you haven't already.
2. **Clone/Navigate** to the `python-scraper` directory.
3. **Create a Virtual Environment** (Recommended):
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows use: venv\Scripts\activate
   ```
4. **Install Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```
5. **Install Google Chrome**: Ensure Google Chrome is installed on your system as it's required by `undetected-chromedriver`.
6. **Install & Run Redis (Optional but Recommended)**:
   - *Windows*: Use WSL or download a Windows-compatible Redis binary.
   - *Mac*: `brew install redis` and `brew services start redis`
   - *Linux*: `sudo apt install redis-server` and `sudo systemctl start redis`

---

## 2. Running the Service Locally

Start the FastAPI application using `uvicorn`:

```bash
uvicorn main:app --reload --port 8000
```

The service will be available at `http://localhost:8000`. You can view the interactive API documentation at `http://localhost:8000/docs`.

---

## 3. Testing the Twitter Transform

You can test the main scraping functionality for Twitter or other platforms.

**Endpoint:** `POST /api/transform`
**Headers:** `X-API-Key: <your_secure_api_key_here>`

**cURL Example (Profile Data):**
```bash
curl -X POST http://localhost:8000/api/transform \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your_secure_api_key_here" \
  -d '{
    "entityType": "person",
    "value": "elonmusk",
    "platform": "twitter",
    "transformType": "profile",
    "options": {}
  }'
```

**cURL Example (Full Data - includes Recent Tweets):**
Change `"transformType": "profile"` to `"transformType": "full"`.

---

## 4. Environment Variables (`.env`)

Copy `.env.example` to `.env` before running the service.

| Variable | Description |
|----------|-------------|
| `API_KEY` | The secure key used to authenticate API requests (e.g., from your Supabase Edge Function). |
| `REDIS_URL` | Connection string for Redis cache (e.g., `redis://localhost:6379`). Leave blank if not using Redis. |

---

## 5. Docker Setup

To run the entire service via Docker:

1. **Build the Image:**
   ```bash
   docker build -t osdg-scraper .
   ```
2. **Run the Container:**
   ```bash
   docker run -p 8000:8000 --env-file .env osdg-scraper
   ```
