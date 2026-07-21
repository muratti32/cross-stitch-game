import { Link } from 'react-router-dom'

const adminUrl = import.meta.env.VITE_ADMIN_CONSOLE_URL ?? 'http://localhost:3001'

export function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer className="footer">
      <div className="container footer__inner">
        <div className="footer__top">
          <div>
            <p className="footer__brand">Stitch Wish</p>
            <p className="footer__tagline">
              A relaxing cross-stitch art game.<br />Stitch beautiful patterns, one X at a time.
            </p>
          </div>

          <div className="footer__links">
            <div className="footer__link-group">
              <h4>Legal</h4>
              <ul>
                <li><Link to="/privacy-policy">Privacy Policy</Link></li>
                <li><Link to="/account-deletion">Account Deletion</Link></li>
              </ul>
            </div>
            <div className="footer__link-group">
              <h4>Help</h4>
              <ul>
                <li><Link to="/support">Support</Link></li>
                <li>
                  <a href="mailto:muratti32@gmail.com">Contact Us</a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="footer__bottom">
          <p className="footer__copy">
            © {year} AVK. All rights reserved.
          </p>
          <a
            href={adminUrl}
            className="footer__admin-link"
            aria-label="Operator Console"
            rel="noopener noreferrer"
          >
            Operator Console →
          </a>
        </div>
      </div>
    </footer>
  )
}
