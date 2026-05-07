import os
import re
from urllib.parse import urljoin, urlparse, unquote

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

load_dotenv()

LEAD_CHAI_API_KEY = os.getenv("LEAD_CHAI_API_KEY", "lc_live_change_this_key")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9"
}

app = FastAPI(title="Lead Chai Email Finder API", version="1.0.0")


class EnrichRequest(BaseModel):
    api_key: str
    website: str


class BulkEnrichRequest(BaseModel):
    api_key: str
    websites: list[str]


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
        "noreply", "no-reply", "donotreply", "do-not-reply"
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
        generic = [e for e in clean_emails if e.startswith(("info@", "contact@", "hello@", "sales@", "office@", "support@", "admin@", "service@"))]

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
        "yelp": ""
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


def fetch_page(url, timeout=15):
    try:
        response = requests.get(url, headers=HEADERS, timeout=timeout, allow_redirects=True)
        if response.status_code >= 200 and response.status_code < 400:
            return response.text, response.url
    except Exception:
        pass

    try:
        if url.startswith("https://"):
            alt_url = url.replace("https://", "http://", 1)
        else:
            alt_url = url.replace("http://", "https://", 1)

        response = requests.get(alt_url, headers=HEADERS, timeout=timeout, allow_redirects=True)
        if response.status_code >= 200 and response.status_code < 400:
            return response.text, response.url
    except Exception:
        pass

    return "", url


def find_contact_links(base_url, html):
    soup = BeautifulSoup(html, "html.parser")
    links = []

    keywords = [
        "contact", "contact-us", "contactus", "get-in-touch",
        "about", "about-us", "aboutus",
        "team", "our-team", "staff", "leadership",
        "privacy", "privacy-policy",
        "locations", "location", "service-area",
        "support", "help", "customer-service",
        "franchise", "local", "near-me"
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
        "/staff",
        "/locations",
        "/location",
        "/service-area",
        "/privacy",
        "/privacy-policy",
        "/support"
    ]

    for page in default_pages:
        links.append(base_url + page)

    final_links = []
    for link in links:
        if link not in final_links:
            final_links.append(link)

    return final_links[:25]


def clean_html_text(html):
    soup = BeautifulSoup(html, "html.parser")

    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()

    text = soup.get_text(" ")
    text = re.sub(r"\s+", " ", text)
    return text


def enrich_website(website):
    website = clean_url(website)
    base_url = get_base_url(website)

    result = {
        "success": True,
        "website": website,
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
        "status": "Not Found"
    }

    home_html, final_home_url = fetch_page(website)
    pages_to_check = [website]

    if home_html:
        pages_to_check += find_contact_links(base_url, home_html)

    checked_pages = []
    found_emails = []

    for page_url in pages_to_check:
        if page_url in checked_pages:
            continue

        checked_pages.append(page_url)

        if page_url.startswith("mailto:"):
            html = page_url
            final_url = page_url
            page_text = page_url
        else:
            html, final_url = fetch_page(page_url)
            page_text = clean_html_text(html) if html else ""

        result["checked_pages"] += 1

        emails = extract_emails(html + " " + page_text, website)

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

    result["all_emails"] = ", ".join(found_emails)

    if not result["email"] and any([result["facebook"], result["instagram"], result["linkedin"], result["twitter"], result["youtube"], result["yelp"]]):
        result["status"] = "Social Found, Email Not Found"

    return result


@app.get("/")
def home():
    return {
        "name": "Lead Chai Email Finder API",
        "status": "running",
        "docs": "/docs"
    }


@app.get("/health")
def health():
    return {
        "success": True,
        "status": "healthy"
    }


@app.post("/enrich")
def enrich(payload: EnrichRequest):
    verify_api_key(payload.api_key)
    return enrich_website(payload.website)


@app.post("/bulk-enrich")
def bulk_enrich(payload: BulkEnrichRequest):
    verify_api_key(payload.api_key)

    results = []
    for website in payload.websites[:50]:
        results.append(enrich_website(website))

    return {
        "success": True,
        "total": len(results),
        "results": results
    }
