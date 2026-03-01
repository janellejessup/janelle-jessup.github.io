# web-site

A simple static website, ready to host on GitHub Pages.

https://github.intuit.com/pages/jjessup/web-site/

## What’s here

- **index.html** — Main page with hero, about, and contact sections
- **styles.css** — Dark theme, responsive layout, DM Sans + Fraunces fonts

## Run locally

Open `index.html` in a browser, or use a local server:

```bash
# Python 3
python3 -m http.server 8000

# Then open http://localhost:8000
```

## Publish with GitHub Pages

1. Push this repo to GitHub (you already have `origin` set).
2. In the repo on GitHub: **Settings → Pages**.
3. Under **Source**, choose **Deploy from a branch**.
4. Set **Branch** to `master` (or `main`) and folder to **/ (root)**.
5. Save. After a minute or two, the site will be at:
   - `https://<username>.github.io/<repo-name>/` (public GitHub)
   - Or your org’s Pages URL if using GitHub Enterprise.

## Customize

- Edit **index.html** for content and structure.
- Edit **styles.css** for colors, fonts, and layout (CSS variables at the top).
- Add more pages (e.g. `about.html`) and link them from the nav.
