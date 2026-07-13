# Real-Time Kill Switch & Auto-Derisk Systems for Futures Trading

> A research report on the design, regulation, and institutional implementation of automated risk-reduction mechanisms for futures desks.
>
> Compiled from CME Group documentation, CFTC regulations (17 CFR §1.73), SEC Rule 15c3-3, MiFID II Article 17 / RTS 6, ESMA guidance, Eurex T7 / volatility-interruption rules, ICE Interval Price Limit documentation, NYSE Market-Wide Circuit Breaker filings, IBKR / Tradovate / NinjaTrader risk-policy documentation, the academic circuit-breaker literature (Subrahmanyam 1994; Goldstein–Evans–Mahoney 1998; Chen–Petukhov–Wang 2018), Jane Street engineering material, and the FIA / CFTC GMAC "Best Practices for Exchange Volatility Control Mechanisms" (Nov 2023).

---

## 1. Kill Switch Fundamentals

A **trading kill switch** is a hard-wired control that, when tripped, immediately (a) cancels every resting order the firm has outstanding across all venues, (b) blocks all new order entry from the affected strategy / trader / account, and (c) issues flatten-only orders for any residual net position. Unlike a human-imposed "stop trading" instruction, a kill switch is intended to fire in **milliseconds or less** of the trigger condition becoming true, with no discretionary override available to the operator whose strategy is being killed. The CME Globex Execution-Firm kill switch, the Nasdaq Equity Kill Switch, the NYSE Pillar Risk Controls kill switch, and the European "trading-venue kill switch" mandated by MiFID II Article 17(2) all conform to this shape: a binary, latch-once, must-be-re-armed-by-an-authorized-person control that sits *outside* the strategy process.

Every institutional futures desk requires a kill switch because the failure modes of automated trading are catastrophic and fast. The 2010 Flash Crash, the 2012 Knight Capital $440M loss in 45 minutes, the 2013 Goldman Sachs options-fat-finger, the 2015 NYSE outage, and the 2020 CME overnight 5% limit-down circuit (Bloomberg, 9 Mar 2020) all share a common signature: the firm's loss grew by orders of magnitude while humans were still reading the first alert. CFTC Regulation 1.73 explicitly requires each clearing FCM to "establish risk-based limits in the proprietary account and in each customer account based on position size, order size, margin requirements, or similar factors" and to screen every order against those limits pre-trade (17 CFR §1.73; CFTC Letter 20-17). The kill switch is the post-trade counterpart: the control that fires when pre-trade screening has been bypassed or when the market has moved against an already-correct position.

**Kill switch vs. auto-derisk — a critical distinction.** A *kill switch* is binary and total: it cancels all orders and flattens all positions, with no gradation. *Auto-derisk* is a graduated, conditional risk-reduction system that can trim exposure in stages — e.g. flatten 25 % of the largest gross position when 1-day 99 % VaR crosses a soft threshold, flatten 50 % when it crosses a hard threshold, and only then escalate to a full kill switch. Concretely, a kill switch answers the question "is this strategy broken right now?" (yes/no), while auto-derisk answers "is the portfolio's risk budget being consumed too quickly?" (continuous quantity). Both must be present; the kill switch is the floor, auto-derisk is the staircase above it. The FIA "Minimum Standard Recommendations for ETD eTrading" (2019) explicitly distinguishes the two: "Formalised Conformance Testing of the Kill Switch feature is recommended. Detail on whether the Kill Switch does anything more than cancel open orders should [be specified]." Auto-derisk is what happens between the cancel-and-flatten extremes.

---

## 2. CME Globex Circuit Breaker Rules (Post-2022)

### 2.1 The 7% / 13% / 20% Market-Wide Circuit Breaker (MWCB) framework

CME equity-index futures coordinate with the NYSE / Cboe / NYSE American cash-equity Market-Wide Circuit Breakers under NYSE Rule 7.12 (amended 2012, refined 2022). The trigger levels are computed against the *previous trading day's* S&P 500 closing price and are evaluated continuously during the cash session:

| Level | S&P 500 decline | Trading halt | Applies |
|-------|-----------------|---------------|---------|
| Level 1 | **−7 %** | 15-minute halt (cash + futures) | Before 2:25 p.m. CT only |
| Level 2 | **−13 %** | 15-minute halt (cash + futures) | Before 2:25 p.m. CT only |
| Level 3 | **−20 %** | **Close for the rest of the trading day** | Any time during the session |

CME's own documentation (cmegroup.com/trading/price-limits.html) confirms: "From 8:30 a.m. to 2:25 p.m. CT, there are successive price limits corresponding to 7 %, 13 %, and 20 % declines below the previous trading day's reference price." After 2:25 p.m. CT, *only* the 20 % Level-3 limit is active — meaning late-session selloffs can run all the way to −20 % without an intermediate halt, then close for the day. CME's education portal adds: "The 7 % and 13 % circuit breakers are each followed by 10-minute trading halts; if the 20 % level is reached, the market closes for the trading day." (The 15-minute duration used by the cash markets and the 10-minute duration used by CME futures differ slightly; the CFTC GMAC Best-Practices document (Nov 2023) clarifies the coordination mechanism: "During daytime trading hours, CME Group U.S. equity futures circuit breakers are coordinated with cash equity market circuit breakers at 7 %, 13 %, and 20 %." The futures resume trading when the cash market resumes.)

### 2.2 Special Price Indicator (SPI) / two-minute monitoring

For US equity-index futures, CME operates a parallel *product-level* mechanism distinct from the MWCB. When a futures contract trades to within 2 % of its daily price limit, CME's **Special Price Indicator (SPI)** mechanism enters a **two-minute monitoring period**. If the limit condition persists at the end of those two minutes, a **two-minute trading halt** is imposed on the primary futures contract (cmegroup.com/trading/equity-index/us-based-equity-index-futures-price-limits-faq.html). The CFTC GMAC document describes the overnight analog: "During overnight hours, if the market moves beyond 3.5 %, up or down, within an hour, trading is paused for two minutes." This is the **dynamic circuit breaker** Optiver's "illustrated guide to price controls on US exchanges" describes as: "These controls suspend trading whenever prices breach an upper or lower bound (e.g., ±5 %) that is set relative to a rolling lookback window."

### 2.3 Cross-exchange coordination

