/**
 * Signal Detectors - Modular trading signal detection
 * FIXED: Removed all funding rate related errors
 */

const TradingUtils = require('../utils');

class SignalDetectors {
  /**
   * Momentum Breakout Detector
   */
  static momentumBreakoutDetector(data, config = {}) {
    const {
      breakoutPeriod = 20,
      volumeMultiplier = 1.5,
      minBreakoutPercent = 1.0
    } = config;

    try {
      const candles15m = data['15m'] || [];
      const candles1h = data['1h'] || [];
      
      if (candles15m.length < breakoutPeriod + 5) {
        return { score: 0, direction: 'NEUTRAL', reason: 'Insufficient data' };
      }

      const closes15m = candles15m.map(c => c.close);
      const volumes15m = candles15m.map(c => c.volume);
      const highs15m = candles15m.map(c => c.high);
      
      const currentClose = closes15m[closes15m.length - 1];
      const currentHigh = highs15m[highs15m.length - 1];
      
      const recentHigh = Math.max(...highs15m.slice(-breakoutPeriod));
      const recentLow = Math.min(...highs15m.slice(-breakoutPeriod));
      
      const volumeMA = volumes15m.slice(-breakoutPeriod).reduce((a, b) => a + b, 0) / breakoutPeriod;
      const currentVolume = volumes15m[volumes15m.length - 1];
      const volumeZScore = TradingUtils.calculateZScore(currentVolume, volumes15m.slice(-breakoutPeriod));
      
      const isBreakout = currentHigh >= recentHigh * (1 + minBreakoutPercent / 100);
      const hasVolumeSpike = volumeZScore > 1.0 && currentVolume > volumeMA * volumeMultiplier;
      
      let score = 0;
      let direction = 'NEUTRAL';
      let reason = 'No breakout detected';
      
      if (isBreakout && hasVolumeSpike) {
        const breakoutStrength = ((currentHigh - recentHigh) / recentHigh) * 100;
        const volumeStrength = Math.min(volumeZScore, 3) / 3 * 100;
        
        score = Math.min(100, (breakoutStrength * 0.6 + volumeStrength * 0.4) * 2);
        direction = 'LONG';
        reason = `Breakout: +${breakoutStrength.toFixed(2)}% with volume spike (z: ${volumeZScore.toFixed(2)})`;
      } else if (currentClose < recentLow * 0.99 && hasVolumeSpike) {
        const breakdownStrength = ((recentLow - currentClose) / recentLow) * 100;
        score = Math.min(100, breakdownStrength * 1.5);
        direction = 'SHORT';
        reason = `Breakdown: -${breakdownStrength.toFixed(2)}% with volume spike`;
      }

      return {
        name: 'momentum_breakout',
        score: Math.round(score),
        direction,
        reason,
        metadata: {
          recentHigh,
          recentLow,
          volumeZScore,
          breakoutStrength: isBreakout ? ((currentHigh - recentHigh) / recentHigh) * 100 : 0
        }
      };
    } catch (error) {
      return { name: 'momentum_breakout', score: 0, direction: 'NEUTRAL', reason: `Error: ${error.message}` };
    }
  }

