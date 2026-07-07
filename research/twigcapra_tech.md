# Jane Street Capital: Technology Stack and Engineering Culture

**Research Report — Compiled from Public Sources**

Jane Street Capital is a privately held quantitative trading firm and liquidity provider headquartered in New York, with offices in London, Hong Kong, Singapore, and Amsterdam. Founded in 2000, the firm trades a remarkably broad range of asset classes — equities, options, futures, bonds, currencies, commodities, and cryptocurrencies — and is one of the largest market makers in the world, routinely accounting for a sizable share of daily volume on major exchanges.

What sets Jane Street apart from most of its competitors in the high-frequency / quantitative trading space is its near-monolithic commitment to a single programming language — **OCaml** — across virtually its entire technology stack, from hardware-design DSLs through trading systems, risk, data infrastructure, and internal web UIs. This report synthesizes what is publicly documented about the firm's technology choices, architectural patterns, and engineering culture, with clear separation between factual public statements and reasonable inference / speculation.

---

## 1. Programming Languages: OCaml "All The Way Down"

### 1.1 Factual Foundation

Jane Street is, by its own description, "big believers in functional programming" and uses **OCaml, a statically typed functional language, as our primary development platform" [1]. Yaron Minsky, who joined Jane Street in 2002 and is widely credited with convincing the firm to adopt OCaml, has stated publicly that Jane Street runs "a large and successful trading business on software written almost entirely in OCaml" [2][3]. The firm's home page explicitly states that "we build low-latency networks, hack compilers and design distributed systems" [4].

The phrase "OCaml all the way down" — used as the title of a popular Jane Street tech talk — is not just marketing. Jane Street uses OCaml for:

- Critical trading systems and market-making engines
- Risk and pricing systems
- Build systems and developer tooling
- Internal web applications (via the Bonsai framework)
- Hardware design, via the Hardcaml DSL that compiles to Verilog/RTL for FPGAs
- Compilers — Jane Street maintains and contributes to the OCaml compiler itself

In the early "Caml Trading" paper (Minsky & Weeks, *Journal of Functional Programming*, 2014), the authors noted that the firm already had "over twenty OCaml programmers and hundreds of thousands of lines of OCaml code" used for "critical trading systems" [5]. Today, public estimates put the firm's engineering headcount in the thousands — Instagram promotional material circulated by Jane Street references "3,500 engineers & researchers, 500+ quants & traders" [6] — and the OCaml codebase is widely understood to be many millions of lines.

### 1.2 Why OCaml? — Reasons Publicly Stated by Jane Street

Jane Street engineers, primarily Yaron Minsky, have articulated the rationale in multiple blog posts and talks:

1. **A predictable, simple runtime.** OCaml has "a more familiar execution model and a much simpler runtime, which makes it easier to predict the performance of a function" [7]. For a trading firm where predictable latency is critical, this matters more than peak micro-benchmark performance.

2. **Strong static typing with type inference.** Jane Street relies on types to encode invariants. Their canonical blog post "OCaml, the ultimate refactoring tool" argues that OCaml "doesn't automate the work of refactoring, but it does greatly reduce the number of bugs that your refactoring introduces" [8]. The type system acts as a continuous, compile-time safety net across a codebase that is constantly being reshaped by traders and researchers asking for new features.

3. **A real "sweet spot" in language design.** In the "Why OCaml?" blog post and accompanying YouTube talk, Minsky frames OCaml as occupying a unique intersection of functional purity, strict static typing, pragmatic mutability when needed for performance, and a relatively small runtime — distinguishing it from Haskell (laziness and typeclass machinery complicate reasoning about performance) and from ML family siblings like SML (smaller ecosystem) [9][10].

4. **Concurrency model.** The firm maintains `Async`, its own asynchronous I/O / concurrency library, which provides cooperative concurrency via monadic deferreds. `Async_kernel` is the heart of Jane Street's concurrent programming story [11].

5. **Industrial-strength tooling they own.** Because Jane Street maintains Core (their alternative standard library), Async, the ppx_jane ppx rewriters, and large parts of the compiler, they can evolve the language to fit the firm's needs rather than waiting for outside vendors [12].

### 1.3 Key Open-Source Libraries Released by Jane Street

Jane Street publishes a synchronized set of open-source OCaml libraries on GitHub and OPAM. The most significant include:

| Library | Purpose |
|---|---|
| **Core / Base** | An industrial-strength alternative to OCaml's standard library. `Base` is the dependency-free foundation; `Core` extends it [13]. |
| **Async** | Asynchronous I/O and concurrency library — Jane Street's answer to Lwt/monadic concurrency [11]. |
| **Incremental** | Self-adjusting / incremental computation library for reactive computations whose inputs change over time (used heavily in trading UIs and live risk views) [14]. |
| **Hardcaml** | A hardware-design DSL embedded in OCaml that compiles to Verilog / RTL for FPGAs [15][16]. |
| **Bonsai** | Functional, reactive web UI framework (inspired by Elm) used to build "almost all web applications" at Jane Street [17][18]. |
| **ppx_jane** | Bundle of syntax extensions including `ppx_inline_test`, `ppx_assert`, `ppx_sexp_value`, `ppx_hash`, `ppx_compare`, etc. — used pervasively to auto-derive comparison, serialization, and tests [12]. |
| **Re2, Core_kernel, Patience_diff, Magic-trace, Cryptokit, etc.** | Many smaller utilities. |

The firm releases these in lock-step under a versioned umbrella (historically `v0.12`, `v0.14`, `v0.15`, `v0.16`, etc.) [13].

### 1.4 OCaml 5 Migration

At ICFP/SPLASH 2025, Jane Street presented on its production deployment of **OCaml 5**, the major rewrite of the OCaml runtime that introduces a new effect-based concurrency model and multicore support. This was a years-long engineering effort that Jane Street co-drove with Tarides and the broader OCaml community, and it directly affects their ability to run trading workloads in parallel on modern multicore hardware [19].

