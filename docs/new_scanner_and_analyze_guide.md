# Pipeline Guide + Scanner / Analyze / Mapper Details

This guide explains:

1. The **shared output layout** (`output_paths.js`)
2. The **3 scripts** (+ `run_all.js`) — what each does, inputs/outputs, and why order matters
3. **How to run** each script
4. What `scan_ren_epc.js` writes
5. How `analyze_profile_from_scan.js` scores profiles and builds impacts
6. How `excel_mapper.js` fills the EMD Excel

For a **manager-friendly pitch**, see [`executive_brief.md`](./executive_brief.md).  
For **why the JSON outputs matter**, see [`json_outputs_guide.md`](./json_outputs_guide.md).  
For **step-by-step internals** (function indexing, block parsing, impact merge, EMD match/insert), see [`how_each_script_works.md`](./how_each_script_works.md).

---

## 0. Shared paths (`output_paths.js`)

All scripts resolve paths through `getRunPaths(workspace, profileInput)` and create folders with `ensureRunDirs`.

Profile input may include or omit `.mk`; the folder name is always **without** `.mk`.

```text
output/<workspace>/<uvp_profile>/
  scan/
    ren_epc_scan_result.json
  analyze/
    result.json
    result.xlsx
  map/
    renEPC_change_point_list_updated.xlsx
    mapping_log.xlsx
    mapping_log.json
    renEPC_change_point_list_Updated_locked.xlsx   ← fallback if primary is locked
    mapping_log_locked.xlsx                        ← fallback if primary is locked
```

Template resolution (first existing wins):

1. `templates/renEPC_change_point_list.xlsx`
2. `renEPC_change_point_list.xlsx` (project root)

---

## 1. How to run the scripts

Run all commands from the project root (`analyzer/`), where the `.js` scripts live.

### Arguments

| Arg | Used by | Meaning |
|-----|---------|---------|
| `<workspace>` | all | Workspace / stream id (e.g. `ubasrh_KPC02530_2291_matsuri3_mp`). Used in p4 paths and output folder. |
| `<uvp_profile>` | all | UVP profile name (with or without `.mk`). Keys the output folder; analyze loads this `.mk` as the UVP profile. |
| `<behavior_profile>` | analyze, `run_all` | Behavior-mode profile name (with or without `.mk`). **Required** for analyze / `run_all` (no default). Passed only to analyze. |

Work-laptop profile directory (analyze):

```text
/data1/p4work/<workspace>/stream_target/subsys_PLP/build/profiles/
  <uvp_profile>.mk
  <behavior_profile>.mk
```

### Full pipeline (recommended)

```bash
node run_all.js <workspace> <uvp_profile> <behavior_profile>
```

Example:

```bash
node run_all.js ubasrh_KPC02530_2291_matsuri3_mp mo2cmtsmN01_uvp_profile C2YC_uvp_profile
```

`run_all.js` runs scan → analyze → excel_mapper. The 3rd arg is passed **only** to analyze.

### Step by step

```bash
# Step 1 — scan renEPC sources
node scan_ren_epc.js <workspace> <uvp_profile>

# Step 2 — score against UVP + behavior profiles
node analyze_profile_from_scan.js <workspace> <uvp_profile> <behavior_profile>

# Step 3 — fill EMD Excel from result.json
node excel_mapper.js <workspace> <uvp_profile>
```

Example:

```bash
node scan_ren_epc.js ubasrh_KPC02530_2291_matsuri3_mp mo2cmtsmN01_uvp_profile
node analyze_profile_from_scan.js ubasrh_KPC02530_2291_matsuri3_mp mo2cmtsmN01_uvp_profile C2YC_uvp_profile
node excel_mapper.js ubasrh_KPC02530_2291_matsuri3_mp mo2cmtsmN01_uvp_profile
```

### Run only what you need

| Situation | Command |
|-----------|---------|
| Already have scan JSON; only re-score profiles | `node analyze_profile_from_scan.js <ws> <uvp> <behavior>` |
| Already have `analyze/result.json`; only update Excel | `node excel_mapper.js <ws> <uvp>` |
| Re-scan code after source changes | `node scan_ren_epc.js <ws> <uvp>` then analyze (then mapper if needed) |

Use the **same** `<workspace>` and `<uvp_profile>` for every step so all three folders stay under one run root.

### Prerequisites before mapper

- Template at `templates/renEPC_change_point_list.xlsx` (or project root)
- `analyze/result.json` from Step 2

---

## 2. The 3 scripts (run order)

