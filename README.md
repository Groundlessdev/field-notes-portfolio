# Field Notes Portfolio

A minimal React portfolio for work spanning philosophy, ecology, and computer science. Built with Vite and configured as a Render Static Site.

## Render deployment

Connect this repository in Render and apply the included `render.yaml` Blueprint. It configures:

- Build command: `npm install && npm run build`
- Publish directory: `dist`
- SPA fallback routing to `index.html`
- Basic security and immutable asset-cache headers

Before publishing, replace `hello@example.com` in `src/main.jsx` with the portfolio owner's email address.
