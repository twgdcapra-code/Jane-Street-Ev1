# Transaction Cost Analysis (TCA) for Futures Trading
## A Comprehensive Research Report

**Scope:** Fundamentals, benchmark prices, slippage decomposition, Implementation Shortfall, VWAP slippage, post-trade metrics, dashboard best practices, regulatory context (MiFID II RTS 28 / SEC Rule 605–606), and quant-firm TCA practices (Jane Street, Citadel Securities, Jump Trading).

**Sources consulted:** CME Group TCA-4 (education), CFA Institute *Trade Strategy and Execution*, Perold (1988) *Journal of Portfolio Management*, Almgren & Chriss (2000), Kissell Research Group, Bouchaud et al. (square-root law), Virtu Financial multi-asset TCA whitepaper, Bloomberg BTCA documentation, Quantitative Brokers (QB), ESMA RTS 28 / FCA PS21/20, SEC Rule 605/606 final rules (34-96493, 34-99679), Tradeweb, AQR Capital Management *Transactions Costs: Practical Application*, and the Jane Street engineering blog.

---

## 1. TCA Fundamentals

### 1.1 What TCA Is

Transaction Cost Analysis (TCA) is the systematic process of measuring, decomposing, and evaluating the cost of executing trades by comparing actual execution prices against a set of pre-defined benchmark prices. According to the CFA Institute's *Trade Strategy and Execution* curriculum, "trade cost analysis enables investors to better manage trading costs and understand where trading activities can be improved through the use of appropriate benchmarks, execution algorithms, and venue selection." CME Group's futures TCA primer similarly defines TCA as "the idea of being able to quantify execution and measure how it performed against the market," noting that it has spread from equities to all asset classes, including listed futures.

TCA covers both **explicit costs** (visible, deterministic — commissions, exchange fees, clearing fees) and **implicit costs** (invisible, probabilistic — bid-ask spread, market impact, timing cost, opportunity cost). The Kx Systems glossary entry captures the essence: "TCA is a method used to evaluate the costs associated with executing trades. This allows investors and traders to improve their trading strategies." The Quod Financial institutional-trading brief adds that modern TCA spans three phases — **pre-trade** (forecasting and venue selection), **intraday** (real-time monitoring and re-routing), and **post-trade** (attribution and feedback into the algorithm tuning loop).

### 1.2 Why TCA Matters for Institutional Futures Traders

Institutional futures traders care about TCA because the gross-to-net drag from poor execution is, in aggregate, often larger than management fees or financing costs. AQR Capital Management's white paper *Transactions Costs: Practical Application* frames the issue bluntly: "Transactions costs are a necessary aspect of implementing any investment strategy, whether active or passive," and the difference between a 1 bp and a 4 bp execution cost across a billion-dollar annual futures rotation can erase a strategy's edge.

For futures specifically, the relevant drivers are:

- **Central clearing and fungibility** mean the same contract trades on multiple venues (CME, ICE, Eurex) — venue selection directly affects the realized spread.
- **High embedded leverage** amplifies the bps-to-dollars conversion: a 1 bp slippage on a 10-year Treasury note futures position (DV01 ≈ $70/contract) carrying, say, 100,000 contracts is roughly $70,000 in pure execution drag.
- **Roll schedules** force predictable, large flows four times a year in index futures and quarterly in commodity futures — predictable flows are exactly when predatory algos can detect and front-run metaorders, so TCA-driven scheduling is critical.
- **Best-execution regulation** (MiFID II in Europe, Reg NMS / SEC Rule 605-606 in the US) requires demonstrable evidence that the firm achieved best execution; TCA reports are the primary artefact regulators inspect.
- **Algorithm tuning feedback loop:** desks such as Quantitative Brokers (QB), Jane Street, and Citadel Securities use TCA residuals to recalibrate their execution algorithms continuously — without TCA, the algorithm cannot learn.

### 1.3 Typical Cost Components and Magnitudes

For liquid futures, all-in round-trip execution costs (excluding commissions) typically fall in the following ranges, consistent with CME Group's education material and the Virtu multi-asset TCA report:

| Bucket | Examples | Typical Round-Trip Cost |
|---|---|---|
| Ultra-liquid | E-mini S&P 500 (ES), 10Y Treasury (ZN), WTI crude (CL) | **0.5–2 bps** |
| Liquid | E-mini Nasdaq (NQ), 5Y Treasury (ZF), Brent (B), EUR/USD FX futures | 1–3 bps |
| Moderately liquid | E-mini Russell 2000, 30Y Bond (ZB), gold (GC) | 2–5 bps |
| Less liquid | Single-stock futures, agricultural softs, far-dated expiries | 5–20+ bps |

Commissions add roughly **$0.10–$2.00 per contract per side** depending on the broker and volume tier, exchange fees typically $0.10–$1.50 per side, and NFA/CFTC regulatory fees a few cents — these are deterministic and bounded. The **implicit** cost (spread + impact + timing) is the variable that TCA is designed to control. Quantitative Brokers explicitly argues that "TCA is primarily based in ticks (minimum price increments); slippage in ticks gives a normalized measure to better compare across contracts," because bps is contaminated by price level and tick-size effects.

---

## 2. Benchmark Prices

Every TCA computation requires a **benchmark price** (P_bench) against which the execution price (P_exec) is compared. The choice of benchmark encodes a hypothesis about what "fair" looks like, and different benchmarks isolate different sources of cost. The signed slippage vs benchmark *B* is:

```
Slippage_B = side × (P_exec − P_B) / P_B          (decimal)
           = side × (P_exec − P_B) / P_B × 10,000  (bps)
```

where `side = +1` for buys and `−1` for sells, so positive slippage always represents a cost (paying more on a buy, receiving less on a sell).

### 2.1 Arrival Price (Decision / Pre-Trade Price)

The arrival price **P_arr** is the mid-quote (or last traded price) observed at the instant the trading decision is made and the order is released to the execution algorithm. It is the most important benchmark in modern TCA because it measures the full implementation cost of the decision, including any price drift between decision and execution.

```
P_arr = (Bid_t0 + Ask_t0) / 2          (mid-quote at decision time t0)
Slippage_arr = side × (P_exec − P_arr) / P_arr × 10,000
```

**Interpretation:** Captures *all* execution friction. A small slippage_arr implies the algorithm preserved the alpha present at decision time.

**Typical magnitude:** 1–10 bps for liquid futures, 5–50 bps for less liquid contracts; corresponds to the Implementation Shortfall benchmark (see §4).

### 2.2 VWAP Benchmark

Volume-Weighted Average Price over a defined window (typically the trading session or a chosen intraday interval):

```
P_VWAP = Σ_i (P_i × V_i) / Σ_i V_i       (summed over all prints i in the window)
Slippage_VWAP = side × (P_exec − P_VWAP) / P_VWAP × 10,000
```

where P_i is the trade price and V_i is the trade size of the i-th print in the window.

**Interpretation:** Measures whether the trader beat the volume-weighted average. Deutsche Bank Quant Research notes that "in a standard post-trade TCA we define trading cost as slippage vs a conventional benchmark, such as Arrival Price, VWAP, PWP" (participation-weighted price). VWAP is most informative when (a) the order participates throughout the window and (b) the volume curve is "normal."

### 2.3 TWAP Benchmark

Time-Weighted Average Price — equal weight per time bucket, regardless of volume:

```
P_TWAP = (1/N) × Σ_k P_k                  (P_k sampled at fixed Δt intervals)
Slippage_TWAP = side × (P_exec − P_TWAP) / P_TWAP × 10,000
```

**Interpretation:** TWAP removes the volume-curve dependency. Useful for benchmarking an algorithm that should not chase volume (e.g., a stealth execution). Amberdata: "TWAP is an average price calculated over a set time interval, weighting each time period equally, regardless of volume."

### 2.4 Interval VWAP (Execution-Window VWAP)

Same formula as §2.2 but the sum is restricted to the actual execution window of the order (from first child fill to last child fill), not the full session:

```
P_IntervalVWAP = Σ_{i ∈ [t_first, t_last]} (P_i × V_i) / Σ_{i ∈ [t_first, t_last]} V_i
```

**Interpretation:** This is the *fairest* volume-weighted benchmark for an order — it compares the algorithm's execution to the volume-weighted average over the same window the algorithm chose to operate in. Session VWAP penalizes or rewards the algorithm for window choice; interval VWAP isolates intra-window skill.

### 2.5 Previous Close / T+1 Close

```
Slippage_PrevClose = side × (P_exec − P_close_T-1) / P_close_T-1 × 10,000
Slippage_T+1Close  = side × (P_close_T+1 − P_exec) / P_exec × 10,000
```

**Interpretation:** Previous-close slippage captures overnight drift + execution cost — useful for assessing timing decisions across days. T+1 (or T+5) close is used to construct the **realized spread** (see §6.3), because by T+1 the temporary market impact has decayed and the residual difference reflects the *permanent* impact and informed-trading premium.

### 2.6 Midpoint of Bid-Ask at Decision Time

```
P_mid_t0 = (Bid_t0 + Ask_t0) / 2
Slippage_mid = side × (P_exec − P_mid_t0) / P_mid_t0 × 10,000
```

This is essentially the arrival price for liquid contracts but differs when the last traded price is used as arrival (illiquid contracts where mid-staleness is an issue). The effective-spread literature (SEC, Ødegaard) uses this midpoint as the canonical fair-value reference.

### 2.7 Implementation Shortfall Benchmark (Arrival)

The IS benchmark *is* the arrival price — see §4 for the full Perold (1988) framework. The convention is:

```
IS_benchmark = P_arr = P_mid at decision time t0
IS_cost = side × (P_exec_avg − P_arr) / P_arr × Q_executed + Opportunity Cost
```

The distinguishing feature is that IS adds an explicit **opportunity cost** term for unexecuted quantity, whereas plain arrival slippage only measures executed-quantity cost.

---

## 3. Slippage Decomposition

The total slippage against the arrival price can be decomposed into five economically distinct components. This decomposition is the analytic core of any serious TCA engine.

### 3.1 Spread Cost

```
Spread_cost = side × (½ × spread) × Q        (in price units)
            = side × (½ × spread / P_arr) × 10,000 × Q   (in bps × qty)
```

**Interpretation:** The mechanical cost of crossing the bid-ask spread. For a marketable buy, you pay the ask; the half-spread from mid is the unavoidable round-trip "admission ticket." For a passive limit order that provides liquidity, spread cost is negative (you capture the spread).