MWCB triggers are coordinated across all US cash equities venues (NYSE, NYSE American, NYSE Arca, Nasdaq, Cboe BYX/BZX/EDGA/EDGX, IEX) and all CME equity-index futures (ES, MES, NQ, MNQ, RTY, YM, etc.). The NYSE MWCB FAQ states: "The NYSE equities and options exchanges have procedures for coordinated cross-market trading halts if a severe market price decline reaches levels that may... " trigger a halt. Cboe's 2024 MWCB Testing Notice confirms that member firms must "Send orders following a Level 1 or Level 2 MWCB halt in a manner consistent with usual trading behavior" — i.e. they must be operationally able to resume on a 15-minute notice. The March 2020 COVID-triggered Level-1 halts (16 Mar 2020 and 18 Mar 2020) remain the live-fire case study: futures on Globex halted in coordination with cash equities, then resumed 15 minutes later, all without manual intervention.

### 2.4 How the kill switch should react to a circuit breaker

A correctly designed auto-derisk system treats a market-wide circuit breaker as a **first-class trigger**, not a market-data event. Recommended behaviors:

1. **On MWCB Level 1 or Level 2 trigger** (the 15-minute halt):
   - Immediately cancel all *non-hedge* resting orders so they do not re-fill when the halt lifts.
   - Hold hedge orders passive (they will not execute during the halt anyway, but cancelling them risks an unhedged resume).
   - Freeze any strategy whose entry signal depends on the halted instrument; pre-position only flatten orders for resume.
   - Recompute `VaR_1d_99` against the post-halt implied volatility surface — vol almost always reprices *up* after an MWCB.

2. **On MWCB Level 3 trigger** (rest-of-day close):
   - Hard-kill all strategies on the affected product.
   - Flatten any residual position into the next session's open at the discretion of the risk officer (many desks have a standing rule: "Level-3 → flatten-to-zero at next open, no exceptions").
   - Lock out new entries until the risk officer performs the two-person re-arm (see §11).

3. **On a SPI / dynamic breaker trigger** (the 2-minute monitoring halt):
   - The halt is short enough that *cancelling* is usually wrong — fill risk on resume is high.
   - Re-price limit orders to the new post-halt band; if the band is limit-up/limit-down locked, convert to marketable limit on resume.

---

## 3. Daily Loss Limit Rules

Institutional futures desks layer daily loss limits at four granularities. The objective is to make the firm's daily VaR budget *unbreachable* even if every individual strategy simultaneously runs to its own limit.

### 3.1 Per-trader daily loss limit

A typical institutional seat (e.g. an ES seat at a Chicago prop desk) carries a per-trader daily loss limit in the **$25k–$100k** range. CME's own education material ("The 2% Rule", cmegroup.com) frames this in percentage terms: "if you are trading a $50,000 account, and you choose a risk management stop loss of 2%, you could risk up to $1,000 on any given trade." That is the per-trade version; the per-trader *daily* version is typically set at **3× the per-trade risk budget**, so a $50k account with a 2 % per-trade rule has a ~$3,000 daily loss limit. Real institutional numbers are far larger: a Topstep / funded-futures 50k Combine sits at ~$1,200 DLL; a $150k institutional seat commonly sits at $5k–$10k; a CME-member ES seat at a major prop firm can carry a $50k–$100k DLL. Topstep's blog ("How daily loss limits build discipline") notes that the limit should be set at **40 % of max drawdown** as a soft cap.

### 3.2 Per-strategy daily loss limit

Each strategy gets its own daily loss limit calibrated to its target Sharpe and historical volatility:

$$
\text{DLL}_{\text{strategy}} = 2 \cdot \text{Sharpe}_{\text{target}}^{-1} \cdot \sigma_{\text{daily}} \cdot \text{Equity}
$$

For a Sharpe-2 strategy with daily vol 0.7 % on $10M equity, that is roughly 2 × 0.5 × 0.007 × $10M = **$70,000 daily loss limit**. The factor of 2 is a heuristic: it is roughly the 99 % one-tailed z-score for a normal distribution, so the limit fires on a ~2.5σ down day, not on routine noise.

### 3.3 Per-session max drawdown

The per-session max drawdown is typically set to **2× the daily Sharpe-target volatility**, which gives the trader one bad day's worth of cushion before the daily limit itself fires. Formally:

$$
\text{MaxDD}_{\text{session}} = 2 \cdot \sigma_{\text{daily}} \cdot \text{Equity}
$$

This is distinct from the daily loss limit (which is realized PnL-based) — the session max drawdown tracks intraday equity against the day's starting equity and trips even if the day ends flat. A trader can blow the session-DD limit and then recover, and the limit still fires.

### 3.4 The "three-strikes" rule

The three-strikes rule — *three consecutive losing trades in a single session → flatten for the day, no re-entry* — is a behavioural circuit breaker. The EdgeFlo blog ("The Three Loss Rule") states it crisply: "Three consecutive losses in a single session means you stop trading for the day. The rule prevents revenge trading spirals before they start." Reddit's prop-firm community data (r/Trading, 2025) corroborates: "traders who survive set a soft stop around 60 % of the daily line and add a cooldown after 2–3 red trades in a row." CrossTrade's daily-loss-limits guide frames the rule as a *size* question: "You can absorb 3 losing trades in a row without panicking. If you're trading at a prop firm [that] enforces its own daily loss limit — often 2–4 % of the combine..." The three-strikes rule is therefore not a monetary control per se; it is a *process* control that prevents the trader from escalating size after early losses.

### 3.5 Loss-limit reset timing

Daily loss limits reset at the **start of the next trading session**, which for CME Globex means 5:00 p.m. CT Sunday–Thursday (the Globex session open). Firms that trade both the overnight session and the RTH day session sometimes distinguish an *intraday* reset (5:00 p.m. CT) from a *calendar* reset (midnight CT). This matters because CME settlement is at 14:59 CT, so a daily-loss-limit breach at 14:55 CT can be re-armed at 15:00 CT for the overnight session if — and only if — the firm's policy treats settlement as the reset boundary.

---

## 4. VaR-Based Auto-Derisk

Value-at-Risk is the dominant real-time risk metric on institutional futures desks because it is dimensionally comparable across asset classes, can be computed on a tick-by-tick basis, and has a clean probabilistic interpretation. The standard triggers (per the CFA Level II risk-management curriculum, AnalystPrep summary):

