/**
 * AI Ensemble Logic - Combines multiple detectors for final signal
 */

const TradingUtils = require('../utils');

class EnsembleAI {
  constructor(config = {}) {
    this.config = {
      minConfidence: config.minConfidence || 60,
      minDetectorAgreement: config.minDetectorAgreement || 2,
      detectorWeights: config.detectorWeights || {
        momentum_breakout: 1.2,
        vwap_pullback: 1.1,
        volatility_squeeze: 1.0,
        orderbook_sweep: 0.9,
        funding_oi_divergence: 0.8,
        volume_spike: 1.0,
        correlation_break: 0.7
      },
      timeOfDayMultipliers: config.timeOfDayMultipliers || {
        '04-10': 1.1,   // Early Asia: higher confidence
        '10-16': 1.0,   // Late Asia/Early Europe: normal
        '16-20': 0.9,   // Europe/US overlap: slightly reduced
        '20-23': 0.8,   // Late US: lower confidence
        '23-04': 0.3    // Late night: very low confidence
      },
      ...config
    };
  }

  /**
   * Calculate time-of-day multiplier
   */
  getTimeOfDayMultiplier() {
    const now = TradingUtils.getVietnamTime();
    const hour = now.hours();
    
    for (const [range, multiplier] of Object.entries(this.config.timeOfDayMultipliers)) {
      const [start, end] = range.split('-').map(Number);
      
      if (start <= hour && hour < end) {
        return multiplier;
      }
      // Handle overnight case (23-04)
      else if (start > end && (hour >= start || hour < end)) {
        return multiplier;
      }
    }
    
    return 1.0;
  }

  /**
   * Calculate detector agreement and majority direction
   */
  calculateDetectorAgreement(detectorResults) {
    const directions = {
      LONG: 0,
      SHORT: 0,
      NEUTRAL: 0
    };
    
    const directionalDetectors = detectorResults.filter(d => d.direction !== 'NEUTRAL');
    
    directionalDetectors.forEach(detector => {
      directions[detector.direction]++;
    });
    
    const totalDirectional = directionalDetectors.length;
    const majorityDirection = Object.entries(directions)
      .filter(([dir]) => dir !== 'NEUTRAL')
      .sort(([,a], [,b]) => b - a)[0];
    
    return {
      directions,
      totalDirectional,
      majorityDirection: majorityDirection ? majorityDirection[0] : 'NEUTRAL',
      majorityCount: majorityDirection ? majorityDirection[1] : 0,
      agreementRatio: totalDirectional > 0 ? majorityDirection[1] / totalDirectional : 0
    };
  }

  /**
   * Calculate weighted meta-score from detector results
   */
  calculateMetaScore(detectorResults, agreement) {
    let weightedSum = 0;
    let totalWeight = 0;
    let detectorFamilyCount = new Set();
    
    // Calculate weighted average of detector scores
    detectorResults.forEach(detector => {
      if (detector.direction !== 'NEUTRAL' && detector.direction === agreement.majorityDirection) {
        const weight = this.config.detectorWeights[detector.name] || 1.0;
        weightedSum += detector.score * weight;
        totalWeight += weight;
        detectorFamilyCount.add(detector.name.split('_')[0]); // Count unique families
      }
    });
    
    if (totalWeight === 0) return 0;
    
    let metaScore = weightedSum / totalWeight;
    
    // Apply confluence bonus for multiple detector families
    const confluenceBonus = (detectorFamilyCount.size - 1) * 5; // 5% bonus per additional family
    metaScore += Math.min(20, confluenceBonus);
    
    // Apply time-of-day multiplier
    const timeMultiplier = this.getTimeOfDayMultiplier();
    metaScore *= timeMultiplier;
    
    return Math.min(100, Math.max(0, metaScore));
  }

  /**
   * Generate entry, SL, TP levels based on ensemble decision
   */
  generateLevels(direction, currentPrice, data, detectorResults) {
    const atr = this.calculateAverageATR(data);
    const volatilityAdjustedATR = atr * currentPrice;
    
    // Use primary detector for entry logic or current price
    const directionalDetectors = detectorResults
      .filter(d => d.direction === direction && d.score > 50)
      .sort((a, b) => b.score - a.score);
    
    let entryPrice = currentPrice;
    
    // If we have strong momentum detectors, adjust entry
    const momentumDetector = directionalDetectors.find(d => 
      d.name.includes('momentum') || d.name.includes('breakout')
    );
    
    if (momentumDetector && momentumDetector.metadata) {
      if (direction === 'LONG' && momentumDetector.metadata.recentHigh) {
        entryPrice = Math.min(currentPrice, momentumDetector.metadata.recentHigh * 1.001);
      } else if (direction === 'SHORT' && momentumDetector.metadata.recentLow) {
        entryPrice = Math.max(currentPrice, momentumDetector.metadata.recentLow * 0.999);
      }
    }
    
    // Calculate stop loss
    const slDistance = volatilityAdjustedATR * 0.8; // 0.8 ATR for SL
    const stopLoss = direction === 'LONG' 
      ? entryPrice - slDistance
      : entryPrice + slDistance;
    
    // Calculate take profit with 1.5 RR ratio minimum
    const risk = Math.abs(entryPrice - stopLoss);
    const minTPDistance = risk * 1.5;
    const takeProfit = direction === 'LONG'
      ? entryPrice + minTPDistance
      : entryPrice - minTPDistance;
    
    // Adjust TP if we detect strong momentum
    const hasStrongMomentum = directionalDetectors.some(d => 
      d.score > 70 && (d.name.includes('momentum') || d.name.includes('volume'))
    );
    
    const finalTakeProfit = hasStrongMomentum 
      ? direction === 'LONG'
        ? takeProfit * 1.1 // 10% more for strong momentum
        : takeProfit * 0.9
      : takeProfit;
    
    const rrRatio = Math.abs(finalTakeProfit - entryPrice) / risk;
    
    return {
      entry: parseFloat(entryPrice.toFixed(6)),
      sl: parseFloat(stopLoss.toFixed(6)),
      tp: parseFloat(finalTakeProfit.toFixed(6)),
      rr: rrRatio.toFixed(2)
    };
  }

