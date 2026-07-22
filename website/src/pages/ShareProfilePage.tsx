import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'

interface ProfileMetadata {
  username: string
  displayName: string
  avatarUrl?: string
  creationsCount: number
}

export function ShareProfilePage() {
  const { username } = useParams<{ username: string }>()
  const [profile, setProfile] = useState<ProfileMetadata | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!username) return

    const apiUrl = import.meta.env.VITE_API_URL || 'https://stitch-wish-staging-api.avkdesign.net'
    let active = true

    fetch(`${apiUrl}/v1/catalog/profiles/${username}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error('Profile not found or unavailable')
        }
        return res.json()
      })
      .then((data) => {
        if (active) {
          setProfile(data)
          setLoading(false)
        }
      })
      .catch(() => {
        // Suppress errors and render the creator profile fallback stub nicely
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [username])

  if (loading) {
    return (
      <main id="main-content" className="share-page">
        <div className="container" style={{ padding: '80px 20px', textAlign: 'center' }}>
          <div className="spinner"></div>
          <p style={{ marginTop: '20px', color: '#666' }}>Loading profile...</p>
        </div>
      </main>
    )
  }

  const appLink = `stitchwish://profile/${username}`
  const profileName = profile?.displayName || `@${username}`

  return (
    <main id="main-content" className="share-page">
      <div className="page-hero">
        <div className="container">
          <p className="page-hero__breadcrumb">
            <Link to="/">Home</Link> / Creators / @{username}
          </p>
          <h1 className="page-hero__title">@{username}</h1>
          <p className="page-hero__subtitle">
            Stitch Wish Creator Profile
          </p>
        </div>
      </div>

      <div className="page-content">
        <div className="container" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div className="support-card" style={{ maxWidth: '520px', margin: '0 auto', padding: '30px' }}>
            <div style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              background: '#EAE6DF',
              border: '1px solid #D8D2CA',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px',
              fontSize: '32px'
            }}>
              🎨
            </div>
            <h2 className="support-card__title">{profileName}</h2>
            <p className="support-card__text" style={{ fontSize: '15px', color: '#666', marginTop: '10px' }}>
              Creator profiles and community submissions are coming soon! You will be able to follow creators, view their public patterns, and share your own designs.
            </p>
            
            <div style={{ margin: '30px 0 20px' }}>
              <a
                href={appLink}
                style={{ display: 'block', textAlign: 'center', background: '#2D6A4F', color: '#fff', padding: '14px', borderRadius: '8px', fontWeight: 'bold', textDecoration: 'none', boxShadow: '0 4px 6px rgba(45,106,79,0.2)' }}
              >
                🚀 Open @{username} in Stitch Wish
              </a>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '20px' }}>
              <a href="https://apps.apple.com" style={{ flex: 1, display: 'block', textAlign: 'center', border: '1px solid #4A4A4A', padding: '10px', borderRadius: '8px', textDecoration: 'none', color: '#4A4A4A', fontWeight: 'bold', fontSize: '14px' }}>
                App Store
              </a>
              <a href="https://play.google.com" style={{ flex: 1, display: 'block', textAlign: 'center', border: '1px solid #4A4A4A', padding: '10px', borderRadius: '8px', textDecoration: 'none', color: '#4A4A4A', fontWeight: 'bold', fontSize: '14px' }}>
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
