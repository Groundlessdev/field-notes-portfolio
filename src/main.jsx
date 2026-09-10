import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const disciplines = [
  {
    number: "01",
    title: "Philosophy",
    description:
      "Essays and inquiries into mind, ethics, technology, and the conditions of a meaningful life.",
    tags: ["Ethics", "Phenomenology", "Technology"],
    symbol: "◌",
  },
  {
    number: "02",
    title: "Ecology",
    description:
      "Field observations and research on living systems, restoration, and our place within the biosphere.",
    tags: ["Systems", "Restoration", "Fieldwork"],
    symbol: "⌁",
  },
  {
    number: "03",
    title: "Computer Science",
    description:
      "Software experiments that make complex systems legible, useful, and a little more humane.",
    tags: ["Interfaces", "Data", "Open source"],
    symbol: "⌘",
  },
];

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11M11 6l4 4-4 4" />
    </svg>
  );
}

function App() {
  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="Field Notes home">
          <span className="wordmark-mark">FN</span>
          <span>Field Notes</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#work">Work</a>
          <a href="#about">About</a>
          <a className="contact-link" href="mailto:hello@example.com">
            Get in touch
          </a>
        </nav>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-kicker">
            <span className="pulse" aria-hidden="true" />
            Interdisciplinary practice · 2026
          </div>
          <h1 id="hero-title">
            Thinking across
            <span>living systems.</span>
          </h1>
          <div className="hero-footer">
            <p>
              A portfolio of research, writing, and software exploring how we
              understand the world—and how we might inhabit it more carefully.
            </p>
            <a href="#work" className="text-link">
              Explore selected work <ArrowIcon />
            </a>
          </div>
          <div className="orbit" aria-hidden="true">
            <span className="orbit-ring ring-one" />
            <span className="orbit-ring ring-two" />
            <span className="orbit-dot dot-one" />
            <span className="orbit-dot dot-two" />
            <span className="orbit-core">Φ</span>
          </div>
        </section>

        <section className="work-section" id="work" aria-labelledby="work-title">
          <div className="section-heading">
            <p>Selected areas</p>
            <h2 id="work-title">Three ways of paying attention.</h2>
          </div>

          <div className="discipline-grid">
            {disciplines.map((discipline) => (
              <article className="discipline-card" key={discipline.title}>
                <div className="card-topline">
                  <span>{discipline.number}</span>
                  <span className="card-symbol" aria-hidden="true">
                    {discipline.symbol}
                  </span>
                </div>
                <div className="card-content">
                  <h3>{discipline.title}</h3>
                  <p>{discipline.description}</p>
                </div>
                <div className="tag-list" aria-label={`${discipline.title} topics`}>
                  {discipline.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
                <a href="mailto:hello@example.com" aria-label={`Ask about ${discipline.title} work`}>
                  View work <ArrowIcon />
                </a>
              </article>
            ))}
          </div>
        </section>

        <section className="about-section" id="about" aria-labelledby="about-title">
          <p className="eyebrow">Working premise</p>
          <div className="about-copy">
            <h2 id="about-title">
              The most interesting questions rarely belong to one field.
            </h2>
            <p>
              This practice brings philosophical clarity, ecological awareness,
              and computational craft into the same conversation. The result is
              work built to reveal connections—not flatten them.
            </p>
          </div>
        </section>
      </main>

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