  /**
   * VWAP Pullback Detector
   */
  static vwapPullbackDetector(data, config = {}) {
    const { vwapDelta = 0.002, volumeUptick = 1.2 } = config;

    try {
      const candles1m = data['1m'] || [];
      const candles15m = data['15m'] || [];
      
      if (candles1m.length < 50 || candles15m.length < 20) {
        return { score: 0, direction: 'NEUTRAL', reason: 'Insufficient data' };
      }

      const currentCandle1m = candles1m[candles1m.length - 1];
      const currentCandle15m = candles15m[candles15m.length - 1];
      
      const vwap = TradingUtils.calculateVWAP(candles1m.slice(-50));
      const currentPrice = currentCandle1m.close;
      
      const isAboveVWAP = currentPrice > vwap;
      const isNearVWAP = Math.abs(currentPrice - vwap) / vwap <= vwapDelta;
      
      const isBullishReversal = currentCandle1m.close > currentCandle1m.open && 
                               currentCandle1m.close > (currentCandle1m.high + currentCandle1m.low) / 2;
      
      const recentVolumes = candles1m.slice(-10).map(c => c.volume);
      const currentVolume = currentCandle1m.volume;
      const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
      const hasVolumeUptick = currentVolume > avgVolume * volumeUptick;
      
      let score = 0;
      let direction = 'NEUTRAL';
      let reason = 'No VWAP pullback setup';
      
      if (isAboveVWAP && isNearVWAP && isBullishReversal && hasVolumeUptick) {
        const vwapDistance = ((currentPrice - vwap) / vwap) * 100;
        const volumeStrength = Math.min(currentVolume / avgVolume, 3) / 3 * 100;
        const reversalStrength = ((currentCandle1m.close - currentCandle1m.open) / currentCandle1m.open) * 10000;
        
        score = Math.min(100, Math.abs(vwapDistance) * 20 + volumeStrength * 0.3 + reversalStrength * 2);
        direction = 'LONG';
        reason = `VWAP pullback: ${vwapDistance.toFixed(3)}% distance, volume ${(currentVolume/avgVolume).toFixed(1)}x`;
      }

      return {
        name: 'vwap_pullback',
        score: Math.round(score),
        direction,
        reason,
        metadata: {
          vwap,
          currentPrice,
          vwapDistance: ((currentPrice - vwap) / vwap) * 100,
          volumeRatio: currentVolume / avgVolume
        }
      };
    } catch (error) {
      return { name: 'vwap_pullback', score: 0, direction: 'NEUTRAL', reason: `Error: ${error.message}` };
    }
  }

  /**
   * Volatility Squeeze Detector
   */
  static volatilitySqueezeDetector(data, config = {}) {
    const { bbPeriod = 20, bbStdDev = 2, squeezePercentile = 10 } = config;

    try {
      const candles15m = data['15m'] || [];
      const candles1h = data['1h'] || [];
      
      if (candles15m.length < bbPeriod + 10) {
        return { score: 0, direction: 'NEUTRAL', reason: 'Insufficient data' };
      }

      const closes15m = candles15m.map(c => c.close);
      const bb = TradingUtils.calculateBollingerBands(closes15m, bbPeriod, bbStdDev);
      
      if (!bb) {
        return { score: 0, direction: 'NEUTRAL', reason: 'Cannot calculate Bollinger Bands' };
      }

      const bbWidth = (bb.upper - bb.lower) / bb.middle;
      
      const historicalWidths = [];
      for (let i = bbPeriod; i < closes15m.length; i++) {
        const slice = closes15m.slice(i - bbPeriod, i);
        const historicalBB = TradingUtils.calculateBollingerBands(slice, bbPeriod, bbStdDev);
        if (historicalBB) {
          historicalWidths.push((historicalBB.upper - historicalBB.lower) / historicalBB.middle);
        }
      }
      
      const sortedWidths = [...historicalWidths].sort((a, b) => a - b);
      const percentileIndex = Math.floor(sortedWidths.length * squeezePercentile / 100);
      const lowPercentileWidth = sortedWidths[percentileIndex] || 0;
      
      const isSqueeze = bbWidth <= lowPercentileWidth;
      const currentPrice = closes15m[closes15m.length - 1];
      
      const isAboveUpper = currentPrice > bb.upper;
      const isBelowLower = currentPrice < bb.lower;
      
      const volumes = candles15m.map(c => c.volume);
      const currentVolume = volumes[volumes.length - 1];
      const volumeZScore = TradingUtils.calculateZScore(currentVolume, volumes.slice(-20));
      
      let score = 0;
      let direction = 'NEUTRAL';
      let reason = 'No volatility squeeze setup';
      
      if (isSqueeze && (isAboveUpper || isBelowLower) && volumeZScore > 0.5) {
        const squeezeStrength = (lowPercentileWidth - bbWidth) / lowPercentileWidth * 100;
        const volumeStrength = Math.min(volumeZScore, 3) / 3 * 100;
        
        score = Math.min(100, squeezeStrength * 0.5 + volumeStrength * 0.5);
        direction = isAboveUpper ? 'LONG' : 'SHORT';
        reason = `Volatility squeeze breakout: ${direction} with volume z-score ${volumeZScore.toFixed(2)}`;
      }

      return {
        name: 'volatility_squeeze',
        score: Math.round(score),
        direction,
        reason,
        metadata: {
          bbWidth,
          lowPercentileWidth,
          squeezeStrength: isSqueeze ? (lowPercentileWidth - bbWidth) / lowPercentileWidth * 100 : 0,
          volumeZScore
        }
      };
    } catch (error) {
      return { name: 'volatility_squeeze', score: 0, direction: 'NEUTRAL', reason: `Error: ${error.message}` };
    }
  }

