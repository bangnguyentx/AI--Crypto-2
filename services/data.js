/**
 * Data service for fetching market data from multiple sources
 */

const axios = require('axios');
const ccxt = require('ccxt');
const Bottleneck = require('bottleneck');
const winston = require('winston');

// Configure logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Rate limiter: 10 requests per second
const limiter = new Bottleneck({
  minTime: 100, // 10 requests per second
  maxConcurrent: 5
});

class DataService {
  constructor() {
    this.binance = new ccxt.binance({
      enableRateLimit: true,
      rateLimit: 100
    });
    
    this.bybit = new ccxt.bybit({
      enableRateLimit: true
    });
    
    this.sources = [this.binance, this.bybit];
    this.currentSourceIndex = 0;
  }

  /**
   * Get current active data source with fallback
   */
  async getActiveSource() {
    for (let i = 0; i < this.sources.length; i++) {
      const sourceIndex = (this.currentSourceIndex + i) % this.sources.length;
      const source = this.sources[sourceIndex];
      
      try {
        // Test connection by fetching time
        await source.fetchTime();
        this.currentSourceIndex = sourceIndex;
        return source;
      } catch (error) {
        logger.warn(`Source ${source.name} failed: ${error.message}`);
        continue;
      }
    }
    
    throw new Error('All data sources are unavailable');
  }

  /**
   * Fetch OHLCV data with retry logic
   */
  async fetchOHLCV(symbol, timeframe = '15m', limit = 100) {
    return limiter.schedule(async () => {
      const source = await this.getActiveSource();
      
      try {
        const ohlcv = await source.fetchOHLCV(symbol, timeframe, undefined, limit);
        
        return ohlcv.map(data => ({
          timestamp: data[0],
          open: data[1],
          high: data[2],
          low: data[3],
          close: data[4],
          volume: data[5],
          timeframe: timeframe
        }));
      } catch (error) {
        logger.error(`Failed to fetch OHLCV for ${symbol}: ${error.message}`);
        throw error;
      }
    });
  }

  /**
   * Fetch order book data
   */
  async fetchOrderBook(symbol, limit = 50) {
    return limiter.schedule(async () => {
      const source = await this.getActiveSource();
      
      try {
        const orderbook = await source.fetchOrderBook(symbol, limit);
        
        // Calculate weighted mid price and depth
        const bids = orderbook.bids.slice(0, 10);
        const asks = orderbook.asks.slice(0, 10);
        
        const bidVolume = bids.reduce((sum, [price, volume]) => sum + volume, 0);
        const askVolume = asks.reduce((sum, [price, volume]) => sum + volume, 0);
        
        const bidWeightedPrice = bids.reduce((sum, [price, volume]) => sum + price * volume, 0) / bidVolume;
        const askWeightedPrice = asks.reduce((sum, [price, volume]) => sum + price * volume, 0) / askVolume;
        
        return {
          symbol,
          bids: orderbook.bids.slice(0, limit),
          asks: orderbook.asks.slice(0, limit),
          bidVolume,
          askVolume,
          volumeImbalance: (bidVolume - askVolume) / (bidVolume + askVolume),
          weightedMidPrice: (bidWeightedPrice + askWeightedPrice) / 2,
          spread: (askWeightedPrice - bidWeightedPrice) / bidWeightedPrice * 100,
          timestamp: orderbook.timestamp
        };
      } catch (error) {
        logger.error(`Failed to fetch orderbook for ${symbol}: ${error.message}`);
        throw error;
      }
    });
  }

  /**
   * Fetch funding rate and open interest
   */
async fetchFundingAndOI(symbol) {
  return limiter.schedule(async () => {
    try {
      const source = await this.getActiveSource();
      
      let fundingRate = 0;
      let openInterest = 0;
      
      // Convert symbol to futures format correctly
      // BTCUSDT -> BTC/USDT for funding rate
      const futuresSymbol = symbol.replace(/(.*)(USDT)$/, '$1/USDT');
      
      // Check if exchange supports funding rate
      if (source.has['fetchFundingRate']) {
        try {
          const funding = await source.fetchFundingRate(futuresSymbol);
          fundingRate = funding.fundingRate * 100; // Convert to percentage
          logger.debug(`Fetched funding rate for ${symbol}: ${fundingRate}%`);
        } catch (error) {
          // Suppress warning for known unsupported symbols
          if (!error.message.includes('not found') && !error.message.includes('invalid symbol')) {
            logger.warn(`Could not fetch funding rate for ${symbol}: ${error.message}`);
          }
        }
      }
      
      // Check if exchange supports open interest
      if (source.has['fetchOpenInterest']) {
        try {
          const oi = await source.fetchOpenInterest(futuresSymbol);
          openInterest = oi.openInterest;
          logger.debug(`Fetched open interest for ${symbol}: ${openInterest}`);
        } catch (error) {
          // Suppress warning for known unsupported symbols
          if (!error.message.includes('not found') && !error.message.includes('invalid symbol')) {
            logger.warn(`Could not fetch open interest for ${symbol}: ${error.message}`);
          }
        }
      }
      
      return {
        symbol,
        fundingRate,
        openInterest,
        timestamp: Date.now()
      };
    } catch (error) {
      // Return default values without logging error
      return {
        symbol,
        fundingRate: 0,
        openInterest: 0,
        timestamp: Date.now()
      };
    }
  });
}

  /**
   * Fetch ticker data for correlation analysis
   */
  async fetchTicker(symbol) {
    return limiter.schedule(async () => {
      const source = await this.getActiveSource();
      
      try {
        const ticker = await source.fetchTicker(symbol);
        return {
          symbol,
          last: ticker.last,
          bid: ticker.bid,
          ask: ticker.ask,
          baseVolume: ticker.baseVolume,
          quoteVolume: ticker.quoteVolume,
          change: ticker.change,
          percentage: ticker.percentage,
          timestamp: ticker.timestamp
        };
      } catch (error) {
        logger.error(`Failed to fetch ticker for ${symbol}: ${error.message}`);
        throw error;
      }
    });
  }

  /**
   * Fetch multiple timeframes data for a symbol
   */
  async fetchMultiTimeframeData(symbol) {
    try {
      const timeframes = ['1m', '15m', '1h', '4h'];
      const data = {};
      
      for (const tf of timeframes) {
        try {
          data[tf] = await this.fetchOHLCV(symbol, tf, 100);
          // Add delay between requests to respect rate limits
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
          logger.warn(`Failed to fetch ${tf} data for ${symbol}: ${error.message}`);
          data[tf] = [];
        }
      }
      
      // Fetch additional market data
      data.orderbook = await this.fetchOrderBook(symbol);
      data.fundingOI = await this.fetchFundingAndOI(symbol);
      data.ticker = await this.fetchTicker(symbol);
      
      return data;
    } catch (error) {
      logger.error(`Failed to fetch multi-timeframe data for ${symbol}: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new DataService();