### 4.1 Two-stage VaR triggers

The canonical two-stage trigger uses 1-day 99 % VaR as a fraction of equity:

- **Soft trigger**: `VaR_1d_99 > 1.5 % of Equity` → flatten 50 % of the largest contributing position, send a warning to the risk officer, block new entries.
- **Hard trigger**: `VaR_1d_99 > 2.5 % of Equity` → flatten 100 %, hard kill the strategy, two-person re-arm required.

These thresholds are calibrated against the strategy's target Sharpe: a Sharpe-2 strategy with daily vol 0.7 % has a routine 99 % VaR of roughly `2.33 × 0.7 % = 1.6 % of Equity`, so the soft trigger at 1.5 % fires roughly once every 100 trading days under normal conditions — the right cadence for a soft warning. The 2.5 % hard trigger is a ~3.6σ event, which under a normal distribution should occur less than once every 100 years; if it fires, something is genuinely wrong with the strategy or the market.

### 4.2 Component VaR contribution

Beyond the *aggregate* VaR trigger, every desk monitors **Component VaR** — the marginal contribution of each position to the portfolio VaR. The trigger:

$$
\text{if } \frac{\text{CVaR}_i}{\text{VaR}_{\text{portfolio}}} > Z \text{ (typically 30 %)}, \quad \text{trim position } i \text{ by } \frac{1}{2}
$$

This prevents a single position from dominating the portfolio risk budget. A common choice is Z = 25 % (four-position-concentration limit) or Z = 30 % (three-position-concentration limit), enforced by trimming whichever position has the highest Component VaR.

### 4.3 Parametric vs. Historical vs. Monte Carlo VaR

For real-time trigger purposes, the three methods differ materially in speed, accuracy, and tail behavior:

**Parametric (variance-covariance) VaR.** Computes `VaR = z_α × σ_portfolio × √Δt` under the assumption that returns are jointly normal. Pros: closed-form, microsecond-fast on an FPGA, no simulation noise. Cons: catastrophic under fat tails; a strategy that sells options will look benign right up until it blows up. CFA curriculum: "The Parametric Model estimates VaR directly from the Standard Deviation of portfolio returns. It assumes that risk factor returns are normal." Use parametric for the *sub-second* kill-switch layer; never as the sole trigger.

**Historical Simulation VaR.** Sorts the last N days (typically 250 or 500) of portfolio returns and takes the empirical (1−α)-quantile. Pros: no distributional assumption, captures fat tails naturally, easy to explain to regulators. Cons: slow to react to regime change (it weights 2008 the same as last Tuesday), and the lookback window choice is arbitrary. Use historical VaR for the *5-second* soft trigger layer.

**Monte Carlo VaR.** Simulates 10,000–100,000 paths from a fitted factor model. Pros: captures non-linear payoffs (options, spreads), stress scenarios can be folded in, gold standard for accuracy. Cons: too slow for tick-by-tick; even on a GPU cluster, a 100k-path MC recompute is 50–200 ms. Use Monte Carlo for the *1-minute* hard-trigger layer, with parametric VaR as the fast pre-filter.

The Quant StackExchange summary is right: "Monte Carlo simulation is computationally a lot more expensive than Historical Simulation or V-CV and requires that a large number of asset [paths be simulated]." Best practice is to **run all three in parallel**, each at its own cadence, and trip the kill switch on the *max* of the three estimates (not the mean), so the fattest-tailed method governs.

---

## 5. Stress-Test-Driven Derisk

Beyond statistical VaR, every institutional desk runs **named historical stress scenarios** against the live book. The Federal Reserve's 2026 severely-adverse scenario, the ECB's 2020 COVID-19 stress template, and the Bank of England's 2022 rate-shock scenarios are the three live reference points. The mechanism is simple: every 60 seconds (or on every position change), re-value the current portfolio against each scenario's historical factor moves; if the stressed PnL breaches a threshold, flatten.

### 5.1 The 2008 GFC scenario replay

Replay the 15 Sep 2008 – 10 Mar 2009 factor moves: S&P 500 −46 %, WTI −66 %, 10Y Treasury yield −150 bp, USD index +12 %, VIX peak 89. Apply those factor shocks *instantaneously* to the current book and compute the resulting `ΔEquity`. Threshold for flattening: 5 % of `Equity`.

### 5.2 The 2020 COVID crash scenario

Replay the 16 Mar 2020 day: S&P 500 −12 % intraday (Level-1 MWCB triggered at the open), ES overnight limit-down −5 %, WTI −30 %, VIX intraday 82. The COVID scenario is more violent but shorter than the GFC scenario; it is the right trigger for short-horizon strategies. Threshold for flattening: 3 % of `Equity` in a single session.

### 5.3 The 2022 rate-shock scenario

Replay Q3 2022: 10Y Treasury yield +140 bp in 8 weeks, mortgage rates 5.5 % → 7.2 %, USD index +8 %, NASDAQ −15 %. This is the *gradual* stress test — it filters out strategies that look fine in the GFC replay (which is a fast crash) but bleed out in a slow-rate-shock.

### 5.4 Trigger logic

If `StressedPnL > threshold` on any scenario, escalate through the auto-derisk ladder:

1. First breach: trim 50 % of the most-stressed position.
2. Second breach (same scenario, 5 minutes later): trim 100 %.
3. Third breach or simultaneous breach on two scenarios: hard kill.

The Cambridge-Judge "Risk Culture" slides (2016 Risk Summit) emphasize that stress testing should drive *real-time probabilities*, not just static capital measures — i.e., the scenario weights should reflect the current macro regime (high-VIX regime → weight COVID and GFC scenarios higher).

---

## 6. Margin Call Protection

The most operationally critical auto-derisk layer is **margin protection**, because breaching maintenance margin puts the account into the FCM's liquidation queue — and the FCM will liquidate at *market*, with no favourable execution.

### 6.1 Margin utilization thresholds

- `Margin_Used / Margin_Avail > 70 %` → warning only, block new entries.
- `Margin_Used / Margin_Avail > 90 %` → auto-flatten 50 % of the largest gross position.
- `Margin_Used / Margin_Avail > 95 %` → hard kill, flatten everything, lock account.

