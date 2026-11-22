# ToolVibe

ToolVibe is a static directory of five browser utilities. The QR generator, image compressor, strong password generator, and word counter process their inputs locally. The thumbnail tool loads public thumbnail images from YouTube.

## Run locally

Serve the contents of `dist/` over a local HTTP server:

```sh
python3 -m http.server 8000 --directory dist
```

Open `http://localhost:8000/`. A local server or an HTTPS host offers the best browser support for clipboard actions.

## Deploy on GitHub Pages

Place the **contents** of `dist/` at the repository root. The portable source ZIP already uses this layout. This build uses relative paths and works under a GitHub Pages repository subpath. Follow the blueprint to choose your publishing branch and root folder.

Set a monitored inbox in `js/site-config.js` to enable the contact page’s email action. With the address unset, visitors can prepare and copy feedback. Once the production URL is chosen, use that URL for the public sitemap and any canonical URLs. The site currently includes no advertising code.

## Source layout

ToolVibe is a free browser-based toolkit.

- `index.html` contains the searchable tool directory.
- `tools/` has five standalone pages with individually written guides and FAQs.
- `pages/` has About, Contact, Privacy Policy, and Terms.
- `css/style.css` supplies shared styling and responsive layouts.
- `js/` contains browser behavior, site configuration, and the bundled MIT-licensed QR encoder.
