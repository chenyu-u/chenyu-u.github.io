"""
fetch_strava.py
───────────────
Fetches recent activities and year-to-date stats from the Strava API
and writes them to strava.json in the repo root.

Run by GitHub Actions nightly (see .github/workflows/strava.yml).
Requires three environment variables set as GitHub Secrets:
  STRAVA_CLIENT_ID
  STRAVA_CLIENT_SECRET
  STRAVA_REFRESH_TOKEN

HOW TO GET YOUR STRAVA TOKENS
──────────────────────────────
1. Go to https://www.strava.com/settings/api
2. Create an app (name/website can be anything, e.g. "My Portfolio")
3. Copy your Client ID and Client Secret → add as GitHub Secrets
4. Get a refresh token with the right scope:
   a. In your browser, visit this URL (replace CLIENT_ID):
      https://www.strava.com/oauth/authorize?client_id=CLIENT_ID&response_type=code&redirect_uri=http://localhost&approval_prompt=force&scope=read,activity:read_all
   b. Authorise → you'll be redirected to localhost (page won't load, that's fine)
   c. Copy the "code" value from the URL
   d. Run this curl command to exchange it for a refresh token:
      curl -X POST https://www.strava.com/oauth/token \\
        -F client_id=CLIENT_ID \\
        -F client_secret=CLIENT_SECRET \\
        -F code=YOUR_CODE \\
        -F grant_type=authorization_code
   e. Copy the "refresh_token" from the JSON response → add as GitHub Secret

HOW TO ADD GITHUB SECRETS
──────────────────────────
1. Go to your repo on GitHub
2. Settings → Secrets and variables → Actions → New repository secret
3. Add:  STRAVA_CLIENT_ID  /  STRAVA_CLIENT_SECRET  /  STRAVA_REFRESH_TOKEN
"""

import os
import json
import requests
from datetime import datetime, timezone

# ─── 1. Exchange refresh token for a new access token ───────────────────────

client_id     = os.environ["STRAVA_CLIENT_ID"]
client_secret = os.environ["STRAVA_CLIENT_SECRET"]
refresh_token = os.environ["STRAVA_REFRESH_TOKEN"]

token_res = requests.post(
    "https://www.strava.com/oauth/token",
    data={
        "client_id":     client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type":    "refresh_token",
    },
    timeout=10,
)
token_res.raise_for_status()
access_token = token_res.json()["access_token"]
headers = {"Authorization": f"Bearer {access_token}"}

# ─── 2. Fetch athlete stats (year-to-date totals) ───────────────────────────

athlete_res = requests.get("https://www.strava.com/api/v3/athlete", headers=headers, timeout=10)
athlete_res.raise_for_status()
athlete_id = athlete_res.json()["id"]

stats_res = requests.get(
    f"https://www.strava.com/api/v3/athletes/{athlete_id}/stats",
    headers=headers,
    timeout=10,
)
stats_res.raise_for_status()
stats = stats_res.json()

ytd_run = stats.get("ytd_run_totals", {})
all_run = stats.get("all_run_totals", {})

# ─── 3. Fetch most recent 20 activities ─────────────────────────────────────

acts_res = requests.get(
    "https://www.strava.com/api/v3/athlete/activities",
    headers=headers,
    params={"per_page": 20, "page": 1},
    timeout=10,
)
acts_res.raise_for_status()

# Keep only the fields the website actually uses
def slim(a):
    return {
        "id":          a["id"],
        "name":        a["name"],
        "type":        a["type"],
        "distance":    a["distance"],           # metres
        "moving_time": a["moving_time"],        # seconds
        "elapsed_time":a["elapsed_time"],
        "start_date":  a["start_date"],         # ISO 8601 UTC
        "average_speed": a.get("average_speed"),
        "max_speed":     a.get("max_speed"),
        "average_heartrate": a.get("average_heartrate"),
        "total_elevation_gain": a.get("total_elevation_gain"),
    }

activities = [slim(a) for a in acts_res.json()]

# ─── 4. Write strava.json ────────────────────────────────────────────────────

output = {
    "updated_at": datetime.now(timezone.utc).isoformat(),
    "ytd": {
        "distance":    ytd_run.get("distance", 0),    # metres
        "count":       ytd_run.get("count", 0),
        "moving_time": ytd_run.get("moving_time", 0), # seconds
    },
    "all_time": {
        "distance":    all_run.get("distance", 0),
        "count":       all_run.get("count", 0),
    },
    "activities": activities,
}

with open("strava.json", "w") as f:
    json.dump(output, f, indent=2)

print(f"✓ Wrote strava.json — {len(activities)} activities, {ytd_run.get('count', 0)} runs YTD")