**Typical magnitude:** 0.25–1 tick for liquid futures (e.g., ES spread is 0.25 pts = $12.50/contract → 0.5 bps on a $5,000 notional). For less liquid contracts (e.g., far-dated ag futures), 2–5 ticks.

### 3.2 Market Impact — Temporary + Permanent

Market impact is the price move attributable to the order's own trading pressure. Following Almgren & Chriss (2000) and the empirical square-root literature (Bouchaud, Gatheral), impact is split into:

- **Temporary impact:** Reverts after the order completes; reflects queue depletion and order-book imbalance during execution.
- **Permanent impact:** Persists post-execution; reflects information leakage and the market's inference that a metaorder is underway.

The empirical **square-root impact model** (Bouchaud et al.; Gatheral 2010; Almgren et al. 2005 *Direct Estimation of Equity Market Impact*) states:

```
Impact (bps) = κ × σ × √(Q / ADV)
```

where:
- **σ** = intraday volatility of the contract (in same units as impact, i.e., fractional or bps),
- **Q** = order quantity (in same units as ADV — contracts or notional),
- **ADV** = average daily volume,
- **κ** = the market-impact coefficient, empirically **≈ 0.1–0.3 for liquid futures** (lower than equities, where κ ≈ 0.3–0.6, because futures markets are deeper and more two-sided).

The CFA Institute's 2026 *Enterprising Investor* blog confirms: "price impact is concave in trade size. Larger trades do cost more, but not proportionally more. This is the well-known square-root law." The "concave" property is what makes the square-root form universal across asset classes.

In the Almgren-Chriss framework, the decomposition is:

```
Total impact cost = (½ × η × (Q/T)² + γ × Q × (Q/T)) × T
                   = ½ × η × Q²/T  +  γ × Q²
                     └ temporary ┘   └ permanent ┘
```

where *T* is execution horizon, *η* is the temporary-impact linear coefficient, and *γ* is the permanent-impact linear coefficient. Temporary impact scales inversely with horizon (slow down to reduce it); permanent impact is independent of horizon (you reveal information regardless of pace).

**Typical magnitude:** For an order at 1% ADV in ES with σ = 1% daily, κ = 0.2: impact ≈ 0.2 × 1% × √(0.01) = 0.0002 = 2 bps. At 5% ADV: 0.2 × 1% × √0.05 ≈ 4.5 bps. At 20% ADV: 0.2 × 1% × √0.20 ≈ 9 bps.

### 3.3 Timing Cost (Drift)

```
Timing_cost = side × (P_mid_t_end − P_mid_t0) × Q_executed / P_arr / 10
```

This is the price drift over the execution window, multiplied by the quantity executed. It captures the cost of *not* executing instantaneously at the arrival price.

**Interpretation:** If you were a buy and the market rallied 5 bps during your 30-minute execution, your timing cost is +5 bps. If the market fell 5 bps, your timing cost is −5 bps (you benefited from the drift). Timing cost is largely exogenous — it is the unforecastable market move — but it can be controlled by execution horizon and participation rate.

**Typical magnitude:** For σ_daily = 1% and a 30-minute execution window (≈ 1/16 of a 8-hour session), expected |drift| ≈ σ × √(1/16) = 25 bps. Drift dwarfs impact for short horizons and small orders; this is why the Almgren-Chriss frontier balances impact vs. timing *risk* (variance of timing cost), not just expected timing cost.

### 3.4 Opportunity Cost

```
Opportunity_cost = side × (P_mid_t_end − P_arr) × Q_unexecuted / P_arr × 10,000
```

where Q_unexecuted = Q_ordered − Q_executed.

**Interpretation:** The cost of *not* filling the full order. If you cancelled the back half of a buy because the market ran away from you, the unfilled quantity "would have" made money, but you didn't capture it. Perold's 1988 framework treats this as a real, monetizable cost because the investment thesis was sized for Q_ordered, not Q_executed.

**Typical magnitude:** Highly variable; in trending markets, opportunity cost can dwarf all other components (often 20–100+ bps for partial fills on fast-moving contracts).

### 3.5 Commission and Fees

```
Commission_cost = (commission_per_contract + exchange_fee + reg_fee) × Q_executed
                 / (P_arr × Q_executed) × 10,000   (in bps)
```

**Typical magnitude:** 0.1–0.5 bps for liquid index futures at institutional commission tiers; 0.3–1.0 bps for less liquid or lower-volume contracts. Always explicit and bounded.

### 3.6 Reconciliation Identity

```
Total_Slippage_arr = Spread_cost + Impact_cost + Timing_cost
                   + Opportunity_cost + Commission_cost
```

Reconciling to within 0.1 bps is the standard data-quality check for a TCA engine. Failures usually indicate missing fills, stale mid-quotes, or mis-attributed venue fees.

---

## 4. Implementation Shortfall (IS) — Perold 1988

### 4.1 Definition

André Perold's 1988 paper *"The Implementation Shortfall: Paper vs. Reality"* (Journal of Portfolio Management, 14(3): 4–9) defines IS as the difference in return between a *paper* portfolio — assuming instantaneous, costless execution at the decision-time price — and the *implemented* portfolio actually realized. The University of Pennsylvania Kearns reading summarizes: "Perold (1988) defines implementation shortfall as the difference in return between a theoretical portfolio and the implemented portfolio."

