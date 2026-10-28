# chenyu-u.github.io

Personal portfolio of **Chenyu Li (李辰宇)**, Mechanical Engineering at the University of Toronto.
Live at **https://chenyu-u.github.io**

## Pages

| File | What it is |
|---|---|
| `index.html` | Main portfolio: about, projects, experience, running, hobbies, volunteering, contact |
| `laptop.html` | 3D office landing page (the portfolio runs on the laptop screen) |
| `robot-sim.html` | Interactive robotic arm simulator and build notes |
| `project-*.html` | Detailed project write-ups (EMA survey app, RC car, light-up drawer) |
| `map.html` | Full-screen travel map |

## Folders

| Folder | Contents |
|---|---|
| `projects/`, `hobbies/`, `hockey/`, `travel/`, `logos/` | Images used on the site |
| `code/` | Arduino sketches linked from the project pages |
| `i18n/` | Chinese (`zh.js`) and German (`de.js`) translations, plus `glossary.json` |
| `tools/` | `i18n-sync.mjs`: finds new English text and translates it |
| `.github/workflows/` | Automations: nightly Strava update, auto-translation |

## Features

- **Light / dark theme** and **English / 简体中文 / Deutsch** menus in the top bar (`site-prefs.js`, `site-prefs.css`).
- **Running stats** from Strava, refreshed every night (`fetch_strava.py` → `strava.json`).
- **Auto-translation**: edit only the English; on push, new text is translated with DeepL
  (needs the `DEEPL_API_KEY` repository secret).

## Editing

1. `git pull`
2. Edit the English in the `.html` files.
3. `git add -A`, `git commit -m "..."`, `git push`

The site is served by GitHub Pages from the `main` branch; changes go live in about two minutes.