```text
Step 1          Step 2              Step 3
scan_ren_epc.js → analyze_profile… → excel_mapper.js
     │                  │                   │
     ▼                  ▼                   ▼
  scan JSON         result.json         updated Excel
                    result.xlsx         mapping_log
```

### Why this order?

```text
Step 1 must run first
  → creates the inventory of switches found in code

Step 2 needs Step 1
  → reads scan JSON + UVP .mk + behavior .mk
  → cannot decide O/X/- without knowing what was found in code

Step 3 needs Step 2
  → reads analyze result.json (not the raw scan)
  → fills the Excel EMD sheet with Result + matched / inserted impacts
```

| You skip… | What breaks |
|-----------|-------------|
| Step 1 | Analyze has no `ren_epc_scan_result.json` → error |
| Step 2 | Mapper has no `result.json` → error |
| Step 3 | You still have scan + analyze; just no updated Excel |

---

### Script 1 — `scan_ren_epc.js` (FIRST)

**Job:** Search ren_epc source for switches and record where they appear.

**Does:**
- Walks both ren_epc trees under the workspace:

```text
/data1/p4work/<workspace>/stream_reference/.../ren/ren_epc
/data1/p4work/<workspace>/stream_target/.../ren/ren_epc
```

- Finds:
  - `UVP_SW_*`
  - `BEHAVIOR_MODE_IF_*`
  - local switches from `config/local_switch.json`
- For each hit, records file / line / function / role / code
- Builds `#if…#endif` **blocks** with `relation` + enclosed `functions`
- Indexes functions with brace matching; if a function never closes `}`, its end is clipped to the next detected function start (so later functions still own their tokens)

**How to run:**

```bash
node scan_ren_epc.js <workspace> <uvp_profile>
```

**Inputs:**
- Source trees (`REN_EPC_DIRS`)
- `config/local_switch.json`
- CLI: `<workspace> <uvp_profile>` (profile is only for output folder name here)

**Output:**

```text
output/<workspace>/<uvp_profile>/scan/ren_epc_scan_result.json
```

**Note on path labeling:** `main()` requires the p4work `REN_EPC_DIRS`. Relative path / stream labeling in `getRelativePath` may still be in local/`codefiles` test mode in some checkouts (reference/target branches commented). When scanning real p4 trees, restore the reference/target roots in `getRelativePath` so `stream` is `reference` / `target` instead of `unknown` / `local`.

---

### Script 2 — `analyze_profile_from_scan.js` (SECOND)

**Job:** Compare scan results against UVP and behavior profiles and decide Pass / Fail / None.

**Does:**
- Loads `ren_epc_scan_result.json` from Step 1
- Loads **UVP** profile `.mk` and **behavior** profile `.mk` from:

```text
/data1/p4work/<workspace>/stream_target/subsys_PLP/build/profiles/
```

- For each switch:
  - `UVP_SW_*` → scored against the UVP profile
  - `BEHAVIOR_MODE_IF_*` → paired to `UVP_SW_*` and scored against the **behavior** profile only (no fallback to UVP)
  - local switches → no profile lookup
  - found in code + profile TRUE → `O`
  - found in code + profile FALSE/missing → `X`
  - not found in code → `-`
- Builds **impacts** from **blocks and locations** (see §6)
- Also adds UVP names that exist in the UVP profile but were never seen in the scan (`result: "-"`, impact `Not Found`)
- Writes Excel + JSON summary

**How to run:**

```bash
node analyze_profile_from_scan.js <workspace> <uvp_profile> <behavior_profile>
```

**Inputs:**
- `scan/ren_epc_scan_result.json`  ← **requires Step 1**
- UVP profile `.mk` + behavior profile `.mk` (both must exist)
- CLI: `<workspace> <uvp_profile> <behavior_profile>`

**Outputs:**

```text
output/<workspace>/<uvp_profile>/analyze/result.json
output/<workspace>/<uvp_profile>/analyze/result.xlsx
```

`result.json` metadata includes `profileFile` / `profilePath` and `behaviorProfileFile` / `behaviorProfilePath`.

---

### Script 3 — `excel_mapper.js` (THIRD)

**Job:** Map analyze results into the official change-point Excel (EMD sheet).

**Does:**
- Loads `analyze/result.json` from Step 2
- Loads template via `output_paths` (History sheet temporarily renamed with JSZip so ExcelJS can load it safely, then restored on write)
- On the **EMD** sheet:
  - Matches switch names + impact file/function rows
  - Writes Result into column E (`O` / `X` / `-`)
  - Marks unmatched template impacts as orphan (`-`)
  - **Inserts** new impact rows when analyze found impacts not already in EMD
  - **Creates name blocks** for switches present in `result.json` but missing from EMD (under Local Switch / Behavior / UVP sections)
