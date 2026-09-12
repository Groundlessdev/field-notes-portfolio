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

The hero renders a five-tile Three.js terrain corridor through Monongahela National Forest. It starts on the original Spruce Knob–Seneca Rocks view, progressively loads the south, southwest, west, and north sections, then begins a slow 120-second out-and-back fly-over. Reduced-motion visitors keep the original static camera.

The source elevation is the public-domain USGS 3DEP Bare Earth DEM. Every tile uses one shared elevation range and a one-pixel neighbor gutter. Hydrology, ridge, and valley derivatives are calculated on the complete source mosaic before it is split, which keeps geometry and shading continuous across internal boundaries. Exact export requests, bounds, encoding, camera controls, and asset names are recorded in `src/assets/terrain/monongahela-terrain.json`.

The deployed browser never contacts USGS. It loads the center assets first while the original hero image remains the loading and WebGL fallback, then preloads the rest of the local corridor in camera-route order.

To reproduce the derived assets:

1. Open the top-level `source.request` URL from the terrain metadata and download the returned 3072×3072 GeoTIFF from its `href`.
2. Install the local preprocessing requirements with `python -m pip install -r scripts/requirements-terrain.txt`.
3. Run `python scripts/process-terrain.py path/to/downloaded-mosaic.tif` from the repository root.
4. Run `npm run validate:terrain` to verify the binary encoding and companion texture.

The production build runs terrain validation automatically before Vite bundles the application.