---

## 2. Low-Latency Infrastructure

### 2.1 Co-location and Networks

As a top-tier liquidity provider on dozens of exchanges worldwide, Jane Street co-locates its servers inside exchange data centers — this is standard practice for any firm competing for queue position in central limit order books [20][21]. A Reddit discussion among practitioners notes that "any co-located market maker ends up needing the same kernel-bypass networking (DPDK or RDMA), the same tick-to-trade latency budgets" [20] — implying Jane Street uses the same class of techniques as competitors like Citadel Securities, Virtu, Optiver, and Jump.

Jane Street publishes peer-reviewed research in this area. At ACM SIGCOMM 2024, Jane Street authors published **"Network Design Considerations for Trading Systems"** in the ACM Digital Library, which "pulls back the curtain on one such area: the low-latency networks used for algorithmic trading systems" and presents "requirements and design considerations" [22]. This is one of the few public, peer-reviewed treatments of low-latency trading network design from a major HFT firm.

A recurring topic on Jane Street's own podcast, *Signals and Threads*, is **reliable multicast**, **clock synchronization**, and **treating "the network as a program"** — reflecting that Jane Street's network is not a passive plumbing layer but an active, programmable substrate designed in tandem with trading logic [23][24].

### 2.2 FPGAs and Hardcaml

Jane Street is a major user of **FPGAs** in its low-latency path. According to public job postings and tech talks, FPGAs at Jane Street are used for:

- **Market data feed handling** — decoding exchange multicast feeds directly in hardware, eliminating operating-system overhead and bypassing the kernel network stack [25][26].
- **Pre-trade risk checks** — order-flow gates enforced at hardware speed.
- **Order gateway / pre-processing** — normalizing order entry messages and performing deterministic transformations before they hit the trading logic.

What makes Jane Street unusual in the FPGA world is that they design their hardware in OCaml, not in Verilog or VHDL. **Hardcaml** — open-sourced and described in an arXiv paper, "Hardcaml: An OCaml Hardware Domain-Specific Language" — lets designers "express circuits with the same amount of control as Verilog or VHDL, but with the abstractions and metaprogramming power of a host programming language" [15]. Hardcaml is "industrially proven, and has been used at Jane Street internally for many large FPGA designs" [15]. A Jane Street FPGA Engineer job posting confirms: "We use Hardcaml, an OCaml library for succinctly describing hardware in RTL. Hardcaml is tightly integrated into our development environment" [26].

The tech talk **"OCaml All The Way Down"** demonstrates the depth of this approach — including use of CORDIC cores and other numeric primitives implemented in Hardcaml — showing that Jane Street effectively treats hardware design as a continuation of software design, in the same language, with the same tooling [27].

Andy Ray, who leads Jane Street's hardware engineering team and is the original author of Hardcaml, was the inaugural guest on the *Signals and Threads* podcast, where he discusses the firm's FPGA program [28].

### 2.3 Latency Numbers

Ron Minsky, Jane Street's head of technology, has publicly stated that "some of their trading systems can react in under 100 nanoseconds" — i.e., **sub-100-nanosecond tick-to-trade latencies** for the fastest paths [29][30]. This is in the same neighborhood as the very fastest HFT firms ( Citadel Securities, Jump, Optiver) and necessarily implies FPGA-based market data decoding combined with pre-computed reaction paths. Minsky's claim that "a response can start going out before the full market data has even arrived" indicates the use of **speculative / anticipated reaction** based on the first bytes of an incoming packet — a well-known technique at the very top of the low-latency pyramid [30].

### 2.4 Own Data Center Build-Out

In 2025–2026 Jane Street announced plans to **build and self-finance its own data center with 100–200 MW of capacity**, primarily to support AI model training and general compute scale-out [31][32][33]. Bloomberg reported this as a response to "compute power running scarce" [31]. A Jane Street-published video touring their Texas datacenter notes that it houses **4,032 GPUs** — for context, "twenty years ago, our 'cluster' was just 6 Dells stacked on the floor of our office" [32]. This is a notable strategic shift: Jane Street is taking physical infrastructure into its own hands rather than relying solely on co-location providers.

### 2.5 Speculation vs. Fact

It is **fact** that Jane Street uses FPGAs, co-locates, and designs hardware in Hardcaml. It is **reasonable inference**, but not publicly confirmed in detail, that their FPGA workloads include feed handlers, normalizers, pre-trade risk gates, and possibly order-tagging logic. The specific split between FPGA-resident and OCaml-on-CPU-resident functionality in their order-entry path is not publicly documented at the level of individual modules.

---

## 3. Trading Systems Architecture

### 3.1 Market Making at the Core

Jane Street's primary business is **market making** — providing continuous two-sided quotes across thousands of listed instruments and earning the bid-ask spread while managing inventory risk. The firm describes itself as a "quantitative trading firm and liquidity provider" [4]. Their systems, as described in job postings and podcasts, are organized around the **dual mandate of every market maker**: capture spread aggressively when edge is present, manage adverse selection (the risk of being picked off by better-informed counterparties), and keep inventory within risk limits.

Jane Street's market-making systems are written in OCaml and run on co-located servers. Minsky has emphasized that OCaml "combines a powerful type system with good and predictable performance and a low overhead runtime" — and that they "write our lowest-latency software systems in OCaml" [34]. The very lowest-latency paths (sub-microsecond) are believed to be in FPGAs.

### 3.2 JX — Jane Street's Internal Crossing Engine

In a multi-part tech talk series **"How to Build an Exchange"**, Jane Street engineer Brian Nigito walks through the architecture of a modern electronic exchange via **JX**, "a crossing engine we built at Jane Street in the last two years" [35][36]. JX is significant because it signals that Jane Street operates an internal matching engine — presumably to cross client and proprietary flow internally before or instead of routing to external venues, and to provide a controlled environment for testing exchange microstructure ideas. The talk covers:

