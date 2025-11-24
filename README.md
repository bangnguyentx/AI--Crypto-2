# AI Trading Bot V3 - Ensemble Edition

A production-ready Telegram AI Trading Bot with ensemble signal detection for cryptocurrency markets.

## 🚀 Features

- **Ensemble AI Analysis**: Combines 7 different signal detectors with weighted scoring
- **TOP 10 Coin Focus**: Monitors only high-volume cryptocurrencies
- **Multi-timeframe Analysis**: Uses 1m, 15m, 1h, and 4h timeframes
- **Risk Management**: Automatic position sizing and risk calculation
- **Telegram Integration**: User-friendly bot interface with activation system
- **Multi-source Data**: Fetches data from Binance and Bybit with automatic fallback
- **Production Ready**: Docker support, health checks, and proper error handling

## 📊 Signal Detectors

The bot uses 7 specialized detectors:

1. **Momentum Breakout** - Identifies breakouts with volume confirmation
2. **VWAP Pullback** - Finds intraday pullback opportunities
3. **Volatility Squeeze** - Detects Bollinger Band breakouts
4. **Orderbook Sweep** - Analyzes market order activity
5. **Funding & OI Divergence** - Contrarian signals based on futures data
6. **Volume Spike** - Unusual volume activity detection
7. **Correlation Break** - Mean-reversion opportunities

## 🛠 Quick Start

### Prerequisites

- Node.js 18+ or Docker
- Telegram Bot Token ([Get from BotFather](https://core.telegram.org/bots#botfather))
- (Optional) Binance/Bybit API keys for enhanced data

### Local Installation

1. **Clone and setup**
```bash
git clone <repository>
cd telegram-ai-bot
cp .env.example .env
