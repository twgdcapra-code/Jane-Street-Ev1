# Regime-Switching Strategy Allocation for Futures Trading

**Scope.** This report surveys the theory, estimation, allocation, and production engineering of regime-switching allocators for futures portfolios. It is written for quantitative researchers building a multi-strategy futures book that must rotate capital between trend-following, mean-reversion, carry, and defensive sub-strategies as the underlying market state evolves. All claims are grounded in the academic literature (Hamilton 1989; Rabiner 1989; Ang & Bekaert 2002; Guidolin & Timmermann 2007) and contemporary quant-fund practice.

---

## 1. Market Regime Theory

### 1.1 What constitutes a regime

A **market regime** is a persistent, discrete state of the world in which the joint distribution of asset returns — mean, variance, skew, kurtosis, and cross-asset correlation — is approximately stationary. Two returns sampled from the *same* regime look like draws from one distribution; two returns sampled from *different* regimes look like draws from different distributions. The defining empirical facts are: (i) regimes are *latent* — they are not directly observable, only inferred from data; (ii) they are *persistent* — once entered, they tend to last for weeks, months, or years rather than single bars; (iii) they are *abrupt* — transitions are sharper than a smoothly time-varying parameter model would predict; and (iv) they are *economically meaningful* — they correspond to identifiable macro environments (expansion, recession, crisis, low-volatility recovery) rather than statistical artefacts.

### 1.2 Why regimes matter for strategy allocation

Every systematic strategy is implicitly a bet on a return-generating process. Trend-following profits when returns are autocorrelated; mean-reversion profits when they are anti-persistent; carry profits when the term structure slopes predictably. Because the *true* data-generating process changes with the regime, no single strategy dominates out-of-sample — a fact documented across asset classes by Moskowitz, Ooi, and Pedersen (2012) for trend and by Asness, Moskowitz, and Pedersen (2013) for value/carry. The economic value of regime-aware allocation is therefore not theoretical: it is the difference between running a trend-follower through 2018 (a catastrophic mean-reverting year for CTAs) versus de-grossing or rotating into a short-vol / mean-reversion book. Regime detection is the layer that lets a portfolio *change its mind* about which strategy to fund.

### 1.3 Evidence for regime persistence: Hamilton (1989)

The seminal empirical contribution is **Hamilton (1989), "A New Approach to the Economic Analysis of Nonstationary Time Series and the Business Cycle,"** *Econometrica* 57(2), 357–384. Hamilton modeled U.S. real GNP growth as a two-state Markov-switching AR(4) process and found:

- Two economically interpretable states — *positive-growth* and *negative-growth* — with sharply different conditional means.
- **High persistence**: estimated transition probabilities `p_11 ≈ 0.97` and `p_22 ≈ 0.76`, implying expected durations of `1/(1-p_11) ≈ 33 quarters` and `1/(1-p_22) ≈ 4 quarters` respectively. Regimes are not single-quarter blips; they last years.
- Switches coincide with NBER-dated recessions, even though NBER dates were *not* used in estimation — strong out-of-sample economic validation.
- The Markov assumption (transition depends only on the current state) parsimoniously captures the persistence without needing an exogenous leading indicator.

Hamilton's framework has since been applied to equity returns, FX, commodities, and volatility, and remains the default starting point for any regime-switching allocator. The key takeaway for trading desks: **regimes are persistent enough to act on, but not persistent enough to ignore** — an allocator that fails to detect the switch will hemorrhage P&L during the transition.

---

## 2. Hidden Markov Models for Regime Detection

### 2.1 The HMM formalism

Following **Rabiner (1989), "A Tutorial on Hidden Markov Models and Selected Applications in Speech Recognition,"** *Proceedings of the IEEE* 77(2), 257–286, an HMM is defined by:

- A set of `N` hidden states `S = {s_1, …, s_N}` representing regimes.
- An initial state distribution `π = {π_i}` where `π_i = P(q_1 = s_i)`.
- A transition matrix `A = [a_ij]` where `a_ij = P(q_t = s_j | q_{t-1} = s_i)`. Row-stochastic.
- An emission distribution `b_j(o_t) = P(o_t | q_t = s_j)` describing how observed returns (or features) are generated in state `j`.

Given a sequence of observations `O = (o_1, …, o_T)`, three classical problems must be solved (Rabiner 1989, §III):

