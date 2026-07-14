# Brinson-Fachler Performance Attribution: A Comprehensive Research Report

**Scope.** This report synthesizes the academic and practitioner literature on the Brinson-Fachler (BF) performance attribution model, with a specific lens on its adaptation to futures trading desks, multi-asset sector classification, multi-period linking, GIPS compliance, and the real-time attribution practices used by quantitative funds such as Jane Street. It is intended to serve as the methodological reference document for a futures attribution engine that decomposes active return into allocation, selection, and interaction effects across six asset-class sectors (equity index, rates, energy, metals, FX, and crypto).

**Primary sources.** The discussion draws on the CFA Institute Research and Policy Center literature review on performance attribution (CFA Institute, 2019), the GIPS Standards Handbook for Firms (CFA Institute, 2020), the original Brinson, Hood, and Beebower (1986) *Financial Analysts Journal* paper "Determinants of Portfolio Performance," Brinson and Fachler's 1985 work, Carl Bacon's *Practical Portfolio Performance Measurement and Attribution* (Wiley, 2008), Frongello (2002) "Linking Single Period Attribution Results" in the *Journal of Performance Measurement*, Cariño (1999) on multi-period linking, and practitioner documentation from Morningstar, FactSet, MSCI, SimCorp, and Interactive Brokers.

---

## 1. Brinson (1985) and Brinson-Fachler (1985) Model Overview

Performance attribution is the set of techniques used to explain *why* a portfolio's performance differed from its benchmark — to decompose the active return into components attributable to specific investment decisions. The Brinson model family, introduced in the mid-1980s, remains the dominant arithmetic attribution framework for equity and multi-asset portfolios.

**Historical origin.** Gary P. Brinson and Nimrod Fachler published "Measuring Non-US Equity Portfolio Performance" in the *Journal of Portfolio Management* in 1985, presenting a framework that decomposed the excess return of a portfolio over a benchmark into an asset-allocation effect and a security-selection effect, with a residual interaction term. One year later, in the July/August 1986 issue of the *Financial Analysts Journal*, Brinson, L. Randolph Hood, and Gilbert L. Beebower (BHB) published the now-famous "Determinants of Portfolio Performance." The 1986 BHB paper examined 91 large U.S. pension plans from 1974 to 1983 and concluded that approximately 93.6% of the quarterly variance in portfolio returns was explained by asset-allocation policy, a finding that was widely (and often mis-) interpreted as the claim that "asset allocation determines 90% of performance." A 1991 follow-up, "Determinants of Portfolio Performance II: An Update" (Brinson, Singer, and Beebower), reaffirmed the result over a longer sample. Commonfund, Voya, and the CFA Institute all cite the 1986 paper as the foundation for the modern performance-attribution industry.

**Conceptual structure.** Both the BF and BHB models treat the active return $R_p - R_b$ as the quantity to be explained, where $R_p$ is the portfolio (total) return and $R_b$ is the benchmark (total) return. The portfolio and benchmark are both partitioned into the same set of $n$ sectors (asset classes, industries, countries, or, in our application, futures sectors). For each sector $i$, we observe:
- $w_{p,i}$: portfolio weight in sector $i$,
- $w_{b,i}$: benchmark weight in sector $i$,
- $R_{p,i}$: portfolio return in sector $i$,
- $R_{b,i}$: benchmark return in sector $i$,
- $R_b = \sum_i w_{b,i} R_{b,i}$: total benchmark return.

The portfolio and benchmark totals satisfy $R_p = \sum_i w_{p,i} R_{p,i}$ and $R_b = \sum_i w_{b,i} R_{b,i}$. The model's genius is to construct three *notional* portfolios — a "policy" portfolio that holds benchmark weights and benchmark returns, an "asset-allocation" portfolio that holds portfolio weights but benchmark returns, and a "selection" portfolio that holds benchmark weights but portfolio returns — and to read the active return off the gaps between them.

**Why BF dominates in practice.** The CFA Institute's 2019 Research Foundation literature review on performance attribution notes explicitly that "the Brinson and Fachler (1985) variant for asset allocation is far more common and better aligned with most investment decision processes" than the BHB variant. AnalystPrep's CFA Level III materials describe the BF model as the simplification of BHB that is used in most practitioner attribution systems, and Advent's white paper on performance attribution concurs that BF "is quite similar to the BHB, with one significant difference: how the allocation effect is calculated." That single difference — subtracting the overall benchmark return $R_b$ from the allocation term — is what makes BF economically interpretable: it credits the manager for overweighting sectors that beat the overall benchmark, not merely sectors with positive absolute returns.

