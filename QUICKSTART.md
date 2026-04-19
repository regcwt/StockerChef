# StockerChef - Quick Start Guide

## ✅ Project Successfully Created!

Your StockerChef desktop stock dashboard application has been fully generated with all required files.

## 📁 Project Structure

```
StockerChef/
├── src/                        # All source code
│   ├── electron/               # Electron main process
│   │   ├── main.ts             # Main process with window management
│   │   └── preload.ts          # Secure IPC bridge
│   ├── hooks/                  # Custom hooks
│   │   ├── useStockQuote.ts    # Auto-polling stock quotes
│   │   └── useStockNews.ts     # News fetching with cache
│   ├── pages/                  # Page components
│   │   ├── Dashboard.tsx       # Main watchlist view
│   │   └── Analysis.tsx        # Stock detail & analysis
│   ├── services/               # API layer
│   │   └── stockApi.ts         # Finnhub integration + rate limiting
│   ├── store/                  # Zustand state
│   │   └── useStockStore.ts    # Global stock state
│   ├── styles/                 # CSS
│   │   └── global.css          # Global styles
│   ├── theme/                  # Ant Design themes
│   │   └── config.ts           # Light/dark mode config
│   ├── types/                  # TypeScript definitions
│   │   ├── index.ts            # Data types
│   │   └── electron.d.ts       # Electron API types
│   ├── utils/                  # Helpers
│   │   └── format.ts           # Formatting utilities
│   ├── App.tsx                 # Main app with routing
│   ├── main.tsx                # React entry point
│   └── vite-env.d.ts           # Vite environment types
├── index.html                  # HTML template
├── package.json                # Dependencies
├── tsconfig.json               # TypeScript config
├── vite.config.ts              # Vite + Electron config
└── README.md                   # Full documentation
```

## 🚀 Next Steps

### 1. Wait for Installation to Complete

The `npm install` command is currently running. This may take a few minutes as it downloads Electron (~150MB).

**Current status:** Installing dependencies...

### 1.5. Install Python Dependencies (Required)

The application uses Python scripts for A-share, Hong Kong, and US stock data. Install required Python packages:

```bash
# macOS: Install Python packages system-wide
python3 -m pip install --break-system-packages -r requirements.txt

# Or if you prefer virtual environments:
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
```

**Required packages:**
- `akshare` - Chinese & Hong Kong stock data
- `tushare` - A-share data (optional, requires token)
- `yfinance` - US stock historical data

### 2. Get Your Finnhub API Key (Optional)

1. Visit: https://finnhub.io/register
2. Sign up for free
3. Copy your API key from the dashboard
4. After launching the app, go to **Settings → Data Sources** and enter your key there

### 3. Start the Application

Once npm install completes:

```bash
npm run dev
```

The Electron app will launch automatically!

## 🎯 Features Implemented

✅ **Dashboard Page** (`/`)
- Watchlist display with real-time quotes
- Search and add stocks
- Auto-refresh every 10 seconds
- Delete stocks from watchlist
- Click to view analysis

✅ **Analysis Page** (`/analysis/:symbol`)
- Stock details tab (profile, market cap, etc.)
- News tab (latest stock news)
- Technical Analysis modal (simulated RSI, SMA, recommendations)

✅ **State Management**
- Zustand for global state
- Auto-save watchlist to electron-store
- Persistent across app restarts

✅ **API Integration**
- Finnhub API for real-time data
- Smart rate limiting (30 req/min)
- Request queue to prevent API overload
- Error handling and user notifications

✅ **UI/UX**
- Ant Design 5.x components
- Auto dark/light mode (follows system)
- Responsive grid layout
- Red/green color coding for stock changes

✅ **Type Safety**
- Full TypeScript coverage
- All interfaces defined (Stock, Quote, NewsItem, etc.)

## 🔧 Configuration Files Created

- **package.json**: All dependencies and scripts
- **tsconfig.json**: TypeScript configuration
- **vite.config.ts**: Vite + Electron integration
- **.gitignore**: Proper exclusions

## 📝 Important Notes

1. **API Key**: Go to **Settings → Data Sources** in the app to enter your Finnhub API key. The key is saved locally and takes effect immediately.

2. **Rate Limiting**: The app limits to 30 API calls/minute (50% of Finnhub's free tier limit) to prevent hitting limits.

3. **Simulated Analysis**: The technical analysis uses simulated data. For production, you'd need historical price data and real indicator calculations.

4. **Data Persistence**: Your watchlist is saved automatically to `~/Library/Application Support/stocker-chef/` on macOS.

## 🐛 Troubleshooting

If the app doesn't start after npm install completes:

```bash
# Clean and reinstall
rm -rf node_modules dist dist-electron
npm install

# Check Node.js version (should be 18+)
node --version
```

If you get Python script errors (e.g., "No module named 'akshare'"):
```bash
# Install Python dependencies
python3 -m pip install --break-system-packages -r requirements.txt

# Verify installation
python3 scripts/main.py --action get_indices
```

If you get GPU process crashes or network service errors (macOS):
- Already fixed in code: `app.disableHardwareAcceleration()` is enabled
- Restart the app to apply the fix

If you get "Invalid API key" errors:
- Go to **Settings → Data Sources** and enter your correct Finnhub API key
- The key takes effect immediately — no restart required

## 📚 Documentation

See [README.md](README.md) for:
- Detailed setup instructions
- API rate limiting information
- Project structure explanation
- Troubleshooting guide
- Future enhancement ideas

## 🎉 You're All Set!

Once npm install finishes, you can run:

```bash
npm run dev
```

And start tracking your favorite stocks!

---

**Questions or Issues?** Check the full README.md or refer to the original specification in `stock-chef-dev-prompt.md`.