- The lifecycle of an order in a matching engine
- Fairness, determinism, and priority rules
- Architectural choices for a low-latency in-process matching core
- How to test exchange software reliably [36][37]

### 3.3 Execution Algorithms and Smart Order Routing

While Jane Street does not publish the internal architecture of its execution layer, the surrounding ecosystem is publicly visible:

- **Execution algorithms**: Public discussions reference "real-time pricing models, ultra-low-latency infrastructure, and smart order speed and precision — every microsecond counts" [38] as core to their options market making.
- **Smart order routing (SOR)**: As a major liquidity provider and an Authorized Participant in ETFs (see Section 5), Jane Street must route orders across many venues. General SOR design principles — splitting parent orders across lit markets, dark pools, and conditional/IOC orders, with dynamic re-routing based on real-time liquidity and adverse-selection signals — are publicly well known and apply [39][40]. The firm-specific SOR implementation details are not disclosed.

### 3.4 Production Engineering at Scale

A 2025 Jane Street tech talk, **"Production Engineering When Trading Billions of Dollars a Day"** by production engineer Mark Doss, walks through "the day-to-day work of monitoring and operating those systems" [41][42]. This is one of the firm's most direct public acknowledgments that it operates trading infrastructure at the scale of billions of dollars in daily flow, and that it has a dedicated production-engineering function modeled on the SRE discipline familiar from Google et al.

### 3.5 Architectural Patterns

From the constellation of public talks, blog posts, and the *Signals and Threads* podcast, several architectural patterns are clearly visible:

1. **Functional, type-driven design.** Invariants are encoded in types; the compiler is the first line of defense against bugs. The ICFP 2024 experience report "Functional Programming in Financial Markets" describes using functional programming to "orchestrate type-driven large-scale pricing workflows" [43].
2. **Monorepo.** Jane Street maintains an internal monorepo (the open-source libraries are "sourced from our internal development repo" and "released together" [13]). This enables atomic cross-cutting changes, which the type system then validates.
3. **Layered latency tiers.** FPGA → low-latency OCaml services → higher-latency OCaml services (research, analytics, UI). Each tier has different correctness and latency budgets.
4. **Reliable multicast and clock sync as first-class infrastructure.** Episodes of *Signals and Threads* on "Reliable Multicast" and clock synchronization reveal that Jane Street builds these primitives themselves rather than depending on off-the-shelf middleware [23].
5. **PPX-driven metaprogramming.** Syntax extensions auto-derive serializers, comparators, hash functions, and inline tests — eliminating large classes of boilerplate bugs [12].

---

## 4. Risk Management and Quantitative Research Platform

### 4.1 No-Silos Organizational Model

A defining feature of Jane Street's culture is its **"no silos"** organizational principle [44][45]. The Machine Learning team's recruiting page states: "Researchers, engineers, and traders sit a few feet away from each other and work together to train models, build systems, and run trading strategies" [44]. The firm's broader departments page describes "Trading, Research, and Machine Learning" as a single collaborative quantitative team rather than walled-off functions [45].

This has direct technical implications: rather than handing a "model" over a wall to a separate engineering team, the people who design a strategy also own its productionization. The *Signals and Threads* episode "Finding Signal in the Noise: Machine Learning and the Markets" explicitly discusses "the porous boundaries between trading, research, and software engineering, which require different sensibilities" [46].

### 4.2 Risk Principles (Publicly Articulated)

While Jane Street does not publish a formal risk-management white paper, several principles are visible in public materials:

- **Discipline over raw P&L.** Medium analyses emphasize that Jane Street "built a record with discipline" — meaning risk limits, position caps, and conservative capital allocation dominate the cultural narrative [47].
- **Authorized-Participant status as a structural edge.** Jane Street is one of the largest Authorized Participants (APs) in the global ETF ecosystem. AP status grants direct access to creation/redemption with ETF issuers, which both (a) provides an arbitrage mechanism when ETF prices deviate from net asset value and (b) is a structural risk mitigant because inventory can be shed into the primary market rather than only via secondary-market sales [48][49].
- **Capture small spreads, hedge exposures instantly.** Public profiles of Jane Street describe a model that "focuses on capturing small spreads, hedging exposures instantly and advanced risk systems to process billions in daily trading volume" [50].
- **Production engineering as a risk control.** The "Production Engineering When Trading Billions of Dollars a Day" talk makes clear that operational reliability — monitoring, alerting, capacity planning, kill switches — is treated as a first-class risk-management discipline [41].

### 4.3 Quantitative Research Platform

Jane Street's research platform is, like the rest of the firm, **OCaml-centric**, but the machine-learning stack necessarily uses Python-fluent tooling (PyTorch, JAX-style frameworks). Public statements describe "the neural network models driving our trading strategies" and "the infrastructure that make training and inference" work at scale [44]. The new 100–200 MW data center with 4,032 GPUs [31][32] is explicitly aimed at "training internal AI models."

The Kaggle competitions Jane Street ran in 2021 ("Jane Street Market Prediction") and 2024–2025 ("Jane Street Real-Time Market Data Forecasting") released anonymized datasets with "79 features and 9 responders, anonymized but representing real market data" [51][52]. These competitions provide indirect evidence of how the firm thinks about modeling: a multi-feature, multi-responder regression / classification problem where the goal is to predict future return distributions from a panel of anonymized but real features. This is consistent with a **statistical arbitrage / short-horizon forecasting** research program.

### 4.4 The Hardcaml–Numeric Stack Overlap

The "OCaml All The Way Down" talk demonstrates that numeric primitives (CORDIC, fixed-point arithmetic) are shared between Hardcaml-based FPGA designs and OCaml software implementations [27]. This implies a unified numeric stack where the same algorithms can be evaluated in software and then pushed to hardware — a research and risk advantage, because models can be prototyped in OCaml and then migrated to FPGA when latency demands.

---

## 5. Data Infrastructure

### 5.1 Superstore — Distributed Columnar Database

