/**
 * Analysis Adapter - Maps ensemble results to the expected analyzeSymbol format
 */

const DataService = require('./services/data');
const SignalDetectors = require('./signal/detectors');
const EnsembleAI = require('./signal/ensemble');
const TradingUtils = require('./utils');

// Initialize ensemble with configuration from environment
const ensembleConfig = {
  minConfidence: process.env.MIN_CONFIDENCE || 60,
  minDetectorAgreement: 2,
  detectorWeights: {
    momentum_breakout: 1.2,
    vwap_pullback: 1.1,
    volatility_squeeze: 1.0,
    orderbook_sweep: 0.9,
    funding_oi_divergence: 0.8,
    volume_spike: 1.0,
    correlation_break: 0.7
  }
};

const ensemble = new EnsembleAI(ensembleConfig);

async function analyzeSymbol(symbol) {
  try {
    console.log(`🔍 Starting analysis for ${symbol}`);
    
    // Fetch multi-timeframe data for the symbol
    const data = await DataService.fetchMultiTimeframeData(symbol);
    
    // Run all detectors
    const detectorResults = await SignalDetectors.runAllDetectors(data, {});
    
    // Get ensemble decision
    const ensembleDecision = await ensemble.analyze(detectorResults, data);
    
    // If no trade, return early
    if (ensembleDecision.direction === 'NO_TRADE' || ensembleDecision.direction === 'NEUTRAL') {
      return {
        symbol,
        direction: ensembleDecision.direction,
        confidence: ensembleDecision.confidence,
        reason: ensembleDecision.reason,
        explain: ensembleDecision.explain
      };
    }
    
    // Calculate position size based on risk management
    const accountBalance = parseFloat(process.env.ACCOUNT_BALANCE) || 1000;
    const riskPercent = parseFloat(process.env.RISK_PERCENT) || 2;
    
    const positionData = TradingUtils.calculatePositionSize(
      accountBalance,
      riskPercent,
      ensembleDecision.levels.entry,
      ensembleDecision.levels.sl,
      ensembleDecision.direction
    );
    
    // Format the response according to the contract
    return {
      symbol,
      direction: ensembleDecision.direction,
      confidence: ensembleDecision.confidence,
      entry: ensembleDecision.levels.entry,
      sl: ensembleDecision.levels.sl,
      tp: ensembleDecision.levels.tp,
      rr: ensembleDecision.levels.rr,
      positionSize: positionData.size,
      maxLoss: positionData.maxLoss,
      explain: ensembleDecision.explain
    };
    
  } catch (error) {
    console.error(`Error analyzing ${symbol}:`, error);
    return {
      symbol,
      direction: 'NO_TRADE',
      confidence: 0,
      reason: `Analysis error: ${error.message}`,
      explain: { error: error.message }
    };
  }
}

// Example usage and mock data for testing
async function testAnalyzeSymbol() {
  // Mock data for testing
  const mockResult = {
    symbol: 'BTCUSDT',
    direction: 'LONG',
    confidence: 75,
    entry: 45000.50,
    sl: 44500.25,
    tp: 46500.75,
    rr: '1.80',
    positionSize: '0.0022',
    maxLoss: '20.00',
    explain: {
      detectorResults: [
        {
          name: 'momentum_breakout',
          score: 80,
          direction: 'LONG',
          reason: 'Breakout above resistance with volume confirmation'
        },
        {
          name: 'volume_spike', 
          score: 70,
          direction: 'LONG',
          reason: 'Volume spike with bullish candle'
        }
      ],
      agreement: {
        directions: { LONG: 2, SHORT: 0, NEUTRAL: 5 },
        majorityDirection: 'LONG',
        majorityCount: 2,
        agreementRatio: 1.0
      },
      metaScore: 75,
      requirementsMet: true
    }
  };
  
  return mockResult;
}

module.exports = { analyzeSymbol, testAnalyzeSymbol };
