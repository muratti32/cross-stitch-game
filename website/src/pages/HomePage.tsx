import { useState, useEffect } from 'react'
import stitchRose from '../assets/stitch_rose.jpg'
import stitchCat from '../assets/stitch_cat.jpg'
import stitchLandscape from '../assets/stitch_landscape.jpg'

// Heart pattern for 12x12 grid auto-stitching
const DEFAULT_PATTERN: [number, number, string][] = [
  [2,4,'c-red'], [2,5,'c-red'], [2,7,'c-red'], [2,8,'c-red'],
  [3,3,'c-red'], [3,4,'c-red'], [3,5,'c-red'], [3,6,'c-red'], [3,7,'c-red'], [3,8,'c-red'], [3,9,'c-red'],
  [4,2,'c-red'], [4,3,'c-red'], [4,4,'c-red'], [4,5,'c-red'], [4,6,'c-red'], [4,7,'c-red'], [4,8,'c-red'], [4,9,'c-red'], [4,10,'c-red'],
  [5,2,'c-red'], [5,3,'c-red'], [5,4,'c-red'], [5,5,'c-red'], [5,6,'c-red'], [5,7,'c-red'], [5,8,'c-red'], [5,9,'c-red'], [5,10,'c-red'],
  [6,3,'c-red'], [6,4,'c-red'], [6,5,'c-red'], [6,6,'c-red'], [6,7,'c-red'], [6,8,'c-red'], [6,9,'c-red'],
  [7,4,'c-red'], [7,5,'c-red'], [7,6,'c-red'], [7,7,'c-red'], [7,8,'c-red'],
  [8,5,'c-red'], [8,6,'c-red'], [8,7,'c-red'],
  [9,6,'c-red'],
  // Gold accents / sparkles
  [1,1,'c-gold'], [2,2,'c-gold'], [1,10,'c-gold'], [2,9,'c-gold'],
  // Blue stars
  [10,1,'c-blue'], [9,2,'c-blue'],
  // Green leaves
  [10,10,'c-green'], [9,9,'c-green']
]

