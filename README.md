# Lead Chai Email Finder API

Own email finder API for Lead Chai.

## Files

```text
lead-chai-api/
├── main.py
├── requirements.txt
├── .env
└── README.md
```

## Local run

```bash
pip install -r requirements.txt
uvicorn main:app --reload
```

Open:

```text
http://127.0.0.1:8000/docs
```

## API endpoints

- GET `/`
- GET `/health`
- POST `/enrich`
- POST `/bulk-enrich`

## API key

Edit `.env`:

```env
LEAD_CHAI_API_KEY=lc_live_your_secret_key_here
```

## Render settings

Build command:

```bash
pip install -r requirements.txt
```

Start command:

```bash
uvicorn main:app --host 0.0.0.0 --port $PORT
```

## Example POST body

```json
{
  "api_key": "lc_live_your_secret_key_here",
  "website": "https://cleanersgrowth.com"
}
```
