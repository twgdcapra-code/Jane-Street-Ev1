# Reinforcement Learning for Trade Execution in Futures Markets

**Scope.** This report examines the application of reinforcement learning (RL) to the problem of optimal trade execution in futures markets. It covers the motivation, the Markov Decision Process (MDP) formulation, two dominant algorithm families (DQN and PPO), the classical Almgren-Chriss benchmark, simulator design, feature engineering, the training pipeline, state-of-the-art empirical results, deployment considerations, practitioner practices at firms such as Jane Street and Citadel, and a path to in-browser implementation. It is written for quantitative researchers and execution engineers who already understand TWAP, VWAP, and POV schedules at an intuitive level.

---

## 1. Why RL for Execution?

The default execution algorithms used by sell-side banks and buy-side desks — **TWAP** (time-weighted average price), **VWAP** (volume-weighted average price), and **POV** (percentage of volume) — are *static schedules*. Given a parent order of size Q over a horizon T, TWAP splits the order into T equal child slices, VWAP weights each slice by the expected intraday volume curve, and POV sends child orders at a rate proportional to observed market volume. None of these algorithms look at the current state of the order book, recent volatility, or the order's own progress versus schedule. They are essentially open-loop controllers.

The cost of this rigidity is real. A TWAP schedule that prints the same quantity every minute will get picked off in a market where liquidity is concentrated at the open and close; a VWAP schedule calibrated on a stale volume profile will under-trade on days with a late-session news shock; a POV schedule will chase price in a one-sided tape because its tempo scales with the very volume its own pressure is creating. Empirically, the literature on implementation shortfall (Perold, 1988) shows that the dominant component of execution cost is *timing risk* and *market impact*, both of which are time-varying and state-dependent.

Reinforcement learning offers a fundamentally different approach. An RL agent learns a policy π(a|s) that maps the current market state s to an action a — how much to trade right now — by *interacting* with a simulator and maximizing cumulative reward. The agent can therefore learn to slow down when spreads widen, accelerate when liquidity is deep, lean on the passive side when the book is imbalanced in its favour, and adapt the schedule to the realized rather than the expected volume profile. Unlike Almgren-Chriss, which commits to a deterministic trajectory before trading begins, an RL policy is *closed-loop*: it re-evaluates at every decision point. The cost of this flexibility is the need for a realistic simulator and substantial training, but the upside — measured in basis points of cost reduction at scale — is the primary reason every major execution desk has invested in RL research over the last five years.

---

## 2. Problem Formulation as an MDP

We cast optimal execution as a finite-horizon Markov Decision Process (MDP) defined by the tuple (S, A, P, r, γ, H).

### State S
The state vector at decision step t is:

```
s_t = [ remaining_qty_t,
        time_remaining_t,
        spread_t,
        depth_t,
        realized_vol_t,
        volume_curve_t,
        recent_returns_t,
        order_book_imbalance_t ]
```

- **remaining_qty_t**: quantity still to execute, normalized by parent order size Q (range 0–1).
- **time_remaining_t**: fraction of horizon H left (range 0–1).
- **spread_t**: current best bid–offer spread in ticks.
- **depth_t**: aggregate size available at top of book, or volume in the top N levels.
- **realized_vol_t**: short-horizon (e.g., 1-minute) realized volatility of the futures contract.
- **volume_curve_t**: cumulative market volume so far divided by expected full-day volume — captures whether the session is running "fast" or "slow".
- **recent_returns_t**: a small window (5–20 bars) of past mid-price returns; gives the agent directional context.
- **order_book_imbalance_t**: see Section 7; a signed proxy of short-term order flow pressure.

Some implementations also include the agent's own schedule deviation (ahead or behind a VWAP trajectory) and time-of-day one-hot features.

### Action A
Two parameterizations are common:

- **Discrete**: a ∈ {0%, 25%, 50%, 75%, 100%} of remaining quantity to execute in the next interval. Five actions is a popular choice because it is expressive enough to capture "wait", "trade half", and "go aggressive" without exploding the Q-table.
- **Continuous**: a ∈ [0, 1], a fraction of remaining quantity. This is the natural setting for PPO and other policy-gradient methods.

