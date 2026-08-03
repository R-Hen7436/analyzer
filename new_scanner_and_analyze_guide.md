# Pipeline Guide + New Scanner / Analyze Details

This guide explains:

1. The **3 scripts** — what each does, inputs/outputs, and why order matters
2. What the **new** `scan_ren_epc.js` writes
3. How `analyze_profile_from_scan.js` was updated to use it

---

## 0. The 3 scripts (run order)

You always run them in this order (or use `run_all.js`, which does the same):

```text
Step 1          Step 2              Step 3
scan_ren_epc.js → analyze_profile… → excel_mapper.js
     │                  │                   │
     ▼                  ▼                   ▼
  scan JSON         result.json         updated Excel
                    result.xlsx         mapping_log
```

```bash
# One-shot
node run_all.js <workspace> <profile>

# Or step by step (same workspace/profile each time)
node scan_ren_epc.js <workspace> <profile>
node analyze_profile_from_scan.js <workspace> <profile>
node excel_mapper.js <workspace> <profile>
```

Shared output root (from `output_paths.js`):

```text
output/<workspace>/<profile>/
  scan/     ← Step 1
  analyze/  ← Step 2
  map/      ← Step 3
```

### Why this order? (prerequisites)

```text
Step 1 must run first
  → creates the inventory of switches found in code
  → nothing else has data without this

Step 2 needs Step 1
  → reads scan JSON + profile .mk
  → cannot decide O/X/- without knowing what was found in code

Step 3 needs Step 2
  → reads analyze result.json (not the raw scan)
  → fills the Excel EMD sheet with Result + matched impacts
```

If you skip a step:

| You skip… | What breaks |
|-----------|-------------|
| Step 1 | Analyze has no `ren_epc_scan_result.json` → error |
| Step 2 | Mapper has no `result.json` → error |
| Step 3 | You still have scan + analyze; just no updated Excel |

---

### Script 1 — `scan_ren_epc.js` (FIRST)

**Job:** Search ren_epc source for switches and record where they appear.

**Does:**
- Walks source files (work laptop: `/data1/p4work/.../ren_epc`; local test: `codefiles/`)
- Finds:
  - `UVP_SW_*`
  - `BEHAVIOR_MODE_IF_*`
  - local switches from `config/local_switch.json`
- For each hit, records file / line / function / code
- **New:** also builds `#if…#endif` **blocks** with `relation` + enclosed `functions`

**Inputs:**
- Source tree (`REN_EPC_DIRS`)
- `config/local_switch.json`
- CLI: `<workspace> <profile>` (profile is only for output folder name here)

**Output:**
```text
output/<workspace>/<profile>/scan/ren_epc_scan_result.json
```

**Why first:**
This is the **source of truth from code**. Analyze and mapper never open `.cpp` files themselves — they consume this JSON.

```text
CPP / headers / makefiles
        │
        ▼
 scan_ren_epc.js
        │
        ▼
 ren_epc_scan_result.json   ← prerequisite for Step 2
```

---

### Script 2 — `analyze_profile_from_scan.js` (SECOND)

**Job:** Compare scan results against the UVP profile and decide Pass / Fail / None.

**Does:**
- Loads `ren_epc_scan_result.json` from Step 1
- Loads profile `.mk` (work laptop: `/data1/p4work/.../profiles/`; local test: `dummy_profile.mk`)
- For each switch:
  - found in code + profile TRUE → `O`
  - found in code + profile FALSE/missing → `X`
  - not found in code → `-`
- Builds **impacts** (file + function affected)
  - **New:** prefers `blocks[].functions` from the scanner
- Writes Excel + JSON summary

**Inputs:**
- `scan/ren_epc_scan_result.json`  ← **requires Step 1**
- Profile `.mk` file
- CLI: `<workspace> <profile>`

**Outputs:**
```text
output/<workspace>/<profile>/analyze/result.json
output/<workspace>/<profile>/analyze/result.xlsx
```

**Why second (and why not first):**
It needs both:
1. “What exists in code?” → from scan  
2. “What does the product profile enable?” → from `.mk`