- Makefile / `rule.mak` paths keep `parent/filename` so `make_client/Makefile` vs `make_server/Makefile` stay distinct
- If the primary output file is locked/open, writes the `*_locked.xlsx` fallback instead
- Writes mapping logs (xlsx + json) with action types

**How to run:**

```bash
node excel_mapper.js <workspace> <uvp_profile>
```

**Inputs:**
- `analyze/result.json`  ← **requires Step 2**
- Template xlsx
- CLI: `<workspace> <uvp_profile>`

**Outputs:**

```text
output/<workspace>/<uvp_profile>/map/renEPC_change_point_list_updated.xlsx
output/<workspace>/<uvp_profile>/map/mapping_log.xlsx
output/<workspace>/<uvp_profile>/map/mapping_log.json
(+ locked fallbacks if primary files cannot be written)
```

#### Mapping log actions

| Action | Meaning |
|--------|---------|
| `Matched` | EMD impact row matched an analyze impact; Result written to E |
| `Inserted` | Analyze impact not in EMD; new row inserted under the name |
| `Orphan` | EMD impact row had no matching analyze impact (or name not in result); wrote `-` |
| `NotFound` | Analyze impacts were only `Not Found`; wrote `-` |
| `CreatedNameBlock` | Switch missing from EMD; new name + impact rows created in the right section |
| `NameMissingFromEmd` | Switch missing from EMD and could not create a block (no valid impacts / section missing) |

---

### One-page summary

| # | Script | Question it answers | Needs before it | Produces |
|---|--------|---------------------|-----------------|----------|
| 1 | `scan_ren_epc.js` | Where do switches appear in code? | Source tree + `local_switch.json` | `scan/*.json` |
| 2 | `analyze_profile_from_scan.js` | Do code findings match UVP / behavior profiles? | Scan JSON + UVP `.mk` + behavior `.mk` | `analyze/result.json` |
| 3 | `excel_mapper.js` | How do those results fill the EMD Excel? | `result.json` + template xlsx | `map/*updated*.xlsx` + logs |

```text
Code ──► Scan ──► Analyze(+UVP + Behavior profiles) ──► Excel map
         (find)    (judge O/X/-)                       (report)
```

---

## 3. Big picture (scan ↔ analyze data)

```text
scan_ren_epc.js
   └─ writes ren_epc_scan_result.json
         ├─ locations[]   = every line where a switch name appears
         └─ blocks[]      = each #if / #ifdef ... #endif region + functions inside it

analyze_profile_from_scan.js
   └─ reads that JSON + UVP .mk + behavior .mk
         ├─ PASS/FAIL uses locations count + profile TRUE/FALSE
         └─ impacts merge blocks[].functions with locations (see §6)
```

| Field | Question it answers |
|-------|---------------------|
| `locations` | Where does the switch **name** appear (line-by-line)? |
| `blocks` | What does each `#if…#endif` **contain** (functions + relation)? |

---

## 4. Old vs new scanner

### Old behavior (before)

- Found tokens on each line
- Guessed function as: **last function whose start line is above this line**
- Problem: for a switch that **wraps** functions, `#ifdef` is between functions → wrong function name

### New behavior (now)

Still keeps line hits (`locations`), **and** builds real preprocessor **blocks**.

Also builds proper function ranges (brace depth). If a function is missing its closing `}`, end is clipped to the next detected function so nested/later functions keep correct partners.

```cpp
#ifdef UVP_SW_AI_SYSTEM
RETCODE Foo::func_a() { ... }
RETCODE Foo::func_b() { ... }
RETCODE Foo::func_c() { ... }
#endif
```

New scanner records:

```json
"blocks": [
  {
    "startLine": 100,
    "endLine": 200,
    "relation": "wraps_functions",
    "functions": [
      "Foo::func_a",
      "Foo::func_b",
      "Foo::func_c"
    ]
  }
]
```

And for the `#ifdef` line itself in `locations`:

```json
{
  "line": 100,
  "function": "(file-scope)",
  "role": "directive_open"
}
```

`(file-scope)` is correct for that **line**. Contained functions live in **`blocks`**.

---

## 5. Scan JSON shape (per switch)

```json
"UVP_SW_OCR": {
  "kind": "uvp",
  "occurrenceCount": 6,
  "locations": [
    {
      "stream": "reference",
      "file": "ren_epc_docpg_param_creator.cpp",
      "fileType": "cpp",
      "line": 1010,
      "function": "ren_epc_docpg_param_creator::convert_normal_param",
      "role": "directive_open",
      "code": "#ifdef UVP_SW_OCR"
    }
  ],
  "blocks": [
    {
      "stream": "reference",
      "file": "ren_epc_docpg_param_creator.cpp",
      "startLine": 1010,
      "endLine": 1068,
      "relation": "inside_function",
      "functions": [
        "ren_epc_docpg_param_creator::convert_normal_param"
      ],
      "parentSwitch": null
    }
  ]
}
```