One of the most concrete public disclosures about Jane Street's data infrastructure is **Superstore**, a distributed columnar database built in-house. The *Signals and Threads* episode "Building a Data Warehouse from Scratch" features Jacob Baskin, the engineer who "began building [Superstore] practically on his first day" at Jane Street, and describes it as "now central to Jane Street's tech stack" [53][54]. The episode reveals that Jane Street was previously buying storage appliances (commercial columnar databases) and ultimately decided to build its own to fit its access patterns.

Baskin also presented Superstore externally — at Carnegie Mellon's Parallel Data Lab speaker series in 2024 [55] — confirming that the system is real, in production, and substantial enough to be the subject of academic-adjacent external talks. The "8 Figures on a Design Doc" short video further dramatizes the impact of the original design document for Superstore [56].

### 5.2 Tick Data and Historical Analytics

Jane Street's data engineer job descriptions state that engineers are "responsible for building systems that process terabytes of historical and real-time market data daily" [57]. The general pattern, consistent with industry practice and Jane Street's own published signals, is:

- A **real-time tick pipeline** ingesting multicast exchange feeds, decoded in FPGAs where latency matters and in OCaml services for downstream consumers.
- A **historical tick store** (likely backed by Superstore for analytical workloads) supporting replay, backtesting, and research.
- A **research / backtesting environment** that operates against historical tick data plus derived features (the Kaggle dataset structure — 79 features, 9 responders — is a public window into this world) [51][52].

### 5.3 Real-Time Analytics and Incremental Computation

Jane Street's open-source **Incremental** library implements self-adjusting computation: computations whose outputs can be efficiently updated when their inputs change. This is the technical backbone of real-time analytics dashboards (trader blotters, live risk views, position monitors) that must update incrementally as new market data arrives rather than recomputing from scratch each tick. The combination of **Async** (concurrency) + **Incremental** (reactivity) + **Bonsai** (UI) is the firm's standard stack for internal real-time analytical tools [14][17][18].

### 5.4 The Network as a Program

The *Signals and Threads* episode "The Network as a Program" describes Jane Street's view that the network itself should be programmable — that they should be able to reason about, instrument, and modify network behavior with the same kind of code-level discipline they apply to application software [24]. This is consistent with the ACM SIGCOMM 2024 paper on network design considerations [22] and suggests that Jane Street's data infrastructure is not just about storage but about a programmable, observable network fabric that carries market data, order flow, and analytics.

---

## 6. Interview and Hiring Practices — Tech Culture Signals

### 6.1 Software Engineering Interviews

Jane Street's own blog post and recruiting page are unusually explicit about their SWE interview process [58][59]:

> "We don't ask software engineers to do mental math, or math olympiad questions, or to contemplate logic puzzles about pirate tigers that only… SWE interviews are about programming, plain and simple."

However, third-party accounts nuance this: the **quantitative trader and quant researcher** interviews are famously puzzle- and probability-heavy, while **software engineering** interviews emphasize programming, system design, and code extension. Exponent's guide notes that "the interviewer starts you on a base solution, then adds requirements on top, so the round centers on how you extend and explain your own code" [60]. Aimvantage's guide describes an "OCaml-and-puzzles" reputation but notes that the firm pays "famously well" [61]. Reddit candidates describe the OA (online assessment) as "really tough, especially if you're used to regular coding interviews. It's all about probability, logic puzzles, and..." [62].

The through-line: Jane Street interviews are designed to find engineers who can (a) write correct code under type-discipline, (b) reason about extension and refactoring safely, and (c) collaborate on hard problems in real time.

### 6.2 Collaborative Problem-Solving Ethos

The firm's interviewing page states: "We focus on collaborative problem solving during the interview and we consider applicants for every open role, not just the one you apply for" [63]. The "no-silos" principle means that Jane Street hires generalist technologists who can move between trading, research, and engineering roles over their careers.

### 6.3 Signals about Culture

Several public artifacts reveal cultural norms:

- **Pedigree of public talks**: Jane Street engineers regularly give talks at CMU, ETH, ICFP, and university tech-talk series — suggesting an academic-friendly culture that values external engagement [64].
- **Open-source commitment**: The breadth of open-source releases (Core, Async, Hardcaml, Bonsai, Incremental, etc.) signals a culture that believes in sharing infrastructure with the broader community — partly for recruiting, partly because OCaml's ecosystem is small enough that Jane Street benefits from external adoption [13].
- **Podcast as cultural document**: *Signals and Threads*, hosted by Ron Minsky, is a 29-episode (as of mid-2026) deep dive into specific engineering problems at Jane Street: clock synchronization, reliable multicast, build systems, reconfigurable hardware, testing, market making, machine learning, UI frameworks, data warehouses [65]. The very existence of this podcast — unusually candid for a secretive trading firm — is itself a cultural statement.

### 6.4 The *Solving Puzzles in Production* Episode Title

The episode "Solving Puzzles in Production" [66] captures something essential about Jane Street's engineering culture: hard, well-defined technical problems (clock sync, multicast reliability, GC tuning, FPGA timing closure) are treated as puzzles to be solved rigorously and shared openly — even if the *trading* application of those solutions is kept proprietary.

---

## 7. Published Papers, Blog Posts, and Talks

### 7.1 Peer-Reviewed and Conference Papers

1. **"Caml trading – experiences with functional programming on Wall Street"**, Yaron Minsky & Stephen Weeks, *Journal of Functional Programming*, Cambridge University Press, 2014 [5]. The canonical academic reference for Jane Street's choice of OCaml.
2. **"Functional Programming in Financial Markets (Experience Report)"**, ACM ICFP 2024 [43]. Describes type-driven pricing workflows at Jane Street.
3. **"Network Design Considerations for Trading Systems"**, ACM SIGCOMM 2024 [22]. A rare public treatment of low-latency trading network design from a major HFT firm.
4. **"Hardcaml: An OCaml Hardware Domain-Specific Language"**, arXiv:2312.15035 [15]. The academic description of Jane Street's hardware DSL.
5. **OCaml 5 production deployment**, ICFP/SPLASH 2025 [19]. Jane Street's migration story to multicore OCaml.