Without the scan, it cannot know occurrence / impacts.  
Without the profile, it cannot assign `O` vs `X` for UVP/behavior.

```text
ren_epc_scan_result.json  +  profile.mk
              │
              ▼
 analyze_profile_from_scan.js
              │
              ▼
 result.json / result.xlsx   ← prerequisite for Step 3
```

---

### Script 3 — `excel_mapper.js` (THIRD)

**Job:** Map analyze results into the official change-point Excel (EMD sheet).

**Does:**
- Loads `analyze/result.json` from Step 2
- Loads template `templates/renEPC_change_point_list.xlsx`
- Matches switch names + impact file/function rows on the **EMD** sheet
- Writes Result into column E (`O` / `X` / `-`)
- Logs matches / orphans / missing names

**Inputs:**
- `analyze/result.json`  ← **requires Step 2**
- `templates/renEPC_change_point_list.xlsx`
- CLI: `<workspace> <profile>`

**Outputs:**
```text
output/<workspace>/<profile>/map/renEPC_change_point_list_updated.xlsx
output/<workspace>/<profile>/map/mapping_log.xlsx
output/<workspace>/<profile>/map/mapping_log.json
```

**Why third:**
The mapper does **not** scan code or read the profile.  
It only places already-decided results (`O`/`X`/`-`) and impacts into the Excel template.  
Those decisions live in `result.json` from Step 2.

```text
result.json  +  renEPC_change_point_list.xlsx
              │
              ▼
        excel_mapper.js
              │
              ▼
 updated Excel + mapping_log
```

---

### One-page summary

| # | Script | Question it answers | Needs before it | Produces |
|---|--------|---------------------|-----------------|----------|
| 1 | `scan_ren_epc.js` | Where do switches appear in code? | Source tree | `scan/*.json` |
| 2 | `analyze_profile_from_scan.js` | Do code findings match the profile? | Scan JSON + profile `.mk` | `analyze/result.json` |
| 3 | `excel_mapper.js` | How do those results fill the EMD Excel? | `result.json` + template xlsx | `map/*updated*.xlsx` |

```text
Code ──► Scan ──► Analyze(+Profile) ──► Excel map
         (find)    (judge O/X/-)         (report)
```

---

## 1. Big picture (scan ↔ analyze data)

```text
scan_ren_epc.js
   └─ writes ren_epc_scan_result.json
         ├─ locations[]   = every line where a switch name appears
         └─ blocks[]      = each #if / #ifdef ... #endif region + functions inside it

analyze_profile_from_scan.js
   └─ reads that JSON + profile (.mk)
         ├─ PASS/FAIL still uses locations count + profile TRUE/FALSE
         └─ "which functions are affected?" now prefers blocks[].functions
```

**Remember:**

| Field | Question it answers |
|-------|---------------------|
| `locations` | Where does the switch **name** appear (line-by-line)? |
| `blocks` | What does each `#if…#endif` **contain** (functions + relation)? |

---

## 2. Old vs new scanner

### Old behavior (before)

- Found tokens on each line (`UVP_SW_*`, `BEHAVIOR_MODE_IF_*`, local switches)
- Guessed function as: **last function whose start line is above this line**
- Problem: for a switch that **wraps** functions, `#ifdef` is between functions → wrong function name

```cpp
// previous function ended here

#ifdef UVP_SW_AI_SYSTEM          // OLD scanner: wrongly said "previous_function"
RETCODE Foo::func_a() { ... }
RETCODE Foo::func_b() { ... }
RETCODE Foo::func_c() { ... }
#endif
```

### New behavior (now)

Still keeps line hits (`locations`), **and** builds real preprocessor **blocks**.

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

`(file-scope)` is correct for that **line** (it is not inside a function body).  
The list of contained functions lives in **`blocks`**.

---

## 3. New scan JSON shape (per switch)