The 70/90/95 ladder is calibrated to give the risk officer time to act before the FCM does. The OCC/DCO self-certification (Sep 2025) describes the clearing-house analog: "After MRDM verifies that unrealized losses on a Clearing Member's account are greater than 50 % of the account's total risk charges, a [margin call]..." — i.e., the clearing house itself starts escalating at the 50 %-of-risk-charges threshold, so the firm-side 70/90/95 ladder sits *above* that to give headroom.

### 6.2 The IBKR / Tradovate reality

Interactive Brokers' published policy is the clearest statement of how a real FCM handles margin deficiency: "Interactive Brokers does not make margin calls. Instead, real-time liquidations occur when an account has a margin deficiency." The IBKR Glossary adds: "Generally, accounts will not have time to deposit funds to meet a margin deficiency." Translation: the moment the firm-side auto-derisk fires at 90 % utilization, the FCM is one bad tick away from firing at 100 % — and the FCM will liquidate first and notify second. The "Liquidate Last" flag in TWS exists exactly for this: "If set to 'Yes' this position will be put at the end of the queue to liquidate last in the case of margin requirements." A well-designed kill switch should set "Liquidate Last" on hedge legs to prevent the FCM from breaking the hedge pair.

### 6.3 The 60-second margin-call rule

For FCM margin calls (as opposed to auto-liquidations), institutional desks operate a **60-second rule**: from the time the FCM's margin-call notification arrives (typically via FIX `MarginCall` message or email), the desk has 60 seconds to either (a) post additional margin, or (b) auto-flatten to a level that brings utilization back under 80 %. The Tradovate Liquidation Policy is typical: "The firm may liquidate the account with or without notification depending upon market conditions based upon the sole discretion of the firm." The 60-second countdown therefore begins when the FCM's risk system generates the call, *not* when the trader reads the email — which is why the auto-flatten must be triggered by the *margin-call FIX message itself*, not by the human.

---

## 7. Drawdown-Based Derisk

Drawdown-based controls fire on the *shape* of the equity curve, not its instantaneous level. They are the primary defense against slowly-decaying strategies that look fine on a single-day basis but bleed over weeks.

### 7.1 Maximum drawdown limit

The institutional standard is a **10 % peak-to-trough max drawdown** on the strategy's high-water mark:

$$
\text{Drawdown} = \frac{\text{Peak\_Equity} - \text{Equity}_{\text{now}}}{\text{Peak\_Equity}}
$$

If `Drawdown > 10 %`, the strategy is hard-killed. The CME simulation-based hedge-fund evaluation paper (cmegroup.com) confirms the Calmar definition: "Calmar ratio is defined as the ratio of annualized excess return to the maximum drawdown." A Calmar of 1.0 with a 10 % max-DD limit corresponds to a ~10 % annualized return; the 10 % limit is the standard because it gives a 1.0-Calmar strategy exactly one bad year of cushion.

### 7.2 Rolling drawdown limit

A second, tighter, rolling limit catches *fast* drawdowns:

- 5 % peak-to-trough over 5 trading days → flatten 50 %.
- 7 % peak-to-trough over 10 trading days → flatten 100 %.

The rolling limit fires before the absolute 10 % limit if the drawdown is fast; this is the rule that catches a strategy that is "working fine" until it suddenly isn't.

### 7.3 High-water mark reset rules

The high-water mark (`Peak_Equity`) is the highest equity the strategy has ever achieved (since inception, or since the last reset — desk policy varies). The Drechsler (2011) "Risk Choice under High-Water Marks" paper shows that high-water-mark contracts push managers toward *higher* risk when below the HWM (because their option-like incentive payoff only has value above the HWM) and *lower* risk when above it. The auto-derisk system must therefore reset the HWM *only* on a calendar basis (monthly or quarterly) — never on a soft re-arm — to prevent the manager from gaming the reset.

### 7.4 Calmar ratio protection

Beyond absolute drawdown, the **Calmar ratio** provides a risk-adjusted circuit breaker:

$$
\text{Calmar} = \frac{\text{CAGR}}{\text{MaxDD}}
$$

If `Calmar < 0.5` over a trailing 36-month window, flatten. The IBKR Quant blog ("Mastering the Calmar Ratio") is explicit: "A higher Calmar Ratio indicates a better risk-adjusted return. Ongoing Monitoring: Regularly update the Calmar Ratio with current data..." The 0.5 threshold corresponds to "this strategy is generating half the return its drawdown is consuming" — i.e., it has decayed from its in-sample promise and should be killed.

---

## 8. Volatility-Regime Derisk

Volatility regime is a *macro* state, not a portfolio state — but it materially affects the portfolio's risk budget, and most institutional desks auto-derisk based on regime alone.

### 8.1 VIX threshold

The standard rule, per the VolatilityBox "Volatility Regimes Explained" classification:

| Regime | VIX | Action |
|--------|-----|--------|
| Low | < 15 | Normal sizing |
| Normal | 15–20 | Normal sizing |
| Elevated | 20–30 | Reduce position size by 25 % |
| Crisis | > 30 | Flatten all non-hedge positions |

The VIX > 30 threshold is the standard "crisis regime" trigger. The MSCI "Risk of Risk Limits" research (msci.com) notes: "This hypothetical portfolio follows a strategy whereby we de-risk as soon as the portfolio's volatility estimate exceeds 20 %. We partly sell the [position]." VIX-30 is the cross-asset equivalent of that rule.

### 8.2 Realized vol multiplier

Beyond VIX (which is *implied*), realized vol provides an independent trigger:

$$
\text{if } \text{RealizedVol}_{20d} > 2 \cdot \sigma_{30d}, \quad \text{flatten 50 \%}
$$

This catches the case where VIX is lagging (it sometimes does, particularly overnight) but realized vol has already spiked. A 2× multiple over the trailing 30-day average is roughly a 95th-percentile event under normal vol-of-vol.

### 8.3 Vol-of-vol spike

Vol-of-vol — the realized volatility of the VVIX, or the standard deviation of `σ_30d` over the last 30 days — is the cleanest signal of regime instability. A 2σ spike in vol-of-vol is a *pre-emptive* flatten trigger, because vol-of-vol tends to lead realized vol by 2–5 days.