The action is interpreted as a *target child order size* for the next decision interval (typically 1–10 seconds). The simulator then determines the fill price and quantity given the order book state.

### Reward r
The reward is the **negative implementation shortfall** of the slice, plus optional shaping terms:

```
r_t = -( exec_price_t - arrival_price ) × fill_qty_t  -  commission_t
```

where `arrival_price` is the mid-price at the moment the parent order was received. Aggregating r_t over the episode yields the total implementation shortfall (Perold, 1988). Variants add a tardiness penalty when remaining quantity is high with little time left, or a bonus when the agent beats the running VWAP benchmark.

### Episode
One episode corresponds to one parent order: it begins when the order is received and ends when remaining quantity hits zero (success) or the horizon expires (failure, in which case a residual penalty applies). A typical episode is 5–30 minutes of simulated time, sliced into 30–300 decision steps.

### Transition P and discount γ
The transition is governed by the simulator's microstructure model (Section 6). The discount factor γ is usually set close to 1 (0.99–0.999) because execution costs are not strongly time-discounted within a single order — a basis point saved at the end of the episode is worth nearly as much as one saved at the start.

---

## 3. Deep Q-Network (DQN)

DQN, introduced by Mnih et al. (2015) in *Nature* for Atari game play, is the canonical value-based deep RL algorithm and a strong baseline for execution. It approximates the **Q-value function** Q(s, a) — the expected discounted return of taking action a in state s and behaving optimally thereafter — with a neural network Q_θ(s, a).

### Bellman equation
The Q-function satisfies the Bellman optimality equation:

```
Q(s, a) = E[ r + γ · max_{a'} Q(s', a') ]
```

DQN trains Q_θ to satisfy this equation by minimizing the temporal-difference loss:

```
L(θ) = E_{(s,a,r,s') ~ D} [ ( r + γ · max_{a'} Q_{θ⁻}(s', a') − Q_θ(s, a) )² ]
```