  /**
   * Calculate average ATR across timeframes
   */
  calculateAverageATR(data) {
    const timeframes = ['15m', '1h', '4h'];
    let totalATR = 0;
    let count = 0;
    
    timeframes.forEach(tf => {
      const candles = data[tf];
      if (candles && candles.length > 14) {
        const atr = TradingUtils.calculateATR(candles);
        totalATR += atr;
        count++;
      }
    });
    
    return count > 0 ? totalATR / count : 0.02; // Default 2% if no data
  }

  /**
   * Main ensemble decision function
   */
  async analyze(detectorResults, data) {
    const agreement = this.calculateDetectorAgreement(detectorResults);
    const metaScore = this.calculateMetaScore(detectorResults, agreement);
    
    // Check minimum requirements
    const hasMinimumAgreement = agreement.majorityCount >= this.config.minDetectorAgreement;
    const hasMinimumConfidence = metaScore >= this.config.minConfidence;
    const hasValidDirection = agreement.majorityDirection !== 'NEUTRAL';
    
    let finalDecision = {
      direction: 'NO_TRADE',
      confidence: 0,
      reason: 'No trading signal generated',
      levels: null,
      explain: {
        detectorResults,
        agreement,
        metaScore,
        timeMultiplier: this.getTimeOfDayMultiplier(),
        requirementsMet: false
      }
    };
    
    if (hasMinimumAgreement && hasMinimumConfidence && hasValidDirection) {
      const currentPrice = data['15m']?.[data['15m'].length - 1]?.close || 
                          data['1h']?.[data['1h'].length - 1]?.close || 0;
      
      const levels = this.generateLevels(
        agreement.majorityDirection, 
        currentPrice, 
        data, 
        detectorResults
      );
      
      finalDecision = {
        direction: agreement.majorityDirection,
        confidence: Math.round(metaScore),
        reason: `Ensemble signal: ${agreement.majorityCount} detectors agree, ${metaScore.toFixed(1)}% confidence`,
        levels,
        explain: {
          detectorResults,
          agreement,
          metaScore,
          timeMultiplier: this.getTimeOfDayMultiplier(),
          requirementsMet: true,
          detectorFamilies: Array.from(new Set(detectorResults.map(d => d.name.split('_')[0])))
        }
      };
    } else {
      finalDecision.explain.requirementsMet = false;
      finalDecision.explain.failureReasons = [];
      
      if (!hasMinimumAgreement) {
        finalDecision.explain.failureReasons.push(`Insufficient detector agreement: ${agreement.majorityCount} < ${this.config.minDetectorAgreement}`);
      }
      if (!hasMinimumConfidence) {
        finalDecision.explain.failureReasons.push(`Low confidence: ${metaScore.toFixed(1)}% < ${this.config.minConfidence}%`);
      }
      if (!hasValidDirection) {
        finalDecision.explain.failureReasons.push('No clear directional bias');
      }
    }
    
    return finalDecision;
  }

  /**
   * Optional: ML Service Adapter for future integration
   */
  async callMLService(featureVector) {
    if (!process.env.ML_ENABLED || process.env.ML_ENABLED === 'false') {
      return null;
    }
    
    try {
      const response = await fetch(process.env.ML_SERVICE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          features: featureVector,
          timestamp: Date.now()
        })
      });
      
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.warn('ML service call failed:', error.message);
    }
    
    return null;
  }

  /**
   * Create feature vector for ML service
   */
  createFeatureVector(detectorResults, data) {
    const features = {};
    
    // Detector scores
    detectorResults.forEach(detector => {
      features[`detector_${detector.name}`] = detector.score;
      features[`detector_${detector.name}_direction`] = 
        detector.direction === 'LONG' ? 1 : detector.direction === 'SHORT' ? -1 : 0;
    });
    
    // Market features
    const currentPrice = data['15m']?.[data['15m'].length - 1]?.close || 0;
    const volume = data['15m']?.[data['15m'].length - 1]?.volume || 0;
    const atr = this.calculateAverageATR(data);
    
    features.price = currentPrice;
    features.volume = volume;
    features.atr = atr;
    features.volatility = atr / currentPrice;
    
    // Time features
    const now = TradingUtils.getVietnamTime();
    features.hour_of_day = now.hours();
    features.day_of_week = now.day();
    
    return features;
  }
}

module.exports = EnsembleAI;