### 8.4 Implied-realized vol spread inversion

Under normal conditions, implied vol trades at a *premium* to realized vol (the "variance risk premium"). When that premium inverts — when `VIX < RealizedVol_20d` — the market is signalling that realized vol is *expected to fall*, which historically is a contrarian "panic already happened" signal. But when the inversion is *extreme* (VIX more than 5 points below realized), it usually precedes a fresh leg down. The trigger: if `RealizedVol_20d - VIX > 5`, flatten all non-hedge positions.

---

## 9. Position-Level Derisk

Each individual position carries its own derisk ladder, evaluated independently of the portfolio.

### 9.1 Stop-loss

The simplest and most-violated rule:

$$
\text{if } \text{PnL}_i < -\text{StopLoss}_i, \quad \text{flatten position } i
$$

The discipline is in setting `StopLoss_i` *before* the position is opened, in writing, and making the kill-switch enforce it without override. Stop-loss should be set at 1–2× the strategy's expected per-trade vol, not at a round number.

### 9.2 Beta-adjusted exposure

For equity-index futures, the notional exposure must be beta-adjusted:

$$
\text{Exposure}_i^{\beta} = \text{Notional}_i \cdot \beta_i
$$

If `Exposure_i^{\beta} > threshold` (typically 25 % of `Equity`), trim. The beta-adjusted view prevents a "small" notional in a high-beta instrument (e.g. NQ) from dominating the risk budget.

### 9.3 Concentration limit

A single position should not exceed **25 % of portfolio risk** (measured by Component VaR, not notional). This is the four-position-concentration rule. The trim trigger:

$$
\text{if } \frac{\text{Notional}_i}{\text{Equity}} > 25 \%, \quad \text{trim to } 20 \%
$$

### 9.4 Sector concentration

For sector-index futures (e.g. XLK, XLF, XLE), no single sector should exceed 40 % of the equity-index book. This is enforced by the same Component-VaR trim logic but applied at the sector-aggregate level rather than per-position.

---

## 10. Time-Based Rules

Time-based derisk fires on the clock, independent of price or PnL.

### 10.1 Pre-FOMC flatten

The institutional standard is **auto-flatten 5 minutes before every FOMC announcement**, with the announcement time pulled from the Federal Reserve's published FOMC calendar (federalreserve.gov/monetarypolicy/fomccalendars.htm). FOMC announcements are 1:00 p.m. CT (statement) and 1:30 p.m. CT (press conference) on the second day of two-day meetings. The 5-minute buffer is calibrated to (a) avoid the *pre-announcement* drift that starts ~10 minutes before, (b) give the system time to flatten illiquid positions, and (c) leave the trader flat through the announcement itself, which is the highest-volatility 60 seconds of the typical month. The FXStreet economic-calendar guidance generalizes: "Reduce position size or stay flat 15–30 mins before the release... Avoid placing new trades just [before]."

### 10.2 End-of-session flatten

For strategies that should not carry overnight risk (most intraday equity futures strategies), the rule is **auto-flatten by 14:59 CT** (1 minute before CME settlement) for the RTH day session, and **auto-flatten by 16:00 CT** for the overnight session. CME's E-mini S&P 500 trading-hours documentation (itg-futures.com PDF) shows the relevant session boundaries: "GLBX: Monday–Friday 5:00 p.m. previous day – 4:00 p.m.; trading halt from 3:15 p.m. – 3:30 p.m. OO: Monday–Friday 8:30 a.m. – 3:15 p.m." The 15:15–15:30 CT maintenance halt is a natural flatten checkpoint.

### 10.3 Economic-release block

Block new order entry (but *do not* auto-flatten existing positions) during the 60 seconds bracketing each high-impact economic release: NFP (first Friday of the month, 7:30 CT), CPI (mid-month, 7:30 CT), FOMC (eight scheduled meetings), GDP (quarterly), PPI, retail sales. The block window is typically T−60s to T+60s for futures-only strategies, T−300s to T+120s for option-bearing strategies. The New York Fed Economic Indicators Calendar (newyorkfed.org/research/calendars/nationalecon_cal) is the authoritative source.

### 10.4 Weekend carry limit

Flatten all positions before **Friday 16:15 CT** (CME close into the weekend). Weekend gap risk is real and un-hedgeable — the 2020 March COVID weekend gaps, the 2016 Brexit weekend gap, and the 2008 Lehman weekend gap all moved futures 3–7 % between Friday close and Sunday open. The weekend-carry rule is non-negotiable for all strategies that are not explicitly *weekend-carry* strategies (which should be a separate, much smaller, separately-permissioned book).

---

## 11. Implementation Patterns

### 11.1 Two-stage kill: soft warning + hard kill

Every limit should have a *soft* threshold at 80 % of the hard limit. The soft threshold triggers a warning, blocks new entries, and pre-positions flatten orders — but does *not* execute them. The hard threshold at 100 % executes the flatten. This 80/20 buffer gives the risk officer visibility without taking the strategy offline on noise, and it gives the system time to ramp out of illiquid positions rather than dumping them in one shot. The Reddit prop-firm data (r/Trading, 2025) confirms: "traders who survive set a soft stop around 60 % of the daily line and add a cooldown after 2–3 red trades in a row."

### 11.2 Kill switch hierarchy

The kill switch must be evaluated bottom-up, not top-down:

1. **Per-position kill**: `PnL_i < -StopLoss_i` → flatten position `i` only.
2. **Per-strategy kill**: `PnL_strategy < -DLL_strategy` → flatten all positions in strategy, block new entries for strategy.
3. **Per-account kill**: `PnL_account < -DLL_account` → flatten all positions in account, block all entries.
4. **Per-broker (FCM) kill**: `Margin_Used / Margin_Avail > 95 %` → flatten all positions across all strategies at that FCM.
5. **Per-firm kill**: `VaR_1d_99 > 2.5 % of Equity` (firm-wide) → flatten everything, everywhere, no exceptions.

Each level latches and requires the next-higher level's risk officer to re-arm. The CME Globex Execution-Firm kill switch documentation (cmegroup.com/tools-information/webhelp/globex-credit-controls) confirms this design: "Multiple EF risk administrators can be permissioned for the same Execution Firm, in which case a kill applied by one administrator can be removed by another" — i.e. the re-arm authority is separate from the trip authority.

