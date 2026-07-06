# Portfolio — Photo Setup & Deployment Guide

---

## STEP 1 — Organise Your Photos

Create this exact folder structure alongside your `index.html`:

```
your-folder/
├── index.html
├── photo.jpg               ← Your hero headshot
├── about.jpg               ← About section photo
│
├── projects/
│   ├── vawt.jpg
│   ├── actuator.jpg
│   ├── fitbit.jpg
│   ├── airflow.jpg
│   ├── compact.jpg
│   └── canstruction.jpg    ← Your Canstruction structure photo
│
├── travel/
│   ├── spain-1.jpg         ← Spain photo 1
│   ├── spain-2.jpg         ← Spain photo 2
│   └── czechia.jpg         ← Czechia photo
│
└── hockey/
    ├── u11-coaching.jpg    ← U11 volunteer coaching photo
    └── private-coaching.jpg ← Private coaching photo
```

**Photo tips:**
- JPG or PNG both work — keep files under 2MB each for fast loading
- Landscape photos (wide) work best for project cards (16:9 ratio ideal)
- Portrait or square photos work best for the hero and about slots
- Travel photos can be any shape — they'll be cropped to fill their slot

---

## STEP 2 — Add Photos to the HTML

Open `index.html` in VS Code. Use **Find** (Ctrl+F / Cmd+F) to search for each `📷 PHOTO:` comment.

For each one, delete the grey placeholder `<div class="ph ...">` block and replace it with an `<img>` tag as shown in the comment.

### Quick reference:

| Search for | Delete | Replace with |
|---|---|---|
| `📷 PHOTO: Hero` | `<div class="ph hero-ph">...</div>` | `<img src="photo.jpg" alt="Chenyu Li" class="ri hero-img" />` |
| `📷 PHOTO: About` | `<div class="ph about-ph">...</div>` | `<img src="about.jpg" alt="Chenyu Li" class="ri about-img" />` |
| `📷 PHOTO: Canstruction` | `<div class="proj-ph">...</div>` | `<img src="projects/canstruction.jpg" alt="Canstruction" class="proj-img" />` |
| `📷 PHOTOS: Travel` | Each `<div class="tph">...</div>` | `<img src="travel/spain-1.jpg" alt="Spain" class="tph-img" />` etc. |
| `📷 PHOTOS: Hockey` | Each `<div class="hkph">...</div>` | `<img src="hockey/u11-coaching.jpg" alt="U11 coaching" class="tph-img" />` etc. |

---

## STEP 3 — Update Your Links

In `index.html`, do a Find & Replace (Ctrl+H / Cmd+H) for:

| Find | Replace with |
|---|---|
| `YOUR-USERNAME` | Your GitHub username (appears 3 times) |
| `li-chenyu` | Your LinkedIn username |
| `YOUR-RESEARCH-GROUP-URL.com` | Your lab/research group URL (appears 2 times) |

---

## STEP 4 — Deploy to GitHub Pages (Free)

### Create your GitHub repo

1. Go to **github.com** → sign up or log in
2. Click **+** → **New repository**
3. Name it exactly: `yourusername.github.io`
   - e.g. if your username is `chenyuli`, name it `chenyuli.github.io`
4. Set to **Public** → click **Create repository**

### Upload your files

**Option A — browser (easiest):**
1. On the repo page click **uploading an existing file**
2. Drag in `index.html` and all your photo folders
3. Click **Commit changes**

**Option B — Git command line:**
```bash
cd path/to/your-folder
git init
git add .
git commit -m "Launch portfolio"
git remote add origin https://github.com/USERNAME/USERNAME.github.io.git
git branch -M main
git push -u origin main
```

### Enable GitHub Pages

1. Go to your repo → **Settings** → **Pages** (left sidebar)
2. Source → **Deploy from a branch**
3. Branch → `main` + `/ (root)` → **Save**
4. Wait ~2 minutes → visit `https://yourusername.github.io`

---

## Updating the Site Later

Edit `index.html` locally, then either:
- Re-upload via the GitHub browser editor (click the file → ✏️ pencil)
- Or via Git: `git add . && git commit -m "Update" && git push`

Changes go live within ~1 minute automatically.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Site shows 404 | Wait 5 min; check repo name matches your username exactly |
| Photos not showing | Check filenames match exactly — capitalisation matters (`spain-1.jpg` ≠ `Spain-1.jpg`) |
| Old version showing | Hard refresh: Ctrl+Shift+R (Win) or Cmd+Shift+R (Mac) |
| CSS broken | Make sure `index.html` is at the root, not inside a subfolder |