### `locations[]` fields

| Field | Meaning |
|-------|---------|
| `line` | 1-based line number |
| `function` | Function that **contains this line**, or `(file-scope)` / makefile context |
| `role` | Why this hit exists (see below) |
| `code` | Trimmed source line |

### `role` values

| role | Meaning |
|------|---------|
| `directive_open` | `#if` / `#ifdef` / `#ifndef` (or a `\` continuation line of one) |
| `directive_close` | `#endif` |
| `directive_branch` | `#elif` / `#else` |
| `runtime_use` | Normal code use, e.g. `if (BEHAVIOR_MODE_IF_OCR)` |
| `comment_ref` | Name appears only in a comment |

### `blocks[]` fields

| Field | Meaning |
|-------|---------|
| `startLine` / `endLine` | `#if` open … matching `#endif` |
| `relation` | How block sits vs functions |
| `functions` | Functions covered by this block |
| `parentSwitch` | Outer switch name if nested, else `null` |

### `relation` values

```text
inside_function
  = switch is INSIDE one function

wraps_functions
  = switch is OUTSIDE and wraps 1 or more whole functions
    (1 function and N functions use the SAME relation;
     only functions.length changes)

mixed
  = rare / odd overlap
```

#### Example — switch inside a function

```cpp
RETCODE Foo::set_prohibition_function()
{
#if defined(UVP_SW_OCR)
    ...
#endif
}
```

```json
"relation": "inside_function",
"functions": ["Foo::set_prohibition_function"]
```

#### Example — switch wraps many functions

```cpp
#if defined(UVP_SW_HCPDF_SPEED) || \
    defined(UVP_SW_HCPDF_RATIO)
RETCODE Foo::convert_hcpdf_param() { ... }
RETCODE Foo::get_doc_arrspace_stamp() { ... }
RETCODE Foo::set_stamp_hcpdf_doc_param() { ... }
#endif
```

```json
"relation": "wraps_functions",
"functions": [
  "Foo::convert_hcpdf_param",
  "Foo::get_doc_arrspace_stamp",
  "Foo::set_stamp_hcpdf_doc_param"
]
```

Both UVP names in the multi-line `#if` get the **same** block.

---

## 6. What decides PASS / FAIL / NONE

Analyze uses:

- presence from `locations.length` (occurrence count)
- profile value TRUE / FALSE / missing

```js
function evaluateResult(kind, profileValue, occurrenceCount) {
    if (kind === "local_switch") {
        return occurrenceCount > 0 ? "O" : "-";
    }

    if (!occurrenceCount) {
        return "-";   // not found in code
    }

    if (profileValue === "TRUE") {
        return "O";   // found + TRUE
    }

    return "X";       // found + FALSE or missing from profile
}
```

| In code? | Profile | Result |
|----------|---------|--------|
| No | anything | `-` |
| Yes | `TRUE` | `O` |
| Yes | `FALSE` or missing | `X` |

Behavior switches use the **paired** `UVP_SW_*` name inside the **behavior** profile only.

---

## 7. How analyze builds impacts

### Current logic (`buildUniqueImpacts`)

Impacts are **merged**, not “blocks only”:

1. **From blocks** — each `block.functions[]` entry → `{ file, function, relation }`  
   (empty `functions` → one `(file-scope)` impact for that block)
2. **From locations** — each location function, with:
   - makefile-style names normalized to `(file-scope)`
   - `(file-scope)` locations **skipped** when the same file already has a real function impact
   - location-sourced rows use `relation: "occurrence"`
3. If still empty → `[{ file: "Not Found", function: "" }]`

Summary function list (`collectFunctionsFromScanEntry`) still **prefers** `blocks[].functions`, then falls back to `locations[].function`.

In `buildRows`:

```js
const locations = scanEntry.locations || [];
const blocks = scanEntry.blocks || [];

const result = evaluateResult(kind, profileValue, locations.length);
const functions = collectFunctionsFromScanEntry(scanEntry);
const impacts = buildUniqueImpacts(locations, blocks);

resultSwitches[name] = {
    kind,
    profile: profileDisplay,
    result,
    occurrenceCount: locations.length,
    blocks,      // kept for debugging / downstream
    impacts      // block + location merge
};
```

Profile-only UVP names (in UVP `.mk` but not in scan) are appended with `result: "-"` and a `Not Found` impact.

---

## 8. End-to-end example (HCPDF wrap)

### Source

```cpp
#if (defined(UVP_SW_FILE_SEND_FORMAT_HIGHCOMPRESSIONPDF_SPEEDPRIORITY) || \
     defined(UVP_SW_FILE_SEND_FORMAT_HIGHCOMPRESSIONPDF_COMPRESSIONRATIOPRIORITY))

RETCODE ...::convert_hcpdf_param(...) { ... }
...
RETCODE ...::get_doc_arrspace_stamp(...) { ... }
...
RETCODE ...::set_stamp_hcpdf_doc_param(...) { ... }

#endif
```

### Scan output (simplified)

```json
"UVP_SW_FILE_SEND_FORMAT_HIGHCOMPRESSIONPDF_COMPRESSIONRATIOPRIORITY": {
  "locations": [
    { "line": 1432, "function": "(file-scope)", "role": "directive_open" }
  ],
  "blocks": [
    {
      "startLine": 1431,
      "endLine": 2246,
      "relation": "wraps_functions",
      "functions": [
        "ren_epc_docpg_param_creator::convert_hcpdf_param",
        "ren_epc_docpg_param_creator::get_doc_arrspace_stamp",
        "ren_epc_docpg_param_creator::set_stamp_hcpdf_doc_param"
      ]
    }
  ]
}
```

### Analyze impact output (simplified)

```json
"impacts": [
  {
    "file": "ren_epc_docpg_param_creator.cpp",
    "function": "ren_epc_docpg_param_creator::convert_hcpdf_param",
    "relation": "wraps_functions"
  },
  {
    "file": "ren_epc_docpg_param_creator.cpp",
    "function": "ren_epc_docpg_param_creator::get_doc_arrspace_stamp",
    "relation": "wraps_functions"
  },
  {
    "file": "ren_epc_docpg_param_creator.cpp",
    "function": "ren_epc_docpg_param_creator::set_stamp_hcpdf_doc_param",
    "relation": "wraps_functions"
  }
]
```

That `impacts` list is what `excel_mapper.js` matches / inserts for “Affecting Header/Function”.

---

## 9. What to look at when reading JSON

```text
Want to know...                         Look at...
--------------------------------------  ---------------------------------
Did we find the switch at all?          locations / occurrenceCount
PASS/FAIL vs profile?                   analyze result (O / X / -)
Which functions does #if contain?       blocks[].functions + relation
Why is this one line "(file-scope)"?    locations[].function for that line
                                        (normal for wrap-case #ifdef)
What goes to Excel impacts?             analyze impacts (blocks + locations)
Did mapper match / insert / orphan?     map/mapping_log.json actions
```

---

## 10. Compatibility

| Scan JSON | Analyze behavior |
|-----------|------------------|
| Has `blocks` | Impacts include block functions, then location hits |
| No `blocks` (old) | Impacts come from locations only |

Additive change: old fields remain; new fields were added.

---

## 11. Quick cheatsheet

```text
How to run (from analyzer/)
  node run_all.js <workspace> <uvp_profile> <behavior_profile>
  node scan_ren_epc.js <workspace> <uvp_profile>
  node analyze_profile_from_scan.js <workspace> <uvp_profile> <behavior_profile>
  node excel_mapper.js <workspace> <uvp_profile>

Profiles (work laptop)
  dir = /data1/p4work/<workspace>/stream_target/subsys_PLP/build/profiles/
  UVP       = <uvp_profile>.mk
  Behavior  = <behavior_profile>.mk   (required; no default)

output_paths.js
  output/<workspace>/<uvp_profile>/{scan,analyze,map}/
  locked xlsx fallbacks under map/ if primary files are locked

scan_ren_epc.js
  locations  = line hits (+ role)
  blocks     = #if regions (+ relation + functions)
  missing }  = function end clipped to next detected function

analyze_profile_from_scan.js
  UVP_SW_*            → UVP profile
  BEHAVIOR_MODE_IF_*  → paired UVP_SW_* in behavior profile (no UVP fallback)
  PASS/FAIL           = locations + that profile TRUE/FALSE
  impacts             = blocks + locations (merge)
  also emits          = UVP names in profile but not in scan (−)

excel_mapper.js
  match / insert impacts, create missing name blocks
  Makefile / rule.mak keep parent/filename
  log actions: Matched, Inserted, Orphan, NotFound,
               CreatedNameBlock, NameMissingFromEmd

relation
  inside_function  = switch inside function
  wraps_functions  = switch wraps 1..N functions
```