### 7.2 Tech Talks (Publicly Available on YouTube / janestreet.com)

- **"Caml Trading — Experiences with OCaml on Wall Street"** (Yaron Minsky) — InfoQ and CMU versions [3][67].
- **"Why OCaml?"** (Yaron Minsky) — overview of OCaml's place in the language-design space [10].
- **"OCaml All The Way Down"** — FPGA design in Hardcaml, including CORDIC and other primitives [27].
- **"How to Build an Exchange"** (Brian Nigito) — architecture of JX, Jane Street's internal crossing engine [35][36].
- **"Making OCaml Safe for Performance Engineering"** — techniques for predictable performance [68].
- **"Production Engineering When Trading Billions of Dollars a Day"** (Mark Doss) — operational SRE-style discipline [41][42].
- **"Programmable Hardware with Andy Ray"** — origin and use of Hardcaml [28].
- **"AI Engineering at Jane Street"** (John Crepezzi) — custom LLM assistants and editor tooling for OCaml [69].
- **"Building a UI Framework"** (Ty Overby) — Bonsai [70].
- **"Building a Data Warehouse From Scratch"** (Jacob Baskin) — Superstore [54].

### 7.3 The *Signals and Threads* Podcast

Hosted by Ron Minsky, with 29 episodes released as of mid-2026. Notable episodes include:

- *Programmable Hardware* (with Andy Ray) [28]
- *The Network as a Program* [24]
- *Finding Signal in the Noise: Machine Learning and the Markets* [46]
- *Building a Data Warehouse from Scratch* (with Jacob Baskin) [53]
- *Building a UI Framework* (with Ty Overby) [70]
- *Why Testing is Hard and How to Fix it* [71]
- *Solving Puzzles in Production* [66]
- *Building Tools for Traders* (with Ian Henry) [72]

### 7.4 The Jane Street Blog

`blog.janestreet.com` is an active blog with posts on OCaml, functional programming, Hardcaml (including an "Advent of Hardcaml" series [73]), ICFP participation indexes [74], interview advice [59], and announcements. Key posts include:

- "Why OCaml?" [9]
- "OCaml, the ultimate refactoring tool" [8]
- "Observations of a functional programmer" [75]
- "Advent of Hardcaml" series [73]
- "Announcing Signals and Threads" [76]

### 7.5 Kaggle Competitions

- **2021**: *Jane Street Market Prediction* [51]
- **2024–2025**: *Jane Street Real-Time Market Data Forecasting* [52]

Both released anonymized but real production-derived datasets, providing the outside world with a narrow but genuine window into the structure of Jane Street's modeling problem (multi-feature, multi-responder, time-series forecasting).

---

## 8. Trading Strategies Jane Street Is Known For

### 8.1 Market Making (Primary Business)

Jane Street's core business is **electronic market making** across equities, options, futures, ETFs, bonds, and increasingly crypto. The firm provides continuous two-sided quotes and earns the spread while managing inventory and adverse-selection risk [4][38]. Public reporting characterizes Jane Street's systems as employing "statistical arbitrage, market making, & latency arbitrage to capitalize on micro-trends-liquidity gaps" [77].

### 8.2 ETF Arbitrage and Authorized-Participant Activity

Jane Street is one of the world's largest ETF Authorized Participants. As an AP, the firm can create new ETF shares by delivering a basket of underlying securities to the fund (creation), or redeem ETF shares for the underlying basket (redemption). This mechanism is the structural arbitrage that keeps ETF market prices close to net asset value (NAV) [48][49][78]. Public discussion frames Jane Street's AP status as both a profit engine and a risk-mitigant: when secondary-market liquidity dries up, the firm can shed inventory via the primary market.

The firm's ETF work spans **equity ETFs, fixed-income ETFs, and commodity ETFs**, and they have published on credit-ETF trading in stressed markets via the Center for Financial Stability [79].

### 8.3 Statistical Arbitrage

The Kaggle competitions [51][52] — with 79 anonymized features and 9 anonymized responders — strongly suggest a **short-horizon statistical arbitrage** research program: predicting cross-sectional and time-series return patterns from a large feature set. Public profiles describe Jane Street as using "high-speed execution, machine learning, and quantitative analysis" for stat-arb-style strategies [80]. The combination of in-house ML team, GPU data center, and a Kaggle-shaped problem structure all point to systematic, feature-driven forecasting across thousands of instruments.

### 8.4 Options Market Making

Jane Street is a major options market maker. Public discussions of their options desk note the use of real-time pricing models (Black-Scholes-family and beyond), ultra-low-latency infrastructure, and sophisticated hedging [38]. The *Signals and Threads* episode "Building Tools for Traders" with Ian Henry discusses building high-performance tools for the options desk [72].

### 8.5 Latency Arbitrage

Public reporting attributes "latency arbitrage" to Jane Street's toolkit [77] — exploiting tiny price discrepancies across venues that exist only for microseconds. The sub-100-nanosecond reaction times claimed by Minsky [29][30] are necessary to be competitive in this niche.

### 8.6 The India Index Options Episode — A Cautionary Note

In July 2025, India's Securities and Exchange Board (SEBI) issued an interim order temporarily barring Jane Street from Indian securities markets and alleging that Jane Street entities manipulated the **Bank Nifty index** on expiry days via a strategy that pushed index levels in the options market to profit from related positions [81][82][83][84]. Jane Street agreed to disgorge approximately ₹4,843 crore (~$566 million) [83][85]. The case is publicly documented and serves as a reminder that even arbitrage-style strategies can be characterized by regulators as manipulative when they involve moving reference prices. This is **fact**, not speculation, based on SEBI's public interim order and extensive press coverage.

---

## 9. Approach to System Design: Functional Programming and Type Safety

### 9.1 The Type-Driven Philosophy