### Experience replay
Transitions (s, a, r, s') are stored in a FIFO **replay buffer** D of typical size 10⁵–10⁶. Mini-batches are sampled uniformly at random from D for each gradient step. This breaks temporal correlation between consecutive samples — critical in financial time series where adjacent states are highly dependent — and reuses each experience many times, improving sample efficiency.

### Target network
A separate **target network** Q_{θ⁻}, whose parameters θ⁻ are copied from θ every N steps (or Polyak-averaged slowly), provides the bootstrap target `max_{a'} Q_{θ⁻}(s', a')`. Without this trick, the same network that produces the prediction also produces the target, creating a positive feedback loop that causes divergence. Mnih et al. (2015) showed that the target network is essential for stable training.

### Epsilon-greedy exploration
During training, the agent selects the greedy action argmax_a Q_θ(s, a) with probability 1−ε, and a random action with probability ε. ε is typically annealed from 1.0 down to 0.05 over the first ~10% of training. For execution, exploration must be careful: a purely random action might mean "dump the entire remaining quantity now," which is catastrophic in a thin book. Practitioners often constrain the random action to a "sane" neighborhood of the greedy one (e.g., ±1 discrete level).

### Practical notes for execution
- Input normalization is critical: spread, depth, vol, and returns live on very different scales.
- The output layer has one unit per discrete action; softmax over Q-values is *not* used (Q-values are not probabilities).
- Double DQN (van Hasselt et al., 2016) reduces overestimation bias by using the online network to select the argmax and the target network to evaluate it — almost always a free win in execution settings.

---

## 4. Proximal Policy Optimization (PPO)

PPO, introduced by Schulman et al. (2017), is the dominant **policy-gradient** algorithm and the default choice when continuous actions are needed. Unlike DQN, PPO learns the policy π_θ(a|s) directly, typically as a Gaussian over a continuous action (mean and standard deviation output by the network).

### Actor-critic architecture
PPO uses two networks (or two heads of one network):
- **Actor** π_θ(a|s): the policy.
- **Critic** V_φ(s): estimates the state-value, used to compute the advantage A_t = R_t − V_φ(s_t), where R_t is the discounted return.

### Clipped surrogate objective
The core innovation of PPO is the **clipped surrogate objective**:

```
L^{CLIP}(θ) = E_t [ min( r_t(θ) · A_t ,  clip(r_t(θ), 1−ε, 1+ε) · A_t ) ]
```

where r_t(θ) = π_θ(a_t|s_t) / π_{θ_old}(a_t|s_t) is the probability ratio between the new and old policy. The clip prevents destructively large policy updates — if the ratio drifts beyond [1−ε, 1+ε] (typical ε = 0.1–0.2), the gradient is zeroed. This gives PPO the stability of trust-region methods (TRPO) without their second-order computational cost.

### On-policy
PPO is **on-policy**: it can only learn from data generated by the *current* policy. There is no replay buffer; each batch of experience is used for a few gradient steps and then discarded. This makes PPO less sample-efficient than DQN but more stable in non-stationary environments — and financial markets are notoriously non-stationary. For execution, where simulators can generate effectively unlimited experience, the sample-efficiency cost is acceptable.

### Why PPO for execution
- **Continuous actions**: slicing "17.3% of remaining quantity" is more expressive than picking from five buckets.
- **Stochastic policy**: the Gaussian actor naturally produces a distribution, which is useful for ensemble exploration and for the variance estimation needed in risk-aware execution.
- **Robustness**: PPO is famously insensitive to hyperparameters, which matters when the production environment drifts from the simulator.

---

## 5. Almgren-Chriss as a Benchmark

The **Almgren-Chriss model** (Almgren & Chriss, 2000) is the classical optimal-execution benchmark and the single most important baseline any RL execution system must beat. It frames execution as a mean-variance optimization: choose a trading trajectory x_t (cumulative quantity traded by time t) to minimize

```
E[IS] + λ · Var[IS]
```

where IS is implementation shortfall, λ ≥ 0 is the trader's risk-aversion parameter, and the dynamics are linear permanent impact + square-root temporary impact.

### Closed-form solution
Under these assumptions the optimal trajectory is a deterministic, downward-sloping curve whose shape depends on λ:
- **λ → 0** (risk-neutral): the agent minimizes expected cost only, trading as slowly as possible → approaches a flat (TWAP-like) schedule.
- **λ → ∞** (infinitely risk-averse): the agent minimizes variance only, executing immediately at t = 0 → front-loaded schedule.
- Intermediate λ produces a smooth convex trajectory that front-loads more aggressively as risk aversion rises.

This is the famous **efficient frontier of optimal execution**: for each λ there is a unique (E[IS], Var[IS]) pair, and no other trajectory can achieve a lower variance at the same expected cost.

### Where Almgren-Chriss falls short
Almgren-Chriss assumes:
1. **Stationary** market dynamics (constant volatility, constant liquidity).
2. **Deterministic** optimal trajectory chosen *before* trading begins.
3. **Linear/quadratic** impact — a simplification of the empirically observed square-root law.
4. **No order book microstructure** — just a price impact curve.

Real futures markets violate all four. Volatility clusters; depth varies intraday by an order of magnitude; impact follows a square-root (not linear) law in trade size; and the order book's state at the next decision step is highly informative about the next tick's direction. An RL agent that conditions on this state — and updates its trajectory online — should, in principle, dominate Almgren-Chriss exactly in the regimes where the assumptions break down: volatile markets, events, end-of-day squeezes, and cross-listed arbitrage flows. In calm, trending markets the two methods are often statistically indistinguishable.

---

## 6. Simulator Design for Training

An RL execution policy is only as good as the simulator it was trained on. The simulator must reproduce the stylized facts of futures microstructure, or the agent will learn to exploit simulator artifacts that do not exist in the real market.

### Order book simulator
A limit order book (LOB) simulator maintains price levels with resting bid and ask sizes, processes incoming market and limit orders, matches them according to FIFO/price-time priority, and emits trades and book updates. Decisions can be made on a wall-clock tick (e.g., every 1 s) or on a **volume clock** (every time N contracts print), which aligns the agent's decision frequency with the natural rhythm of liquidity.

### Market impact: the square-root law
Empirical work by Bouchaud and others over the last 30 years has established the **square-root law of market impact**:

```
impact ≈ κ · σ · √( Q / ADV )
```

where κ is a contract-specific constant (~0.1–1.0), σ is daily volatility, Q is the parent order size, and ADV is average daily volume. The simulator should implement temporary impact on the agent's child orders using this functional form (possibly augmented with a concave transient component and a small linear permanent component). A linear impact model — common in toy simulators — dramatically understates the cost of large orders and teaches the agent to be too aggressive.

### Adverse selection
When the agent buys, the simulator must push the price *up* — not just via the agent's own impact, but because in real markets a sequence of aggressive buys is a signal that other informed traders are also buying. This **adverse selection** is implemented by skewing the mid-price drift in the direction of the agent's signed order flow. Without it, the agent learns to cross the spread freely; with it, the agent learns that passive execution is often cheaper in expectation.

### Volume clock
The agent's decision interval should be tied to a **volume clock** rather than wall-clock time: when market volume is high, the agent gets more decision opportunities, matching the actual granularity of liquidity. This also makes the state's `volume_curve` feature meaningful.

### Noise traders
Background order flow — "noise traders" — generates the bulk of LOB events and prevents the agent from believing it is the only participant. Noise is typically modeled as a Poisson or Hawkes process of marketable and limit orders whose intensity is calibrated to historical intraday volume profiles. Some simulators go further and include informed flow, momentum traders, and even simulated predators (see Section 11).

---

## 7. Feature Engineering

The quality of the state features is the single biggest determinant of RL execution performance. Below are the features most consistently useful in published and industry work.

### Order book imbalance (OBI)
The single most predictive microstructure feature for short-horizon price moves:

```
OBI = (bid_size − ask_size) / (bid_size + ask_size)
```

using top-of-book sizes, or summed over the top N levels. OBI ∈ [−1, +1]; positive OBI predicts upward mid moves, negative predicts downward. Recent deep-RL work (e.g., Kolm, Turiel & Westray, 2021) shows that a *deep* version of OBI — using all N levels as a vector input — substantially improves return forecasts at horizons of a few seconds.

### Volume-weighted midpoint (VWMP)
Rather than the simple midpoint (best bid + best ask)/2, use the size-weighted midpoint of the top N levels. This better reflects the "true" fair value when the book is asymmetric.

### Realized volatility
Two windows are useful:
- **5-bar** (~ a few seconds): high-frequency regime indicator.
- **20-bar** (~ a minute): slower regime, useful for sizing child orders.

Both should be annualized or log-scaled so the agent sees a stationary input.

### Time-of-day features
Futures markets have pronounced intraday seasonality: a U-shaped volume curve (high at open and close, low mid-session), periodic bursts at economic releases (NFP, CPI, FOMC), and lunch lulls in Asian hours. Encode time-of-day either as minutes-since-open (normalized) or as a one-hot bucket (open / morning / lunch / afternoon / close). This lets the agent learn different policies per session phase.

### Remaining quantity ratio
remaining_qty / Q — already in the state vector. Essential for the agent to know how far it is from completion.

### Schedule deviation
The difference between the agent's actual cumulative fill and a VWAP schedule:

```
deviation_t = cumulative_fill_t − expected_VWAP_fill_t
```

Positive deviation means "ahead of schedule"; negative means "behind." Combined with time_remaining, this lets the agent learn to manage end-of-order urgency — the single largest source of implementation shortfall variance.

---

## 8. Training Process

### Episode budget
A single training run typically requires **10,000–100,000 episodes** for DQN and 1–10 million environment steps for PPO. With a 30-minute episode sliced into 100 steps, that is 10⁶–10⁷ simulator steps — comfortably tractable on a single GPU in 4–24 hours when the simulator is vectorized.

### Curriculum learning
Start with small parent orders (e.g., 0.1% of ADV) where impact is negligible and the agent can learn the basic mechanics, then progressively increase order size up to several percent of ADV where impact dominates. Without curriculum, the agent never explores enough "good" trajectories at large sizes and gets stuck in a local minimum of "always wait until the last second."

### Reward shaping
Pure implementation-shortfall rewards are sparse and noisy at the start of training. Common shaping additions:
- **Tardiness penalty**: −α · max(0, remaining_qty − expected_remaining) at each step, encouraging the agent to keep pace.
- **VWAP-beating bonus**: +β · (VWAP − exec_price) · qty, aligning the reward with a benchmark the agent will be measured against in production.
- **Impact penalty**: explicit penalty on the square-root impact of each child order.

Shaping must be removed or annealed toward the end of training so the final policy optimizes the true objective.

### Validation
Hold out a separate set of historical market data (or simulator seeds calibrated to a different period) and evaluate the trained policy on it **without further learning**. The standard protocol is **train on 2023, test on 2024** — a full out-of-sample year that includes different volatility regimes, contract rolls, and macro events.

### Overfitting risk
RL policies are notoriously prone to overfitting the simulator. Symptoms include:
- Policy that performs well in training but degrades sharply in held-out data.
- Extreme action choices (e.g., always 100% or always 0%).
- Sensitivity to small input perturbations.

Mitigations: domain randomization (vary σ, spread, depth across episodes), walk-forward validation, ensemble of multiple seeds, and the **combinatorial purged cross-validation** approach of Lopez de Prado applied to episode selection. A policy that beats TWAP by 3 bps in-sample but only 0.5 bps out-of-sample is overfit; one that beats by 2 bps in both is real.

---

## 9. State-of-the-Art Results

Empirical results across both academic and industry papers have converged on a fairly consistent picture:

- **DQN with discrete actions** typically beats TWAP by **2–5 bps** on liquid futures (ES, CL, Bund) and by 1–3 bps on less liquid contracts. The improvement over VWAP is smaller (1–3 bps) because VWAP already captures much of the intraday volume pattern.
- **PPO with continuous actions** beats TWAP by **3–7 bps** and beats VWAP by 2–4 bps, with the advantage largest in volatile or news-heavy sessions. The continuous action space is the main driver: the ability to trade "23% of remaining" rather than "25%" adds up over thousands of child orders.
- **Almgren-Chriss** is competitive with — and occasionally beats — RL in calm, trending markets where its assumptions hold. RL's edge appears precisely in volatile regimes, around the close, and on large parent orders where the square-root impact and adverse selection matter most.
- **Multi-agent RL** shows larger gains. Ning et al. (2021) and subsequent work on **multi-agent RL for execution** report **5–10 bps** improvements over single-agent DQN by decomposing the parent order across multiple child-order agents that learn to coordinate (e.g., one agent works the bid, another the ask, a third manages hidden orders). Recent arXiv work (e.g., "Optimal Execution with Reinforcement Learning in a Multi-Agent Market", 2024) confirms that Double-DQN-based MARL frameworks outperform both VWAP and TWAP in ROI and IS.

The numbers should be interpreted with caution: they are simulator-dependent, and a 5 bps backtest gain can vanish in production if the simulator under-models latency, queue position, or exchange microstructure rules. The robust conclusion is that **RL systematically matches or beats classical schedules, with the largest gains in non-stationary regimes** — exactly where fixed schedules are weakest.

---

## 10. Deployment Considerations

### Inference latency
Real-time execution demands sub-millisecond decision latency. A 3-layer MLP with 64–128 units per layer runs in **<100 µs** on a modern CPU and **<10 µs** on a GPU; that is well within budget. The bottleneck is usually not the network forward pass but feature computation (OBI, vol) and the order-management round-trip. Inference must be deterministic and reproducible — no random sampling at deployment time; use the greedy action (DQN) or the policy mean (PPO).

### Model serialization
Export the trained network to **ONNX** (Open Neural Network Exchange) for cross-framework portability, or to **TensorFlow Lite** / **ONNX Runtime** for edge deployment. ONNX is the de-facto standard for production ML inference and runs on every major inference server. Avoid Python in the hot path — load the ONNX model in C++, Rust, or a JVM and call it directly from the order-management system.

### A/B testing
Never deploy a new RL policy against all flow at once. Route a small percentage (e.g., 5%) of parent orders to the RL agent and the rest to the existing TWAP/VWAP baseline, stratified by order size, symbol, and time of day. Compare realized implementation shortfall over a statistically meaningful sample (typically thousands of orders, several weeks). Use the same arrival-price accounting for both arms. Kill the experiment if the RL arm underperforms by more than a pre-specified threshold for two consecutive days.

### Continuous learning
Markets drift; a policy trained in January will be stale by June. Retrain **nightly** on the most recent 30–90 days of data, validate on the most recent held-out week, and promote to production only if it beats the incumbent on out-of-sample IS. Maintain a model registry with versioning and full lineage (training data hash, hyperparameters, simulator seed).

### Circuit breaker
A hard fallback is essential. Monitor the RL agent's realized IS versus the TWAP baseline in real time; if it underperforms by more than N bps over a rolling window (e.g., 5 bps over the last 50 parent orders), automatically fall back to TWAP for the next order and alert the desk. This protects against silent policy degradation from regime change, exchange rule updates, or upstream data quality issues.

---

## 11. Jane Street / Citadel Practices

Top quantitative firms do not publish their execution RL stacks, but a consistent picture emerges from job postings, conference talks, and the open-source work they do release.

### Custom RL frameworks
Firms at this scale do not use OpenAI Gym or Stable-Baselines3 in production. Jane Street, Citadel, and Optiver build **custom RL frameworks** tightly integrated with their proprietary market simulators, written in OCaml, F#, C++, or increasingly Rust. The simulator and the trainer share the same data structures, eliminating serialization overhead and allowing the trainer to run on the firm's full historical tick database.

### FPGA-accelerated inference
Jane Street's published performance-engineering work (Hardcaml, their OCaml-to-FPGA toolchain) and their public talks on FPGA-based ML accelerators make clear that latency-critical inference is increasingly offloaded to **FPGAs**. A small MLP quantized to fixed-point can run in single-digit microseconds on an FPGA, with the order-book state maintained in on-chip BRAM. This is well below the ~100 µs round-trip to a CPU-based inference server.

### Multi-agent: one agent per child order
Rather than a single monolithic policy deciding all child-order sizes, modern execution stacks decompose the problem: a **meta-agent** decides urgency and overall schedule, and **child agents** (one per active child order) decide limit price, venue, and cancellation. This matches the hierarchical structure of real OMS/EMS systems and lets each child agent specialize (e.g., one for passive top-of-book, one for dark pools, one for aggressive crosses).

### Hierarchical decomposition
The hierarchy is explicit:
- **Meta-agent**: sees parent order parameters and macro market state; outputs an urgency / risk-budget schedule.
- **Schedule agent**: converts urgency into a target child-order cadence.
- **Micro agent**: picks the concrete limit price and order type for each child order, conditioning on the live LOB.

This decomposition dramatically reduces the state and action space each network must learn, improving sample efficiency and interpretability.

### Adversarial training
The most sophisticated stacks train the execution agent **against simulated predators** — adversarial RL agents whose reward is to detect and front-run the execution agent's pattern. This adversarial training produces policies that are robust to gaming, hide their footprint better, and survive contact with real informed flow. It is the same principle as GANs, applied to market microstructure.

---

## 12. Browser Implementation

While production execution runs in co-located C++/FPGA stacks, there is growing value in **browser-based** RL for research, visualization, and lightweight deployment to non-latency-critical venues (e.g., crypto, retail brokerages, or internal demo tools).

### TensorFlow.js for in-browser inference
**TensorFlow.js** (TF.js) runs neural networks directly in the browser using WebGL (and increasingly WebGPU) for acceleration. A trained PyTorch or TensorFlow model can be converted to TF.js format via the `tensorflowjs_converter` and loaded with `tf.loadLayersModel()`. A 3-layer MLP runs in single-digit milliseconds on commodity hardware — fast enough for a 1-Hz decision loop on liquid crypto pairs.

### Web Workers for non-blocking training
Training in the main thread would freeze the UI. Offload the training loop to a **Web Worker** (or several), posting state tensors in and policy updates out via `postMessage`. SharedArrayBuffer enables zero-copy tensor sharing between workers when cross-origin isolation is configured. For heavier training, **WebGPU** provides near-native GPU compute in Chromium-based browsers.

### Simple feedforward network
For execution, the network need not be deep. A **2–3 hidden layer MLP with 64–128 units per layer** and ReLU or GELU activations is sufficient. Larger networks overfit the simulator; recurrent networks (LSTM/GRU) help if the state does not already include recent-return history, but are harder to serve in real time. The input layer matches the state vector size (8–20 features); the output is either one unit per discrete action (DQN) or a mean + log-std pair (PPO continuous).

### Q-table fallback
For very small state spaces — for example, a discretized execution problem with 10 quantity bins × 10 time bins × 5 spread bins × 3 vol bins = 1,500 states and 5 actions — a tabular Q-learning agent is competitive with DQN, trivially debuggable (you can inspect every Q-value), and requires zero ML libraries. It is the right starting point for a new execution problem: build the Q-table, confirm the agent learns sensible behaviour, then graduate to DQN/PPO only when the state space grows.

---

## Conclusion

Reinforcement learning reframes trade execution from a static scheduling problem into a closed-loop control problem. With a careful MDP formulation, a realistic simulator that reproduces the square-root impact law and adverse selection, and disciplined out-of-sample validation, RL agents — whether DQN for discrete slicing or PPO for continuous control — consistently match or beat TWAP, VWAP, and even Almgren-Chriss (2000), with the largest gains in volatile and non-stationary regimes where fixed schedules fail. The path to production runs through ONNX-serialized models, A/B testing against TWAP baselines, nightly retraining, and hard circuit-breaker fallbacks; the path to state-of-the-art runs through multi-agent hierarchical architectures, adversarial training against simulated predators, and FPGA-accelerated inference — practices increasingly documented at firms like Jane Street.

---

## References

- Almgren, R. & Chriss, N. (2000). *Optimal Execution of Portfolio Transactions*. Journal of Risk, 3(2), 5–39.
- Bouchaud, J.-P., Farmer, J. D., & Lillo, F. (2009). *How Markets Slowly Digest Changes in Supply and Demand*. Handbook of Financial Markets.
- Kolm, P. N., Turiel, J., & Westray, N. (2021). *Deep Order Flow Imbalance: Extracting Alpha at Multiple Horizons from the Limit Order Book*. SSRN.
- Lopez de Prado, M. (2018). *Advances in Financial Machine Learning*. Wiley.
- Mnih, V. et al. (2015). *Human-level Control through Deep Reinforcement Learning*. Nature, 518, 529–533.
- Ning, B., Lin, F. H. T., & Jaimungal, S. (2021). *Double Deep Q-Learning for Optimal Execution*. Applied Mathematical Finance, 28(4), 361–380.
- Perold, A. F. (1988). *The Implementation Shortfall: Paper versus Reality*. Journal of Portfolio Management, 14(3), 4–9.
- Schulman, J., Wolski, F., Dhariwal, P., Radford, A., & Klimov, O. (2017). *Proximal Policy Optimization Algorithms*. arXiv:1707.06347.
- van Hasselt, H., Guez, A., & Silver, D. (2016). *Deep Reinforcement Learning with Double Q-Learning*. AAAI.