function HeroPhoneMockup() {
  const [grid, setGrid] = useState<Record<string, string>>({})
  const [selectedColor, setSelectedColor] = useState<string>('c-red')
  const [isMouseDown, setIsMouseDown] = useState<boolean>(false)
  const [isAutoStitching, setIsAutoStitching] = useState<boolean>(true)

  // Auto-stitch the heart pattern on page load
  useEffect(() => {
    let timer: any
    let index = 0
    const speed = 40 // ms per stitch

    setGrid({})
    setIsAutoStitching(true)

    const stitchNext = () => {
      if (index >= DEFAULT_PATTERN.length) {
        setIsAutoStitching(false)
        return
      }
      const [r, c, color] = DEFAULT_PATTERN[index]
      setGrid(prev => ({
        ...prev,
        [`${r}-${c}`]: color
      }))
      index++
      timer = setTimeout(stitchNext, speed)
    }

    timer = setTimeout(stitchNext, 800)
    return () => clearTimeout(timer)
  }, [])

  // Listen to mouseup globally to stop painting
  useEffect(() => {
    const handleMouseUp = () => setIsMouseDown(false)
    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [])

  const handleCellAction = (r: number, c: number) => {
    const key = `${r}-${c}`
    setGrid(prev => {
      const next = { ...prev }
      if (selectedColor === 'eraser') {
        delete next[key]
      } else {
        next[key] = selectedColor
      }
      return next
    })
  }

  const handleMouseDownCell = (r: number, c: number) => {
    setIsMouseDown(true)
    handleCellAction(r, c)
  }

  const handleMouseEnterCell = (r: number, c: number) => {
    if (isMouseDown) {
      handleCellAction(r, c)
    }
  }

  const clearCanvas = () => {
    setGrid({})
    setIsAutoStitching(false)
  }

  const colors = [
    { class: 'c-red', hex: 'var(--color-red)', label: 'Red' },
    { class: 'c-blue', hex: 'var(--color-blue)', label: 'Blue' },
    { class: 'c-green', hex: 'var(--color-green)', label: 'Green' },
    { class: 'c-gold', hex: 'var(--color-gold)', label: 'Gold' },
  ]

  const cells = []
  for (let r = 0; r < 12; r++) {
    for (let c = 0; c < 12; c++) {
      const colorClass = grid[`${r}-${c}`]
      let cellColor = ''
      if (colorClass === 'c-red') cellColor = 'var(--color-red)'
      else if (colorClass === 'c-blue') cellColor = 'var(--color-blue)'
      else if (colorClass === 'c-green') cellColor = 'var(--color-green)'
      else if (colorClass === 'c-gold') cellColor = 'var(--color-gold)'

      cells.push(
        <div
          key={`${r}-${c}`}
          className={`hero__cell${colorClass ? ' filled' : ''}`}
          style={{ color: cellColor }}
          onMouseDown={() => handleMouseDownCell(r, c)}
          onMouseEnter={() => handleMouseEnterCell(r, c)}
          onTouchStart={(e) => {
            e.preventDefault()
            handleCellAction(r, c)
          }}
          aria-hidden="true"
        />
      )
    }
  }

  return (
    <div className="hero__phone">
      <div className="hero__phone-frame" aria-hidden="true">
        <div className="hero__phone-notch" />
        <div className="hero__phone-screen">
          {/* Status bar */}
          <div className="phone-status">
            <span className="phone-status__time">09:41</span>
            <div className="phone-status__icons">
              <span style={{ fontSize: 9 }}>📶</span>
              <span style={{ fontSize: 9, marginLeft: 3 }}>🔋</span>
            </div>
          </div>

          {/* Game Title Bar */}
          <div className="phone-header">
            <span className="phone-header__appname">🧵 Stitch Wish</span>
            <button className="phone-header__btn" onClick={clearCanvas}>Reset</button>
          </div>

          {/* Stitch Grid */}
          <div 
            className="hero__grid" 
            style={{ gridTemplateColumns: 'repeat(12,14px)', gridTemplateRows: 'repeat(12,14px)' }}
          >
            {cells}
          </div>

          {/* Color Palette toolbar */}
          <div className="phone-toolbar">
            <div className="phone-palette">
              {colors.map(col => (
                <button
                  key={col.class}
                  onClick={() => setSelectedColor(col.class)}
                  className={`phone-palette__color ${selectedColor === col.class ? 'active' : ''}`}
                  style={{ backgroundColor: col.hex }}
                  title={col.label}
                />
              ))}
              <button
                onClick={() => setSelectedColor('eraser')}
                className={`phone-palette__eraser ${selectedColor === 'eraser' ? 'active' : ''}`}
                title="Eraser"
              >
                🧹
              </button>
            </div>
            <div className="phone-toolbar__tip">
              {isAutoStitching ? 'Auto stitching...' : 'Tap & drag on canvas to stitch!'}
            </div>
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
    text: 'Stitch from a curated catalog of official designs, or convert your own digital memories into cross-stitch boards.',
  },
  {
    icon: '📱',
    color: 'blue',
    title: 'Play Anywhere',
    text: 'Local-first engineering ensures your projects, progress, and library are fully available offline.',
  },
  {
    icon: '🎨',
    color: 'green',
    title: 'Authentic DMC Colors',
    text: 'Stitch with the exact colors of DMC cotton floss threads. A physical crafter\'s palette rendered digitally.',
  },
  {
    icon: '✨',
    color: 'gold',
    title: 'Create with AI',
    text: 'Unleash your imagination. Describe anything and watch the built-in AI transform it into a stitchable pattern canvas.',
  },
]

const screenshotPreviews = [
  { label: 'Blooming Rose', img: stitchRose, level: 'DMC 817 • 12 Colors', complexity: 'Easy' },
  { label: 'Sleeping Kitten', img: stitchCat, level: 'DMC 743 • 8 Colors', complexity: 'Medium' },
  { label: 'Starry Night', img: stitchLandscape, level: 'DMC 825 • 18 Colors', complexity: 'Hard' },
]

function AISimulator() {
  const [prompt, setPrompt] = useState('A cute orange kitten holding a blue balloon')
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'mapping' | 'success'>('idle')
  const [progress, setProgress] = useState(0)

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault()
    if (status !== 'idle') return

    setStatus('analyzing')
    setProgress(15)

    setTimeout(() => {
      setStatus('mapping')
      setProgress(60)
    }, 1200)

    setTimeout(() => {
      setProgress(100)
      setStatus('success')
    }, 2500)
  }

  const resetSimulator = () => {
    setStatus('idle')
    setProgress(0)
  }

  return (
    <div className="ai-sim animate-fade-in delay-2">
      <div className="ai-sim__content">
        <h3 className="ai-sim__title">Try the AI Pattern Generator</h3>
        <p className="ai-sim__subtitle">
          Type an idea below to preview how our neural network converts concepts into structured DMC color charts.
        </p>

        {status === 'idle' && (
          <form onSubmit={handleGenerate} className="ai-sim__form">
            <input
              type="text"
              className="ai-sim__input"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g., A cozy cabin under northern lights, pixel art"
              required
            />
            <button type="submit" className="btn btn--primary">
              Generate Pattern
            </button>
          </form>
        )}

        {(status === 'analyzing' || status === 'mapping') && (
          <div className="ai-sim__status-wrap">
            <div className="ai-sim__loader">
              <div className="ai-sim__loader-bar" style={{ width: `${progress}%` }} />
            </div>
            <p className="ai-sim__status-text">
              {status === 'analyzing' && '🪄 Imagining artwork and sketching pixels...'}
              {status === 'mapping' && '🧵 Mapping colors to DMC thread charts...'}
            </p>
          </div>
        )}

        {status === 'success' && (
          <div className="ai-sim__result">
            <div className="ai-sim__result-meta">
              <div>
                <strong>Generated Pattern:</strong> "{prompt}"
              </div>
              <div>
                <span className="badge badge--success">Chart Ready</span>
              </div>
            </div>

            <div className="ai-sim__chart-grid">
              <div className="ai-sim__pixel-preview">
                {/* Simulated generated pattern */}
                <div className="ai-sim__pixel-art">
                  {Array.from({ length: 64 }).map((_, i) => {
                    const colors = ['#C44B3E', '#4A7C9E', '#C49A3E', '#5A9E6F', '#735F4C']
                    const randCol = colors[(i + prompt.length) % colors.length]
                    return (
                      <div
                        key={i}
                        className="ai-sim__pixel-cell"
                        style={{ backgroundColor: randCol }}
                      />
                    )
                  })}
                </div>
              </div>
              <div className="ai-sim__thread-list">
                <h4>Required Threads (DMC)</h4>
                <ul>
                  <li><span className="thread-chip" style={{ background: 'var(--color-red)' }} /> DMC 817 (Red) — 420 sts</li>
                  <li><span className="thread-chip" style={{ background: 'var(--color-blue)' }} /> DMC 825 (Blue) — 285 sts</li>
                  <li><span className="thread-chip" style={{ background: 'var(--color-gold)' }} /> DMC 729 (Gold) — 110 sts</li>
                  <li><span className="thread-chip" style={{ background: 'var(--color-green)' }} /> DMC 319 (Green) — 90 sts</li>
                </ul>
              </div>
            </div>

            <button onClick={resetSimulator} className="btn btn--secondary btn--sm" style={{ marginTop: '1rem' }}>
              Create Another
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function HomePage() {
  return (
    <main id="main-content">
      {/* Decorative floaters in background */}
      <div className="hero__floater floater-1" aria-hidden="true">✕</div>
      <div className="hero__floater floater-2" aria-hidden="true">✕</div>
      <div className="hero__floater floater-3" aria-hidden="true">✦</div>
      <div className="hero__floater floater-4" aria-hidden="true">✦</div>

      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="hero section" aria-label="Hero">
        <div className="container hero__inner">
          <div className="animate-fade-in">
            <span className="hero__eyebrow">A Cozy Crafting Retreat</span>
            <h1 className="hero__title">
              Stitch your world,<br />
              <em>one X at a time.</em>
            </h1>
            <p className="hero__subtitle">
              Stitch Wish brings the peaceful, quiet joy of needlepoint cross-stitching directly to your phone. 
              Relax with gorgeous charts, stitch offline, and generate bespoke patterns with AI.
            </p>
            <div className="hero__cta">
              <StoreBadge store="apple" />
              <StoreBadge store="google" />
            </div>
          </div>
          <div className="animate-fade-in delay-1">
            <HeroPhoneMockup />
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────── */}
      <section className="features section animate-fade-in delay-2" aria-label="Features" id="features">
        <div className="container">
          <header className="features__header">
            <span className="section-tag">Why Stitch Wish?</span>
            <h2 className="section-title">Mindful Crafting in Your Pocket</h2>
            <p className="section-subtitle">
              A peaceful, meticulously detailed experience designed to help you decompress.
            </p>
          </header>

          <div className="features__grid">
            {features.map((f, idx) => (
              <article key={f.title} className={`feature-card animate-fade-in delay-${(idx % 4) + 1}`}>
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

      {/* ── Screenshots / Showcase ──────────────────────── */}
      <section className="screenshots section animate-fade-in delay-3" aria-label="App screenshots" id="screenshots">
        <div className="container">
          <header className="features__header">
            <span className="section-tag">Premium Catalog</span>
            <h2 className="section-title">Hand-Stitched Masterpieces</h2>
            <p className="section-subtitle">
              Browse through a cozy gallery of pre-rendered, high-fidelity stitch designs ready for your needle.
            </p>
          </header>

          <div className="screenshots__hoops-wrapper">
            {screenshotPreviews.map((s, idx) => (
              <div key={s.label} className={`showcase-card animate-fade-in delay-${idx + 1}`}>
                <div className="embroidery-hoop" aria-hidden="true">
                  <img src={s.img} alt={s.label} className="embroidery-hoop__canvas" />
                  <div className="embroidery-hoop__texture" />
                </div>
                <div className="showcase-card__details">
                  <span className="showcase-card__complexity">{s.complexity}</span>
                  <h3 className="showcase-card__title">{s.label}</h3>
                  <span className="showcase-card__subtitle">{s.level}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── AI Interactive Demo ─────────────────────────── */}
      <section className="ai-demo section" aria-label="AI Generator Demo">
        <div className="container">
          <AISimulator />
        </div>
      </section>

      {/* ── CTA Banner ───────────────────────────────────── */}
      <section className="cta-banner section" aria-label="Download call to action" id="download">
        <div className="container cta-banner__inner">
          <h2 className="cta-banner__title">Find your creative calm today</h2>
          <p className="cta-banner__subtitle">
            Free to download on iOS and Android. Start stitching your first pattern in minutes.
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