### 11.3 Audit log requirements

Under SEC Rule 17a-4(f) (as amended Nov 2022), broker-dealers must preserve "comprehensive recordkeeping of all activities related to securities transactions" for 3–6 years. The 2022 amendment introduced an explicit **audit-trail alternative** to the WORM (write-once-read-many) requirement, allowing firms to preserve a tamper-evident audit trail rather than a WORM copy (sec.gov Final Rule 34-96034). The audit trail must reconstruct, for every order: timestamp (microsecond), order ID, trader ID, strategy ID, instrument, side, quantity, price, limit type, venue, and — critically — every risk-check evaluation (pass/fail/kill-fired). For CFTC-regulated firms, CFTC Regulation 1.73 requires that order-screening records be preserved; for MiFID II firms, RTS 6 requires logging of every algorithmic decision including kill-switch events.

The MiFID II RTS 6 Article 15 pre-trade risk controls are the most prescriptive: firms must maintain "pre-trade limits for maximum order price, maximum order size, maximum order message throughput, and a kill-switch." The ESMA Final Report on algorithmic trading (esma70-156-4572) confirms: "Stress testing concerns testing that the investment firm must carry on its algorithm against which, for the purposes of MiFID II, the trading [venue must coordinate]."

### 11.4 Human-in-the-loop override with two-person rule

The kill switch should be **latched** — once tripped, it stays tripped until an authorized risk officer re-arms it. The OpenAlgo guidance is blunt: "A kill switch that automatically re-arms is worse than none, because it lulls you into trusting it. Make the trip one-way: latch it, log who and what tripped [it]." For re-arm, the **two-person rule** is standard: two authorized risk officers must independently authenticate (different passwords, different hardware tokens) to re-arm. The CME Globex EF kill-switch documentation supports this pattern: "Multiple EF risk administrators can be permissioned for the same Execution Firm." The Nasdaq Equity Kill Switch documentation similarly distinguishes Risk Users (who can trip) from Master Risk Users (who can re-arm).

### 11.5 Re-arm cooldown period

After any kill event, impose a **5-minute minimum cooldown** before re-arm is even possible. This prevents the strategy that just got killed from immediately restarting, and it gives the risk officer time to investigate the root cause. The Traders Magazine coverage of the European Kill Switch design discussion ("Brokers Wary About Kill Switch Design") notes that "any attempt to cut a broker off could involve multiple warnings first—telephonic, electronic or both" — the cooldown is the formalization of those warnings.

---

## 12. Jane Street / Citadel / Jump Practices

### 12.1 Hard-coded daily loss limits

Institutional HFT firms hard-code daily loss limits into the trading engine at *compile time*, not at configuration-load time. The reason: a runtime-configurable limit can be raised by a trader under stress; a compiled-in limit cannot. The CFTC Regulation 1.73 requirement that "Clearing FCMs ... establish risk-based limits in the proprietary account and in each customer account" is interpreted by major desks as: the limit values themselves are owned by Risk, not by Trading, and the only way to change them is a code change signed off by the CRO. This pattern is visible in the Jane Street "Production Engineering When Trading Billions of Dollars a Day" talk (YouTube, signalsandthreads.com): risk limits are part of the deployment artifact, not a runtime parameter.

### 12.2 Real-time VaR recomputation on every tick

Jane Street's Ron Minsky (Head of Technology) has stated publicly that some Jane Street systems "can react in under 100 nanoseconds" (Instagram/Youtube interviews, 2025). For VaR specifically, this means parametric VaR is recomputed on every market-data tick — not on every trade — using a hardware-accelerated variance-covariance matrix update. The 100-nanosecond floor is the FPGA tick-to-trade latency; the VaR recompute sits behind that, at perhaps 1–10 microseconds, fast enough to trip a kill switch before the next tick arrives. The practical implication: by the time a human can see a red PnL number on a screen, the FPGA kill switch has already tripped, cancelled, and flattened.

### 12.3 FPGA-based kill switch

Jane Street, Citadel Securities, Jump Trading, Optiver, and IMC all run FPGA-accelerated market-data paths and order paths. The Medium article "FPGA Acceleration in HFT" (2025) summarizes: "FPGA-accelerated systems operate in hundreds of nanoseconds. Sub-microsecond trading attracts regulatory scrutiny." The kill switch is implemented in the FPGA itself — *before* the order leaves the firm's network — so that no order can be sent that violates the pre-trade risk limits. This is the CFTC Regulation 1.73 "screen orders for compliance with the risk-based limits" requirement taken to its hardware conclusion: the screen happens in the FPGA, in nanoseconds, on every order, with no software in the path.

### 12.4 "Trip wire" alerts before kill trigger fires

The kill switch is the last line of defense; the *trip wires* are the earlier lines. A typical trip-wire ladder:

- **Trip wire 1** (informational): `PnL_today < -0.5 × DLL` → Slack alert to the desk.
- **Trip wire 2** (warning): `PnL_today < -0.8 × DLL` → Slack alert to risk officer, sound on desk.
- **Trip wire 3** (block new entries): `PnL_today < -0.9 × DLL` → strategy enters flatten-only mode.
- **Kill** (hard): `PnL_today < -1.0 × DLL` → hard kill, latch, two-person re-arm.

The Nasdaq Equity Kill Switch documentation describes this exact pattern: "The Nasdaq Kill Switch is a tool offered by Nasdaq that enables a participant to establish levels of Risk Exposure, to receive notifications as the value of..." — i.e. notifications *before* the kill, not just at the kill.

### 12.5 Auto-disable on engine anomaly

Beyond market and PnL triggers, the kill switch must fire on *engine-health* anomalies:

- **Latency spike**: if the order-ack latency exceeds 3× the trailing 1-minute median, hard kill. The strategy is either (a) being queued behind an exchange backlog, (b) suffering a network issue, or (c) being frontrun — all of which justify a flatten.
- **Data gap**: if no market-data tick has been received for an instrument in N seconds (where N is the product's typical tick interval × 10), hard kill. The classic failure mode is a partial feed outage where one leg of a spread stops ticking but the other continues, producing phantom arbitrage signals.
- **Mid-quote gap**: if the best bid / best ask mid moves more than X basis points in one tick (X = 50 bp for ES, 100 bp for NQ), hard kill. This is the "Knight Capital" defense — a fat-finger or a stale-quote bug can move the mid-quote dramatically in a single tick, and the right action is to stop, not to keep trading.

The Jane Street "Safe at Any Speed" tech talk (janestreet.com/tech-talks) and the "Production Engineering When Trading Billions of Dollars a Day" YouTube talk both describe these engine-health checks as first-class kill-switch triggers, on par with the PnL triggers.

---

## 13. Summary of Math Notation

The following variables are used throughout this report and should be tracked in real time by any kill-switch / auto-derisk implementation:

| Variable | Definition |
|----------|-----------|
| `PnL_today` | Realized + unrealized PnL since session open |
| `Equity` | Current account equity (cash + positions marked-to-market) |
| `VaR_1d_99` | 1-day 99% Value-at-Risk of the current portfolio |
| `Margin_Used` | Currently-posted initial + maintenance margin |
| `Margin_Avail` | Total margin capacity (cash + securities collateral) |
| `Drawdown` | `(Peak_Equity - Equity) / Peak_Equity` |
| `Peak_Equity` | High-water mark of `Equity` since strategy inception or last reset |
| `VIX` | CBOE Volatility Index (implied 30-day S&P 500 volatility) |
| `RealizedVol` | Realized 20-day or 30-day return volatility |
| `σ_30d` | 30-day rolling standard deviation of returns |
| `Beta` | Position beta vs. relevant benchmark (e.g. SPX for ES) |
| `Exposure` | Beta-adjusted notional exposure of a position or portfolio |
| `StopLoss` | Pre-committed per-position stop-loss level |

The trigger hierarchy (in evaluation order, every tick):

1. `PnL_i < -StopLoss_i` → flatten position `i`.
2. `Margin_Used / Margin_Avail > 0.90` → flatten 50 % of largest position.
3. `Margin_Used / Margin_Avail > 0.95` → hard kill, flatten everything.
4. `VaR_1d_99 > 1.5 % × Equity` → soft trigger, trim 50 %.
5. `VaR_1d_99 > 2.5 % × Equity` → hard kill, flatten everything.
6. `Drawdown > 5 %` (5-day rolling) → trim 50 %.
7. `Drawdown > 10 %` (peak-to-trough) → hard kill, latch.
8. `Calmar < 0.5` (36-month trailing) → hard kill, strategy decommissioned.
9. `VIX > 30` → flatten all non-hedge positions.
10. `RealizedVol_20d > 2 × σ_30d` → flatten 50 %.
11. Three consecutive losing trades in session → flatten for day.
12. `Margin_Used / Margin_Avail > 0.95` AND FCM margin call received → flatten in ≤ 60 s.
13. MWCB Level 1/2 trigger → cancel non-hedge orders, freeze entries.
14. MWCB Level 3 trigger → hard kill for the day, two-person re-arm.
15. 5 minutes before FOMC announcement → auto-flatten.
16. Friday 16:15 CT → flatten all positions for weekend.

---

## References (Selected)

- **CME Group**, "S&P 500 Price Limits FAQ" — cmegroup.com/trading/equity-index/sp-500-price-limits-faq.html
- **CME Group**, "US-Based Equity Index Futures Price Limits FAQ" — cmegroup.com/trading/equity-index/us-based-equity-index-futures-price-limits-faq.html
- **CME Group**, "Understanding Price Limits and Circuit Breakers" — cmegroup.com/education/articles-and-reports/understanding-price-limits-and-circuit-breakers
- **CME Group**, "Price Limits: Ags, Energy, Metals, Equity Index" — cmegroup.com/trading/price-limits.html
- **CME Group**, "Enforcing Kill Switch" (Globex Credit Controls) — cmegroup.com/tools-information/webhelp/globex-credit-controls/Content/KS_Detail.html
- **CME Group**, "The 2% Rule" — cmegroup.com/education/courses/trade-and-risk-management/the-2-percent-rule
- **CME Group**, "A simulation-based methodology for evaluating hedge fund [Calmar ratio]" — cmegroup.com/education/files/simulation-based-framework-for-hedge-fund-evaluations.pdf
- **CFTC**, 17 CFR §1.73 "Clearing futures commission merchant risk management" — law.cornell.edu/cfr/text/17/1.73
- **CFTC**, Letter No. 20-17 (May 13, 2020) — cftc.gov/csl/20-17/download
- **CFTC GMAC / FIA**, "Best Practices for Exchange Volatility Control Mechanisms" (Nov 2023) — cftc.gov/media/9581/gmac_FIA110623/download
- **CFTC**, "Kill Switches and Price Limits" Federal Register 2013-22185 — cftc.gov/LawRegulation/FederalRegister/finalrules/2013-22185.html
- **SEC**, Rule 15c3-3 "Customer Protection Rule" — law.cornell.edu/cfr/text/17/240.15c3-3
- **SEC**, Final Rule 34-96034 "Electronic Recordkeeping Requirements for Broker-Dealers" (2022) — sec.gov/files/rules/final/2022/34-96034.pdf
- **SEC / FINRA**, Rule 17a-4 (audit-trail alternative, Nov 2022) — finra.org/rules-guidance/guidance/interpretations-financial-operational-rules/sea-rule-17a-4-and-related-interpretations
- **NYSE**, "Market-Wide Circuit Breakers FAQ" — nyse.com/publicdocs/nyse/NYSE_MWCB_FAQ.pdf
- **NYSE**, "Report of the Market-Wide Circuit Breaker Working Group" — nyse.com/publicdocs/nyse/markets/nyse/Report_of_the_Market-Wide_Circuit_Breaker_Working_Group.pdf
- **NYSE**, "NYSE Pillar Risk Controls" — nyse.com/publicdocs/nyse/NYSE_Pillar_Risk_Controls.pdf
- **Cboe**, "Member Testing Obligations – 2024 MWCB Testing" — cboe.com/notices/content/?id=51516
- **Nasdaq**, "Equity Kill Switch" — nasdaqtrader.com/content/EquityKillSwitch.pdf
- **Eurex**, "Volatility Interruption Functionality" — eurex.com/ex-en/support/emergencies-and-safeguards/volatility-interruption-functionality
- **Deutsche Börse / Xetra**, "Protective Mechanisms" — cashmarket.deutsche-boerse.com/cash-en/trading/Xetra/protective-mechanisms
- **ICE**, "Interval Price Limit Functionality" — ice.com/publicdocs/futures_us/Futures_US_IPL_Levels.pdf
- **FIA**, "Exchange Risk Controls – Overview of CME and ICE risk controls" — fia.org/sites/default/files/2025-01/Exchange%20Risk%20Controls%20...pdf
- **FIA**, "MiFID II Minimum Standard Recommendations for ETD eTrading" — fia.org/sites/default/files/2019-05/FIA-Europe-MiFID-II-Minimum-Standard-Recs-...pdf
- **FIA**, "CFTC Rule 1.73 Pertaining to Give-Ups FAQs" — fia.org/sites/default/files/2019-05/CFTC-Rule-173-Give-Up-FAQs.pdf
- **ESMA**, "Article 17 Algorithmic trading" (MiFID II Interactive Single Rulebook) — esma.europa.eu/publications-and-data/interactive-single-rulebook/mifid-ii/article-17-algorithmic-trading
- **ESMA**, "MiFID II Final Report on Algorithmic Trading" — esma.europa.eu/sites/default/files/library/esma70-156-4572_mifid_ii_final_report_on_algorithmic_trading.pdf
- **ESMA**, RTS 6 (MiFID II Regulatory Technical Standards on algorithmic trading)
- **Kroll**, "Algorithmic Trading Under MiFID II" — kroll.com/en/publications/financial-compliance-regulation/algorithmic-trading-under-mifid-ii
- **Eventus**, "Practical Steps to Address: MiFID II RTS 6" — eventus.com/cat-article/enforcement-action-from-esma-on-rts-6
- **Interactive Brokers**, "Margin Call" (IBKR Campus glossary) — interactivebrokers.com/campus/glossary-terms/margin-call
- **Interactive Brokers**, "Liquidate Last" — interactivebrokers.com/campus/glossary-terms/liquidate-last
- **Interactive Brokers**, "Mastering the Calmar Ratio for Risk Analysis" — interactivebrokers.com/campus/ibkr-quant-news/mastering-the-calmar-ratio-for-risk-analysis
- **Tradovate**, "Risk Settings" — support.tradovate.com/s/article/Risk-Settings-Tradovate
- **Tradovate**, "Daily Loss Limit" — tradovate.com/daily-loss-limit
- **Tradovate**, "Liquidation Policy" — tradovate.com/liquidation-policy
- **Topstep**, "How daily loss limits build discipline for funded traders" — topstep.com/blog/the-value-of-setting-a-daily-loss-limit
- **Optiver**, "An illustrated guide to price controls on US exchanges" — optiver.com/insights/explainers/an-illustrated-guide-to-price-controls-on-us-exchanges
- **MSCI**, "The Risk of Risk Limits" — msci.com/research-and-insights/blog-post/the-risk-of-risk-limits
- **Subrahmanyam, A.** (1994), "Circuit Breakers and Market Volatility: A Theoretical Perspective," *Journal of Finance* 49(1), 237–254 — onlinelibrary.wiley.com/doi/abs/10.1111/j.1540-6261.1994.tb04427.x
- **Goldstein, M., Evans, J., Mahoney, J.** (1998), "Circuit Breakers, Volatility, and the U.S. Equity Markets: Evidence from NYSE Rule 80A" — imes.boj.or.jp/en/conference/cbrc/cbrc-16.pdf
- **Chen, H., Petukhov, A., Wang, J.** (2018), "The Dark Side of Circuit Breakers" — web.mit.edu/wangj/www/pap/ChenPetukhovWang18.pdf
- **Drechsler, I.** (2011), "Risk Choice Under High-Water Marks" — archive.nyu.edu/bitstream/2451/31320/2/Risk_Choice_HWM.pdf
- **Federal Reserve**, "2026 Stress Test Scenarios" — federalreserve.gov/publications/2026-stress-test-scenarios.htm
- **ECB**, "Advancements in stress-testing methodologies" (Op Paper 348) — ecb.europa.eu/pub/pdf/scpops/ecb.op348~6b72fbe3cf.en.pdf
- **Jane Street**, "Safe at Any Speed" (tech talk) — janestreet.com/tech-talks/safe-at-any-speed
- **Jane Street**, "Production Engineering When Trading Billions of Dollars a Day" (YouTube) — youtube.com/watch?v=zR9PpXWsKFQ
- **Jane Street Blog** — blog.janestreet.com
- **OpenAlgo**, "Kill Switches, Risk Controls and Algo Surveillance" — openalgo.in/quant/kill-switches-risk-controls
- **The Regulatory Review** (Univ. of Penn.), "Discussion of Securities Market 'Kill Switch' Dominates SEC Roundtable" — theregreview.org/2012/10/17/17-ellias-sec-kill-switch
- **AnalystPrep**, "Methods for Estimating VaR | CFA Level II" — analystprep.com/study-notes/cfa-level-2/compare-the-parametric-variance-covariance-historical-simulation-and-monte-carlo-simulation-methods-for-estimating-var
- **Dechert**, "Refresher on U.S. Market-Wide Circuit Breakers" — dechert.com/knowledge/onpoint/2020/3/refresher-on-u-s--market-wide-circuit-breakers.html
- **VolatilityBox**, "Volatility Regimes Explained" — volatilitybox.com/research/volatility-regimes-explained
- **EdgeFlo**, "The Three Loss Rule: A Hard Stop for Your Trading Day" — edgeflo.com/blog/three-loss-rule-trading
- **Federal Register**, "Self-Regulatory Organizations; NYSE LLC" (2021) — federalregister.gov/documents/2021/07/22/2021-15548/...
- **Federal Register**, "Clearing Member Risk Management" (2011) — federalregister.gov/documents/2011/08/01/2011-19362/clearing-member-risk-management
- **Bloomberg**, "US Stocks Circuit Breaker 2020: S&P Plunges 7% Triggers" — bloomberg.com/news/articles/2020-03-08/rout-in-u-s-stock-futures-would-trigger-trading-curbs-at-5
- **Reuters**, "Global futures reopen after CME suffers multi-hour [outage]" (28 Nov 2025) — reuters.com/business/cme-trading-halted-due-cooling-issue-data-centers-2025-11-28
