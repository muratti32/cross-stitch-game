import { Link, NavLink } from 'react-router-dom'

export function Nav() {
  return (
    <nav className="nav" aria-label="Main navigation">
      <div className="container nav__inner">
        <Link to="/" className="nav__logo" aria-label="Stitch Wish home">
          <svg className="nav__logo-icon" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="#FAF7F2" stroke="#DDD3C3" strokeWidth="1.5"/>
            {/* Cross-stitch X in DMC red */}
            <line x1="8"  y1="8"  x2="24" y2="24" stroke="#C44B3E" strokeWidth="2.5" strokeLinecap="round"/>
            <line x1="24" y1="8"  x2="8"  y2="24" stroke="#C44B3E" strokeWidth="2.5" strokeLinecap="round"/>
            {/* Mini grid */}
            <rect x="6"  y="6"  width="8" height="8" rx="1" fill="none" stroke="#DDD3C3" strokeWidth="1"/>
            <rect x="18" y="6"  width="8" height="8" rx="1" fill="none" stroke="#DDD3C3" strokeWidth="1"/>
            <rect x="6"  y="18" width="8" height="8" rx="1" fill="none" stroke="#DDD3C3" strokeWidth="1"/>
            <rect x="18" y="18" width="8" height="8" rx="1" fill="rgba(74,124,158,0.2)" stroke="#4A7C9E" strokeWidth="1" fillOpacity="0.2"/>
          </svg>
          Stitch Wish
        </Link>

        <div className="nav__actions">
          <ul className="nav__links" role="list">
            <li><NavLink to="/" end>Home</NavLink></li>
            <li><NavLink to="/support">Support</NavLink></li>
            <li><NavLink to="/privacy-policy">Privacy Policy</NavLink></li>
            <li><NavLink to="/terms-of-service">Terms</NavLink></li>
          </ul>
          <a href="#download" className="btn btn--primary btn--sm nav__cta-btn">
            Get App
          </a>
        </div>
      </div>
    </nav>
  )
}
