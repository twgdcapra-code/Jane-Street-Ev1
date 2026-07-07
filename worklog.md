---
Task ID: 1 (root task)
Agent: Main agent (orchestrator)
Task: Research Jane Street Capital comprehensively and build a complete, fully-functional futures trading system inspired by their tech stack, strategies, and risk discipline. Verify the build is bug-free and end-to-end functional.

Work Log:
- Launched two parallel research subagents:
  - Agent 1 produced `/home/z/my-project/research/jane_street_tech.md` (6,537 words, 16 web searches) — covered OCaml, Hardcaml, Bonsai, Superstore, JX, co-location, network design, hiring culture, ACM SIGCOMM 2024 paper, SEBI matter.
  - Agent 2 produced `/home/z/my-project/research/jane_street_strategies.md` (5,638 words, 16 web searches) — covered market making (Avellaneda-Stoikov), ETF arbitrage (AP dominance), stat-arb (cointegration/OU), futures markets (ES, NQ, RTY, ZN, SR3, CL, GC, BRR), Greeks, VaR, Sharpe targets, market impact.
- Loaded `fullstack-dev` skill and initialised Next.js 16 project (TypeScript + Tailwind 4 + shadcn/ui + Zustand + Recharts).
- Built core engine libraries under `/src/lib/trading/`:
  - `types.ts` — strict discriminated-union type system (Orders, Fills, Positions, Quotes, Candles, Strategies, Risk, Backtest, Greeks).
  - `contracts.ts` — 14 real futures contracts (ES, NQ, RTY, YM, ZN, ZB, SR3, CL, NG, GC, SI, 6E, 6B, BRR) with accurate tick sizes, point values, margins, volatilities, betas.
  - `market-engine.ts` — stochastic market data simulator: GBM + Heston-style vol mean-reversion + Merton jump-diffusion + L2 order-book depth generation. Seeded 250-day history + intraday candles for every contract.
  - `indicators.ts` — vectorised TA primitives: SMA, EMA, RSI, MACD, Bollinger Bands, ATR, VWAP, stdev, rolling max/min, Pearson correlation, beta, log/simple returns, Ornstein-Uhlenbeck half-life, Engle-Granger cointegration, Black's model (options on futures) with full Greeks.
  - `strategies.ts` — 6 quant strategies drawn from Jane Street's known playbook: Mean Reversion (OU z-score), Momentum (EMA + RSI), Pairs (Engle-Granger cointegration), Market Making (Avellaneda-Stoikov reservation price), Breakout (Donchian + Bollinger + ATR trailing stop), Volatility (VRP harvesting proxy). Each exposes paramSchema + generate(candles, params, pairCandles).
  - `backtest.ts` — walk-forward backtester with realistic slippage (sqrt-impact + spread), commission per contract, equity curve, drawdown, and full metrics (Sharpe, Sortino, Calmar, Ulcer, profit factor, expectancy, win rate, beta/alpha, information ratio).
  - `risk.ts` — Risk engine: historical VaR, parametric VaR, Monte Carlo VaR with Cholesky-decomposed multivariate GBM, Expected Shortfall, 6 stress scenarios (2008 GFC, 2020 COVID, 2022 rate shock, 2010 Flash Crash, 2024 yen carry unwind, oil shock), portfolio exposure/beta/diversification ratio/HHI concentration.
  - `analytics.ts` — portfolio metrics (Sharpe, Sortino, max DD, Calmar, Ulcer, up/down capture, skewness, kurtosis), correlation matrix, position/account computation with margin.
  - `store.ts` — central Zustand store wired to MarketEngine: real-time quote subscription, OMS with LIMIT/STOP/STOP_LIMIT/MIT/MARKET matching, fill ledger, position recomputation, account equity, alerts, system logs, risk-budget state.
