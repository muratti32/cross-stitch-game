import { Link } from 'react-router-dom'

// Decorative cross-stitch grid for the hero phone mockup
const GRID_PATTERN = [
  // [row, col, color-class]
  [0,0,'c-red'],[0,1,'c-red'],[0,5,'c-blue'],[0,6,'c-blue'],
  [1,0,'c-red'],[1,2,'c-red'],[1,4,'c-blue'],[1,6,'c-blue'],
  [2,1,'c-red'],[2,2,'c-red'],[2,3,'c-green'],[2,4,'c-blue'],[2,5,'c-blue'],
  [3,2,'c-green'],[3,3,'c-green'],[3,4,'c-green'],
  [4,1,'c-gold'],[4,2,'c-green'],[4,3,'c-green'],[4,4,'c-green'],[4,5,'c-gold'],
  [5,0,'c-gold'],[5,1,'c-gold'],[5,5,'c-gold'],[5,6,'c-gold'],
  [6,0,'c-blue'],[6,2,'c-gold'],[6,4,'c-gold'],[6,6,'c-red'],
  [7,1,'c-blue'],[7,2,'c-blue'],[7,4,'c-red'],[7,5,'c-red'],
] as [number, number, string][]

function HeroPhoneMockup() {
  const cells: React.ReactNode[] = []
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const match = GRID_PATTERN.find(([gr, gc]) => gr === r && gc === c)
      cells.push(
        <div
          key={`${r}-${c}`}
          className={`hero__cell${match ? ` filled ${match[2]}` : ''}`}
          aria-hidden="true"
        />
      )
    }
  }
  return (
    <div className="hero__phone">
      <div className="hero__phone-frame" aria-hidden="true">
        <div className="hero__phone-screen">
          <div className="hero__grid" style={{ gridTemplateColumns: 'repeat(8,20px)', gridTemplateRows: 'repeat(8,20px)' }}>
            {cells}
          </div>
        </div>
      </div>
    </div>
  )
}

function StoreBadge({ store, href }: { store: 'apple' | 'google'; href?: string }) {
  const Tag = href ? 'a' : 'span'
  return (
    <Tag
      href={href}
      className="store-badge"
      target={href ? '_blank' : undefined}
      rel={href ? 'noopener noreferrer' : undefined}
      aria-label={store === 'apple' ? 'Download on the App Store (coming soon)' : 'Get it on Google Play (coming soon)'}
    >
      {store === 'apple' ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M3.18 23.76c.34.19.72.24 1.09.14l12.12-6.99-2.56-2.56-10.65 9.41zm-1.5-20.2C1.44 3.9 1.25 4.37 1.25 5v14c0 .63.19 1.1.43 1.44l.07.07 7.84-7.84v-.18L1.68 3.56l-.0.0zm18.34 8.6l-2.28-1.31-2.87 2.87 2.87 2.87 2.28-1.32c.65-.38.65-1.73 0-2.11zM4.27.1C3.9 0 3.52.05 3.18.24l10.65 9.41 2.56-2.56L4.27.1z"/>
        </svg>
      )}
      <span>
        <span className="store-badge__label">{store === 'apple' ? 'Download on the' : 'Get it on'}</span>
        <span className="store-badge__name">{store === 'apple' ? 'App Store' : 'Google Play'}</span>
      </span>
    </Tag>
  )
}

const features = [
  {
    icon: '🧵',
    color: 'red',
    title: 'Beautiful Patterns',
    text: 'Stitch from a curated catalog of official designs, or create your own from photos and AI-generated artwork.',
  },
  {
    icon: '📱',
    color: 'blue',
    title: 'Play Anywhere',
    text: 'Local-first design means your sessions are always available — even without an internet connection.',
  },
  {
    icon: '🎨',
    color: 'green',
    title: 'Real DMC Colors',
    text: 'Every pattern uses authentic DMC thread colors. A true cross-stitcher\'s palette in the palm of your hand.',
  },
  {
    icon: '✨',
    color: 'gold',
    title: 'Create with AI',
    text: 'Turn any idea into a stitch-able pattern using the built-in AI artwork generator. No crafting experience needed.',
  },
]