1. **Evaluation**: compute `P(O | λ)` — forward algorithm.
2. **Decoding**: find the most likely state sequence `Q*` — Viterbi algorithm.
3. **Learning**: estimate `λ = (A, B, π)` from `O` — Baum–Welch algorithm.

### 2.2 Two-state model: bull / bear

The simplest non-trivial HMM fits returns to two Gaussian-emission states, conventionally labelled **bull** (high mean, low variance) and **bear** (low or negative mean, high variance). This mirrors Hamilton's original specification and is the workhorse model for equity-index futures. Its strength is robustness: with only 5 free parameters (`μ_1, μ_2, σ_1, σ_2, p_11, p_22` minus one for normalization), it converges quickly on as few as 5 years of daily data. Its weakness is that it conflates low-volatility chop with high-volatility chop — both are "non-bull" and lumped into the bear state, even though they call for opposite strategies (mean-reversion vs. de-grossing).

### 2.3 Three-state model: bull / bear / sideways

The **three-state model** is the most common in production research. Adding a *sideways* state (near-zero mean, low-to-moderate variance) cleanly separates the regime where mean-reversion and carry strategies excel from the regime where one should simply be flat. Guidolin and Timmermann (2007) find that a 3- or 4-state model is statistically and economically preferred to a 2-state model for U.S. stock and bond returns, with the additional state capturing the *recovery* transition between bear and bull. Practitioners typically initialize the 3-state HMM with k-means centroids on rolling mean and volatility, then run Baum–Welch to convergence.

### 2.4 Four-state model: bull / bear / sideways / high-vol

A fourth state isolates **high-volatility crisis regimes** — VIX > 30, fat-tailed innovations, spiking cross-asset correlation. Splitting "bear" into "ordinary bear" and "crisis" matters because the optimal response differs: in an ordinary bear one shorts momentum and rotates defensive; in a crisis one slashes gross, harvests the volatility risk premium via options, and explicitly hedges tail risk. A 4-state Gaussian-mixture HMM fitted to the VIX itself (Bialkowski et al., SSRN) recovers a clean low / mid / high / spike partition. The cost is parameter count and the risk of overfitting: 4-state HMMs need 15+ years of data to estimate reliably and are sensitive to initialization.

### 2.5 Baum–Welch algorithm for parameter estimation

Baum–Welch is a specialization of Expectation–Maximization to HMMs (Baum, Petrie, Soules & Weiss 1970; reviewed in Rabiner 1989 §III-C). Each iteration consists of:

- **E-step**: compute the forward (`α`) and backward (`β`) recursions, then form the posterior state probabilities `γ_t(i) = P(q_t = s_i | O, λ)` and joint posteriors `ξ_t(i,j) = P(q_t = s_i, q_{t+1} = s_j | O, λ)`.
- **M-step**: re-estimate `π_i = γ_1(i)`, `a_ij = Σ_t ξ_t(i,j) / Σ_t γ_t(i)`, and update emission parameters (e.g. `μ_i = Σ_t γ_t(i) o_t / Σ_t γ_t(i)`; `σ²_i = Σ_t γ_t(i)(o_t − μ_i)² / Σ_t γ_t(i)` for Gaussian emissions).

The algorithm is guaranteed to monotonically increase the log-likelihood and converge to a local optimum, so multiple random restarts are standard. Convergence is typically reached in 20–100 iterations on daily futures data.

### 2.6 Viterbi algorithm for state decoding

Given a fitted model, the **Viterbi algorithm** (Rabiner 1989 §III-B) returns the single most probable state path `Q* = argmax_Q P(Q, O | λ)` via dynamic programming:

```
δ_t(j) = max_{q_1..q_{t-1}} P(q_1..q_{t-1}, q_t = s_j, o_1..o_t | λ)
δ_t(j) = [max_i δ_{t-1}(i) a_ij] · b_j(o_t)
```

with backpointers `ψ_t(j)` storing the argmax. Viterbi gives a *hard* state assignment for each historical bar and is what one uses to build the regime timeline. For live trading, however, the smoothed posterior `γ_t(i)` from the forward–backward pass is usually preferable because it conveys *confidence*, not just a label (see §6.2).

### 2.7 Gaussian emissions vs. Student-t emissions