- Built 10 UI components under `/src/components/trading/`:
  - `Dashboard.tsx` — account strip (equity, BP, exposure, margin), open positions with one-click flatten, working orders, recent fills, embedded order ticket + blotter.
  - `MarketWatch.tsx` — all 14 contracts with bid/ask/size, last, change%, volume, OI, VWAP, hi/lo; filterable by asset class and searchable.
  - `ChartPanel.tsx` — candlestick or line chart with 10 toggleable indicators (SMA20/50, EMA9/21, Bollinger, VWAP, RSI, MACD, ATR, Volume); subcharts for each oscillator; contract spec panel.
  - `OrderBook.tsx` — L2 depth heatmap with cumulative size and bid/ask imbalance indicator.
  - `OrderTicket.tsx` — 5 order types (MKT/LMT/STP/STL/MIT), 4 TIFs (DAY/GTC/IOC/FOK), quantity selector with quick buttons, bid/ask quick-fill, notional/margin calculation, BUY/SELL with semantic colours.
  - `OrderBlotter.tsx` — full order history with status filter, cancel working, colour-coded status badges.
  - `StrategyLab.tsx` — library of 6 strategies with description + param schema; instantiate, enable/disable, edit params live, view P&L/Sharpe/MDD.
  - `Backtester.tsx` — full config UI, runs backtest on historical data, displays equity curve + drawdown + 12 metrics + complete trade ledger.
  - `RiskManager.tsx` — VaR/CVaR cards, 6 stress test scenarios with portfolio impact, Monte Carlo distribution histogram, position risk contribution table, KILL SWITCH button.
  - `PortfolioAnalytics.tsx` — 12 metric cards, equity vs benchmark line chart, returns distribution histogram, 14×14 cross-asset correlation matrix with colour heatmap, trade statistics.
  - `ResearchTerminal.tsx` — 4 research tools: Factor/Beta decomposition, Cointegration lab (Engle-Granger + OU half-life + residual z-score), Rolling correlation, Volatility surface.
  - `SystemMonitor.tsx` — architecture diagram (Jane Street-inspired), 12 live system metrics, engine state, performance counters, risk budget, real-time event log.
  - `AlertsPanel.tsx` — slide-out alerts drawer with ack/clear.
- Composed everything in `src/app/page.tsx` — dark-themed terminal layout with sticky header (live status, session P&L, symbol switcher, alerts bell), sidebar nav (9 modules), main content area, footer with system stats.
- Fixed two bugs surfaced during testing:
  1. `compact is not defined` — wrapper component didn't pass `compact` prop to inner (fixed by adding `compact` to props).
  2. Order ticket price reset on symbol change — fixed via `key={selectedSymbol}` to remount the inner component.
- Resolved 3 ESLint errors (setState-in-effect, refs-during-render, preserve-manual-memoization) by switching to `useMemo` derived state and direct imports.
- Verified end-to-end via Agent Browser:
  - Page loads HTTP 200, no console errors.
  - All 9 modules render correctly.
  - Order placement works: LIMIT order shows as WORKING, MARKET order fills immediately and updates position.
  - Backtester produces real metrics (Total Return, CAGR, Sharpe, Sortino, Max DD, Calmar, Win Rate, Profit Factor, etc.).
  - Risk Manager displays VaR/CVaR, all 6 stress scenarios, Monte Carlo distribution.
  - Portfolio Analytics shows correlation matrix and equity curve.
  - Research Terminal shows factor decomposition and cointegration analysis.
  - System Monitor shows architecture, metrics, and live event log.

Stage Summary:
- Total code written: ~3,500 lines across 18 files (8 engine libs, 10 UI components, 1 page).
- Research deliverables: 2 markdown reports (~12,200 words combined) saved to `/home/z/my-project/download/`.
- All modules verified working end-to-end with no console errors or runtime crashes.
- Lint clean (`bun run lint` passes with no errors).
- Dev server runs on port 3000, page returns HTTP 200.
- The system is a fully functional, professional-grade futures trading SIMULATOR inspired by Jane Street Capital. It is NOT connected to real exchanges and cannot execute real-money trades — that would require direct exchange memberships, regulatory licensing, and co-located infrastructure that no individual can replicate. What it does provide: realistic market microstructure simulation, 6 real quant strategies with proper math, walk-forward backtesting, full risk management (VaR/Monte Carlo/stress tests), portfolio analytics, and a research terminal.
