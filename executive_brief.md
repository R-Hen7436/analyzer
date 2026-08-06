# renEPC Switch Analyzer ? Executive Brief

**Audience:** managers / stakeholders  
**Purpose:** what this tool does, why it matters, and what you get from a run  
**Technical detail:** see [`how_each_script_works.md`](./how_each_script_works.md) and [`new_scanner_and_analyze_guide.md`](./new_scanner_and_analyze_guide.md)

---

## One sentence

This pipeline **scans renEPC source code for feature switches**, **checks them against product profiles**, and **fills the official change-point Excel** so reviewers can see Pass / Fail / Not found without manually digging through code.

---

## The problem it solves

Feature behavior in renEPC is controlled by many switches:

- `UVP_SW_*` (UVP profile)
- `BEHAVIOR_MODE_IF_*` (behavior profile)
- local switches

Today, answering questions like these is slow and error-prone if done by hand:

- Is this switch actually used in renEPC?
- Is it enabled (`TRUE`) or disabled (`FALSE`) for this product profile?
- Which files / functions are affected?
- Does the official change-point list (EMD Excel) reflect reality?

**This tool automates that check** for a chosen workspace + UVP profile + behavior profile.

---

## What a run produces (business view)

For one product run you get a single output folder:

```text
output/<workspace>/<uvp_profile>/
```

| Deliverable | What it means for review |
|-------------|--------------------------|
| **Scan report** | Inventory: where each switch appears in code |
| **Analyze result** (`O` / `X` / `-`) | Judgement vs profiles: Pass / Fail / Not found |
| **Updated EMD Excel** | Official change-point sheet filled with results |
| **Mapping log** | Audit trail: what matched, what was added, what didnб╟t match |

### Result symbols (easy reading)

| Symbol | Meaning |
|--------|---------|
| **O** | Found in code and profile says TRUE (Pass) |
| **X** | Found in code but profile is FALSE or missing (Fail / mismatch) |
| **-** | Not found in code (or not applicable for that row) |

---

## How the pipeline works (3 steps)

Think of it as **Find вк Judge вк Report**.

```text
  Code + profiles                Official Excel template
         ив                                  ив
         вз                                  ив
   игибибибибибибибибибибибибибид                          ив
   ив 1. SCAN     ив  Find switches in renEPC ив
   ижибибибибибибииибибибибибибие                          ив
          вз                                 ив
   игибибибибибибибибибибибибибид                          ив
   ив 2. ANALYZE  ив  Compare to UVP +        ив
   ив             ив  behavior profiles       ив
   ив             ив  вк O / X / -             ив
   ижибибибибибибииибибибибибибие                          ив
          вз                                 вз
   игибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибид
   ив 3. MAP                                      ив
   ив    Fill EMD Excel + write mapping log       ив
   ижибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибибие
```

| Step | Script | Plain English |
|------|--------|----------------|
| 1 | Scanner | Searches renEPC and records every switch hit and which functions `#if` blocks cover |
| 2 | Analyzer | Scores each switch against the UVP and behavior profile makefiles |
| 3 | Mapper | Writes those results into the change-point Excel and logs every change |

You can run all three with one command (`run_all`), or re-run only Analyze / Map when profiles or the template change.

---

## What you can tell leadership

1. **Traceability** ? Results are tied to real source locations and profile values, not tribal knowledge.
2. **Consistency** ? Same rules every run (`O` / `X` / `-`), same output layout per workspace/profile.
3. **Review speed** ? Reviewers open the updated Excel and mapping log instead of grepping code by hand.
4. **Gap visibility** ? Quickly see switches in code but off in profile (`X`), or in profile but unused in renEPC (`-`).
5. **Auditability** ? Mapping log records matches, inserts, orphans, and missing names.

---

## What it does *not* claim

Keep expectations clear:

- It is a **static analysis helper**, not a full compiler or runtime test.
- Function / `#if` association uses heuristics (very good for review, not a formal C++ parser).
- It fills and extends the EMD sheet based on analyze results; **human review of Fail (`X`) and orphans still matters**.
- Quality of output depends on correct workspace paths and the right UVP / behavior profile pair.

---

## Typical use case

> б╚For workspace *W* and UVP profile *P*, with behavior profile *B*, show me which renEPC switches pass or fail, which functions they hit, and update the change-point Excel.б╔

That is exactly one pipeline run.

---

## Bottom line for a pitch

| Without this tool | With this tool |
|-------------------|----------------|
| Manual search across large renEPC trees | Automated inventory |
| Mental mapping of profile TRUE/FALSE | Clear O / X / - per switch |
| Hand updates to change-point Excel | Auto-filled EMD + log |
| Hard to reproduce last weekб╟s check | Same command вк same folder layout |

**Ask:** adopt this as the standard pre-review check for renEPC switch / profile alignment on each target workspace.

---

## Related docs

| Doc | When to use it |
|-----|----------------|
| **This brief** | Pitch / status to higher-ups |
| [`new_scanner_and_analyze_guide.md`](./new_scanner_and_analyze_guide.md) | How to run + data shapes |
| [`how_each_script_works.md`](./how_each_script_works.md) | Technical internals for engineers |