```json
"UVP_SW_OCR": {
  "kind": "uvp",
  "occurrenceCount": 6,
  "locations": [
    {
      "stream": "local",
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
      "stream": "local",
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
| `function` | Function that **contains this line**, or `(file-scope)` |
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

### `relation` values (the important new idea)

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

#### Example A — switch inside a function

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

#### Example B — switch wraps many functions

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

#### Example C — switch wraps exactly one function

```cpp
#ifdef UVP_SW_AI_SYSTEM
ren_epc_ai_param_creator*
Foo::create_ai_param_creator(...) { ... }
#endif
```

```json
"relation": "wraps_functions",
"functions": ["Foo::create_ai_param_creator"]
```

Same logic as Example B; only `functions.length === 1`.

---

## 4. What still decides PASS / FAIL / NONE

Analyze **did not** change the PASS rule. It still uses:

- presence from `locations.length` (occurrence count)
- profile value TRUE / FALSE / missing

```js
// analyze_profile_from_scan.js (same idea as before)
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

So:

| In code? | Profile | Result |
|----------|---------|--------|
| No | anything | `-` |
| Yes | `TRUE` | `O` |
| Yes | `FALSE` or missing | `X` |

---

## 5. How analyze was updated to complement the scanner

### Before (old analyze)

Impacts came only from `locations[].function`:

```js
// OLD idea
impacts = unique(locations.map(loc => ({
  file: loc.file,
  function: loc.function
})))
```

Problem for wrap cases:

- `#ifdef` line → `(file-scope)` or wrong previous function
- `#endif` line → last function only
- Missing middle wrapped functions

### After (new analyze)

**Prefer `blocks`**, fall back to `locations` (compatible with old JSON too).

```js
// analyze_profile_from_scan.js — NEW
function buildUniqueImpacts(locations, blocks) {
    // 1) Prefer blocks (new scanner output)
    if (blocks && blocks.length > 0) {
        const fromBlocks = [];

        for (const block of blocks) {
            const file = block.file || "";
            const functions =
                Array.isArray(block.functions) && block.functions.length > 0
                    ? block.functions
                    : [""];

            for (const functionName of functions) {
                fromBlocks.push({
                    file,
                    function: functionName || "",
                    relation: block.relation || ""
                });
            }
        }

        // unique by "file | function"
        const unique = /* Map dedupe + sort */;
        if (unique.length > 0) {
            return unique;
        }
    }

    // 2) Fallback for old scan JSON (no blocks)
    //    use locations like before
    return /* unique from locations */;
}
```

Summary function list uses the same preference:

```js
function collectFunctionsFromScanEntry(scanEntry) {
    // Prefer functions from blocks
    const fromBlocks = [];
    for (const block of scanEntry.blocks || []) {
        for (const functionName of block.functions || []) {
            if (functionName) fromBlocks.push(functionName);
        }
    }
    if (fromBlocks.length > 0) {
        return [...new Set(fromBlocks)].sort();
    }

    // Fallback: locations
    return [...new Set(
        (scanEntry.locations || []).map(l => l.function || "")
    )].filter(Boolean).sort();
}
```

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
    impacts      // now block-aware
};
```

---

## 6. End-to-end example (HCPDF wrap)

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

That `impacts` list is what `excel_mapper.js` uses for “Affecting Header/Function”.

---

## 7. What to look at when reading JSON

```text
Want to know...                         Look at...
--------------------------------------  ---------------------------------
Did we find the switch at all?          locations / occurrenceCount
PASS/FAIL vs profile?                   analyze result (O / X / -)
Which functions does #if contain?       blocks[].functions + relation
Why is this one line "(file-scope)"?    locations[].function for that line
                                        (normal for wrap-case #ifdef)
What goes to Excel impacts?             analyze impacts (from blocks)
```

---

## 8. Compatibility

| Scan JSON | Analyze behavior |
|-----------|------------------|
| New (has `blocks`) | Impacts from `blocks[].functions` |
| Old (no `blocks`) | Falls back to `locations[].function` |

Additive change: old fields remain; new fields were added.

---

## 9. Quick cheatsheet

```text
scan_ren_epc.js
  locations  = line hits (+ role)
  blocks     = #if regions (+ relation + functions)

analyze_profile_from_scan.js
  PASS/FAIL  = still from locations + profile
  impacts    = prefer blocks, else locations

relation
  inside_function  = switch inside function
  wraps_functions  = switch wraps 1..N functions
```