Gaussian emissions are the default but famously understate tail risk: a 2-state Gaussian HMM cannot reproduce the observed kurtosis of futures returns without inflating `σ` to the point that bull/bear separation collapses. The fix is a **Student-t emission** with `ν` degrees of freedom:

`b_j(o_t) ∝ [1 + (o_t − μ_j)² / (ν_j σ²_j)]^{-(ν_j+1)/2}`

Bulla et al. and the IAENG work on Indian index returns show that **Student-t emissions materially improve tail fit** and slightly increase estimated regime persistence (because extreme observations are no longer mis-attributed to spurious regime switches). The MDPI adaptive hierarchical HMM survey finds the gain is modest for transition probabilities and expected durations but large for VaR estimation — critical for any strategy whose sizing depends on regime-conditional volatility. Production recommendation: **use Student-t emissions for any strategy whose P&L is convex in tail risk** (vol-harvesting, options, short-vol); Gaussian is acceptable for pure directional trend/mean-reversion books.

---

## 3. Alternative Regime Detection Methods

HMMs are not the only game. Each alternative trades statistical sophistication for interpretability or latency, and the best production systems usually combine several.

### 3.1 Volatility regime: GARCH(1,1) forecast vs. long-run average

Fit a **GARCH(1,1)** — `σ²_t = ω + α ε²_{t-1} + β σ²_{t-1}` — to daily returns and compare the one-step-ahead forecast `σ̂²_{t+1}` to the unconditional long-run variance `σ̄² = ω / (1 − α − β)`. The ratio `σ̂_{t+1} / σ̄` is a continuous regime indicator: > 1.5 ⇒ high-vol regime, < 0.75 ⇒ low-vol regime. Multi-scale Markov-Switching GARCH (MS-GARCH) extensions go further by letting the GARCH parameters themselves switch. The advantage over HMM is that GARCH captures volatility clustering with no latent-state inference; the disadvantage is that it says nothing about the *directional* regime (bull vs. bear).

### 3.2 Trend regime: ADX

Wilder's **Average Directional Index (ADX)** isolates trend *strength* independent of direction. ADX > 25 ⇒ trending, ADX < 20 ⇒ sideways, with a gray zone between. The directional movement indicators +DI / −DI supply the sign. ADX is the standard filter on trend-following futures systems because it is bounded [0, 100], robust to outliers, and works on every liquid futures contract from CL to ZB. Its weakness is lag: ADX is a smoothed indicator and typically turns 5–10 bars after the true regime onset, which is acceptable for daily-bar trend systems but problematic for intraday.

### 3.3 Momentum regime: 50-day vs. 200-day moving average crossover

The simplest possible regime detector: `MA_50 > MA_200` ⇒ bull, else bear. Despite (or because of) its simplicity, this rule is remarkably robust and is the basis of the "Golden Cross / Death Cross" heuristic. It correlates highly with NBER business-cycle dating and, when applied to a broad futures basket, produces a regime signal whose average turnover is well below HMM-based alternatives. It is the right baseline against which any more sophisticated detector must justify its complexity.

### 3.4 Volatility regime: VIX threshold

For equity-index futures, the VIX is a market-implied (not historical) volatility regime indicator. Conventional thresholds: VIX < 15 ⇒ low-vol / risk-on; 15 ≤ VIX ≤ 30 ⇒ normal; VIX > 30 ⇒ high-vol / risk-off / crisis. The BIS Committee on the Global Financial System (CGFS 2011) cautions against treating VIX purely as "risk aversion" — it conflates expected volatility, variance risk premium, and funding stress — but for leveraged futures portfolios with VaR-based risk limits, VIX-threshold scaling remains operationally indispensable.

### 3.5 Correlation regime: risk-on / risk-off

Compute the rolling 60-day correlation between equity-index futures and 10-year Treasury futures. In **risk-on** regimes this correlation is positive or modestly negative; in **risk-off** regimes it becomes strongly negative (the "flight to quality" effect documented in Baele, Bekaert, Inghelbrecht & Wei, *Flights to Safety*, AER 2020). Cross-asset correlation regimes are the cleanest signal for multi-asset futures books because they tell you *which spreads* are likely to work: a risk-off regime favors long-bond / short-equity and long-USD / short-EM-FX pairs.

---

## 4. Strategy–Regime Mapping