The unifying theme across all of Jane Street's public engineering material is **type-driven design**. Their stated approach treats types as the primary mechanism for enforcing invariants in a codebase that is constantly being reshaped. Concretely:

- **Algebraic data types and pattern matching** model domain entities (orders, fills, instruments, market data events) precisely and exhaustively.
- **ppx_jane** auto-derives comparison, serialization, hashing, and inline tests, so types stay consistent across the stack.
- **Phantom types and GADTs** are used to encode protocol states and units (e.g., distinguishing a quoted price from a traded price at the type level).
- **Async** provides structured concurrency with deterministic, monitorable deferreds rather than threads and locks.
- **Incremental** makes reactive computation composable and efficient.

The ICFP 2024 experience report frames this approach as "type-driven large-scale pricing workflows" [43] — meaning the type system is the tool used to keep a sprawling pricing and risk calculation graph correct across many product lines.

### 9.2 Functional Programming as Risk Control

For a trading firm, the most valuable property of this approach is not raw speed but **refactor safety**. Strategies, instruments, and regulations change constantly; engineers must reshape large codebases without introducing subtle bugs. Jane Street's blog post "OCaml, the ultimate refactoring tool" [8] makes the case explicitly: types catch the bugs that refactoring would otherwise introduce, allowing the firm to move quickly without sacrificing correctness.

### 9.3 Hardware and Software in One Language

The Hardcaml story extends this philosophy into hardware: the same engineers, the same language, the same tooling, the same test infrastructure can express both the software and the FPGA implementation of a numeric primitive. This eliminates the impedance mismatch that usually separates hardware and software teams and allows Jane Street to migrate functionality across the latency stack with minimal friction [15][27].

### 9.4 Build, Test, and Production as One System

The *Signals and Threads* episodes on build systems, testing, and production engineering reveal that Jane Street treats the entire toolchain — from monorepo build, to inline tests, to deployment, to runtime monitoring — as a single integrated system. This is the "no silos" principle applied to engineering itself: there is no separate "platform team" that hands binaries over a wall to a "trading team" that hands them to an "ops team." The same engineers who write the strategy also own its production behavior [41][71].

---

## 10. Summary: What Is Public, What Is Inference, What Is Speculation

### Public Fact (Directly Documented)
- Jane Street uses OCaml as its primary language across the stack [1][4][5].
- Jane Street maintains and open-sources Core, Async, Incremental, Hardcaml, Bonsai, and ppx_jane [12][13][15][17].
- Jane Street designs FPGAs in Hardcaml and uses FPGAs in production [15][26][27].
- Jane Street co-locates at exchanges and operates sub-100-nanosecond reaction paths [20][29][30].
- Jane Street operates JX, an internal crossing engine [35][36].
- Jane Street built Superstore, an in-house distributed columnar database [53][55].
- Jane Street runs a no-silos organizational model with traders, researchers, and engineers working together [44][45].
- Jane Street is a top-tier ETF Authorized Participant [48][49].
- Jane Street runs Kaggle competitions with anonymized production-derived data [51][52].
- Jane Street is migrating to / has migrated to OCaml 5 in production [19].
- Jane Street is building its own 100–200 MW data center with thousands of GPUs [31][32].
- Jane Street publishes papers at ICFP, SIGCOMM, and in JFP [5][22][43].
- Jane Street runs the *Signals and Threads* podcast [65].
- The 2025 SEBI order against Jane Street re: Bank Nifty expiry-day trading is public record [81][82][83].

### Reasonable Inference (Consistent with Public Info but Not Directly Confirmed)
- Specific FPGA workloads (feed handlers, pre-trade risk, order gateway normalization) — inferred from job descriptions and industry norms [26].
- Use of kernel-bypass networking (DPDK/RDMA) — inferred from practitioner discussions and latency claims [20].
- The split between FPGA-resident and CPU-resident functionality in the order path.
- Detailed architecture of the SOR and execution algorithms — the *existence* is documented, the *internals* are not.

### Speculation (Not Publicly Documented)
- Specific model architectures used by the ML team (e.g., transformer-based vs. gradient-boosted).
- Specific FPGA vendors and part numbers used.
- Specific dark-pool connectivity and internalization rates.
- Specific P&L attribution across strategies.

---

## References