  /**
   * Orderbook Sweep Detector - SIMPLIFIED VERSION
   */
  static orderbookSweepDetector(data, config = {}) {
    try {
      const orderbook = data.orderbook;
      if (!orderbook) {
        return { score: 0, direction: 'NEUTRAL', reason: 'No orderbook data' };
      }

      const { bids, asks, volumeImbalance } = orderbook;
      
      if (!bids || !asks || bids.length === 0 || asks.length === 0) {
        return { score: 0, direction: 'NEUTRAL', reason: 'Invalid orderbook data' };
      }

      const bidVolume = bids.slice(0, 3).reduce((sum, [price, volume]) => sum + volume, 0);
      const askVolume = asks.slice(0, 3).reduce((sum, [price, volume]) => sum + volume, 0);
      
      let score = 0;
      let direction = 'NEUTRAL';
      let reason = 'No significant orderbook imbalance';
      
      const imbalance = (bidVolume - askVolume) / (bidVolume + askVolume);
      
      if (imbalance > 0.3) {
        score = Math.min(100, imbalance * 150);
        direction = 'LONG';
        reason = `Strong buy pressure: ${(imbalance * 100).toFixed(1)}% imbalance`;
      } else if (imbalance < -0.3) {
        score = Math.min(100, Math.abs(imbalance) * 150);
        direction = 'SHORT';
        reason = `Strong sell pressure: ${(Math.abs(imbalance) * 100).toFixed(1)}% imbalance`;
      }

      return {
        name: 'orderbook_sweep',
        score: Math.round(score),
        direction,
        reason,
        metadata: {
          bidVolume,
          askVolume,
          volumeImbalance: imbalance
        }
      };
    } catch (error) {
      return { name: 'orderbook_sweep', score: 0, direction: 'NEUTRAL', reason: `Error: ${error.message}` };
    }
  }

  /**
   * Volume Spike Detector
   */
  static volumeSpikeDetector(data, config = {}) {
    const { volumeZScoreThreshold = 2.0 } = config;

    try {
      const candles15m = data['15m'] || [];
      
      if (candles15m.length < 20) {
        return { score: 0, direction: 'NEUTRAL', reason: 'Insufficient data' };
      }

      const volumes = candles15m.map(c => c.volume);
      const closes = candles15m.map(c => c.close);
      const currentVolume = volumes[volumes.length - 1];
      const currentClose = closes[closes.length - 1];
      const prevClose = closes[closes.length - 2];
      
      const volumeZScore = TradingUtils.calculateZScore(currentVolume, volumes.slice(-20));
      
      const priceChange = (currentClose - prevClose) / prevClose * 100;
      const isBullishCandle = currentClose > prevClose;
      const isBearishCandle = currentClose < prevClose;
      
      let score = 0;
      let direction = 'NEUTRAL';
      let reason = 'No significant volume spike';
      
      if (volumeZScore > volumeZScoreThreshold) {
        if (isBullishCandle) {
          score = Math.min(100, volumeZScore * 20 + Math.max(priceChange, 0) * 10);
          direction = 'LONG';
          reason = `Bullish volume spike: z-score ${volumeZScore.toFixed(2)}, price +${priceChange.toFixed(2)}%`;
        } else if (isBearishCandle) {
          score = Math.min(100, volumeZScore * 20 + Math.max(Math.abs(priceChange), 0) * 10);
          direction = 'SHORT';
          reason = `Bearish volume spike: z-score ${volumeZScore.toFixed(2)}, price ${priceChange.toFixed(2)}%`;
        } else {
          reason = `Volume spike (z: ${volumeZScore.toFixed(2)}) but no clear direction`;
        }
      }

      return {
        name: 'volume_spike',
        score: Math.round(score),
        direction,
        reason,
        metadata: {
          volumeZScore,
          priceChange,
          currentVolume
        }
      };
    } catch (error) {
      return { name: 'volume_spike', score: 0, direction: 'NEUTRAL', reason: `Error: ${error.message}` };
    }
  }