The whole point of detecting regimes is to *act* on them. The mapping below summarizes which strategy families dominate in each regime, based on the empirical asset-allocation literature (Ang & Bekaert 2002; Guidolin & Timmermann 2007) and CTA industry practice.

| Regime | Directional bias | Preferred strategy families | Rationale |
|---|---|---|---|
| **Trending bull** | Long | Momentum, breakout, trend-following | Positive autocorrelation; new highs beget new highs |
| **Trending bear** | Short / inverse | Short momentum, inverse ETF, defensive trend | Negative drift; vol clustering favors trend on the short side |
| **Sideways / low-vol** | Neutral | Mean reversion, market making, carry, short-vol | Anti-persistence; range-bound; VRP positive |
| **High-vol (crisis)** | Reduce gross | Volatility harvesting, tail hedging, de-leverage | Fat tails; correlations → 1; survival > return |
| **Risk-on** | Pro-cyclical | Equity long, carry trades, EM FX carry, commodity long | Funding cheap, vol low, correlation to beta positive |
| **Risk-off** | Counter-cyclical | Flight to quality: long bonds, gold, USD, JPY | Funding stress, vol spike, beta sell-off |

Two practical rules of thumb: (1) **a strategy should never trade in a regime where its historical Sharpe is below 0.3** — compute regime-conditional Sharpe matrices in the walk-forward backtest and zero-out allocations below this floor; (2) **the highest-confidence regime call is for the crisis state**, because almost every well-specified strategy loses money there except explicit long-vol and short-equity — so the most valuable single allocation decision is the *de-grossing* that happens when the HMM posterior on the crisis state crosses ~50%.

---

## 5. Dynamic Capital Allocation

Given a regime call (or posterior), how is capital actually split? Four canonical schemes, in order of sophistication:

### 5.1 Fixed allocation per regime

The simplest and most operationally robust: pre-specify a weight vector `w_r = (w_1, …, w_K)` for each regime `r`, where `w_k` is the fraction of risk budget allocated to strategy `k`. Example for a 3-strategy book (trend, mean-reversion, carry):

| Regime | Trend | MeanRev | Carry |
|---|---|---|---|
| Trending bull | 0.60 | 0.10 | 0.30 |
| Trending bear | 0.55 | 0.15 | 0.30 |
| Sideways | 0.15 | 0.55 | 0.30 |
| High-vol | 0.20 | 0.20 | 0.20 (plus 40% cash) |

This is the scheme most CTA shops actually run because it is auditable, explainable to risk, and trivially walk-forward testable.

### 5.2 Kelly criterion allocation based on regime-specific Sharpe

For strategy `k` in regime `r`, the full-Kelly fraction is `f^*_{r,k} = μ_{r,k} / σ²_{r,k}`, which (under the standard Sharpe approximation `S = μ/σ`) gives `f^* = S / σ`. In practice one uses **fractional Kelly** (typically 0.25–0.5× full Kelly) to account for parameter uncertainty and non-Gaussianity. The allocation per regime is then `w_{r,k} ∝ (S_{r,k} / σ_{r,k}) · 1[ S_{r,k} > S_min ]`. QuantStart's formulation and the alpha-theory literature both emphasize that Kelly weights are extremely sensitive to estimation error in `μ`, so shrinkage toward equal weight or toward the fixed-allocation scheme is essential.

### 5.3 Volatility targeting: scale position by 1/σ

The most widely deployed single idea in modern futures trading. Each strategy's notional is scaled so that its ex-ante annualized volatility equals a fixed target `σ_target`: `notional_t = (σ_target / σ̂_t) · capital`. ECB analysis of vol-targeting funds during the 2018/2020 sell-offs shows this mechanically de-grosses when `σ̂` rises and re-grosses when it falls, providing an automatic regime overlay even without an explicit regime detector. The combination "volatility target + regime overlay" is the dominant industry architecture.

### 5.4 Risk parity: equal risk contribution per strategy