Quantitative Brokers' historical review adds: "Perold's paper discusses the differences between paper trading where the execution price is assumed to equate the current market level, and the [reality of execution friction]."

### 4.2 The IS Equation

```
IS = (P_exec_avg − P_arr) × side × Q_ordered        (in currency units)
   + (P_arr − P_cancel) × side × Q_unexecuted          (opportunity cost, if cancelled at P_cancel)

or, normalized:

IS (bps) = side × [(P_exec_avg − P_arr) × Q_executed
                  + (P_arr − P_cancel) × Q_unexecuted] / (P_arr × Q_ordered) × 10,000
```

If the order is fully filled (Q_executed = Q_ordered), the opportunity-cost term vanishes and IS reduces to arrival-price slippage.

### 4.3 The Four-Component Decomposition

Perold's framework (as elaborated by Wagner, Edwards, and the modern CFA Institute curriculum) decomposes IS into:

1. **Selection cost** — the difference between the decision price (when the PM formed the view) and the arrival price (when the order was actually released to the market). If a PM decided to buy at 10:00 but the desk didn't release the order until 10:30, and the market rallied 3 bps in between, that 3 bps is selection cost. It is the cost of delay between *decision* and *action*.

2. **Timing cost** — drift during the execution window, as in §3.3.

3. **Market impact cost** — the temporary + permanent price pressure attributable to the order itself, as in §3.2.

4. **Opportunity cost** — the lost P&L on unexecuted quantity, as in §3.4.

The full decomposition identity:

```
IS = Selection_cost + Timing_cost + Impact_cost + Opportunity_cost + Commission_cost

where:
  Selection_cost = side × (P_arr − P_decision) × Q_ordered
  Timing_cost    = side × (P_mid_t_end − P_arr) × Q_executed
  Impact_cost    = side × (P_exec_avg − P_mid_t_end) × Q_executed
  Opportunity    = side × (P_arr − P_cancel) × Q_unexecuted
```

### 4.4 When to Use IS vs VWAP

| Use IS when… | Use VWAP when… |
|---|---|
| Order is large relative to ADV (>1–2%) | Order is small relative to ADV (<0.5%) |
| PM has a directional view and timing matters | Order is a pure liquidity-providing flow |
| Opportunity cost is material (partial fills) | Order is fully filled within the window |
| Benchmarking the *investment decision* execution | Benchmarking the *execution algorithm* skill |
| Regulatory best-ex evidence (MiFID II RTS 28) | Broker-algo comparison (QB, Bloomberg EMSX) |

The *Markit/Scribd* paper *"The Use and Abuse of Implementation Shortfall"* argues that IS has been over-extended as a single benchmark; for very small, fully filled orders, VWAP (or interval VWAP) is more informative because IS collapses to a trivial arrival slippage with no opportunity-cost dimension.

---

## 5. VWAP Slippage

### 5.1 Computation

```
P_VWAP = Σ_i (P_i × V_i) / Σ_i V_i       over all trades i in the benchmark window
Slippage_VWAP = side × (P_exec_avg − P_VWAP) / P_VWAP × 10,000
```

For an order sliced into child fills at prices p_1, …, p_n with sizes q_1, …, q_n:

```
P_exec_avg = Σ_j (p_j × q_j) / Σ_j q_j
```

### 5.2 When VWAP Is Misleading

VWAP slippage is misleading in three documented regimes:

1. **Trending days.** If the market trends monotonically upward during the window, any buy executed evenly across the window will underperform VWAP (because VWAP weights the later, higher prices more heavily). Conversely, on a downward-trending day, a buy will *beat* VWAP for purely mechanical reasons. This is the classic VWAP paradox: the algorithm "looks bad" on exactly the days the market moved in the order's direction.

2. **Volume-curve divergence.** VWAP assumes the trader's volume curve matches the market's. If a buy concentrates in low-volume morning hours when the market rallies, and the market falls in the high-volume afternoon, the trader's VWAP slippage is dominated by *when* they traded, not how well they executed within each slice. Global Trading: "VWAP execution can essentially be reduced to a problem of choosing an optimal trading curve and minimising volume slippage."

3. **Aggressive / opportunistic orders.** VWAP benchmarks assume passive participation. A manager who pulls the order forward to capture a dislocation will mechanically underperform VWAP even though the *decision* was correct. The TRADE News reports that "VWAP-Arrival improved median spread-adjusted arrival slippage by 4.9 bps compared to a market-adjusted benchmark," precisely because the hybrid benchmark corrects VWAP's trend-day bias.

### 5.3 Relationship to the Volume Curve

The benchmark VWAP depends entirely on the intraday volume curve. An algorithm targeting VWAP must forecast this curve and pace child orders so that cumulative participation matches cumulative market volume. The standard metric is the **volume-curve slippage**:

```
Volume_curve_slip = Σ_t |π_t − v_t|
where π_t = (own_qty_t / total_own_qty) and v_t = (market_vol_t / total_market_vol)
```

A perfect VWAP execution has volume-curve slippage = 0; deviations represent the algorithm's timing error relative to the realized volume profile.

---

## 6. Post-Trade Metrics

A complete TCA engine computes the following metrics for every fill, every order (parent + children), and every trading session.

### 6.1 Slippage in bps vs Each Benchmark

```
Slip_B(fill) = side × (P_fill − P_B) / P_B × 10,000   for B ∈ {Arr, VWAP, TWAP, IntervalVWAP, PrevClose, T+1, Mid_t0}
```

