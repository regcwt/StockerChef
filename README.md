# StockerChef - Desktop Stock Dashboard

A macOS desktop stock dashboard application built with Electron + React + Vite + TypeScript + Ant Design.

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## Features

- 📊 **Real-time Stock Quotes** - Monitor your favorite stocks with auto-refreshing prices
- 📈 **Technical Analysis** - View simulated RSI, SMA indicators and buy/sell recommendations
- 📰 **Stock News** - Stay updated with the latest news for each stock
- 💾 **Local Persistence** - Your watchlist is saved automatically using electron-store
- 🌓 **Dark/Light Mode** - Automatically follows your system theme preference
- ⚡ **Rate Limiting** - Smart request queue to respect API limits
- 🎨 **Modern UI** - Beautiful interface powered by Ant Design 5.x

## Tech Stack

- **Framework**: Electron 28.x
- **Frontend**: React 18 + TypeScript
- **Build Tool**: Vite 5.x
- **UI Components**: Ant Design 5.x
- **State Management**: Zustand 4.x
- **HTTP Client**: Axios
- **Routing**: React Router v6
- **Local Storage**: electron-store
- **Stock API**: Finnhub (free tier)

## Prerequisites

- Node.js 18.x or higher
- npm or yarn

## Getting Started

### 1. Clone the Repository

```bash
git clone <repository-url>
cd StockerChef
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Get Finnhub API Key

This application uses [Finnhub](https://finnhub.io/) for real-time stock data. You need to get a free API key:

1. Visit [https://finnhub.io/register](https://finnhub.io/register)
2. Sign up for a free account
3. Go to your dashboard at [https://finnhub.io/dashboard](https://finnhub.io/dashboard)
4. Copy your API key from the "API Key" section

**Free Tier Limits:**
- 60 API calls per minute
- Real-time US stock quotes
- Company news (up to 1 year)
- Company profiles

### 4. Configure Environment Variables

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit `.env` and add your Finnhub API key:

```env
VITE_STOCK_API_KEY=your_finnhub_api_key_here
```

### 5. Run the Application

```bash
npm run dev
```

This will start the Vite development server and launch the Electron app.

## Development Commands

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Preview production build (web only)
npm run preview
```

## Project Structure

```
StockerChef/
├── src/                     # All source code
│   ├── electron/            # Electron main process files
│   │   ├── main.ts          # Main Electron process
│   │   └── preload.ts       # Preload script for IPC
│   ├── components/          # Reusable UI components
│   ├── hooks/               # Custom React hooks
│   │   ├── useStockQuote.ts # Stock quote polling hook
│   │   └── useStockNews.ts  # Stock news fetching hook
│   ├── pages/               # Page components
│   │   ├── Dashboard.tsx    # Main watchlist dashboard
│   │   └── Analysis.tsx     # Stock analysis page
│   ├── services/            # API service layer
│   │   └── stockApi.ts      # Finnhub API integration
│   ├── store/               # Zustand state management
│   │   └── useStockStore.ts # Global stock state
│   ├── styles/              # Global styles
│   │   └── global.css       # CSS utilities
│   ├── theme/               # Ant Design theme config
│   │   └── config.ts        # Light/dark themes
│   ├── types/               # TypeScript type definitions
│   │   ├── index.ts         # Data types
│   │   └── electron.d.ts    # Electron API types
│   ├── utils/               # Utility functions
│   │   └── format.ts        # Formatting helpers
│   ├── App.tsx              # Main App component
│   ├── main.tsx             # React entry point
│   └── vite-env.d.ts        # Vite environment types
├── resources/               # Application resources
│   └── icon.png             # Application icon (512x512 recommended)
├── index.html               # HTML template
├── package.json             # Project dependencies
├── tsconfig.json            # TypeScript configuration
├── vite.config.ts           # Vite configuration
├── .env.example             # Environment variables template
└── README.md                # This file
```

## Usage

### Adding Stocks to Watchlist

1. On the dashboard page, use the search bar at the top
2. Type a stock symbol (e.g., AAPL, TSLA, MSFT)
3. Click on a search result or press Enter to add it
4. The stock will appear in your watchlist with real-time pricing

### Viewing Stock Analysis

1. Click on any stock card in the dashboard
2. You'll be taken to the analysis page
3. Browse between "Details" and "News" tabs
4. Click "Technical Analysis" button for indicators

### Removing Stocks

- Click the delete icon (trash) on any stock card to remove it from your watchlist

## API Rate Limiting

The application implements client-side rate limiting to respect Finnhub's free tier limits:

- **Maximum requests**: 30 per minute (50% of the 60/min limit)
- **Request queuing**: All API calls go through a queue with 2-second intervals
- **Automatic backoff**: When rate limit is hit, the app pauses and notifies you
- **Caching**: News data is cached for 5 minutes to reduce API calls

If you encounter rate limit errors:
1. Wait 1-2 minutes before refreshing
2. Reduce the number of stocks in your watchlist
3. Consider upgrading to Finnhub's paid tier for higher limits

## Data Persistence

Your watchlist is automatically saved to local storage using `electron-store`. The data persists between app sessions and is stored in:

- **macOS**: `~/Library/Application Support/stocker-chef/`

## Troubleshooting

### "Invalid API key" error
- Make sure you've created a `.env` file with your Finnhub API key
- Verify the key is correct by testing it on Finnhub's website

### "Rate limit exceeded" error
- You've made too many requests in a short time
- Wait 1-2 minutes and try again
- Consider reducing your watchlist size

### App won't start
- Make sure all dependencies are installed: `npm install`
- Check that Node.js version is 18.x or higher
- Clear the cache: `rm -rf node_modules dist dist-electron && npm install`

### Stock data not loading
- Check your internet connection
- Verify your API key is valid
- Check the browser console for error messages (DevTools opens automatically in dev mode)

## Building for Production

To create a distributable macOS app:

```bash
npm run build
```

This will create a `.dmg` file in the `dist` folder that you can distribute.

### Application Icon

The application uses `resources/icon.png` as its icon. The icon is configured for:
- **macOS app icon**: Displayed in Finder and Dock
- **DMG installer icon**: Shown in the installation dialog
- **Window icon**: Used during development

**Icon Requirements:**
- Format: PNG
- Recommended size: 512x512 pixels (or 1024x1024 for best quality)
- The icon at `resources/icon.png` is already configured and ready to use

To replace the icon, simply replace `resources/icon.png` with your own icon file (keep the same filename).

## Customization

### Changing the Update Interval

Edit `src/pages/Dashboard.tsx` and modify the interval in this line:

```typescript
const interval = setInterval(fetchAllQuotes, 10000); // 10 seconds
```

### Adjusting Rate Limits

Edit `src/services/stockApi.ts`:

```typescript
const MAX_REQUESTS_PER_MINUTE = 30; // Change this value
```

## Future Enhancements

- [ ] WebSocket support for real-time updates
- [ ] Historical price charts
- [ ] Portfolio tracking
- [ ] Price alerts
- [ ] Multiple watchlists
- [ ] Export data to CSV
- [ ] A股 (Chinese stock market) support

## License

MIT License - feel free to use this project for personal or commercial purposes.

## Acknowledgments

- [Finnhub](https://finnhub.io/) for providing free stock market data API
- [Ant Design](https://ant.design/) for the beautiful UI components
- [Electron](https://www.electronjs.org/) for the desktop framework

---

**Note**: This is a demonstration application. The technical analysis features use simulated data. For production use, implement proper historical data fetching and real indicator calculations.
