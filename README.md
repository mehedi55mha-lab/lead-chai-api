# Lead Chai API + Google Maps extension

Find local business leads on Google Maps, pull phone/website from the place panel, then enrich emails from each website with this FastAPI backend.

```text
lead-chai-api/
├── main.py                 FastAPI app (Vercel entrypoint)
├── requirements.txt
├── vercel.json
├── templates/index.html    Landing page
├── public/og.jpg
└── extension/              Chrome extension (load unpacked)
```

## 1. Host the API on Vercel

1. Push this repo to GitHub.
2. Open [vercel.com/new](https://vercel.com/new) and import the repo.
3. Vercel detects FastAPI from `main.py`.
4. Add environment variable:

```env
LEAD_CHAI_API_KEY=lc_live_your_secret_key_here
```

5. Deploy. Your API URL will look like `https://lead-chai-api.vercel.app`.

CLI option:

```bash
npm i -g vercel
vercel login
vercel --prod
```

Check:

- `GET /health`
- `GET /docs`
- `POST /enrich`

Vercel serverless functions time out if a scrape runs too long. The extension calls `/enrich` **one website at a time** with `mode: "quick"` so it stays within the limit.

## 2. Load the Chrome extension

1. Chrome-e jaw: `chrome://extensions`
2. Developer mode on.
3. **Load unpacked** → select the `extension/` folder.
4. Google Maps khule search dao, e.g. `dentists in Dhaka`.
5. Right side-e Lead Chai panel asbe.

Settings:

- **API URL** = your Vercel URL
- **API key** = the same `LEAD_CHAI_API_KEY`

Workflow:

1. **Scan leads** — reads the Maps results list (auto-scrolls).
2. **Get details** — opens each place for phone, website, address.
3. **Find emails** — sends websites to this API.
4. **Export CSV**.

Extension works for names/phones/websites even before the API is deployed. Emails need the API.

## Local API

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Open `http://127.0.0.1:8000` and `http://127.0.0.1:8000/docs`.

## API

`POST /enrich`

```json
{
  "api_key": "lc_live_your_secret_key_here",
  "website": "https://cleanersgrowth.com",
  "business_name": "Cleaners Growth",
  "mode": "quick"
}
```

`mode`:

- `quick` — homepage + contact-like pages, stop when an email is found (default, Vercel-friendly)
- `deep` — more pages

`POST /bulk-enrich` accepts up to 8 websites (`quick`) or 5 (`deep`).

## Notes

Use publicly listed business data only. Respect Google Maps terms and local outreach laws. This is a personal lead-research tool, not an official Google product.