---

## 2. Three-Factor Decomposition Formulas

The BF three-factor decomposition writes the active return as the sum of an allocation effect $A$, a selection effect $S$, and an interaction effect $I$:

$$R_p - R_b = A + S + I$$

with

$$A = \sum_{i=1}^{n} (w_{p,i} - w_{b,i}) \cdot (R_{b,i} - R_b)$$

$$S = \sum_{i=1}^{n} w_{b,i} \cdot (R_{p,i} - R_{b,i})$$

$$I = \sum_{i=1}^{n} (w_{p,i} - w_{b,i}) \cdot (R_{p,i} - R_{b,i})$$

**Algebraic identity.** It is a useful exercise to verify that these three terms indeed sum to $R_p - R_b$. Expand the sum:

$$A + S + I = \sum_i \Big[ (w_{p,i} - w_{b,i})(R_{b,i} - R_b) + w_{b,i}(R_{p,i} - R_{b,i}) + (w_{p,i} - w_{b,i})(R_{p,i} - R_{b,i}) \Big].$$

Expanding and cancelling, one obtains $\sum_i (w_{p,i} R_{p,i} - w_{b,i} R_{b,i}) - R_b \sum_i (w_{p,i} - w_{b,i})$. Because weights sum to one in both the portfolio and the benchmark, the second term vanishes and we are left with $R_p - R_b$. The decomposition is exact for every single period.

**Allocation effect.** $A$ measures the value added (or lost) by the manager's *decision to over- or under-weight* each sector relative to the benchmark. Crucially, BF credits the manager only when the overweighted sector outperforms the *overall benchmark* return $R_b$, not merely when the sector return is positive. Consider a sector that returns +2% while the overall benchmark returns +5%; under BHB, overweighting that sector would be recorded as a positive allocation contribution, even though it destroyed relative value. BF corrects this by subtracting $R_b$, so overweighting a sub-benchmark sector correctly produces a negative allocation contribution. This is the central economic improvement of BF over BHB and is why Morningstar, FactSet, and the CFA Institute prefer it.

**Selection effect.** $S$ measures the value added by the manager's *security (or instrument) choices within each sector*, evaluated at benchmark sector weights. A positive $S$ means that, holding sector weights constant at benchmark, the manager picked instruments that beat the sector benchmark. In a futures context, $S$ captures within-sector contract selection — e.g., choosing the Brent crude contract versus the WTI crude contract within the "energy" sector, or choosing the 10-year Treasury note future versus the 30-year bond future within the "rates" sector. Using the benchmark weight $w_{b,i}$ rather than the portfolio weight $w_{p,i}$ isolates pure selection skill from any confounding allocation decision; the residual cross-term is captured separately by $I$.

**Interaction effect.** $I$ is the residual term that captures the *joint* effect of allocation and selection. It is positive when the manager is simultaneously overweight *and* outperforming within a sector — i.e., "doubling down" on skill. It is negative when the manager is overweight a sector in which they underperform the benchmark. Many practitioners view $I$ as the cleanest signal that skill is being scaled appropriately: a consistently positive interaction effect suggests the manager is sizing winners larger than the benchmark dictates. Some attribution vendors (notably Kiski and certain Morningstar configurations) merge $I$ into $S$ by redefining selection with portfolio weights, $\tilde S = \sum_i w_{p,i}(R_{p,i}-R_{b,i})$, in which case the two-term decomposition $A + \tilde S = R_p - R_b$ holds. The three-term form is preferred for diagnostic granularity.

---

## 3. Brinson-Fachler vs Brinson-Hood-Beebower Differences

The BHB (1986) and BF (1985) models share identical formulas for the selection and interaction effects. They differ *only* in the allocation effect:

$$A^{\text{BHB}} = \sum_i (w_{p,i} - w_{b,i}) \cdot R_{b,i}$$

$$A^{\text{BF}} = \sum_i (w_{p,i} - w_{b,i}) \cdot (R_{b,i} - R_b)$$

Because $\sum_i (w_{p,i} - w_{b,i}) = 0$, the two allocation formulas differ by the constant $-R_b \cdot \sum_i (w_{p,i} - w_{b,i}) = 0$. **At the total-portfolio level, BHB and BF produce identical total allocation effects.** They differ only in how that total is *distributed across sectors*. This is a subtle but important point confirmed across the Advent, Morningstar, TSG Performance, and CIPM Exam prep sources.

