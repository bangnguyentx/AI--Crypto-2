/**
 * Utility functions for trading indicators and calculations
 */

const { SMA, RSI, BollingerBands } = require('technicalindicators');

class TradingUtils {
  /**
   * Calculate Average True Range (ATR)
   */
  static calculateATR(candles, period = 14) {
    if (!candles || candles.length < period + 1) return 0;

    const trValues = [];
    for (let i = 1; i < candles.length; i++) {
      const tr = Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i-1].close),
        Math.abs(candles[i].low - candles[i-1].close)
      );
      trValues.push(tr);
    }

    let atr = trValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trValues.length; i++) {
      atr = (atr * (period - 1) + trValues[i]) / period;
    }
    
    return atr;
  }

  /**
   * Calculate VWAP for given candles
   */
  static calculateVWAP(candles) {
    if (!candles || candles.length === 0) return 0;

    let cumulativeTPV = 0;
    let cumulativeVolume = 0;

    candles.forEach(candle => {
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      cumulativeTPV += typicalPrice * candle.volume;
      cumulativeVolume += candle.volume;
    });

    return cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : 0;
  }

  /**
   * Calculate RSI
   */
  static calculateRSI(closes, period = 14) {
    if (!closes || closes.length < period + 1) return 50;
    
    try {
      const rsi = RSI.calculate({
        values: closes,
        period: period
      });
      return rsi[rsi.length - 1] || 50;
    } catch (error) {
      return 50;
    }
  }

  /**
   * Calculate Bollinger Bands
   */
  static calculateBollingerBands(closes, period = 20, stdDev = 2) {
    if (!closes || closes.length < period) return null;

    try {
      const bb = BollingerBands.calculate({
        values: closes,
        period: period,
        stdDev: stdDev
      });
      return bb[bb.length - 1] || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Calculate z-score for value relative to array
   */
  static calculateZScore(value, array) {
    if (!array || array.length === 0) return 0;
    
    const mean = array.reduce((a, b) => a + b, 0) / array.length;
    const stdDev = Math.sqrt(
      array.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / array.length
    );
    
    return stdDev === 0 ? 0 : (value - mean) / stdDev;
  }

  /**
   * Calculate correlation between two arrays
   */
  static calculateCorrelation(array1, array2) {
    if (!array1 || !array2 || array1.length !== array2.length || array1.length < 2) return 0;

    const n = array1.length;
    const sum1 = array1.reduce((a, b) => a + b, 0);
    const sum2 = array2.reduce((a, b) => a + b, 0);
    
    const sum1Sq = array1.reduce((a, b) => a + b * b, 0);
    const sum2Sq = array2.reduce((a, b) => a + b * b, 0);
    
    const pSum = array1.reduce((a, b, i) => a + b * array2[i], 0);
    
    const num = pSum - (sum1 * sum2 / n);
    const den = Math.sqrt((sum1Sq - sum1 * sum1 / n) * (sum2Sq - sum2 * sum2 / n));
    
    return den === 0 ? 0 : num / den;
  }

  /**
   * Calculate position size based on risk management
   */
  static calculatePositionSize(accountBalance, riskPercent, entry, stopLoss) {
    const riskAmount = accountBalance * (riskPercent / 100);
    const riskPerUnit = Math.abs(entry - stopLoss);
    
    if (riskPerUnit === 0) return { size: 0, maxLoss: 0 };
    
    const size = riskAmount / riskPerUnit;
    return {
      size: size.toFixed(8),
      maxLoss: riskAmount.toFixed(2)
    };
  }

  /**
   * Normalize value to 0-100 scale
   */
  static normalizeScore(value, min, max) {
    if (max === min) return 50;
    return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  }

  /**
   * Get current Vietnam time
   */
  static getVietnamTime() {
    const moment = require('moment-timezone');
    return moment().tz('Asia/Ho_Chi_Minh');
  }

  /**
   * Check if current time is within trading hours (4:00 - 23:30 Vietnam time)
   */
  static isTradingHours() {
    const now = this.getVietnamTime();
    const hour = now.hours();
    const minute = now.minutes();
    
    if (hour < 4) return false;
    if (hour === 23 && minute > 30) return false;
    return true;
  }
}

module.exports = TradingUtils;
