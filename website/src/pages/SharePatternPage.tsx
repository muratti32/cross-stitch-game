import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'

interface PatternMetadata {
  id: string
  title: string
  creatorName: string
  categoryCode: string
  tags: { code: string; label: string }[]
  width: number
  height: number
  paletteSize: number
  previewUrl: string
  unlockPriceTier: string | null
  publishedAt: string
}

export function SharePatternPage() {
  const { id } = useParams<{ id: string }>()
  const [pattern, setPattern] = useState<PatternMetadata | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return

    const apiUrl = import.meta.env.VITE_API_URL || 'https://stitch-wish-staging-api.avkdesign.net'
    let active = true

    fetch(`${apiUrl}/v1/catalog/patterns/${id}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error('Pattern not found or unavailable')
        }
        return res.json()
      })
      .then((data) => {
        if (active) {
          setPattern(data)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [id])

  if (loading) {
    return (
      <main id="main-content" className="share-page">
        <div className="container" style={{ padding: '80px 20px', textAlign: 'center' }}>
          <div className="spinner"></div>
          <p style={{ marginTop: '20px', color: '#666' }}>Loading pattern details...</p>
        </div>
      </main>
    )
  }

  if (error || !pattern) {
    return (
      <main id="main-content" className="share-page">
        <div className="page-hero">
          <div className="container">
            <h1 className="page-hero__title">Pattern Unavailable</h1>
            <p className="page-hero__subtitle">
              This pattern is no longer available. It may have been withdrawn or removed by moderation.
            </p>
          </div>
        </div>
        <div className="page-content">
          <div className="container" style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div className="support-card" style={{ maxWidth: '480px', margin: '0 auto' }}>
              <span className="support-card__icon" aria-hidden="true">⚠️</span>
              <h2 className="support-card__title">Stitch Wish: Cross Stitch</h2>
              <p className="support-card__text">
                Browse thousands of beautiful community and official cross-stitch patterns, or convert your own photos using AI!
              </p>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '20px' }}>
                <a href="https://apps.apple.com" className="btn btn--sage" style={{ display: 'inline-block', padding: '10px 20px', textDecoration: 'none', background: '#2D6A4F', color: '#fff', borderRadius: '8px' }}>
                  App Store
                </a>
                <a href="https://play.google.com" className="btn btn--sage" style={{ display: 'inline-block', padding: '10px 20px', textDecoration: 'none', background: '#2D6A4F', color: '#fff', borderRadius: '8px' }}>
                  Google Play
                </a>
              </div>
              <div style={{ marginTop: '20px' }}>
                <Link to="/" style={{ color: '#2D6A4F', fontWeight: 'bold' }}>← Back to Home</Link>
              </div>
            </div>
          </div>
        </div>
      </main>
    )
  }

  const appLink = `stitchwish://catalog/pattern/${pattern.id}`

  return (
    <main id="main-content" className="share-page">
      <div className="page-hero">
        <div className="container">
          <p className="page-hero__breadcrumb">
            <Link to="/">Home</Link> / <Link to="/">Catalog</Link> / {pattern.title}
          </p>
          <h1 className="page-hero__title">{pattern.title}</h1>
          <p className="page-hero__subtitle">
            A cross-stitch pattern created by <strong>{pattern.creatorName}</strong>
          </p>
        </div>
      </div>

      <div className="page-content">
        <div className="container">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px', alignItems: 'start', '@media (max-width: 768px)': { gridTemplateColumns: '1fr' } } as any} className="share-layout">
            
            {/* Left: Preview Image */}
            <div className="share-preview-container" style={{ background: '#FAF6F0', borderRadius: '16px', border: '1px solid #E6DCD2', padding: '20px', textAlign: 'center', boxShadow: '0 4px 10px rgba(0,0,0,0.02)' }}>
              <img
                src={pattern.previewUrl}
                alt={`Cross stitch preview of ${pattern.title}`}
                style={{ maxWidth: '100%', maxHeight: '450px', borderRadius: '8px', objectFit: 'contain' }}
              />
            </div>

            {/* Right: Metadata and CTA */}
            <div className="share-info-container" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div className="prose">
                <h2>Pattern Details</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', margin: '20px 0' }}>
                  <div style={{ background: '#fff', padding: '16px', borderRadius: '12px', border: '1px solid #E6DCD2' }}>
                    <div style={{ fontSize: '12px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Dimensions</div>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#4A4A4A', marginTop: '4px' }}>{pattern.width} × {pattern.height}</div>
                  </div>
                  <div style={{ background: '#fff', padding: '16px', borderRadius: '12px', border: '1px solid #E6DCD2' }}>
                    <div style={{ fontSize: '12px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>DMC Threads</div>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#4A4A4A', marginTop: '4px' }}>{pattern.paletteSize} colors</div>
                  </div>
                </div>

                {pattern.tags && pattern.tags.length > 0 && (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '24px' }}>
                    {pattern.tags.map((tag) => (
                      <span key={tag.code} style={{ background: '#EAE2D8', color: '#4A4A4A', fontSize: '13px', padding: '6px 12px', borderRadius: '99px', border: '1px solid #DCD2C4' }}>
                        #{tag.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Action Cards */}
              <div className="support-card" style={{ padding: '24px', background: '#EAE6DF', border: '1px solid #D8D2CA' }}>
                <h3 style={{ marginTop: 0, marginBottom: '8px', color: '#2D6A4F' }}>Play this Pattern</h3>
                <p style={{ color: '#666', fontSize: '14px', marginBottom: '20px' }}>
                  Start stitching this pattern instantly in the Stitch Wish app. Your progress will be saved to your device.
                </p>
                <a
                  href={appLink}
                  style={{ display: 'block', textAlign: 'center', background: '#2D6A4F', color: '#fff', padding: '14px', borderRadius: '8px', fontWeight: 'bold', textDecoration: 'none', boxShadow: '0 4px 6px rgba(45,106,79,0.2)', transition: 'background 0.2s' }}
                >
                  🚀 Open in Stitch Wish App
                </a>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h4 style={{ margin: 0, fontSize: '14px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Don't have the app yet?</h4>
                <p style={{ fontSize: '14px', color: '#666', margin: 0 }}>
                  Download Stitch Wish for free and start cross-stitching today.
                </p>
                <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                  <a href="https://apps.apple.com" style={{ flex: 1, display: 'block', textAlign: 'center', border: '1px solid #4A4A4A', padding: '10px', borderRadius: '8px', textDecoration: 'none', color: '#4A4A4A', fontWeight: 'bold', fontSize: '14px' }}>
                    App Store
                  </a>
                  <a href="https://play.google.com" style={{ flex: 1, display: 'block', textAlign: 'center', border: '1px solid #4A4A4A', padding: '10px', borderRadius: '8px', textDecoration: 'none', color: '#4A4A4A', fontWeight: 'bold', fontSize: '14px' }}>
                    Google Play
                  </a>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </main>
  )
}
