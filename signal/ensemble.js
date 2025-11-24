/**
 * AI Ensemble Logic - SIMPLIFIED AND STABLE
 */

const TradingUtils = require('../utils');

class EnsembleAI {
  constructor(config = {}) {
    this.config = {
      minConfidence: config.minConfidence || 60,
      minDetectorAgreement: config.minDetectorAgreement || 2,
      ...config
    };
  }

  /**
   * Calculate detector agreement
   */
  calculateDetectorAgreement(detectorResults) {
    const directions = { LONG: 0, SHORT: 0, NEUTRAL: 0 };
    
    detectorResults.forEach(detector => {
      if (detector.direction !== 'NEUTRAL' && detector.score > 40) {
        directions[detector.direction]++;
      }
    });
    
    const majorityDirection = Object.entries(directions)
      .filter(([dir]) => dir !== 'NEUTRAL')
      .sort(([,a], [,b]) => b - a)[0];
    
    return {
      directions,
      majorityDirection: majorityDirection ? majorityDirection[0] : 'NEUTRAL',
      majorityCount: majorityDirection ? majorityDirection[1] : 0
    };
  }

  /**
   * Calculate meta score
   */
  calculateMetaScore(detectorResults, agreement) {
    if (agreement.majorityCount < this.config.minDetectorAgreement) {
      return 0;
    }

    let totalScore = 0;
    let count = 0;
    
    detectorResults.forEach(detector => {
      if (detector.direction === agreement.majorityDirection && detector.score > 40) {
        totalScore += detector.score * (detector.weight || 1.0);
        count++;
      }
    });
    
    if (count === 0) return 0;
    
    let metaScore = totalScore / count;
    
    // Apply agreement bonus
    const agreementBonus = (agreement.majorityCount - 1) * 10;
    metaScore += Math.min(20, agreementBonus);
    
    return Math.min(100, metaScore);
  }

  /**
   * Generate trading levels
   */
  generateLevels(direction, currentPrice, data) {
    const candles15m = data['15m'] || [];
    if (candles15m.length < 10) {
      return this.generateDefaultLevels(direction, currentPrice);
    }

    const atr = TradingUtils.calculateATR(candles15m);
    const volatilityAdjustedATR = atr * currentPrice;
    
    const entryPrice = currentPrice;
    const slDistance = volatilityAdjustedATR * 0.8;
    
    const stopLoss = direction === 'LONG' 
      ? entryPrice - slDistance
      : entryPrice + slDistance;
    
    const risk = Math.abs(entryPrice - stopLoss);
    const takeProfit = direction === 'LONG'
      ? entryPrice + risk * 1.8
      : entryPrice - risk * 1.8;
    
    const rrRatio = Math.abs(takeProfit - entryPrice) / risk;
    
    return {
      entry: parseFloat(entryPrice.toFixed(4)),
      sl: parseFloat(stopLoss.toFixed(4)),
      tp: parseFloat(takeProfit.toFixed(4)),
      rr: rrRatio.toFixed(2)
    };
  }

  /**
   * Default levels if data insufficient
   */
  generateDefaultLevels(direction, currentPrice) {
    const riskPercent = 0.02; // 2% risk
    const stopLoss = direction === 'LONG' 
      ? currentPrice * (1 - riskPercent)
      : currentPrice * (1 + riskPercent);
    
    const risk = Math.abs(currentPrice - stopLoss);
    const takeProfit = direction === 'LONG'
      ? currentPrice + risk * 1.8
      : currentPrice - risk * 1.8;
    
    const rrRatio = Math.abs(takeProfit - currentPrice) / risk;
    
    return {
      entry: parseFloat(currentPrice.toFixed(4)),
      sl: parseFloat(stopLoss.toFixed(4)),
      tp: parseFloat(takeProfit.toFixed(4)),
      rr: rrRatio.toFixed(2)
    };
  }

  /**
   * Main ensemble analysis
   */
  async analyze(detectorResults, data) {
    const agreement = this.calculateDetectorAgreement(detectorResults);
    const metaScore = this.calculateMetaScore(detectorResults, agreement);
    
    const currentPrice = data['15m']?.[data['15m'].length - 1]?.close || 
                        data.ticker?.last || 0;
    
    if (metaScore >= this.config.minConfidence && agreement.majorityCount >= this.config.minDetectorAgreement) {
      const levels = this.generateLevels(agreement.majorityDirection, currentPrice, data);
      
      return {
        direction: agreement.majorityDirection,
        confidence: Math.round(metaScore),
        reason: `${agreement.majorityCount} detectors agree, ${Math.round(metaScore)}% confidence`,
        levels,
        explain: {
          detectorResults: detectorResults.map(d => ({
            name: d.name,
            score: d.score,
            direction: d.direction,
            reason: d.reason
          })),
          agreement,
          metaScore
        }
      };
    }
    
    return {
      direction: 'NO_TRADE',
      confidence: Math.round(metaScore),
      reason: `Insufficient agreement: ${agreement.majorityCount} detectors, ${Math.round(metaScore)}% confidence`,
      explain: {
        detectorResults,
        agreement,
        metaScore
      }
    };
  }
}

module.exports = EnsembleAI;
