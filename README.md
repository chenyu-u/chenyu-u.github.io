# chenyu-u.github.io

Personal website of **Chenyu Li (李辰宇)**, Mechanical Engineering at the University of Toronto.
Live at **https://chenyu-u.github.io**

It is a plain static site: HTML, CSS and JavaScript files served as they are by GitHub Pages.
There is nothing to compile or build.

## Pages

| File | What it is |
|---|---|
| `index.html` | Home: the wind cover, then a full-screen 3D wind turbine (`turbine.js`) with text blocks spread over it; scrolling takes it apart one assembly at a time (blades, hub, nacelle, drivetrain, tower, foundation) and puts it back together |
| `story.html` | "Follow the wind", the 3D journey from the Rockies to Calgary, Toronto and Delft (`world.js`) |
| `experience.html` | Every role in full |
| `projects.html` | Work: all projects, with filters |
| `life.html` | Running (Strava), hobbies, travel map, volunteering |
| `resume.html` | Skills, education, awards, coursework, and the resume request form |
| `classic.html` | Old one-page portfolio address: forwards to the page that now holds each section |
| `laptop.html` | 3D office, linked from the side tab and footer (the projects page runs on the laptop screen) |
| `robot-sim.html` | Interactive robotic arm simulator and build notes |
| `project-*.html` | Project write-ups (EMA survey app, Bluetooth-controlled car, light-up drawer) |
| `map.html` | Full-screen travel map |

## Scripts and styles

| File | What it does |
|---|---|
| `world.js` | The 3D world behind the story page: scene, camera shots, lighting, weather, frame loop |
| `world-terrain.js` | The landscape as numbers: map of places, terrain height and colour, forests (no three.js) |
| `world-worker.js` | Runs `world-terrain.js` on a second thread so loading never stalls the page |
| `live-weather.js` | Current wind and weather in Toronto (Open-Meteo), shown on the cover and in the world |
| `sound.js` | Soundtrack for the home page (files in `audio/`) |
| `site-prefs.js`, `site-prefs.css` | Theme and language menus on every page, the fonts, and the translations loader |
| `site.css`, `site.js` | Look and behaviour of the experience, projects, life and resume pages (photo viewer, filters, running log, request form) |
| `shell.css` | The header, footer and office tab every page shares |
| `travel-map.js` | The travel map on the life page |
| `project.css` | Layout of the project write-ups (colours come from the shared tokens) |

## Folders

| Folder | Contents |
|---|---|
| `projects/`, `hobbies/`, `hockey/`, `travel/`, `img/`, `logos/` | Photos and logos, as web-sized WebP files |
| `fonts/`, `vendor/` | Fonts and third-party libraries, served from this site (see `vendor/README.md`) |
| `audio/` | Soundtrack recordings |
| `code/` | Arduino sketches linked from the project pages |
| `i18n/` | Chinese (`zh.js`) and German (`de.js`) translations, plus `glossary.json` |
| `tools/` | `shell.mjs` (writes the shared header and footer into every page), `i18n-sync.mjs` (finds and translates new English text), `optimize-images.mjs` (prepares photos) |
| `.github/workflows/` | Automations: nightly Strava update, automatic translation |

## Editing

1. `git pull`
2. Edit the English in the `.html` files.
3. `git add -A`, `git commit -m "..."`, `git push`

To change a link in the header or footer, edit `tools/shell.mjs` and run `node tools/shell.mjs`
(the home page's header is written by hand in `index.html`).

Resume requests from `resume.html` are emailed to info.chenyuli@gmail.com through FormSubmit
(the address is in `site.js`). The very first request sends a one-time activation email: click its link.

Changes go live in about two minutes. New text is translated automatically on push
(DeepL; needs the `DEEPL_API_KEY` repository secret).

### Adding a photo

Camera photos are several megabytes each; the site only needs a fraction of that.
Convert a photo before adding it:

```
npm install --no-save sharp          (once)
node tools/optimize-images.mjs --replace travel/map/lisbon.jpg
```

This writes `travel/map/lisbon.webp` at the right size and prints the `<img>` tag to paste,
with its width and height. Keep your original photos somewhere outside this folder.

### Trying the site on your computer

The home page uses JavaScript modules, which browsers only load from a web address,
so open the folder through a small local server rather than by double-clicking a file:

```
npx serve .          (or: python -m http.server)
```
