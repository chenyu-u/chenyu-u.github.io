"""
fetch_strava.py
────────────────────────────────────────────────────────────────
Fetches your year-to-date running stats and most recent activities
from the Strava API, and writes them to strava.json in the repo
root. Your live site reads strava.json directly (see loadStrava()
in index.html) — this script is what keeps that file fresh.

Run automatically every night by GitHub Actions
(.github/workflows/strava.yml). You will not normally run this
yourself, but you can test it locally if you want (see bottom).

REQUIRES THREE ENVIRONMENT VARIABLES (set as GitHub Secrets):
  STRAVA_CLIENT_ID
  STRAVA_CLIENT_SECRET
  STRAVA_REFRESH_TOKEN

See SETUP_GUIDE.md, Part 4, for exactly how to obtain these three
values. None of them are ever written into this file or committed
to the repo — they're injected at run time by GitHub Actions.
────────────────────────────────────────────────────────────────
"""

import json
import os
import sys
from datetime import datetime, timezone

import requests

CLIENT_ID     = os.environ.get("STRAVA_CLIENT_ID")
CLIENT_SECRET = os.environ.get("STRAVA_CLIENT_SECRET")
REFRESH_TOKEN = os.environ.get("STRAVA_REFRESH_TOKEN")

TOKEN_URL      = "https://www.strava.com/oauth/token"
ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities"
STATS_URL_TMPL = "https://www.strava.com/api/v3/athletes/{id}/stats"

OUTPUT_PATH = "strava.json"
MAX_ACTIVITIES = 12   # site only shows 6, but we keep a few extra as buffer


def fail(msg):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def get_access_token():
    if not (CLIENT_ID and CLIENT_SECRET and REFRESH_TOKEN):
        fail("Missing one or more required env vars: "
             "STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN")

    resp = requests.post(TOKEN_URL, data={
        "client_id":     CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "refresh_token":  REFRESH_TOKEN,
        "grant_type":    "refresh_token",
    })
    if resp.status_code != 200:
        fail(f"Token refresh failed ({resp.status_code}): {resp.text}")

    data = resp.json()
    return data["access_token"], data["athlete"]["id"]


def get_activities(access_token):
    resp = requests.get(
        ACTIVITIES_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        params={"per_page": MAX_ACTIVITIES},
    )
    if resp.status_code != 200:
        fail(f"Fetching activities failed ({resp.status_code}): {resp.text}")
    return resp.json()


def get_run_stats(access_token, athlete_id):
    """Returns (ytd_totals, all_time_totals) for runs."""
    resp = requests.get(
        STATS_URL_TMPL.format(id=athlete_id),
        headers={"Authorization": f"Bearer {access_token}"},
    )
    if resp.status_code != 200:
        fail(f"Fetching athlete stats failed ({resp.status_code}): {resp.text}")
    stats = resp.json()

    def pick(key):
        t = stats.get(key, {}) or {}
        return {
            "distance":    t.get("distance", 0),
            "count":       t.get("count", 0),
            "moving_time": t.get("moving_time", 0),
        }

    return pick("ytd_run_totals"), pick("all_run_totals")


def main():
    access_token, athlete_id = get_access_token()

    raw_activities = get_activities(access_token)
    runs = [a for a in raw_activities if a.get("type") == "Run"]

    activities = [{
        "type":         a["type"],
        "name":         a["name"],
        "distance":     a["distance"],       # meters
        "moving_time":  a["moving_time"],    # seconds
        "start_date":   a["start_date"],
    } for a in runs[:6]]

    ytd, all_time = get_run_stats(access_token, athlete_id)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "ytd": ytd,
        "all": all_time,
        "activities": activities,
    }

    with open(OUTPUT_PATH, "w") as f:
        json.dump(payload, f, indent=2)

    print(f"Wrote {OUTPUT_PATH}: {len(activities)} activities, "
          f"YTD {ytd['distance']/1000:.1f} km, "
          f"all-time {all_time['distance']/1000:.1f} km over {all_time['count']} runs.")


if __name__ == "__main__":
    main()