Within a regime, allocate so that each strategy contributes equally to portfolio variance: `w_k (Σw)_k = w_j (Σw)_j` for all `k, j`. This requires inverting the strategy covariance matrix `Σ`, which is itself regime-dependent — hence the *regime-conditional risk parity* of LongTail Alpha and the EFMA literature, which re-solves the risk-parity weights conditional on the detected regime. The benefit is robustness to correlation breakdown (the equal-risk contribution survives when one strategy's vol spikes); the cost is turnover from frequent re-solving.

---

## 6. Implementation

### 6.1 Online HMM

A production allocator cannot refit the full HMM on every tick. The standard approach is an **online update**: keep the previous parameter estimates `λ_{t-1}` and run a single Baum–Welch EM step (or a stochastic-gradient step on the log-likelihood) on the newly arrived observation. The MDPI *Regime-Aware LightGBM* paper validates a simpler variant: refit a Gaussian HMM on a rolling 5-year window every 63 trading days (quarterly), with no look-ahead, and use the posterior of the most recent bar for live allocation. The trade-off is between parameter stability (long refit interval) and responsiveness (short interval); 63-day refits are a well-supported compromise.

### 6.2 Regime probability instead of hard state

Never allocate based on the argmax Viterbi state alone. Use the **smoothed posterior** `γ_t(i) = P(q_t = s_i | O_{1:T})` (offline) or the **filtered posterior** `P(q_t = s_i | O_{1:t})` (online). The allocation is then `w_t = Σ_i γ_t(i) · w^{(i)}`, a probability-weighted blend of regime-specific weight vectors. This is *far* more robust than hard switching: during a regime transition, the posterior migrates smoothly from one state to another, and the blended allocation naturally reduces gross exposure (because intermediate posteriors place weight on the high-vol / defensive regime).

### 6.3 Transition matrix

The estimated transition matrix `A` carries the regime-persistence information that Hamilton (1989) emphasized. Diagonal-dominant `A` (e.g. `p_ii > 0.95`) implies long expected durations `1/(1−p_ii)` and supports low-turnover allocation. Off-diagonal-heavy `A` implies frequent switching and should push the allocator toward smaller per-regime weight differentials to avoid churn. Always report the implied expected regime duration alongside the matrix.

### 6.4 Regime stability filter

Hard regime switches based on a single bar's posterior are whipsaw-prone. A **stability filter** requires `N` consecutive bars of posterior `> τ` (typically `N ∈ {3, 5}`, `τ = 0.6`) on a new state before the allocation actually transitions. This sacrifices ~2–5 bars of regime-detection latency (the well-known HMM lag) for a large reduction in false switches and the transaction costs they generate.

---

## 7. Backtesting Regime-Switching Allocators

### 7.1 In-sample detection vs. out-of-sample allocation

The cardinal sin is detecting regimes in-sample on the full history and then evaluating allocation decisions on the same data. The correct protocol: fit the HMM on `[1, T]`, then for each `t > T` use only data `[1, t−1]` (or `[t−W, t−1]` on a rolling window `W`) to compute the filtered posterior and the resulting allocation. The regime detector must never see the bar it is allocating on.

### 7.2 Walk-forward: rolling-window re-estimation

A rigorous walk-forward framework (per the arXiv *Rigorous Walk-Forward Validation Framework*) re-estimates the HMM every `K` bars on a trailing window, recomputes regime posteriors and allocation weights, simulates execution with realistic fills and costs, and rolls forward `K` bars. This is the only way to obtain honest Sharpe, max-drawdown, and turnover statistics. The MDPI 63-day refit cadence is a defensible default for daily-bar futures.

### 7.3 Transaction costs of regime switches

Every regime-induced reallocation generates turnover: selling the trend book and buying the mean-reversion book is two trades, each crossing the bid-ask and paying commissions. The expected cost per switch must be subtracted from the regime-conditional Sharpe improvement before deciding whether the regime overlay is worth it. Empirically: with 2 bps round-trip on liquid index futures, a regime overlay that switches 6–10 times per year typically *adds* net Sharpe; one that switches 30+ times typically *destroys* it. The stability filter in §6.4 is the primary lever for controlling switch frequency.

### 7.4 Regime detection lag

HMM filtered posteriors lag the true regime onset by **2–5 bars** on daily data — a consequence of the EM algorithm needing several observations to "notice" a distributional shift. This lag is structural and cannot be eliminated by tuning; it can only be reduced by adding faster features (intraday realized vol, order-flow imbalance) to the emission distribution. The implication for backtesting: a regime overlay will typically miss the first 2–5 bars of a new regime, which is exactly when the P&L differential is largest. Plan for this — the realistic gain from a regime overlay is ~30–50% of the *perfect-foresight* gain, not 100%.

---

## 8. Performance Attribution

### 8.1 Alpha from regime detection vs. alpha from strategy selection

Decompose total P&L into three additive components using a Brinson–Fachler-style attribution:

1. **Strategy-selection alpha** — the contribution from the underlying strategies' average returns (the "what we trade" decision).
2. **Regime-timing alpha** — the contribution from being in the right strategy at the right time (the "when we trade it" decision).
3. **Residual / interaction** — usually small if allocations are linear in posteriors.

A well-functioning regime overlay should produce positive regime-timing alpha net of transaction costs. If regime-timing alpha is negative, the detector is either too noisy (raise `N` in the stability filter) or too slow (lower the refit cadence).

### 8.2 Regime timing: did we switch at the right time?

Compare the *realized* switch dates to *ex-post* optimal switch dates (computed by Viterbi on the full sample). A good online detector's switches should be within 2–5 bars of the ex-post optimum for ≥ 70% of transitions. Larger lags indicate an under-parameterized model or an overly aggressive stability filter.

### 8.3 Regime hit rate

The **Regime Classification Measure (RCM)** of Ang & Bekaert (2002):

`RCM = 100 · N · Σ_i [ (1/T) Σ_t (γ_t(i) − N⁻¹)² ]^{1/2}`

ranges from 0 (perfect classification, every `γ_t(i)` is 0 or 1) to 100 (no classification, every `γ_t(i) = 1/N`). Useful targets: RCM < 30 is a strong classifier, RCM > 60 is barely better than random. Pair RCM with a *hit rate*: the fraction of bars where `argmax_i γ_t(i)` matches the ex-post Viterbi state. A hit rate of 0.80+ is achievable on liquid index futures with a 3-state HMM; 0.70 is a more realistic cross-asset average.

---

## 9. Visualization

A regime-switching allocator is only as useful as its monitoring. Four standard visualizations, all of which should update daily on the research dashboard:

1. **Regime timeline** — a horizontal strip chart, x-axis = time, color-coded by `argmax γ_t(i)`.一眼 the last 5 years of regime history. Useful for sanity-checking that detected regimes line up with known macro events (2020-Q1 crisis, 2022-rate-hike bear, 2023-AI-bull).
2. **Regime probability heatmap** — for each `t`, a row vector `(γ_t(1), …, γ_t(N))` shown as a heatmap. Reveals transitions as soft color gradients rather than abrupt flips, and exposes low-confidence periods where the allocator should be de-grossed.
3. **Strategy allocation pie chart per regime** — a small multiple of `N` pie charts, one per regime, showing the weight vector `w^{(r)}`. Forces explicit review of the mapping in §4 and makes the regime→strategy logic auditable by risk and compliance.
4. **Equity curve with regime shading** — the portfolio equity curve overlaid with shaded vertical bands marking the active regime. Makes regime-timing alpha (or its absence) visually obvious: gains clustered in trending regimes and drawdowns clustered in misclassified transitions are both immediately visible.

---

## 10. Jane Street / Quant Fund Practices

Top-tier quantitative funds treat regime detection as a first-class research problem, not a footnote to strategy design.

### 10.1 Real-time regime classification on every tick

Jane Street's published engineering blog (*Real World Machine Learning*) and their Kaggle competition (*Real-Time Market Data Forecasting*) make clear that regime classification is recomputed on every market-data update, not daily. The HMM (or its ML successor) is fed by a streaming feature pipeline backed by kdb+/q or similar, and the regime posterior is published to all strategy processes via a low-latency pub-sub bus. This enables intraday de-grossing minutes into a regime change rather than days.

### 10.2 Multi-asset regime detection

A single equity-index regime is too coarse for a multi-asset futures book. Production systems maintain *parallel regime detectors* for: equity-index regime (S&P, Nasdaq, Russell), rates regime (2y/10y/30y UST), commodity regime (oil, metals, grains), FX regime (DXY, EM basket), and volatility regime (VIX term structure). Each regime posterior feeds the relevant sub-book, and a *master* regime (typically a 2-state risk-on/risk-off) arbitrates capital allocation across sub-books.

### 10.3 Regime-switching at multiple timescales

Intraday (minutes–hours), daily (days–weeks), and weekly (months–years) regime detectors coexist. The intraday detector governs execution tactics (aggression vs. passive), the daily detector governs strategy selection, and the weekly detector governs gross-exposure / leverage. This multi-timescale architecture suppresses whipsaw at one scale while preserving responsiveness at another.

### 10.4 Machine-learning regime detection

Beyond classical HMMs, modern desks deploy **random-forest classifiers** (QuantInsti documents ~91% out-of-sample regime-prediction accuracy on a tree-based model with market-breadth features) and **LSTM / transformer sequence models** that learn the emission and transition structure jointly. The arXiv literature on LSTM-RF hybrids shows meaningful gains over Gaussian HMMs in tail-regime detection. The trade-off is interpretability: an HMM's `A` matrix is auditable; an LSTM's regime posterior is not. Most shops run both and use the HMM as a sanity-check / risk-control overlay on the ML detector.

### 10.5 Regime overlay on top of strategy portfolio

The dominant architecture is **strategies first, regime overlay second**: each strategy is developed, backtested, and risk-budgeted independently as if regimes did not exist; the regime overlay then scales the *aggregate* gross and tilts the inter-strategy weights. This separation keeps strategy P&L attribution clean (each strategy's alpha is measured against its own benchmark) while still capturing the regime-timing alpha the overlay generates. Jane Street, Two Sigma, and the major CTAs (Winton, AHL, Man) all use variants of this architecture.

---

## References

- **Hamilton, J. D.** (1989). "A New Approach to the Economic Analysis of Nonstationary Time Series and the Business Cycle." *Econometrica* 57(2), 357–384.
- **Rabiner, L. R.** (1989). "A Tutorial on Hidden Markov Models and Selected Applications in Speech Recognition." *Proceedings of the IEEE* 77(2), 257–286.
- **Ang, A. & Bekaert, G.** (2002). "International Asset Allocation With Regime Shifts." *Review of Financial Studies* 15(4), 1137–1187. (RCM introduced here; see also SSRN 310626.)
- **Guidolin, M. & Timmermann, A.** (2007). "Asset Allocation under Multivariate Regime Switching." *Journal of Economic Dynamics and Control* 31(11), 3503–3544.
- **Baum, L. E., Petrie, T., Soules, G. & Weiss, N.** (1970). "A Maximization Technique Occurring in the Statistical Analysis of Probabilistic Functions of Markov Chains." *Annals of Mathematical Statistics* 41(1), 164–171. (Baum–Welch.)
- **Bulla, J. & Bulla, I.** (2006). "Stylized facts of financial time series and hidden semi-Markov models." *Computational Statistics & Data Analysis.* (Student-t HMM persistence.)
- **Baele, L., Bekaert, G., Inghelbrecht, K. & Wei, M.** (2020). "Flights to Safety." *Review of Economic Studies* 87(2). (Risk-on/risk-off correlation regimes.)
- **Bollerslev, T.** (1986). "Generalized Autoregressive Conditional Heteroskedasticity." *Journal of Econometrics* 31(3), 307–327. (GARCH.)
- **Wilder, J. W.** (1978). *New Concepts in Technical Trading Systems.* (ADX / DMI.)
- **CGFS** (2011). *Fixed-income strategies of insurance companies and pension funds.* Bank for International Settlements. (VIX as risk-aversion proxy — caveats.)
- **Moskowitz, T. J., Ooi, Y. H. & Pedersen, L. H.** (2012). "Time Series Momentum." *Journal of Financial Economics* 104(2), 228–250.
- **QuantInsti** (2023). "Machine Learning for Market Regime Detection Using Random Forest." *Blog.*
- **Jane Street** (2024). "Real World Machine Learning." *blog.janestreet.com*; "Jane Street Real-Time Market Data Forecasting." *Kaggle.*
- **MDPI** (2024). "Regime-Aware LightGBM for Stock Market Forecasting: A Validated Online HMM Approach." *Mathematics.*

---

## Summary

Regime-switching allocation for futures trading rests on Hamilton's (1989) evidence that market states are latent, persistent, and Markovian, and is implemented in practice by fitting a Gaussian or Student-t HMM (estimated with Baum–Welch, decoded with Viterbi) whose posterior regime probabilities drive a probability-weighted blend of regime-specific strategy weights — typically volatility-targeted, Kelly-aware, and risk-parity-tilted — with walk-forward re-estimation, stability filters to control turnover, and real-time multi-timescale multi-asset overlays of the kind deployed at Jane Street and other top quant funds.
