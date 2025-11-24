/**
 * Signal Detectors - Modular trading signal detection
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

      // Get recent closes and volumes
      const closes15m = candles15m.map(c => c.close);
      const volumes15m = candles15m.map(c => c.volume);
      const highs15m = candles15m.map(c => c.high);
      
      const currentClose = closes15m[closes15m.length - 1];
      const currentHigh = highs15m[highs15m.length - 1];
      
      // Calculate resistance level (recent high)
      const recentHigh = Math.max(...highs15m.slice(-breakoutPeriod));
      const recentLow = Math.min(...highs15m.slice(-breakoutPeriod));
      
      // Calculate volume MA and current volume z-score
      const volumeMA = volumes15m.slice(-breakoutPeriod).reduce((a, b) => a + b, 0) / breakoutPeriod;
      const currentVolume = volumes15m[volumes15m.length - 1];
      const volumeZScore = TradingUtils.calculateZScore(currentVolume, volumes15m.slice(-breakoutPeriod));
      
      // Check for breakout
      const isBreakout = currentHigh >= recentHigh * (1 + minBreakoutPercent / 100);
      const hasVolumeSpike = volumeZScore > 1.0 && currentVolume > volumeMA * volumeMultiplier;
      
      let score = 0;
      let direction = 'NEUTRAL';
      let reason = 'No breakout detected';
      
      if (isBreakout && hasVolumeSpike) {
        // Calculate breakout strength
        const breakoutStrength = ((currentHigh - recentHigh) / recentHigh) * 100;
        const volumeStrength = Math.min(volumeZScore, 3) / 3 * 100;
        
        score = Math.min(100, (breakoutStrength * 0.6 + volumeStrength * 0.4) * 2);
        direction = 'LONG';
        reason = `Breakout: +${breakoutStrength.toFixed(2)}% with volume spike (z: ${volumeZScore.toFixed(2)})`;
      } else if (currentClose < recentLow * 0.99 && hasVolumeSpike) {
        // Breakdown case
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
      
      // Calculate VWAP for last 50 1m candles
      const vwap = TradingUtils.calculateVWAP(candles1m.slice(-50));
      const currentPrice = currentCandle1m.close;
      
      // Check if price is above VWAP and pulled back to VWAP zone
      const isAboveVWAP = currentPrice > vwap;
      const isNearVWAP = Math.abs(currentPrice - vwap) / vwap <= vwapDelta;
      
      // Check for bullish reversal candle
      const isBullishReversal = currentCandle1m.close > currentCandle1m.open && 
                               currentCandle1m.close > (currentCandle1m.high + currentCandle1m.low) / 2;
      
      // Volume analysis
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
        const reversalStrength = ((currentCandle1m.close - currentCandle1m.open) / currentCandle1m.open) * 10000; // in basis points
        
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

      // Calculate BB width as percentage of price
      const bbWidth = (bb.upper - bb.lower) / bb.middle;
      
      // Calculate historical BB widths for percentile comparison
      const historicalWidths = [];
      for (let i = bbPeriod; i < closes15m.length; i++) {
        const slice = closes15m.slice(i - bbPeriod, i);
        const historicalBB = TradingUtils.calculateBollingerBands(slice, bbPeriod, bbStdDev);
        if (historicalBB) {
          historicalWidths.push((historicalBB.upper - historicalBB.lower) / historicalBB.middle);
        }
      }
      
      // Check if current BB width is in low percentile (squeeze)
      const sortedWidths = [...historicalWidths].sort((a, b) => a - b);
      const percentileIndex = Math.floor(sortedWidths.length * squeezePercentile / 100);
      const lowPercentileWidth = sortedWidths[percentileIndex] || 0;
      
      const isSqueeze = bbWidth <= lowPercentileWidth;
      const currentPrice = closes15m[closes15m.length - 1];
      
      // Check for breakout from squeeze
      const isAboveUpper = currentPrice > bb.upper;
      const isBelowLower = currentPrice < bb.lower;
      
      // Volume confirmation
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
   * Orderbook Sweep Detector
   */
  static orderbookSweepDetector(data, config = {}) {
    const { levelsThreshold = 3, sizeThreshold = 50000 } = config;

    try {
      const orderbook = data.orderbook;
      if (!orderbook) {
        return { score: 0, direction: 'NEUTRAL', reason: 'No orderbook data' };
      }

      const { bids, asks, volumeImbalance, spread } = orderbook;
      
      // Detect large market orders (sweeps)
      let bidSweep = false;
      let askSweep = false;
      
      // Check if top bid levels were removed (large sell market order)
      if (bids.length >= levelsThreshold) {
        const topBidSize = bids[0][1];
        bidSweep = topBidSize > sizeThreshold;
      }
      
      // Check if top ask levels were removed (large buy market order)
      if (asks.length >= levelsThreshold) {
        const topAskSize = asks[0][1];
        askSweep = topAskSize > sizeThreshold;
      }
      
      let score = 0;
      let direction = 'NEUTRAL';
      let reason = 'No significant orderbook sweeps';
      
      // Context: Sweeps often indicate exhaustion moves
      // Large sell sweep might indicate bottom (contrarian LONG)
      // Large buy sweep might indicate top (contrarian SHORT)
      
      if (bidSweep && !askSweep) {
        // Large sell sweep - potential buying opportunity
        score = Math.min(100, (bids[0][1] / sizeThreshold) * 20);
        direction = 'LONG';
        reason = `Large sell sweep detected: ${bids[0][1].toFixed(0)} units`;
      } else if (askSweep && !bidSweep) {
        // Large buy sweep - potential selling opportunity
        score = Math.min(100, (asks[0][1] / sizeThreshold) * 20);
        direction = 'SHORT';
        reason = `Large buy sweep detected: ${asks[0][1].toFixed(0)} units`;
      } else if (bidSweep && askSweep) {
        // Both sides swept - high volatility, neutral
        reason = 'Both sides swept - high volatility';
      }

      return {
        name: 'orderbook_sweep',
        score: Math.round(score),
        direction,
        reason,
        metadata: {
          bidSweepSize: bidSweep ? bids[0][1] : 0,
          askSweepSize: askSweep ? asks[0][1] : 0,
          volumeImbalance,
          spread: spread * 100 // Convert to percentage
        }
      };
    } catch (error) {
      return { name: 'orderbook_sweep', score: 0, direction: 'NEUTRAL', reason: `Error: ${error.message}` };
    }
  }

  /**
   * Funding & OI Divergence Detector
   */
  static fundingOIDivergenceDetector(data, config = {}) {
    const { fundingThreshold = 0.01, oiSpikeThreshold = 1.5 } = config;

    try {
      const fundingOI = data.fundingOI;
      const candles1h = data['1h'] || [];
      
      if (!fundingOI || candles1h.length < 24) {
        return { score: 0, direction: 'NEUTRAL', reason: 'Insufficient funding/OI data' };
      }

      const { fundingRate, openInterest } = fundingOI;
      const currentPrice = candles1h[candles1h.length - 1].close;
      const price24hAgo = candles1h[candles1h.length - 24].close;
      const priceChange = (currentPrice - price24hAgo) / price24hAgo * 100;
      
      // Check for extreme funding rates
      const isHighFunding = fundingRate > fundingThreshold;
      const isLowFunding = fundingRate < -fundingThreshold;
      
      // Check OI spike (simplified - would need historical OI data for better analysis)
      const isOIHigh = openInterest > 0; // Placeholder - would need baseline
      
      let score = 0;
      let direction = 'NEUTRAL';
      let reason = 'No funding/OI divergence';
      
      // Contrarian logic: high funding + price up → potential short
      if (isHighFunding && priceChange > 2) {
        score = Math.min(100, Math.abs(fundingRate) * 1000 + Math.min(priceChange, 10) * 5);
        direction = 'SHORT';
        reason = `High funding (${fundingRate.toFixed(4)}%) with price up ${priceChange.toFixed(2)}%`;
      }
      // Low funding + price down → potential long
      else if (isLowFunding && priceChange < -2) {
        score = Math.min(100, Math.abs(fundingRate) * 1000 + Math.min(Math.abs(priceChange), 10) * 5);
        direction = 'LONG';
        reason = `Low funding (${fundingRate.toFixed(4)}%) with price down ${Math.abs(priceChange).toFixed(2)}%`;
      }

      return {
        name: 'funding_oi_divergence',
        score: Math.round(score),
        direction,
        reason,
        metadata: {
          fundingRate,
          openInterest,
          priceChange24h: priceChange
        }
      };
    } catch (error) {
      return { name: 'funding_oi_divergence', score: 0, direction: 'NEUTRAL', reason: `Error: ${error.message}` };
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
      
      // Calculate volume z-score
      const volumeZScore = TradingUtils.calculateZScore(currentVolume, volumes.slice(-20));
      
      // Check for directional candle
      const priceChange = (currentClose - prevClose) / prevClose * 100;
      const isBullishCandle = currentClose > prevClose && currentClose > (candles15m[candles15m.length - 1].high + candles15m[candles15m.length - 1].low) / 2;
      const isBearishCandle = currentClose < prevClose && currentClose < (candles15m[candles15m.length - 1].high + candles15m[candles15m.length - 1].low) / 2;
      
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
          currentVolume,
          avgVolume: volumes.slice(-20).reduce((a, b) => a + b, 0) / 20
        }
      };
    } catch (error) {
      return { name: 'volume_spike', score: 0, direction: 'NEUTRAL', reason: `Error: ${error.message}` };
    }
  }

  /**
   * Correlation Break Detector
   */
  static correlationBreakDetector(data, config = {}) {
    const { correlationThreshold = 0.7, lookbackPeriod = 24 } = config;

    try {
      // This would require BTC and ETH data for comparison
      // For simplicity, we'll use a placeholder implementation
      const candles1h = data['1h'] || [];
      
      if (candles1h.length < lookbackPeriod * 2) {
        return { score: 0, direction: 'NEUTRAL', reason: 'Insufficient data for correlation analysis' };
      }

      // Placeholder: In real implementation, we would compare with BTC/ETH
      const symbolReturns = [];
      for (let i = 1; i < candles1h.length; i++) {
        const ret = (candles1h[i].close - candles1h[i-1].close) / candles1h[i-1].close;
        symbolReturns.push(ret);
      }
      
      // Simulate BTC returns (random walk for demo)
      // In production, you would fetch actual BTC data
      const btcReturns = symbolReturns.map(() => (Math.random() - 0.5) * 0.02);
      
      const recentSymbolReturns = symbolReturns.slice(-lookbackPeriod);
      const recentBtcReturns = btcReturns.slice(-lookbackPeriod);
      
      const correlation = TradingUtils.calculateCorrelation(recentSymbolReturns, recentBtcReturns);
      const currentReturn = symbolReturns[symbolReturns.length - 1];
      const btcReturn = btcReturns[btcReturns.length - 1];
      
      let score = 0;
      let direction = 'NEUTRAL';
      let reason = 'Normal correlation behavior';
      
      // If correlation breaks and coin moves independently
      if (Math.abs(correlation) < correlationThreshold && Math.abs(currentReturn) > Math.abs(btcReturn) * 2) {
        // Mean reversion expectation
        score = Math.min(100, (1 - Math.abs(correlation)) * 100);
        direction = currentReturn > 0 ? 'SHORT' : 'LONG'; // Fade the move
        reason = `Correlation break (${correlation.toFixed(2)}), independent move ${(currentReturn * 100).toFixed(2)}%`;
      }

      return {
        name: 'correlation_break',
        score: Math.round(score),
        direction,
        reason,
        metadata: {
          correlation,
          currentReturn: currentReturn * 100,
          btcReturn: btcReturn * 100
        }
      };
    } catch (error) {
      return { name: 'correlation_break', score: 0, direction: 'NEUTRAL', reason: `Error: ${error.message}` };
    }
  }

  /**
   * Run all detectors and return results
   */
  static async runAllDetectors(data, config = {}) {
    const detectors = [
      { fn: this.momentumBreakoutDetector, weight: 1.2 },
      { fn: this.vwapPullbackDetector, weight: 1.1 },
      { fn: this.volatilitySqueezeDetector, weight: 1.0 },
      { fn: this.orderbookSweepDetector, weight: 0.9 },
      { fn: this.fundingOIDivergenceDetector, weight: 0.8 },
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
          name: detector.fn.name,
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

module.exports = SignalDetectors;
