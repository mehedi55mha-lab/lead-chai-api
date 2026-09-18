import os
import re
import time
from pathlib import Path
from typing import Literal, Optional
from urllib.parse import urljoin, urlparse, unquote

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, Field

load_dotenv()

LEAD_CHAI_API_KEY = os.getenv("LEAD_CHAI_API_KEY", "lc_live_change_this_key")
ROOT_DIR = Path(__file__).parent

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}

app = FastAPI(
    title="Lead Chai Email Finder API",
    version="1.1.0",
    description="Find emails and social links from a business website. Built for the Lead Chai Google Maps extension.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)


class EnrichRequest(BaseModel):
    api_key: str
    website: str
    business_name: Optional[str] = None
    mode: Literal["quick", "deep"] = "quick"


class BulkEnrichRequest(BaseModel):
    api_key: str
    websites: list[str] = Field(default_factory=list)
    mode: Literal["quick", "deep"] = "quick"


def verify_api_key(api_key):
    if api_key != LEAD_CHAI_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


def clean_url(url):
    url = str(url).strip()
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url
    return url.rstrip("/")


def get_base_url(url):
    parsed = urlparse(url)
    return parsed.scheme + "://" + parsed.netloc


def domain_from_url(url):
    try:
        return urlparse(url).netloc.replace("www.", "").lower()
    except Exception:
        return ""


def deobfuscate_text(text):
    text = unquote(str(text))
    text = text.replace("&commat;", "@")
    text = text.replace("&#64;", "@")
    text = text.replace("%40", "@")
    text = text.replace("[at]", "@").replace("(at)", "@").replace("{at}", "@")
    text = text.replace(" at ", "@")
    text = text.replace("[dot]", ".").replace("(dot)", ".").replace("{dot}", ".")
    text = text.replace(" dot ", ".")
    return text


def decode_cfemail(encoded_string):
    try:
        r = int(encoded_string[:2], 16)
        email = ""
        for i in range(2, len(encoded_string), 2):
            email += chr(int(encoded_string[i:i + 2], 16) ^ r)
        return email
    except Exception:
        return ""


def extract_cloudflare_emails(html):
    emails = []
    matches = re.findall(r'data-cfemail=["\']([a-fA-F0-9]+)["\']', html)
    for item in matches:
        email = decode_cfemail(item)
        if email:
            emails.append(email)
    return emails


def extract_mailto_emails(html):
    emails = []
    matches = re.findall(r'mailto:([^"\'\s<>?]+)', html, re.I)
    for item in matches:
        item = unquote(item.strip())
        item = item.replace("mailto:", "")
        item = item.split("?")[0]
        item = item.replace("%40", "@")
        emails.append(item)
    return emails


def is_valid_email(email):
    if not email or "@" not in email:
        return False

    email = email.lower().strip()
    parts = email.split("@")

    if len(parts) != 2:
        return False

    local, domain = parts

    if not local or not domain:
        return False

    if "." not in domain:
        return False

    if len(email) > 90:
        return False

    if re.search(r"@\d+\.\d+", email):
        return False

    if not re.search(r"[a-zA-Z]", domain):
        return False

    if "*" in email:
        return False

    bad_words = [
        "example", "domain", "test@", "your@", "name@", "email@",
        "sentry", "wixpress", "schema", "google", "facebook",
        "instagram", "linkedin", "twitter", "wordpress", "cloudflare",
        "png", "jpg", "jpeg", "webp", "svg", "gif",
        "noreply", "no-reply", "donotreply", "do-not-reply",
    ]

    if any(bad in email for bad in bad_words):
        return False

    return True


def clean_email(email):
    email = str(email).lower().strip()
    email = unquote(email)
    email = email.replace("mailto:", "")
    email = email.split("?")[0]
    email = email.replace("%40", "@")
    email = email.rstrip(".,;:)(")
    return email


def extract_emails(text, website=""):
    if not text:
        return []

    text = deobfuscate_text(text)
    emails = []

    emails += extract_cloudflare_emails(text)
    emails += extract_mailto_emails(text)

    normal_emails = re.findall(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}", text)
    emails += normal_emails

    clean_emails = []
    for email in emails:
        email = clean_email(email)
        if is_valid_email(email):
            clean_emails.append(email)

    clean_emails = list(dict.fromkeys(clean_emails))

    domain = domain_from_url(website)

    if domain:
        same_domain = [e for e in clean_emails if domain in e]
        generic = [
            e for e in clean_emails
            if e.startswith((
                "info@", "contact@", "hello@", "sales@", "office@",
                "support@", "admin@", "service@",
            ))
        ]

        if same_domain:
            return same_domain + [e for e in clean_emails if e not in same_domain]

        if generic:
            return generic + [e for e in clean_emails if e not in generic]

    return clean_emails


def extract_social_links(html):
    socials = {
        "facebook": "",
        "instagram": "",
        "linkedin": "",
        "twitter": "",
        "youtube": "",
        "yelp": "",
    }

    if not html:
        return socials

    links = re.findall(r'https?://[^\s"\'<>]+', html)

    for link in links:
        link = link.rstrip("/").rstrip(".,;:)(")
        lower = link.lower()

        if "facebook.com" in lower and not socials["facebook"]:
            if "share" not in lower and "plugins" not in lower:
                socials["facebook"] = link

        if "instagram.com" in lower and not socials["instagram"]:
            socials["instagram"] = link

        if "linkedin.com" in lower and not socials["linkedin"]:
            socials["linkedin"] = link

        if ("twitter.com" in lower or "x.com" in lower) and not socials["twitter"]:
            socials["twitter"] = link

        if "youtube.com" in lower and not socials["youtube"]:
            socials["youtube"] = link

        if "yelp.com" in lower and not socials["yelp"]:
            socials["yelp"] = link

    return socials


def fetch_page(url, timeout=8):
    try:
        response = requests.get(url, headers=HEADERS, timeout=timeout, allow_redirects=True)
        if 200 <= response.status_code < 400:
            return response.text, response.url
    except Exception:
        pass

    try:
        if url.startswith("https://"):
            alt_url = url.replace("https://", "http://", 1)
        else:
            alt_url = url.replace("http://", "https://", 1)

        response = requests.get(alt_url, headers=HEADERS, timeout=timeout, allow_redirects=True)
        if 200 <= response.status_code < 400:
            return response.text, response.url
    except Exception:
        pass

    return "", url


def find_contact_links(base_url, html, limit=8):
    soup = BeautifulSoup(html, "html.parser")
    links = []

    keywords = [
        "contact", "contact-us", "contactus", "get-in-touch",
        "about", "about-us", "aboutus",
        "team", "our-team", "staff", "leadership",
        "privacy", "privacy-policy",
        "locations", "location", "service-area",
        "support", "help", "customer-service",
        "franchise", "local", "near-me",
    ]

    for a in soup.find_all("a", href=True):
        href = a.get("href", "")
        text = (a.get_text(" ") or "").lower()
        href_lower = href.lower()

        if href_lower.startswith("mailto:"):
            links.append(href)
            continue

        if any(k in href_lower or k in text for k in keywords):
            full_url = urljoin(base_url + "/", href)
            links.append(full_url)

    default_pages = [
        "/contact",
        "/contact-us",
        "/contactus",
        "/get-in-touch",
        "/about",
        "/about-us",
        "/aboutus",
        "/team",
        "/our-team",
        "/locations",
        "/privacy",
        "/privacy-policy",
    ]

    for page in default_pages:
        links.append(base_url + page)

    final_links = []
    for link in links:
        if link not in final_links:
            final_links.append(link)

    return final_links[:limit]


def clean_html_text(html):
    soup = BeautifulSoup(html, "html.parser")

    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()

    text = soup.get_text(" ")
    text = re.sub(r"\s+", " ", text)
    return text


def enrich_website(website, mode="quick", business_name=None):
    website = clean_url(website)
    base_url = get_base_url(website)
    started = time.time()
    deadline = 48 if mode == "quick" else 55
    page_limit = 8 if mode == "quick" else 18
    page_timeout = 6 if mode == "quick" else 8

    result = {
        "success": True,
        "website": website,
        "business_name": business_name or "",
        "email": "",
        "all_emails": "",
        "email_source": "",
        "facebook": "",
        "instagram": "",
        "linkedin": "",
        "twitter": "",
        "youtube": "",
        "yelp": "",
        "checked_pages": 0,
        "mode": mode,
        "status": "Not Found",
    }

    home_html, final_home_url = fetch_page(website, timeout=page_timeout)
    pages_to_check = [website]

    if home_html:
        pages_to_check += find_contact_links(base_url, home_html, limit=page_limit)

    checked_pages = []
    found_emails = []

    for page_url in pages_to_check:
        if time.time() - started > deadline:
            break

        if page_url in checked_pages:
            continue

        checked_pages.append(page_url)

        if page_url.startswith("mailto:"):
            html = page_url
            final_url = page_url
            page_text = page_url
        else:
            html, final_url = fetch_page(page_url, timeout=page_timeout)
            page_text = clean_html_text(html) if html else ""

        result["checked_pages"] += 1

        emails = extract_emails((html or "") + " " + (page_text or ""), website)

        if emails:
            for email in emails:
                if email not in found_emails:
                    found_emails.append(email)

            if not result["email"]:
                result["email"] = emails[0]
                result["email_source"] = final_url
                result["status"] = "Found"

        if html:
            socials = extract_social_links(html)
            for key in ["facebook", "instagram", "linkedin", "twitter", "youtube", "yelp"]:
                if socials.get(key) and not result[key]:
                    result[key] = socials[key]

        if result["email"] and mode == "quick":
            break

    result["all_emails"] = ", ".join(found_emails)

    if not result["email"] and any([
        result["facebook"], result["instagram"], result["linkedin"],
        result["twitter"], result["youtube"], result["yelp"],
    ]):
        result["status"] = "Social Found, Email Not Found"

    return result


@app.get("/", response_class=HTMLResponse)
def home():
    index = ROOT_DIR / "templates" / "index.html"
    if index.exists():
        return HTMLResponse(index.read_text(encoding="utf-8"))
    return HTMLResponse("<h1>Lead Chai API</h1><p>See <a href='/docs'>/docs</a></p>")


@app.get("/og.jpg")
def og_image():
    path = ROOT_DIR / "public" / "og.jpg"
    if path.exists():
        return FileResponse(path, media_type="image/jpeg")
    raise HTTPException(status_code=404, detail="Not found")


@app.get("/lead-chai-extension.zip")
def extension_zip():
    path = ROOT_DIR / "public" / "lead-chai-extension.zip"
    if path.exists():
        return FileResponse(path, media_type="application/zip", filename="lead-chai-extension.zip")
    raise HTTPException(status_code=404, detail="Not found")


@app.get("/health")
def health():
    return {
        "success": True,
        "status": "healthy",
        "service": "lead-chai-api",
    }


@app.get("/api")
def api_info():
    return {
        "name": "Lead Chai Email Finder API",
        "status": "running",
        "docs": "/docs",
        "endpoints": {
            "health": "GET /health",
            "enrich": "POST /enrich",
            "bulk_enrich": "POST /bulk-enrich",
        },
    }


@app.post("/enrich")
def enrich(payload: EnrichRequest):
    verify_api_key(payload.api_key)
    return enrich_website(
        payload.website,
        mode=payload.mode,
        business_name=payload.business_name,
    )


@app.post("/bulk-enrich")
def bulk_enrich(payload: BulkEnrichRequest):
    verify_api_key(payload.api_key)

    limit = 8 if payload.mode == "quick" else 5
    results = []
    for website in payload.websites[:limit]:
        results.append(enrich_website(website, mode=payload.mode))

    return {
        "success": True,
        "total": len(results),
        "results": results,
    }