  /**
   * RSI Momentum Detector - REPLACES Funding OI Detector
   */
  static rsiMomentumDetector(data, config = {}) {
    const { rsiOverbought = 70, rsiOversold = 30 } = config;

    try {
      const candles15m = data['15m'] || [];
      const candles1h = data['1h'] || [];
      
      if (candles15m.length < 15 || candles1h.length < 15) {
        return { score: 0, direction: 'NEUTRAL', reason: 'Insufficient data' };
      }

      const closes15m = candles15m.map(c => c.close);
      const closes1h = candles1h.map(c => c.close);
      
      const rsi15m = TradingUtils.calculateRSI(closes15m, 14);
      const rsi1h = TradingUtils.calculateRSI(closes1h, 14);
      
      let score = 0;
      let direction = 'NEUTRAL';
      let reason = 'RSI in neutral zone';
      
      if (rsi15m < rsiOversold && rsi1h < rsiOversold) {
        score = Math.min(100, (rsiOversold - rsi15m) * 3);
        direction = 'LONG';
        reason = `Oversold: RSI15m ${rsi15m.toFixed(1)}, RSI1h ${rsi1h.toFixed(1)}`;
      } else if (rsi15m > rsiOverbought && rsi1h > rsiOverbought) {
        score = Math.min(100, (rsi15m - rsiOverbought) * 3);
        direction = 'SHORT';
        reason = `Overbought: RSI15m ${rsi15m.toFixed(1)}, RSI1h ${rsi1h.toFixed(1)}`;
      }

      return {
        name: 'rsi_momentum',
        score: Math.round(score),
        direction,
        reason,
        metadata: {
          rsi15m,
          rsi1h
        }
      };
    } catch (error) {
      return { name: 'rsi_momentum', score: 0, direction: 'NEUTRAL', reason: `Error: ${error.message}` };
    }
  }

  /**
   * Correlation Break Detector - SIMPLIFIED
   */
  static correlationBreakDetector(data, config = {}) {
    try {
      const candles1h = data['1h'] || [];
      
      if (candles1h.length < 10) {
        return { score: 0, direction: 'NEUTRAL', reason: 'Insufficient data for correlation analysis' };
      }

      const priceChanges = [];
      for (let i = 1; i < candles1h.length; i++) {
        const change = (candles1h[i].close - candles1h[i-1].close) / candles1h[i-1].close;
        priceChanges.push(change);
      }
      
      const recentVolatility = Math.std(priceChanges.slice(-5)) * 100;
      const historicalVolatility = Math.std(priceChanges) * 100;
      
      let score = 0;
      let direction = 'NEUTRAL';
      let reason = 'Normal volatility';
      
      if (recentVolatility > historicalVolatility * 2) {
        score = Math.min(100, (recentVolatility / historicalVolatility) * 25);
        direction = Math.random() > 0.5 ? 'LONG' : 'SHORT';
        reason = `High volatility spike: ${recentVolatility.toFixed(2)}% vs avg ${historicalVolatility.toFixed(2)}%`;
      }

      return {
        name: 'correlation_break',
        score: Math.round(score),
        direction,
        reason,
        metadata: {
          recentVolatility,
          historicalVolatility
        }
      };
    } catch (error) {
      return { name: 'correlation_break', score: 0, direction: 'NEUTRAL', reason: `Error: ${error.message}` };
    }
  }

  /**
   * Run all detectors and return results - UPDATED
   */
  static async runAllDetectors(data, config = {}) {
    const detectors = [
      { fn: this.momentumBreakoutDetector, weight: 1.2 },
      { fn: this.vwapPullbackDetector, weight: 1.1 },
      { fn: this.volatilitySqueezeDetector, weight: 1.0 },
      { fn: this.orderbookSweepDetector, weight: 0.9 },
      { fn: this.rsiMomentumDetector, weight: 1.0 }, // REPLACED funding detector
      { fn: this.volumeSpikeDetector, weight: 1.0 },
      { fn: this.correlationBreakDetector, weight: 0.7 }
    ];

    const results = [];
    
    for (const detector of detectors) {
      try {
        const result = detector.fn(data, config);
        results.push({
          ...result,
          weight: detector.weight
        });
      } catch (error) {
        results.push({
          name: detector.fn.name.replace('Detector', '').toLowerCase(),
          score: 0,
          direction: 'NEUTRAL',
          reason: `Detector error: ${error.message}`,
          weight: detector.weight
        });
      }
    }
    
    return results;
  }
}

// Add missing Math.std function
Math.std = function(arr) {
  if (!arr || arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / arr.length);
};

module.exports = SignalDetectors;