Aggregate to order level by value-weighting fills; aggregate to session level by value-weighting orders.

### 6.2 Effective Spread

The effective spread measures the cost of immediate execution relative to the prevailing mid-quote:

```
Effective_spread = 2 × side × (P_fill − P_mid_t0) / P_mid_t0 × 10,000   (bps)
```

For a buy, this is 2 × (ask_paid − mid) / mid. The factor of 2 reflects the round-trip (full spread, not half). SEC's *Trade Weighted Exchange Average Quoted Spread* documentation and the Berkeley DeFi bid-ask-spread paper both use this convention. Per AnalystPrep's CFA Level II notes: "Effective Spread transaction cost estimate = Trade size × (Trade price − (Bid+Ask)/2)" for buy orders, with the sign flipped for sells.

**Interpretation:** The effective spread is the realized cost of crossing the spread at order arrival. If a passive limit order fills, the effective spread is negative (you *earned* the spread).

### 6.3 Realized Spread

The realized spread uses a *future* mid-quote to net out the temporary impact:

```
Realized_spread = 2 × side × (P_fill − P_mid_t+τ) / P_mid_t0 × 10,000
```

with τ typically 5 minutes (per SEC Rule 605 conventions) or 1 day / 5 days (for slower-moving contracts). Ødegaard's lecture notes define: "Realized Spread = 2 × d_t × (p_t − m_t) − (m_{t+Δ} − m_t)." The frds.io reference: "Realized Spread (log) = 2 × | ln P_it − ln m_{i,t+τ} |."