[1] Jane Street, "Technology :: Jane Street," https://www.janestreet.com/technology
[2] Y. Minsky, "Caml Trading - Experiences with OCaml on Wall Street," InfoQ, https://www.infoq.com/presentations/jane-street-caml-ocaml
[3] Jane Street, "Caml Trading" (CMU talk), https://blog.janestreet.com/caml-trading-talk-at-cmu/
[4] Jane Street, "Home," https://www.janestreet.com
[5] Y. Minsky and S. Weeks, "Caml trading – experiences with functional programming on Wall Street," *Journal of Functional Programming*, Cambridge University Press, https://www.cambridge.org/core/journals/journal-of-functional-programming/article/caml-trading-experiences-with-functional-programming-on-wall-street/02F18023B4C43BF6E53512AA7062A9A5
[6] Jane Street promotional Instagram post, https://www.instagram.com/p/DN4FlTsk95i
[7] Quora discussion, "Why does Jane Street use OCaml?" https://www.quora.com/Why-does-Jane-Street-use-OCaml
[8] Jane Street Blog, "OCaml, the ultimate refactoring tool," https://blog.janestreet.com/ocaml-the-ultimate-refactoring-tool
[9] Jane Street Blog, "Why OCaml?" https://blog.janestreet.com/why-ocaml
[10] YouTube, "Why OCaml" (Jane Street), https://www.youtube.com/watch?v=v1CmGbOGb2I
[11] GitHub, `janestreet/async`, https://github.com/janestreet/async
[12] OCaml Discuss, "Do you use Core (or other Jane Street libs)? Tell us how!" https://discuss.ocaml.org/t/do-you-use-core-or-other-jane-street-libs-tell-us-how/8229
[13] Jane Street, "JaneStreet packages v0.12 documentation," https://ocaml.janestreet.com/ocaml-core/v0.12/doc
[14] OCaml Package, Incremental (Jane Street), https://ocaml.org/p/incremental
[15] A. Madhavapeddy et al., "Hardcaml: An OCaml Hardware Domain-Specific Language," arXiv:2312.15035, https://arxiv.org/html/2312.15035v1
[16] Hardcaml.org, https://hardcaml.org
[17] GitHub, `janestreet/bonsai`, https://github.com/janestreet/bonsai
[18] Jane Street Blog, "ICFP 2024," https://blog.janestreet.com/icfp-2024-index
[19] A. Madhavapeddy, "Jane Street and Docker on moving to OCaml 5 at ICFP/SPLASH 2025," https://anil.recoil.org/notes/icfp25-ocaml5-js-docker
[20] Reddit r/quant, "Jane Street — HFT?" https://www.reddit.com/r/quant/comments/1t2kjjc/jane_street_hft
[21] BlackCore Tech, "Co-location, fast networks, and high-speed NICs," https://www.blackcoretech.com/knowledge/co-location-fast-networks-and-high-speed-nics-optimizing-your-electronic-trading-stack
[22] ACM Digital Library, "Network Design Considerations for Trading Systems," https://dl.acm.org/doi/pdf/10.1145/3696348.3696890
[23] *Signals and Threads*, episode list, https://signalsandthreads.com
[24] *Signals and Threads*, "The Network as a Program," https://signalsandthreads.com/the-network-as-a-program
[25] LinkedIn, "Jane Street's FPGA Advantage in High-Frequency Trading," https://www.linkedin.com/posts/dasanik2001_janestreet-fpga-highfrequencytrading-activity-7473392363835506688-8Fs1
[26] Dice.com, "FPGA Engineer - Jane Street," https://www.dice.com/job-detail/cb975863-39ff-4903-ac37-42df2112972f
[27] Jane Street Tech Talk, "OCaml All The Way Down," https://www.janestreet.com/tech-talks/ocaml-all-the-way-down
[28] *Signals and Threads*, "Programmable Hardware" (with Andy Ray), https://signalsandthreads.com/programmable-hardware
[29] Instagram (reel), Ron Minsky on Jane Street sub-100ns reaction times, https://www.instagram.com/reel/DY7gFe2Bkm6
[30] Instagram (reel), Jane Street latency discussion, https://www.instagram.com/reel/DZYmy-GMnUP
[31] Bloomberg, "Jane Street Plans New Data Center as Computing Power Runs Scarce," https://www.bloomberg.com/news/articles/2026-06-04/jane-street-plans-new-data-center-as-compute-power-runs-scarce
[32] YouTube, "Dwarkesh Goes Inside Jane Street's Latest AI Data Center," https://www.youtube.com/watch?v=8J-GUnfSqeE
[33] Data Center Dynamics, "Quant trading firm Jane Street plans data center," https://www.datacenterdynamics.com/en/news/quant-trading-firm-jane-street-plans-data-center-report
[34] Jane Street, "Performance Engineering," https://www.janestreet.com/performance-engineering
[35] Jane Street Tech Talk, "How to Build an Exchange," https://www.janestreet.com/tech-talks/building-an-exchange
[36] Jane Street Blog, "How to Build an Exchange," https://blog.janestreet.com/how-to-build-an-exchange
[37] Keypointt, "How to build an exchange — notes," https://keypointt.com/2025-06-16-How-to-build-an-exchange
[38] LinkedIn, "How Jane Street won a hedge fund war with a powerful options strategy," https://www.linkedin.com/posts/mohak-pachisia-0a56a71b6_the-options-strategy-that-sparked-a-hedge-activity-7319963103285112832-uIG4
[39] Quod Financial, "Dark Pools vs Lit Markets: How SOR Navigates Fragmentation," https://www.quodfinancial.com/dark-pools-vs-lit-markets-how-sor-navigates-liquidity-fragmentation
[40] SmartTrade, "Smart Order Routing: The Route to Liquidity Access & Best Execution," https://www.smart-trade.net/wp-content/uploads/2016/12/Smart_Order_Routing_The_Route_to_Liquidity_Access_and_Best_Execution.pdf
[41] YouTube, "Production Engineering When Trading Billions of Dollars a Day" (Mark Doss, Jane Street), https://www.youtube.com/watch?v=zR9PpXWsKFQ
[42] LinkedIn (Jane Street), "Production Engineering When Trading Billions of Dollars a Day," https://www.linkedin.com/posts/jane-street-global_production-engineering-when-trading-billions-activity-7475170869435207681-67Q0
[43] ACM Digital Library, "Functional Programming in Financial Markets (Experience Report)," https://dl.acm.org/doi/10.1145/3674633
[44] Jane Street, "Machine Learning," https://www.janestreet.com/join-jane-street/machine-learning
[45] Jane Street, "Departments," https://www.janestreet.com/join-jane-street/departments
[46] *Signals and Threads*, "Finding Signal in the Noise: Machine Learning and the Markets," https://signalsandthreads.com/finding-signal-in-the-noise
[47] Medium, "Jane Street Built a Record With Discipline," https://medium.com/@finomicsedge/jane-street-built-a-record-with-discipline-what-that-means-for-your-own-risk-choices-621ac039755a
[48] Medium, "Authorized Participant status in the ETF ecosystem gives Jane Street direct access to creation and redemption," https://medium.com/@finomicsedge/jane-street-built-a-record-with-discipline-what-that-means-for-your-own-risk-choices-621ac039755a
[49] LinkedIn, "Jane Street's ETF Market Making Approach," https://www.linkedin.com/posts/lana-marshania_rather-than-forecasting-returnsjane-street-activity-7420171214729527297-kSNv
[50] LinkedIn, "Jane Street Case: Market Manipulation or Arbitrage?" https://www.linkedin.com/posts/sanya-sud-4a2a9791_jane-street-the-line-between-market-manipulation-activity-7366850168333197314-HW9q
[51] Kaggle, "Jane Street Market Prediction," https://www.kaggle.com/competitions/jane-street-market-prediction
[52] Kaggle, "Jane Street Real-Time Market Data Forecasting," https://www.kaggle.com/competitions/jane-street-real-time-market-data-forecasting
[53] *Signals and Threads*, "Building a Data Warehouse from Scratch," https://signalsandthreads.com/building-a-data-warehouse-from-scratch
[54] YouTube, "Building a Data Warehouse From Scratch with Jacob Baskin," https://www.youtube.com/watch?v=EnsZazeC1h4
[55] CMU Parallel Data Lab, "Superstore" (Jacob Baskin talk), https://www.pdl.cmu.edu/talk-series/2024/073124.shtml
[56] YouTube, "8 Figures on a Design Doc" (Jane Street), https://www.youtube.com/shorts/Oq7Mfi0-I-8
[57] Dataford, "Jane Street Data Engineer Interview Questions & Guide 2026," https://dataford.io/interview-guides/jane-street/data-engineer
[58] Jane Street, "Preparing for a Software Engineering Interview," https://www.janestreet.com/preparing-for-a-software-engineering-interview
[59] Jane Street Blog, "Interviewing At Jane Street," https://blog.janestreet.com/interviewing-at-jane-street
[60] Exponent, "Jane Street Software Engineer Interview Guide," https://www.tryexponent.com/guides/jane-street-software-engineer-interview
[61] Aimvantage, "Jane Street software engineer interview: the OCaml-and-puzzles reputation," https://aimvantage.uk/blog/jane-street-software-engineer-interview-2026
[62] Reddit r/InterviewCoderHQ, "jane street oa, never felt dumber in my life," https://www.reddit.com/r/InterviewCoderHQ/comments/1t4umzi/jane_street_oa_never_felt_dumber_in_my_life
[63] Jane Street, "Interviewing," https://www.janestreet.com/join-jane-street/interviewing
[64] VIS ETH Zurich, "VIS x Jane Street: Tech Talk," https://vis.ethz.ch/en/events/999
[65] YouTube, "Signals & Threads Podcast" (Jane Street), https://www.youtube.com/playlist?list=PLCiAikFFaMJouorRXDSfS2UoKV4BfKyQm
[66] *Signals and Threads*, "Solving Puzzles in Production," https://signalsandthreads.com/solving-puzzles-in-production
[67] YouTube, "Caml Trading" (Jane Street), https://www.youtube.com/watch?v=hKcOkWzj0_s
[68] Jane Street Tech Talk, "Making OCaml Safe for Performance Engineering," https://www.janestreet.com/tech-talks/making-ocaml-safe-for-performance-engineering
[69] YouTube, "AI Engineering at Jane Street" (John Crepezzi), https://www.youtube.com/watch?v=0ML7ZLMdcl4
[70] *Signals and Threads*, "Building a UI Framework" (with Ty Overby), https://signalsandthreads.com/building-a-ui-framework
[71] *Signals and Threads*, "Why Testing is Hard and How to Fix it," https://signalsandthreads.com/why-testing-is-hard-and-how-to-fix-it
[72] YouTube, "Building Tools for Traders with Ian Henry," https://www.youtube.com/watch?v=w7-2lF5DK6c
[73] Jane Street Blog, "Advent of Hardcaml 2024," https://blog.janestreet.com/advent-of-hardcaml-2024
[74] Jane Street Blog, "ICFP 2024 Index," https://blog.janestreet.com/icfp-2024-index
[75] Jane Street Blog, "Observations of a functional programmer," https://blog.janestreet.com/observations-of-a-functional-programmer
[76] Jane Street Blog, "Announcing Signals and Threads," https://blog.janestreet.com/announcing-signals-and-threads-index
[77] LinkedIn, "Jane Street's Algorithmic Trading Dominance on Wall Street," https://www.linkedin.com/posts/bbgoriginals_how-a-secretive-trading-empire-is-taking-activity-7455889031931994113-LJu5
[78] BlackRock, "Authorised participants and market makers," https://www.blackrock.com/au/insights/ishares/authorised-participants-and-market-makers
[79] Center for Financial Stability, "Credit ETF Trading in Stressed Markets" (Jane Street), http://www.centerforfinancialstability.org/etfs/ETFAnalysis/credit-etf-trading-in-stressed-markets-jane-street-20190723.pdf
[80] Vtrender, "Jane Street: A Deep Dive into a Quantitative Trading Powerhouse," https://vtrender.com/posts/jane-street-a-deep-dive-into-a-quantitative-trading-powerhouse
[81] BBC, "Why Jane Street, a US trading giant, is in trouble in India," https://www.bbc.com/news/articles/c5y0zgrevl1o
[82] Oxford Business Law Blog, "Jane Street and the Expiry Day Trap: Unpacking SEBI's Crackdown," https://blogs.law.ox.ac.uk/oblb/blog-post/2025/07/jane-street-and-expiry-day-trap-unpacking-sebis-crackdown-algorithmic
[83] Reddit r/IndiaInvestments, "A deeper look into Jane Street's market manipulation," https://www.reddit.com/r/IndiaInvestments/comments/1m9n8g0/a_deeper_look_into_jane_streets_market
[84] SSRN, "Jane Street Case Marks a Turning Point in SEBI's Index Governance," https://papers.ssrn.com/sol3/Delivery.cfm/5341047.pdf?abstractid=5341047&mirid=1
[85] SteelEye, "Jane Street Fine - $566.3m - Market Manipulation - SEBI - Jul-25," https://www.steel-eye.com/news/jane-street-fine-566.3m-market-manipulation-sebi-jul-25

---

*Report compiled from publicly available sources. Where the firm has not officially documented a specific technical detail, this report marks the distinction between fact, reasonable inference, and speculation. All URLs were valid as of the research date.*