const screenshotPreviews = [
  { label: 'Pattern Catalog', colors: ['#C44B3E','#4A7C9E','#5A9E6F'] },
  { label: 'Stitching Session', colors: ['#C44B3E','#C49A3E','#4A7C9E'] },
  { label: 'My Patterns', colors: ['#5A9E6F','#C44B3E','#4A7C9E'] },
  { label: 'AI Artwork', colors: ['#4A7C9E','#5A9E6F','#C49A3E'] },
]

function MiniGridPreview({ colors }: { colors: string[] }) {
  const SIZE = 10
  const cells = []
  for (let i = 0; i < SIZE * SIZE; i++) {
    const r = Math.floor(i / SIZE), c = i % SIZE
    const dist = Math.sqrt((r - SIZE / 2) ** 2 + (c - SIZE / 2) ** 2)
    const colorIdx = dist < 2 ? 0 : dist < 4 ? 1 : dist < 6 ? 2 : -1
    cells.push(
      <div
        key={i}
        className="mini-cell"
        style={{
          width: 14,
          height: 14,
          background: colorIdx >= 0 ? colors[colorIdx] : '#DDD3C3',
          borderRadius: 2,
        }}
        aria-hidden="true"
      />
    )
  }
  return (
    <div
      style={{ display: 'grid', gridTemplateColumns: `repeat(${SIZE},14px)`, gap: 2 }}
      aria-hidden="true"
    >
      {cells}
    </div>
  )
}

export function HomePage() {
  return (
    <main id="main-content">
      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="hero section" aria-label="Hero">
        <div className="container hero__inner">
          <div>
            <span className="hero__eyebrow">Cross-stitch art game</span>
            <h1 className="hero__title">
              Stitch your world,<br />
              <em>one X at a time.</em>
            </h1>
            <p className="hero__subtitle">
              Stitch Wish brings the calm joy of cross-stitch to your phone.
              Browse gorgeous patterns, stitch offline, and create your own
              masterpieces with real DMC colors.
            </p>
            <div className="hero__cta">
              <StoreBadge store="apple" />
              <StoreBadge store="google" />
            </div>
          </div>
          <HeroPhoneMockup />
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────── */}
      <section className="features section" aria-label="Features" id="features">
        <div className="container">
          <header className="features__header">
            <span className="section-tag">Why Stitch Wish?</span>
            <h2 className="section-title">Everything you need to stitch</h2>
            <p className="section-subtitle">
              A relaxing, beautifully crafted experience designed for both
              beginners and seasoned cross-stitchers.
            </p>
          </header>

          <div className="features__grid">
            {features.map((f) => (
              <article key={f.title} className="feature-card">
                <div className={`feature-card__icon feature-card__icon--${f.color}`} aria-hidden="true">
                  {f.icon}
                </div>
                <h3 className="feature-card__title">{f.title}</h3>
                <p className="feature-card__text">{f.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Screenshots ──────────────────────────────────── */}
      <section className="screenshots section" aria-label="App screenshots" id="screenshots">
        <div className="container">
          <header className="features__header">
            <span className="section-tag">In-App Preview</span>
            <h2 className="section-title">See it in action</h2>
            <p className="section-subtitle">
              Beautifully designed screens that make stitching a joy.
            </p>
          </header>

          <div className="screenshots__track" role="list" aria-label="App screen previews">
            {screenshotPreviews.map((s) => (
              <div key={s.label} className="screenshot-card" role="listitem">
                <MiniGridPreview colors={s.colors} />
                <span className="screenshot-card__label">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA Banner ───────────────────────────────────── */}
      <section className="cta-banner section" aria-label="Download call to action">
        <div className="container cta-banner__inner">
          <h2 className="cta-banner__title">Start stitching today</h2>
          <p className="cta-banner__subtitle">
            Free to download. Hundreds of patterns waiting for you.
            No experience needed.
          </p>
          <div className="cta-banner__badges">
            <StoreBadge store="apple" />
            <StoreBadge store="google" />
          </div>
        </div>
      </section>
    </main>
  )
}