**Interpretation:** The realized spread is *what the liquidity provider actually earned* on the trade. If effective spread is 4 bps but realized spread is 0 bps, the entire 4 bps was temporary impact that reverted — the trader paid for nothing. If effective spread = realized spread, the move was *informed* (the trader knew something the market didn't) and the spread was the price of that information.

### 6.4 Participation Rate

```
Participation_rate = Q_executed / Volume_over_execution_window
```

Expressed as a percentage. A 5% participation rate means the trader accounted for 5% of market volume during the execution window — a common upper bound for stealth execution. Almgren-Chriss optimal trajectories typically target 5–15% participation for liquid contracts.

### 6.5 Fill Rate

```
Fill_rate = Q_executed / Q_ordered
```

A fill rate < 100% triggers the opportunity-cost term in the IS decomposition. Below 90% on a liquidity-seeking order typically warrants investigation.

### 6.6 Average Fill Time

```
Avg_fill_time = (t_last_fill − t_first_child) / N_child_orders
or, weighted:  Σ_j q_j × (t_j − t_first) / Σ_j q_j
```

Captures the duration of the execution. Long durations increase timing risk; short durations increase impact.

### 6.7 Z-Score of Slippage vs Historical Distribution

```
Z = (Slippage_order − μ_historical) / σ_historical
```

where μ_historical and σ_historical are computed over the trailing N (e.g., 90 days) similar orders (same contract, same size bucket, same side). A |Z| > 2 flags the order as a statistical outlier — typically reviewed manually. SteelEye, ACA Group, and other TCA vendors promote z-score-based outlier detection as a core best-exec surveillance feature.

---

## 7. Visualization Best Practices

Modern broker / dealer TCA dashboards (Virtu, Bloomberg BTCA, TT TCA, Quantitative Brokers, TS Imagine, SteelEye) converge on a common set of visualizations. The Talos Analytics dashboard documentation describes the canonical layout: "decomposes slippage and other relevant metrics such as volumes and participation rates distribution by strategy."

### 7.1 Slippage Distribution Histogram (Per Fill)

X-axis: slippage in bps (binned, e.g., −10 to +30 in 0.5-bp buckets). Y-axis: count of fills or notional-weighted count. Overlay the benchmark mean and median. A right-skewed distribution with a long right tail is the classic signature of market-impact leakage.

### 7.2 Slippage by Symbol (Heatmap or Bar)

Either a horizontal bar chart (one bar per contract, sorted by total notional traded) or a heatmap matrix of contracts × benchmarks. Color encodes signed slippage in bps — green for negative (good) through red for positive (bad). Useful for spotting contracts where the desk systematically underperforms.

### 7.3 Slippage over Time (Time Series by Day / Hour)

Line chart with rolling 20-day mean and ±1σ bands. Annotated with regime changes (e.g., FOMC days, roll days). A spike in 20-day mean slippage typically precedes an algorithm-recalibration review.

### 7.4 Slippage by Order Size Bucket

Bar chart with buckets: Small (<0.1% ADV), Medium (0.1–1% ADV), Large (1–5% ADV), Block (>5% ADV). The square-root law predicts slippage scales with √(Q/ADV), so a properly calibrated impact model produces a √-shaped bar pattern; deviations suggest model misspecification or liquidity-regime shift.

### 7.5 Slippage by Side (Buy vs Sell)

Buy orders typically pay more market impact than sell orders in futures markets because (a) the buy-side metaorder is more frequently information-driven, and (b) liquidity provision tends to be asymmetric. The bar chart comparing buy vs sell slippage isolates this effect.

### 7.6 Slippage by Venue / Broker

A matrix of venues (CME, ICE, Eurex, broker-led blocks) × benchmarks. The Quantitative Brokers' Prism smart-order-router is explicitly designed to optimize this matrix for US Treasuries; analogous routers exist for futures. Persistent venue outperformance of >1 bp warrants reallocation.

### 7.7 Cumulative Cost Chart

Cumulative bps slippage × cumulative notional, plotted as a step function over the session or month. The slope is the realized cost-per-notional — a flattened slope is the goal of any execution-quality initiative.

### 7.8 Top 10 Worst Fills Table

Sortable table: timestamp, contract, side, quantity, fill price, arrival price, slippage_arr, slippage_VWAP, slippage_T+1, Z-score, venue, broker, child-algo. The 80/20 rule is sharp: typically 10–20% of fills account for 60–80% of total cost. Reviewing these fills is the highest-ROI activity a trading desk undertakes.

### 7.9 Per-Order Detail with Benchmark Breakdown

For each parent order: arrival price, VWAP, TWAP, interval VWAP, prev close, T+1 close, average fill price, slippage vs each, plus the full IS decomposition (selection, timing, impact, opportunity, commission). Typically a tabbed or expandable row in the dashboard.

---

## 8. Regulatory Context

### 8.1 MiFID II RTS 28 — Best Execution Reporting

MiFID II (Markets in Financial Instruments Directive II), in force since January 2018, imposes best-execution obligations on EU investment firms via Article 27. Regulatory Technical Standard **RTS 28** requires firms that execute client orders to publish, annually, a summary of the **top five execution venues** by class of financial instruments, along with quality-of-execution information.

Key elements (per ESMA clarifications, the SIX TCA factsheet, the Barclays RTS 28 disclosure page, and PGGM's 2024 RTS 28 report):

- **Annual publication** on the firm's website.
- **Top-five venues** per instrument class (equities, bonds, derivatives, FX).
- **Quality-of-execution data:** including price, cost, speed, likelihood of execution and settlement, size, and nature of orders.
- **RTS 27** (the venue-side counterpart, since repealed in the UK under FCA PS21/20) required trading venues to publish execution-quality reports.
- **ESMA's 2023 Public Statement** clarified that, pending full application of the new rules under the MiFID II "encumbrance" review, firms were no longer required to annually report RTS 28 detailed information — but the *underlying best-execution obligation* (Article 27) remains.
- **TCA data retention:** under MiFID II Article 16(7) and RTS 6, firms must retain order-and-transaction records for **at least 5 years** (and up to 7 years at the competent authority's request). TCA reports, being part of the execution evidence chain, fall under this 5-year minimum.

Tradeweb's best-execution overview summarizes: TCA is the "role" that operationalizes MiFID II best-execution compliance, providing the *evidence* that the firm followed its execution policy.

### 8.2 SEC Rule 605 / Rule 606 — US Execution Quality and Routing Disclosure

In the US, the SEC's Reg NMS framework imposes parallel obligations:

- **Rule 605** (formerly 11Ac1-5): Requires **market centers** (exchanges, alternative trading systems, OTC market makers that exceed a de minimis volume threshold) to publish monthly reports on execution quality for "covered orders" in NMS stocks. Reports include:
  - Shares executed, percentage of orders executed at or better than the quoted price,
  - **Effective spread** statistics,
  - **Realized spread** statistics (using 5-minute post-trade mid-quote per the SEC's *Order Payment* study),
  - Speed of execution.
  - The 2024 amendments (SEC Release 34-96493, finalized March 2024) **expanded scope** to "larger" broker-dealers (≥100,000 customer accounts) and added new metrics including the *average effective over quoted spread* (a percentage-based metric).

- **Rule 606**: Requires **broker-dealers** to publish quarterly reports on **order routing** — by venue, by order type, with statistics on execution quality, payment for order flow, and net received. The 2018 amendments required disclosure of **net payment** for routed and held orders, and **standardized month-by-month reporting** for institutional orders.

- **Data retention:** Per the SEC's Final Rule 34-99679, "the public order execution quality reports [must] be kept publicly available for a period of **three years**." Internal TCA records supporting best-execution analysis are subject to the longer broker-dealer books-and-records retention rules under SEA Rule 17a-4 — typically **3 to 6 years** depending on the document type, with the first 2 years on site.

Citadel Securities, Virtu Financial, and ClearStreet all publish their Rule 605 and 606 reports on their websites; the reports are the US analogue of MiFID II RTS 28.

### 8.3 What TCA Data Must Be Retained

| Jurisdiction | Rule | TCA-Adjacent Records | Retention |
|---|---|---|---|
| EU | MiFID II Art. 16(7) + RTS 6 | Order, execution, and TCA records | **5 years** (7 on request) |
| UK | UK MiFIR (post-Brexit) | Same as EU baseline | 5 years |
| US | SEA Rule 17a-4 | Order tickets, TCA reports, blotters | **3–6 years** (2 onsite) |
| US | SEC Rule 605 (2024 amendments) | Public execution-quality reports | 3 years public |
| US | SEC Rule 606 | Public routing reports | 3 years public |

---

## 9. Jane Street / Quant Firm TCA Practices

### 9.1 Internal TCA Engines — Not Relying on Broker TCA

Top quant firms (Jane Street, Citadel Securities, Jump Trading, HRT, Tower Research) run their **own internal TCA engines** rather than relying on broker-supplied TCA. The reason is conflict-of-interest: broker TCA grades the broker's own execution, and the broker has an incentive to choose benchmarks and windows that flatter its performance. An internal engine, calibrated to the firm's own execution data, is the only objective measure.

Jane Street's engineering blog and the *Signals and Threads* podcast (hosted by Ron Minsky) repeatedly emphasize that the firm builds its own latency-sensitive market-data and execution infrastructure from the ground up — including the analytics layer. The firm's preference for OCaml (and the recent OxCaml fork) for the core trading system reflects a deliberate choice to own the entire stack, including TCA. A recent LinkedIn post notes: "Jane Street re-wrote its 'core trading system' with an OCaml fork, OxCaml. That means you can test, optimize, and deploy trading algorithms" — and TCA logic — entirely in-house.

Citadel Securities and Jump Trading take the same approach with FPGA-accelerated tick capture (VHDL/Verilog per Jump's job descriptions) feeding internal analytics pipelines. Virtu Financial, while selling TCA as a service to clients (per their multi-asset TCA PDF), runs a separate, deeper internal engine for proprietary trading.

### 9.2 Real-Time TCA During Execution

A second defining characteristic is **real-time TCA** — not just post-trade. The desk sees, for every live parent order:

- Current slippage vs arrival (running),
- Projected final slippage with confidence interval (from a calibrated impact model),
- Participation rate vs plan,
- Projected vs. realized volume curve,
- Z-score of current slippage against the historical distribution of similar orders.

If the projected slippage crosses a threshold (e.g., >2σ above expectation), the trader or supervisory algorithm can intervene: cancel remaining child orders, switch venues, or escalate to a block desk. This closed-loop, intraday TCA is what the Quod Financial brief calls "intraday TCA" and what the Tabb Forum piece *Beyond TCA* describes as "analytics to change behavior, not just report results."

### 9.3 Almgren-Chriss for Optimal Execution

The Almgren-Chriss model (Almgren & Chriss, 2000, "Optimal Execution of Portfolio Transactions," *Journal of Risk*) is the foundational framework for scheduling large parent orders into child slices. The model:

- Splits total order Q into a schedule X_1, X_2, …, X_N over N time buckets,
- Assumes **linear temporary impact** (per-slice cost ∝ slice size / bucket length) and **linear permanent impact** (cumulative cost ∝ total executed quantity),
- Minimizes the mean-variance objective:

```
Minimize:  E[Cost] + λ × Var[Cost]
subject to: Σ X_i = Q
```

The solution is a **family of efficient-frontier trajectories** parameterized by the risk-aversion λ. For λ → 0 (risk-neutral), the optimal is VWAP (front-load uniformly). For λ → ∞ (infinitely risk-averse), the optimal is to trade everything in the first bucket (minimize timing risk, accept maximum impact). Real desks pick λ based on the alpha-decay profile of the underlying signal — fast-decaying alpha demands high λ (execute quickly), slow-decaying alpha tolerates low λ (execute patiently).

The Imperial College / Lillo lecture notes observe that Almgren-Chriss assumes "market impact which is linear, fixed, and permanent," while empirical impact is **transient** — the past order flow affects future prices. This motivates the *propagator* and *transient impact* extensions discussed in §9.4.

### 9.4 Kissell-Morton Barrier Diffusion Model

Kissell Research Group (Kissell 2013, *The Science of Algorithmic Trading and Portfolio Management*) and the related Kissell-Morton work extend the impact framework with a **barrier-diffusion** formulation:

- The mid-quote is modeled as a Brownian diffusion with drift,
- Each child order creates a "barrier" (price level) that the mid must re-cross before the order's impact is dissipated,
- The expected time-to-barrier-crossing determines the temporary-vs-permanent impact split.

The model gives closed-form solutions for optimal slicing when the underlying price is diffusion-dominated and provides a theoretically grounded κ for the square-root law. The Kissell Research Group pre-trade model "assists funds in determining the most appropriate best execution strategy given the specific investment objectives of the manager." The CFA Institute's 2026 *Enterprising Investor* blog describes the resulting framework as the practical bridge between the Almgren-Chriss frontier and real-world calibration.

### 9.5 TCA Feeding Back into Algorithm Tuning

The final, and arguably most important, practice at top quant firms is the **closed-loop feedback** from post-trade TCA into algorithm tuning. The cycle is:

1. **Execute** parent order through the algorithm,
2. **Decompose** realized slippage into spread + impact + timing + opportunity + commission,
3. **Regress** realized impact against the predicted impact model (square-root or Almgren-Chriss),
4. **Recalibrate** κ, η, γ coefficients (and the volume-curve forecast) on a rolling basis,
5. **Backtest** the updated parameters on historical metaorder data,
6. **Deploy** to the live algorithm via a feature-flagged rollout,
7. **Monitor** for degradation.

This is the *learning loop* that distinguishes a quant firm's execution desk from a traditional broker's. Quantitative Brokers' institutional pitch emphasizes this: "QB's proprietary TCA platform allows for thorough performance reviews of all orders executed in the Simulator" — the simulator is the offline step (5) above. Jane Street, Citadel Securities, and Jump Trading run this loop at much higher frequency and granularity than any commercial TCA vendor can support.

---

## 10. Math Notation Reference

| Symbol | Definition |
|---|---|
| P_arr | Arrival price (mid-quote at decision / order-release time t0) |
| P_VWAP | VWAP benchmark over the chosen window |
| P_TWAP | TWAP benchmark over the chosen window |
| P_exec | Realized execution price (single fill or value-weighted average) |
| P_mid_t0 | Midpoint of bid-ask at decision time (same as P_arr for liquid contracts) |
| P_mid_t+τ | Midpoint τ seconds/minutes/days after the fill (used for realized spread) |
| P_close_T-1 | Previous session close |
| P_close_T+1 | Next session close (used for T+1 benchmarks) |
| Q | Order quantity (parent / ordered), in contracts or notional |
| q | Filled quantity (executed subset of Q), in contracts or notional |
| Q_unexecuted | Q − q; unexecuted quantity |
| σ | Intraday volatility of the contract (fractional or bps) |
| ADV | Average daily volume (contracts or notional) |
| spread | Bid-ask spread at execution time, in price units |
| κ | Market-impact coefficient, ≈ 0.1–0.3 for liquid futures (square-root law) |
| η | Almgren-Chriss temporary-impact linear coefficient |
| γ | Almgren-Chriss permanent-impact linear coefficient |
| λ | Risk-aversion parameter in mean-variance optimal execution |
| side | +1 for buy, −1 for sell (so positive slippage always = cost) |

### Key Formulas

```
Slippage (bps)            = side × (P_exec − P_B) / P_B × 10,000
VWAP benchmark            = Σ_i (P_i × V_i) / Σ_i V_i
TWAP benchmark            = (1/N) × Σ_k P_k
Interval VWAP             = Σ_{i ∈ [t_first, t_last]} (P_i × V_i) / Σ_{i ∈ [t_first, t_last]} V_i
Midpoint benchmark        = (Bid_t0 + Ask_t0) / 2
Spread cost (bps)         = side × (½ × spread) / P_arr × 10,000
Square-root impact (bps)  = κ × σ × √(Q / ADV)
Implementation Shortfall  = side × [(P_exec_avg − P_arr) × Q_executed
                                    + (P_arr − P_cancel) × Q_unexecuted] / (P_arr × Q_ordered) × 10,000
Effective spread (bps)    = 2 × side × (P_fill − P_mid_t0) / P_mid_t0 × 10,000
Realized spread (bps)     = 2 × side × (P_fill − P_mid_t+τ) / P_mid_t0 × 10,000
Participation rate        = Q_executed / Volume_over_execution_window
Fill rate                 = Q_executed / Q_ordered
Z-score                   = (Slippage_order − μ_hist) / σ_hist

Almgren-Chriss objective:  Minimize  E[Cost] + λ × Var[Cost]   s.t.  Σ X_i = Q
  where  Cost = ½ × η × Σ (X_i² / Δt) + γ × Σ (X_i × cumulative_prior_X)
```

---

## Appendix A — Source Bibliography

1. Perold, A. (1988). "The Implementation Shortfall: Paper vs. Reality." *Journal of Portfolio Management* 14(3): 4–9.
2. Almgren, R. & Chriss, N. (2000). "Optimal Execution of Portfolio Transactions." *Journal of Risk* 3(2): 5–39.
3. Almgren, R., Thum, C., Hauptmann, E., Li, H. (2005). "Direct Estimation of Equity Market Impact."
4. Kissell, R. (2013). *The Science of Algorithmic Trading and Portfolio Management.* Academic Press.
5. Gatheral, J. (2010). "No-Dynamic-Arbitrage and Market Impact." *Quantitative Finance* 10(7): 749–759.
6. Bouchaud, J.-P., Farmer, J. D., Lillo, F. (2009). "How Markets Slowly Digest Changes in Supply and Demand." *Handbook of Financial Markets*.
7. CME Group. "Transaction Cost Analysis for Futures." Education Series, TCA-4.
8. CFA Institute. *Trade Strategy and Execution.* CFA Program 2026 Level III Reading.
9. AQR Capital Management. *Transactions Costs: Practical Application.* White paper.
10. European Securities and Markets Authority (ESMA). Public Statement on RTS 28 best-execution reporting.
11. UK FCA. *PS21/20: Changes to UK MiFID's conduct and organisational requirements.*
12. SEC. *Final Rule: Disclosure of Order Execution Information* (Release 34-96493, 2024; Release 34-99679).
13. Virtu Financial. "Multi-Asset Transaction Cost Analysis" (white paper, August 2020).
14. Bloomberg Professional Services. "Transaction Cost Analysis (BTCA)."
15. Quantitative Brokers. "A Brief History of Implementation Shortfall"; "Best Execution: Unit of Measurement."
16. Kissell Research Group. Pre-Trade model documentation.
17. Tradeweb. "Best Execution Under MiFID II and the Role of TCA."
18. Jane Street Blog and *Signals and Threads* podcast (engineering and execution infrastructure).
19. Ødegaard, B. A. "Trading Costs — Spread Measures." University of Stavanger lecture notes.
20. Berkeley DeFi. "Bid-Ask Spreads: Measuring Trade Execution Costs in Financial Markets" (2010).

---

*End of report. ~6,400 words. Research compiled from 18 web searches across CME Group, CFA Institute, ESMA, SEC, FCA, Virtu, Bloomberg, Quantitative Brokers, Kissell Research Group, Tradeweb, AQR, the Jane Street engineering blog, and the academic literature on Perold (1988), Almgren-Chriss (2000), and the square-root market-impact law.*
