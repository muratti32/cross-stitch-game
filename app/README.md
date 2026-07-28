# Stitch Wish Mobile App

Stitch Wish is a cozy cross-stitch (kanaviçe) mobile game where players stitch beautiful pixel-art patterns cell by cell using colored threads. This folder houses the React Native mobile application built on Expo SDK 54, Expo Router, TypeScript strict, TanStack Query, and Zustand.

---

## 📂 Folder Structure

The application separates routing files, design assets, and app logic cleanly:

```text
app/
├── app/                      # Expo Router Routing Folder (URL/Deep-link mapping)
│   ├── _layout.tsx           # Root navigation layout & App providers wrapping
│   ├── index.tsx             # Entry redirect pointing to /(tabs)/(catalog)
│   └── (tabs)/               # Bottom tab navigator group
│       ├── _layout.tsx       # Bottom tabs navigation and icon settings
│       ├── (catalog)/        # Catalog/Discovery tab group (Index, Staff Picks, New, Categories)
│       ├── (play)/           # Play tab group (Active & Recent stitching sessions)
│       ├── (create)/         # Creation tab group (Photo Import, AI Generation, Pattern Editor)
│       ├── (profile)/        # Profile tab group (Stitch count, Coins ledger, User patterns)
│       └── (settings)/       # Settings tab group (App settings, Links, Server Health checks)
├── src/                      # Application Logic & Reusable Primitives
│   ├── components/           # UI elements (Screen, Card, Button, EmptyState, SectionHeader)
│   ├── theme/                # Cozy craft design tokens (colors, spacing, typography, radii)
│   ├── store/                # Zustand client-only state store (no server data caching)
│   ├── hooks/                # Custom React hooks (useHealthCheck backend fetching)
│   ├── config/               # Environmental variable mapping and configuration
│   └── types/                # Strongly-typed models (Pattern, Category, HealthResponse)
├── assets/                   # Shared image resources, app icons, and splash screens
├── package.json              # Node dependencies locking Expo SDK 54 versions
├── tsconfig.json             # Strict TypeScript compiler options with alias mappings
├── eas.json                  # Multi-environment EAS Build profiles
├── metro.config.js           # Metro Bundler settings
├── .env.example              # Template for environment configurations
└── .env                      # Local environment configurations (ignored in git)
```

---

## 🎨 Cozy Craft Design System

Stitch Wish features a tactile, warm, craft-inspired UI. Design tokens reside in `src/theme/theme.ts`. No raw hex codes are hardcoded directly in screens to support future features like a night/dark mode easily.
- **Background**: Warm linen fabric color (`#FAF6F0`).
- **Accents**: Warm Rose (`#C36A76`), Sage Green (`#7A9A82`), Honey Gold (`#D4A35C`), and Deep Teal (`#2C5E65`).
- **Cards**: Large-rounded soft-edged container cards (`Theme.radii.lg = 16`).
- **Borders**: Soft warm borders (`Theme.colors.border = '#EADFC9'`) paired with dashed empty states for a needlepoint frame look.

---

## ⚙️ Environment Configurations

The application relies on `EXPO_PUBLIC_API_BASE_URL` to route backend calls. RevenueCat additionally requires an explicit `EXPO_PUBLIC_REVENUECAT_STORE_MODE` plus the matching public SDK key; see `.env.example` for the variable names.

1. Copy the example configuration to create your local variables:
   ```bash
   cp .env.example .env
   ```
2. Adjust `EXPO_PUBLIC_API_BASE_URL` in `.env` to point to your running Game Backend (default: `http://localhost:3000`).

---

## 🚀 Running the App

Follow these steps to run the application in development:

### 1. Installation
Install project dependencies matching Expo SDK 54 compatibility:
```bash
npm install
```

### 2. Start the Metro Bundler
Start the development environment:
```bash
npm run start
```

### 3. Open on Devices / Simulators
Inside the Metro terminal:
- Press `i` to open the iOS Simulator.
- Press `a` to open the Android Emulator.
- Scan the QR code with your Expo Go app (if running Expo Go, though note this is configured as a `dev-client` app layout).

---

## 🛠️ Build Profiles (`eas.json`)

Build configurations correspond to separate environments:
- **`development`**: Existing local-backend development client. RevenueCat mode is `native`; missing native public keys disable commerce without blocking the app.
- **`development-test-store`**: Development client targeting the staging Game Backend with RevenueCat mode `test_store`. Set `EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY` in the EAS `development` environment; never put this key in preview or production.
- **`preview`**: Internal staging build using the iOS/Android native store and the EAS `preview` environment's platform-specific RevenueCat public key.
- **`production`**: Live release build using the iOS/Android native store and the EAS `production` environment's platform-specific RevenueCat public key.

RevenueCat variable mapping:

| Build profile | Store mode | Public SDK key | Game Backend |
|---|---|---|---|
| `development` | `native` | `EXPO_PUBLIC_REVENUECAT_API_KEY_IOS` or `EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID` | local network URL in `eas.json` |
| `development-test-store` | `test_store` | `EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY` | staging |
| `preview` | `native` | platform-specific key | staging |
| `production` | `native` | platform-specific key | production EAS environment |

Run the TypeScript checker command to ensure type compliance before pushing changes:
```bash
npm run ts:check
```