**Practical implication.** Although the totals coincide, the per-sector attribution can be dramatically different. Consider a futures portfolio in which the manager overweights the equity-index sector by 10 percentage points during a quarter in which the equity-index sector returns +6% but the overall benchmark returns +9% (because every other sector rallied more). BHB would credit the manager with +0.6% allocation from the equity-index sector — a perverse reward for overweighting the laggard. BF would correctly charge −0.3% ($= 0.10 \times (6\% - 9\%)$). For any desk that intends to use attribution as a *decision-improvement feedback loop* rather than a scorekeeping exercise, BF is unambiguously preferable. As the CFA Institute review states, BF "is far more common and better aligned with most investment decision processes."

**AnalystPrep characterization.** AnalystPrep summarizes the relationship by saying "the Brinson–Fachler (1985) attribution simplifies the Brinson–Hood–Beebower scheme by folding the interaction term into the selection term." This refers to the *alternative two-term* BF representation that uses portfolio weights in selection, as discussed above. The interpretation requires care: the "folding" only works cleanly when the analyst is willing to abandon the standalone interaction term. In a futures attribution engine where the goal is to give traders clean, separate signals about (i) sector-timing skill, (ii) contract-selection skill, and (iii) the joint sizing effect, the three-term BF decomposition is the right choice.

**Reddit/CFA community discussion.** CFA candidate forums repeatedly note that exam questions sometimes prefer one model over the other, with BHB used in older Kaplan materials and BF in newer Schweser materials. The community consensus, echoed in the MantaRisk documentation and the Frongello papers, is that BF is the practitioner default; BHB survives mainly in legacy textbooks and in the historical record of the 1986 paper. The CIPM exam prep site states: "The only difference between the two models is with regard to how the asset allocation component of the return attribution is calculated."

| Feature | BHB (1986) | BF (1985) |
|---|---|---|
| Allocation formula | $\sum (w_p-w_b) R_b$ | $\sum (w_p-w_b)(R_b - R_{b,\text{total}})$ |
| Selection formula | $\sum w_b (R_p - R_b)$ | $\sum w_b (R_p - R_b)$ (or $\sum w_p (R_p - R_b)$ in 2-term form) |
| Interaction formula | $\sum (w_p - w_b)(R_p - R_b)$ | $\sum (w_p - w_b)(R_p - R_b)$ (zero in 2-term form) |
| Sub-benchmark overweight penalized? | No (perversely rewards) | Yes (correct) |
| Practitioner adoption | Legacy/textbook | Industry default |

---

## 4. Application to Futures Trading

The Brinson-Fachler model was developed for long-only equity and balanced portfolios, but its underlying arithmetic is asset-agnostic. Adapted to a futures trading desk, the "sectors" become asset-class groupings of futures contracts, and the "benchmark" becomes a passive equal-weight (or risk-weight) basket of those same sectors. The mapping is straightforward and unlocks the same diagnostic power enjoyed by long-only equity managers.

**Sectors as asset classes.** A futures book is naturally partitioned by underlying asset class:
- **Equity index futures** (ES, NQ, RTY, Nikkei, DAX, Hang Seng, etc.),
- **Rate / bond futures** (TY, US, FV, Bund, Schatz, JGB, etc.),
- **Energy futures** (CL, NG, RB, HO, Brent),
- **Metals futures** (GC, SI, HG, PL, PA),
- **FX futures** (6E, 6B, 6J, 6A, DX) plus cash FX forwards,
- **Crypto futures** (BTC, ETH perps on Binance/Bybit/CME).

These six sectors are the analogue of the equity manager's sector (technology, healthcare, financials, etc.). Each sector's benchmark return $R_{b,i}$ is computed from the equal-weight basket of contracts the desk trades in that sector; the portfolio return $R_{p,i}$ is computed from the desk's actual positions (signed, net of intraday rebalancing).

