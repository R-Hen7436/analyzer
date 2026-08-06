# How the JSON Outputs Help

**Audience:** reviewers, maintainers, and stakeholders  
**Related:** [`executive_brief.md`](./executive_brief.md) | [`new_scanner_and_analyze_guide.md`](./new_scanner_and_analyze_guide.md)

Excel is the **report people review**.  
JSON is the **evidence and audit trail** - searchable, comparable between runs, and usable by other tools later.

---

## What each JSON is for

All files live under:

```text
output/<workspace>/<uvp_profile>/
```

| File | Produced by | Helps you... |
|------|-------------|--------------|
| `scan/ren_epc_scan_result.json` | Scanner | See **where** every switch appears in code |
| `analyze/result.json` | Analyzer | See **Pass / Fail / None** + **impacts** vs profiles |
| `map/mapping_log.json` | Mapper | See **what changed** in the EMD Excel and why |

---

## 1. Scan JSON - inventory

**Path:** `scan/ren_epc_scan_result.json`

Useful when someone asks: *"Does renEPC use this switch? Where?"*

### What you can do with it

- List all `UVP_SW_*` / `BEHAVIOR_MODE_IF_*` / local switches found
- Jump to file + line + function + code snippet (`locations[]`)
- See `#if` **blocks** - which functions a switch wraps (`blocks[]`)
- Compare **reference vs target** streams (when path labeling is correct)
- Spot local switches configured but **never found** (summary counts)

### Why it matters

It is the **evidence base** from source code - not opinion, not a one-off manual grep.

---

## 2. Analyze JSON - judgement

**Path:** `analyze/result.json`

Useful when someone asks: *"For this product profile, is it OK?"*

### What you can do with it

- One place with `result`: **O / X / -**
- See which profile value was used (`TRUE` / `FALSE` / `NOT_FOUND`)
- Use `impacts[]` as the file/function list for change-point review
- Find profile-only switches (in `.mk` but not in code) as `-`
- Filter quickly:
  - all **X** -> mismatches to investigate
  - all **O** -> aligned
  - all **-** -> absent from code (or not applicable)

### Result symbols

| Symbol | Meaning |
|--------|---------|
| **O** | Found in code and profile says TRUE |
| **X** | Found in code but profile is FALSE or missing |
| **-** | Not found in code (or Not Found impact) |

### Why it matters

It is a **scored checklist** you can re-run next week and compare to the last run.

---

## 3. Mapping log JSON - audit trail

**Path:** `map/mapping_log.json`

Useful when someone asks: *"Did the tool change the Excel correctly?"*

### What you can do with it

- Read `summary` counts for a quick health check
- Inspect each `actions[]` entry (name, EMD row, affecting text, result, reason)

### Common action types

| Action | Meaning |
|--------|---------|
| `Matched` | Existing EMD row matched an analyze impact; Result written |
| `Inserted` | Analyze impact was missing from EMD; new row added |
| `Orphan` | EMD row had no matching analyze impact; wrote `-` |
| `NotFound` | Analyze impacts were only Not Found; wrote `-` |
| `CreatedNameBlock` | Switch missing from EMD; new name + impact rows created |
| `NameMissingFromEmd` | Switch missing from EMD and could not create a block |

### Why it matters

Every Excel write has a **reason** - useful for review, handoff, and debugging mapper behavior.

---

## Practical ways the team can use them

1. **Review prep** - open `result.json`, focus on `X` first  
2. **Diff between runs** - same workspace/profile last week vs this week (what newly became `X`?)  
3. **Search / scripts** - grep or small Node/Python over JSON without opening Excel  
4. **Debug**
   - Scan found it, analyze says `X` -> profile issue  
   - Analyze says `O`, map says `Orphan` -> Excel naming/path mismatch  
5. **Handoff** - share JSON (+ Excel) with another site; they can inspect without re-scanning  
6. **Future automation** - dashboards, CI checks ("fail if any `X`"), tickets from mismatch lists  

---

## How the three JSONs connect

```text
Source code
    |
    v
ren_epc_scan_result.json     <- inventory (where)
    |
    v
result.json                  <- judgement (O/X/- + impacts)
    |
    v
EMD Excel updated
    |
    v
mapping_log.json             <- audit (what the mapper did)
```

No later step re-opens `.cpp` files. After the scan, everything is driven by JSON + profiles + the Excel template.

---

## Pitch line

| Without JSON | With JSON |
|--------------|-----------|
| Only a filled spreadsheet | Evidence you can search and re-check |
| Hard to compare last week's run | Diff two `result.json` files |
| Hard to explain Excel changes | `mapping_log.json` lists every action |
| Tooling stops at Excel | Other scripts/CI can consume the same data |

**Bottom line:** Excel is for sign-off; JSON is for proof, comparison, and long-term reuse.
