# Field Notes Portfolio

A minimal React portfolio for work spanning philosophy, ecology, and computer science. Built with Vite and configured as a Render Static Site.

## Render deployment

Connect this repository in Render and apply the included `render.yaml` Blueprint. It configures:

- Build command: `npm install && npm run build`
- Publish directory: `dist`
- SPA fallback routing to `index.html`
- Basic security and immutable asset-cache headers

Before publishing, replace `hello@example.com` in `src/main.jsx` with the portfolio owner's email address.

## Animated terrain background

The hero renders a Three.js terrain scene from a checked-in, 16-bit height map of the Spruce Knob–Seneca Rocks area in Monongahela National Forest. The source elevation is the public-domain USGS 3DEP Bare Earth DEM. Its exact export request, geographic bounds, elevation range, encoding, and derivative-channel descriptions are recorded in `src/assets/terrain/monongahela-terrain.json`.

The browser never contacts USGS. It loads `monongahela-height.r16` and the packed hydrology/ridge/valley texture from the built site, while the original hero image remains the loading and WebGL fallback.

To reproduce the derived assets:

1. Open the `source.request` URL from the terrain metadata and download the GeoTIFF from the returned `href`.
2. Install the local preprocessing requirements with `python -m pip install -r scripts/requirements-terrain.txt`.
3. Run `python scripts/process-terrain.py path/to/downloaded-dem.tif` from the repository root.
4. Run `npm run validate:terrain` to verify the binary encoding and companion texture.

The production build runs terrain validation automatically before Vite bundles the application.