**Benchmark as equal-weight basket.** The natural futures benchmark is *not* a published index (because the desk's strategy is not "tracking" any external index) but rather an internally-constructed equal-weight basket of the same contracts the desk trades. This is the approach recommended in the AMINDIS white paper "Performance Attribution for Portfolios that Trade Futures Contracts," which extends the Brinson model to handle margin, notional exposure, and the special accounting of derivatives. Equal weighting is the most defensible neutral starting point: it assigns no ex-ante skill to any sector, it is easy to compute, and it is robust to contract additions/removals.

**Treatment of leverage and margin.** Futures differ from cash equities in two economically important ways. First, notional exposure can be a large multiple of posted margin, so attribution must be performed on fully-expanded notional dollars, not on margin. Second, futures returns include roll yield (convergence of the futures price to spot as the contract expires) and collateral return (interest earned on posted margin). A clean attribution decomposes total futures return into collateral return + roll yield + price change, and the BF effects are computed on the price-change component (with collateral return reported separately as a financing line). This is the convention adopted by Advent, MSCI, and the Interactive Brokers white paper.

**Single-sector versus multi-sector futures.** A desk that trades only equity-index futures cannot benefit from sector allocation attribution — the allocation effect is mechanically zero. The BF model becomes valuable only for multi-asset futures strategies: global macro, CTA, risk-premia / alternative risk premia (ARP), or multi-strategy quant funds. In these settings, BF attribution is the standard tool used by Man AHL, Winton, Two Sigma, and Millburn to attribute monthly performance to (i) which sectors the desk was net long/short and (ii) which contracts within each sector were chosen.

**Directional versus relative-value.** For directional futures traders, BF allocation captures sector-timing skill (being long energy when energy rallies). For relative-value traders (e.g., long WTI / short Brent crack spreads), the "selection effect" within the energy sector captures spread-decomposition skill while allocation captures the choice of gross allocated to energy spreads versus metal spreads. BF adapts cleanly because it is purely arithmetic — it does not assume long-only positions or positive weights.

---

## 5. Multi-Period Linking (Cariño, Frongello)

The Brinson-Fachler decomposition is *arithmetic* in a single period: the three effects sum exactly to the active return. Across multiple periods, this arithmetic breaks down. The geometric (compound) active return over $T$ periods is *not* the sum of the single-period active returns, because portfolio and benchmark returns compound at different rates. Linking algorithms are required to redistribute this compounding gap back onto the single-period effects so that the *linked* attribution still sums to the multi-period active return.

**The linking problem.** Concretely, suppose in month 1 the portfolio returns +10% and the benchmark returns +5%, giving an active return of +5%. In month 2 the portfolio returns −10% and the benchmark returns −5%, giving an active return of −5%. Naive arithmetic summing gives +5% + (−5%) = 0% active return. But the compounded portfolio return is $(1.10)(0.90) - 1 = -1\%$ while the compounded benchmark return is $(1.05)(0.95) - 1 = -0.25\%$, so the true multi-period active return is −0.75%, not 0%. The −0.75% must be distributed across the two months' allocation, selection, and interaction effects. Linking algorithms do exactly this distribution.

**Cariño (1999).** David Cariño's method, published in the *Journal of Performance Measurement*, introduces a scaling factor

$$k_t = \frac{R_p^{[1,T]} - R_b^{[1,T]}}{R_p^{[1,T]} \cdot \sum_t (R_{p,t} - R_{b,t})}$$

(with a limit form when the denominator is near zero) that scales each single-period attribution effect so that the scaled effects sum to the multi-period active return. Cariño's method is intuitive and widely implemented in commercial systems, but it has been criticized (e.g., by Frongello and by the SSRN paper "Comparing Performance Attribution Linking Methods") for scaling effects based on the magnitude of period returns in a way that has "no defensible basis." Critics argue that two periods with identical single-period attribution but different absolute return levels will receive different scaled contributions, which is economically arbitrary.

**Frongello (2002).** Andrew Frongello's "Linking Single Period Attribution Results" (*Journal of Performance Measurement*, Spring 2002) takes a different approach: each single-period attribution effect is inflated by a multiplicative factor that reflects the cumulative return of the portfolio up to that period. The Frongello linking formula for an effect $E_t$ in period $t$ is

$$E_t^{\text{linked}} = E_t \cdot \prod_{s=1}^{t-1} (1 + R_{p,s}) + R_{p,t} \cdot \sum_{s=1}^{t-1} E_s^{\text{linked}}$$

which ensures both that the linked effects sum exactly to the multi-period active return and that the linking is *order-dependent* in a controlled, economically-meaningful way. Frongello's paper argues that his approach "retains explanatory power while presenting multiple period attribution results by means of a method" that scales each period's contribution by the cumulative portfolio appreciation it generates. The Washington University dissertation and the QWAFAFEW Boston paper "Sector Level Attribution Effects with Compounded Notional Portfolios" extend Frongello's linking to sector-level attribution using compounded notional portfolios.

**Menchero and GRAP.** Jose Menchero's method (also published in *JPM*) and the GRAP (Geometric Re-Attribution Procedure) method provide alternative linking algorithms; both are surveyed in Ortec Finance's white paper "Multi-Period Performance Attribution: Framework for an Allocation Effect" and in Bacon (2008, Chapter 8 on smoothing algorithms). Bacon covers Cariño, Menchero, GRAP, Frongello, and Davies-Laker and recommends Frongello for arithmetic single-period BF systems because it preserves the explanatory interpretation of each effect.

**Practical guidance for a futures desk.** For a daily-attributed futures desk with monthly reporting, the standard choice is **Frongello linking** because (a) it sums exactly to the multi-period active return, (b) it preserves the per-period, per-sector interpretation, and (c) it is computationally simple. For a real-time intraday attribution system (see Section 10), linking is typically bypassed in favor of *direct* multi-period arithmetic — the active return over any horizon is recomputed from scratch at each tick, and the single-period BF effects are re-estimated over the desired horizon. This avoids the linking-coefficient overhead at the cost of losing the strict per-period decomposition.

---

## 6. Benchmark Selection for Futures

Benchmark selection is the single most consequential design decision in any attribution system, and it is unusually subtle for futures desks because there is no canonical "market portfolio" of futures the way there is for equities.

**No natural benchmark.** Unlike an equity long-only manager who can benchmark against the S&P 500 or MSCI World, a futures trader is not "tracking" an index. The desk's mandate is typically absolute-return (generate Sharpe > 1) or risk-premium-harvesting (carry, momentum, value). The benchmark must therefore be *constructed*, not selected. The CFA Institute literature review and the CFA Level III curriculum both stress that the benchmark must be (i) unambiguous, (ii) investable, (iii) measurable, (iv) appropriate, (v) reflective of current investment opinion, (vi) specified in advance, and (vii) owned by the investment manager. These are the seven CFA benchmark quality criteria.

**Equal-weight basket as the default.** The most defensible futures benchmark is an equal-weight basket of the same contracts the desk trades, rebalanced monthly (or at contract roll). Equal weighting satisfies all seven CFA criteria: it is unambiguous, investable, measurable, appropriate (it reflects the desk's investable universe), reflective of current opinion (no prior skill assumed), specified in advance, and owned by the manager. AMINDIS's futures attribution paper uses exactly this construction. Equal weighting is also robust to the well-documented biases of capitalization-weighted equity benchmarks (size, momentum, concentration), none of which apply to futures.

**Alternative: risk-weighted basket.** For desks that run constant-risk targets (volatility targeting), a risk-weighted basket — in which each sector is weighted inversely to its trailing realized volatility — is a better neutral benchmark. This is the approach used by many CTAs and by Man AHL's flagship systematic trading program: the benchmark is "an equal-risk basket of the traded sectors," and the desk's value-add is measured as the excess over that risk-equalized basket. Risk weighting avoids penalizing the manager for being long a low-vol sector like rates versus a high-vol sector like crypto, since both contribute equally to benchmark risk.

**Alternative: published commodity/CTA indices.** Some futures desks benchmark against published indices — the SG CTA Index, the BarclayHedge CTA Index, the BCOM commodity index, the S&P GSCI. This is appropriate only when the desk's strategy is *directly comparable* to the index construction (e.g., a systematic trend-follower benchmarking against SG Trend). The risk is benchmark mismatch: a discretionary global macro book benchmarked against SG Trend will produce attribution results that conflate "trend-following beta" with genuine alpha. The CFA Institute's guidance is to use a published index only when the strategy is effectively a constrained version of the index.

**For our purposes.** For a multi-strategy futures desk trading across equity index, rates, energy, metal, FX, and crypto sectors, the recommended default is the **equal-weight basket of traded contracts, rebalanced monthly at the front-month roll**. This is the construction that maximally isolates skill from sector selection: any deviation from equal weights is a deliberate allocation bet, and any deviation within a sector is a deliberate selection bet.

---

## 7. Sector Definition by Asset Class

For a futures book, the six recommended sectors map directly to the underlying asset classes of the contracts traded:

1. **Equity Index** (`equity_index`): futures on broad equity indices — S&P 500 (ES), Nasdaq 100 (NQ), Russell 2000 (RTY), Dow (YM), Nikkei 225 (SGX N225), DAX, FTSE, Hang Seng, CSI 300. These contracts share the economic driver of equity beta and the same roll calendar (quarterly, March/June/Sep/Dec). Treating them as one sector captures the desk's directional equity-timing skill separately from contract-selection skill.

2. **Rate** (`rate`): futures on government bonds and short-term interest rates — 10-year T-note (TY), 30-year T-bond (US), 5-year (FV), 2-year (TU), Eurodollar (GE)/SOFR (SR3), Bund, Bobl, Schatz, Gilt, JGB, ASX 3y/10y. These contracts share the economic driver of interest-rate and curve risk.

3. **Energy** (`energy`): crude (CL, BZ), products (RB, HO), natural gas (NG), coal, carbon (EUA, CER). The energy complex is the most volatile sector and the one where selection effects (Brent vs WTI, gas vs crack spreads) tend to dominate.

4. **Metal** (`metal`): precious (GC, SI, PL, PA) and base (HG, LX). Often subdivided in equity attribution but kept as one sector in futures because the desk's metal book is typically small.

5. **FX** (`fx`): CME FX futures (6E, 6B, 6J, 6A, 6C, 6S, DX) and any cash FX forwards. The benchmark is the equal-weight basket of the currencies the desk actually trades.

6. **Crypto** (`crypto`): BTC and ETH perpetual futures on offshore exchanges (Binance, Bybit, OKX) plus CME BTC/ETH futures. Treated as a separate sector because crypto's volatility and correlation regime differ structurally from the other five; lumping crypto into "equity index" would distort the allocation effect.

**Why these six.** The six-sector partition balances granularity against statistical power. With six sectors, a quarterly attribution produces 18 sector-level effect estimates (6 sectors × 3 effects); with 10+ sectors, the per-sector estimates become noisy and the equal-weight benchmark becomes unwieldy. The partition aligns with how multi-asset futures desks are organized (each sector is typically run by a separate pod or trader team), which makes the resulting allocation and selection effects directly actionable as feedback to the responsible decision-maker.

**Cross-sector hedges.** A subtlety: some strategies are inherently cross-sector (e.g., long equity index / short FX to express a USD-funded equity carry trade). The BF framework will decompose such a position into an allocation contribution from equity index (overweight) and an allocation contribution from FX (underweight / short), which together capture the cross-sector bet. The framework has no difficulty with this — it simply requires that *signed* weights (negative for shorts) be used consistently across portfolio and benchmark.

---

## 8. Visualization Patterns

Attribution results are only useful if they are communicated clearly. Three chart families dominate the practitioner literature on attribution visualization, all surveyed in Morningstar Direct's *Equity Performance Attribution Methodology* documentation, in FactSet's "Delicate Art of Interaction" piece, and in Carl Bacon's *Practical Portfolio Performance Measurement and Attribution* (Chapter 12 on presentation).

**Stacked bar chart.** The stacked bar is the canonical attribution chart: one bar per sector, with three colored segments representing allocation, selection, and interaction effects, and a final "Total" bar showing the sum. Positive effects stack upward from zero, negative effects stack downward. This chart is the most information-dense single view: it shows simultaneously (a) which sectors contributed to the active return, (b) whether the contribution came from allocation, selection, or interaction, and (c) the overall active return. Best practice (per Morningstar and FactSet) is to sort sectors by absolute total contribution, descending, so the eye is drawn to the largest drivers first.

**Waterfall chart.** The waterfall chart decomposes a single period's active return step by step: starting from zero (or from the benchmark return), each sector's allocation effect is added as a step, then each sector's selection effect, then each sector's interaction effect, ending at the total active return. Waterfalls are best for telling the *story* of attribution to non-quantitative audiences (clients, risk committees) because they make the cumulative buildup of performance explicit. The Domo, Inforiver, and think-cell guides all recommend waterfalls for financial variance analysis, and the modern Power BI / Tableau implementations make them trivial to build. For a futures desk, a quarterly waterfall with 18 steps (6 sectors × 3 effects) is the recommended client-facing chart.

**Heatmap.** The heatmap is the most powerful chart for multi-period, multi-sector analysis: rows are sectors (or sector-effect combinations), columns are time periods (days, weeks, months), and cell color encodes the attribution value (red for negative, green for positive, with intensity proportional to magnitude). The heatmap reveals *persistence* — whether a sector's allocation effect is consistently positive (skill) or randomly signed (luck) — which a single-period bar or waterfall cannot. Bacon (2008) recommends the heatmap as the primary internal management chart, with the waterfall and stacked bar reserved for client reporting. For a futures desk running daily attribution, a 6-sector × 60-trading-day heatmap of allocation effects is the standard "pulse check" chart.

**Combining the three.** A best-practice attribution dashboard shows all three: a stacked bar for the latest period, a waterfall for the quarter-to-date cumulative, and a heatmap for the trailing 60-day pattern. This combination supports both point-in-time diagnosis (what drove today?) and persistence assessment (is the skill real?).

---

## 9. GIPS Compliance Requirements

The Global Investment Performance Standards (GIPS), maintained by the CFA Institute, are the voluntary ethical standards for calculating and presenting investment performance. The 2020 edition (the current standard, with the GIPS Standards Handbook for Firms as the operational reference) imposes specific requirements that bear on attribution.

**GIPS does not mandate attribution.** The GIPS standards mandate time-weighted returns (TWR) for composites, require a minimum of five years of annual performance (extended to ten years after the first five), prescribe the treatment of carve-outs, fee presentation, and composite construction — but they do *not* require performance attribution. Attribution is treated as a recommended supplement, not a required component, of a GIPS-compliant presentation. The CFA Institute's Standard III(D) Performance Presentation and the GIPS Handbook both make this clear.

**What GIPS does require that bears on attribution.** Several GIPS requirements directly shape the data environment in which attribution is computed:
- **Time-weighted returns** (or modified TWR with geometric linking of sub-period returns) are required for composite presentation. Any attribution that aims to be GIPS-aligned must use TWR-based returns as inputs, not internal-rate-of-return (IRR) figures (which are permitted only for private equity and certain real-asset composites).
- **Accrual accounting for fixed-income** securities is required, which extends naturally to the rate-futures sector (where daily variation margin accrues).
- **Carve-out policies** require that any sub-portfolio included in a composite have its own cash allocation (post-2010), which affects how a multi-sector futures book is partitioned for attribution.
- **Composite consistency**: portfolios in the same composite must have similar strategies, which implies that attribution across portfolios within a composite should be computed using a consistent benchmark definition and consistent sector partition.
- **Disclosures**: the recommended (not required) disclosures include a description of the benchmark, the basis of calculation, and any deviations from the benchmark — all of which are naturally produced as byproducts of an attribution system.

**GIPS-attribution alignment best practice.** Although attribution is not required, the CFA Institute's performance attribution guidance and the CIPM curriculum recommend that any firm presenting attribution alongside GIPS-compliant returns should:
1. Use the same return calculation methodology (TWR) for attribution as for the GIPS presentation.
2. Use a benchmark that satisfies the seven CFA benchmark quality criteria (Section 6).
3. Disclose the attribution model used (BF, BHB, Brinson-Fachler with Frongello linking, etc.).
4. Reconcile attribution to the GIPS-presented returns to the basis point.
5. Present multi-period attribution using a recognized linking algorithm (Cariño, Frongello, Menchero, or GRAP).

For a futures desk claiming GIPS compliance, item 4 (reconciliation) is particularly important because futures accounting (variation margin, roll P&L, collateral yield) introduces several reconciling items that must be classified — typically as a separate "financing" line outside the three BF effects.

---

## 10. Jane Street / Quant Fund Practices: Real-Time Attribution and the 2D Strategy × Sector Matrix

The largest quantitative trading firms — Jane Street, Citadel, Two Sigma, Millennium, D.E. Shaw, Hudson River Trading — run attribution not as a monthly after-the-fact report but as a **real-time, intraday feedback loop**. Their practices, while mostly proprietary, can be reconstructed from job descriptions, conference talks (especially the QWAFAFEW Boston and Risk USA conferences), and the publicly-visible methodology documents of attribution vendors (Equity Data Science, SimCorp, MSCI Barra) that serve this segment.

**Real-time attribution.** At a firm like Jane Street, the attribution system runs on every position update — every fill, every cancel, every mark-to-market tick — and produces a live decomposition of year-to-date P&L into allocation, selection, and interaction effects by sector. The CFA Institute's literature review, the SimCorp article "Breaking Down Performance Attribution," and the Equity Data Science product description (used by several multi-manager platforms) all emphasize that continuous attribution provides a clearer, more actionable view of return and risk drivers than periodic end-of-month reporting. For a futures desk, real-time attribution has two practical implications. First, the BF formulas must be evaluated continuously against an evolving benchmark (the equal-weight basket itself moves as front-month rolls occur). Second, the *interaction term* becomes a particularly valuable real-time signal: a desk whose interaction effect is turning negative intra-day is "doubling down" on losing selection bets, which is precisely the pattern a risk manager wants to detect and flag for de-grossing.

**The 2D strategy × sector attribution matrix.** The single most important structural innovation in quant-fund attribution practice is the extension of the one-dimensional BF sector decomposition to a two-dimensional strategy × sector matrix. Instead of decomposing P&L into allocation/selection/interaction across six sectors (an 18-cell vector), the quant-fund attribution system decomposes P&L across both sectors *and* strategies, producing a matrix in which:
- rows are strategies (trend, carry, value, momentum, mean-reversion, basis-trading, calendar-spread, vol-arbitrage),
- columns are sectors (equity_index, rate, energy, metal, fx, crypto),
- each cell contains the strategy's contribution to that sector's allocation, selection, and interaction effects.

A 10-strategy × 6-sector × 3-effect attribution produces 180 cells — far too many to inspect directly, which is why the heatmap (Section 8) is the dominant visualization. The 2D matrix is also the input to *risk-adjusted attribution*, which decomposes active return by active risk taken in each cell to produce a cell-by-cell information ratio — the standard output of BarraOne and Axioma attribution systems.

**Pod attribution at multi-manager funds.** At Citadel and Millennium, the attribution matrix is further extended along a third dimension: the *pod* (the individual portfolio-management team) that generated the trade. The resulting 3D tensor — strategy × sector × pod — is the standard P&L-attribution output reviewed daily by risk and capital-allocation committees. Pods that consistently generate positive interaction effects in their assigned sector are scaled up; pods that consistently generate negative allocation effects are cut. Jane Street, Two Sigma, and D.E. Shaw operate similarly but with strategies internally developed rather than pod-driven.

**Implications for our engine.** For a futures attribution engine aimed at this level of practice, the design implications are: (a) compute attribution continuously, not monthly; (b) maintain a strategy dimension alongside the sector dimension so the 2D matrix is the natural output; (c) make the heatmap the primary management chart; (d) report the interaction term prominently and flag intra-day interaction deterioration; (e) reconcile continuously to the firm's accounting P&L to the tick; and (f) use Frongello linking for any backward-looking multi-period reporting while bypassing linking for forward-looking real-time attribution by recomputing directly over the desired horizon.

---

## References

1. Bacon, C. (2008). *Practical Portfolio Performance Measurement and Attribution* (2nd ed.). Wiley. Chapters 5, 7, 8 (Cariño/Menchero/GRAP/Frongello/Davies-Laker smoothing), 12 (presentation).
2. Brinson, G. P., & Fachler, N. (1985). Measuring Non-US Equity Portfolio Performance. *Journal of Portfolio Management*, 11(3), 73–76.
3. Brinson, G. P., Hood, L. R., & Beebower, G. L. (1986). Determinants of Portfolio Performance. *Financial Analysts Journal*, 42(4), 39–44 (JSTOR 4478947).
4. Brinson, G. P., Singer, B. D., & Beebower, G. L. (1991). Determinants of Portfolio Performance II: An Update. *Financial Analysts Journal*, 47(3), 40–48.
5. Cariño, D. (1999). Combining Attribution Effects Over Time. *Journal of Performance Measurement*, 4(1).
6. CFA Institute (2019). *Performance Attribution*. Research Foundation Literature Review. rpc.cfainstitute.org.
7. CFA Institute (2020). *GIPS Standards Handbook for Firms*. gipsstandards.org.
8. Frongello, A. (2002). Linking Single Period Attribution Results. *Journal of Performance Measurement*, 6(3), Spring.
9. Morningstar Direct. *Equity Performance Attribution Methodology*. morningstardirect.morningstar.com.
10. Advent / SS&C. *Performance Attribution* white paper. cdn.advent.com.
11. AMINDIS. Performance Attribution for Portfolios that Trade Futures Contracts. amindis.com.
12. SimCorp (2024). Breaking Down Performance Attribution. simcorp.com.
13. Ortec Finance. Multi-Period Performance Attribution: Framework for an Allocation Effect (Leerink).
14. FactSet Insight. Equity Attribution and the Delicate Art of Interaction.
15. AnalystPrep. Performance Evaluation and Attribution — CFA Level III.

---

## Appendix: Worked Single-Period Example (Illustrative)

Consider a two-sector futures book (equity index, energy) with a 50/50 equal-weight benchmark over one quarter:

| Sector $i$ | $w_{b,i}$ | $w_{p,i}$ | $R_{b,i}$ | $R_{p,i}$ |
|---|---|---|---|---|
| Equity index | 0.50 | 0.60 | +4.0% | +5.0% |
| Energy | 0.50 | 0.40 | +8.0% | +6.0% |

$R_b = +6.0\%$, $R_p = +5.4\%$, active return $= -0.6\%$.

- **Allocation (BF):** $(0.1)(4\%-6\%) + (-0.1)(8\%-6\%) = -0.4\%$. BF correctly penalizes overweighting the sub-benchmark equity-index sector.
- **Selection:** $0.5(5\%-4\%) + 0.5(6\%-8\%) = -0.5\%$. Net within-sector underperformance.
- **Interaction:** $(0.1)(5\%-4\%) + (-0.1)(6\%-8\%) = +0.3\%$. Joint sizing credit.
- **Reconciliation:** $-0.4\% + (-0.5\%) + 0.3\% = -0.6\%$. ✓

BHB would produce the same total allocation ($-0.4\%$) but with perverse per-sector signs — illustrating the BF improvement.
