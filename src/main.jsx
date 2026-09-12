import React from "react";
import { createRoot } from "react-dom/client";
import { version } from "../package.json";
import scientificLandscapeHero from "./assets/scientific-landscape-hero.png";
import TerrainBackground from "./TerrainBackground";
import "./styles.css";

function App() {
  return (
    <div className="site-shell">
      <section className="hero" id="top" aria-label="Field Notes">
        <TerrainBackground fallbackSrc={scientificLandscapeHero} />
        <div className="hero-grain" aria-hidden="true" />

        <header className="site-header">
          <div className="site-identity">
            <a className="wordmark" href="#top" aria-label="Field Notes home">
              <span className="wordmark-mark">FN</span>
              <span>Field Notes</span>
            </a>
            <span className="build-version" aria-label={`Build version ${version}`}>
              Build v{version}
            </span>
          </div>
          <nav aria-label="Primary navigation">
            <a className="contact-link" href="mailto:hello@example.com">
              Get in touch
            </a>
          </nav>
        </header>
      </section>

      <footer>
        <p>Based on Earth · Working everywhere</p>
        <a href="mailto:hello@example.com">hello@example.com</a>
        <p>© 2026</p>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
