export const Theme = {
  colors: {
    // Cozy craft aesthetic: warm linen background, soft neutrals, thread-color accents
    background: '#FAF6F0',      // Warm linen fabric-inspired neutral background
    card: '#FFFFFF',            // Clean soft white for container/cards
    border: '#EADFC9',          // Muted warm border color

    // Accent colors (cozy threads)
    accentRose: '#C36A76',      // Warm Rose thread
    accentSage: '#7A9A82',      // Sage Green thread
    accentHoney: '#D4A35C',     // Honey Gold thread
    accentTeal: '#2C5E65',      // Deep Teal thread

    // Game navigation surfaces
    accentHoneySoft: '#F6E7C8', // Raised Honey action surface
    gameBar: '#FFF9EE',         // Warm framed HUD surface
    gameBarEdge: '#234C52',     // Dark stitched frame edge
    gameBarShadow: '#173438',   // Raised control shadow
    googleBlue: '#4285F4',      // Google sign-in brand accent

    // Text hierarchy
    textPrimary: '#2E2A25',     // Warm dark brown-slate (less harsh than pure black)
    textSecondary: '#857D75',   // Muted brown-gray
    textLight: '#FAF6F0',       // Light text on dark buttons/elements

    // Interaction states
    overlayPressed: 'rgba(44, 94, 101, 0.08)', // Press overlay
    disabledBackground: '#E6DFD5',
    disabledText: '#A19A91',

    // Status colors
    success: '#5B8C5A',
    error: '#D35D5D',
    warning: '#D39E5D',
    loading: '#857D75'
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },
  radii: {
    none: 0,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    full: 9999,
  },
  typography: {
    sizes: {
      xs: 12,
      sm: 14,
      md: 16,
      lg: 18,
      xl: 20,
      xxl: 24,
      xxxl: 32,
    },
    weights: {
      regular: '400' as const,
      medium: '500' as const,
      semibold: '600' as const,
      bold: '700' as const,
    }
  }
};

export type AppTheme = typeof Theme;
