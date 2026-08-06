# How Each Script Works (Internals)

Companion to [`new_scanner_and_analyze_guide.md`](./new_scanner_and_analyze_guide.md).

| Doc | Use it for |
|-----|------------|
| [`executive_brief.md`](./executive_brief.md) | Easy pitch for managers / higher-ups |
| `new_scanner_and_analyze_guide.md` | How to run, inputs/outputs, JSON shapes, O/X/- rules, mapper log actions |
| **This file** | Step-by-step **how** each script works inside |

Scripts covered:

1. `output_paths.js` - shared path helper
2. `run_all.js` - orchestrator
3. `scan_ren_epc.js` - code scanner
4. `analyze_profile_from_scan.js` - profile judge
5. `excel_mapper.js` - EMD Excel filler

---

## 1. `output_paths.js`

**Role:** One place that decides where every artifact lives.

### Flow

```text
getRunPaths(workspace, profileInput)
  -> strip .mk from profile name
  -> build output/<workspace>/<profile>/
  -> return paths for scan / analyze / map files + template

ensureRunDirs(paths)
  -> mkdir scan/, analyze/, map/ if missing
  -> return the same paths object
```

Every pipeline script calls:

```js
const RUN_PATHS = ensureRunDirs(getRunPaths(WORKSPACE, PROFILE_INPUT));
```

Then uses fields like `RUN_PATHS.scanJson`, `resultJson`, `mapUpdatedXlsx`, `templateXlsx`, etc.

Template is the first existing of:

1. `templates/renEPC_change_point_list.xlsx`
2. `renEPC_change_point_list.xlsx` (project root)

---

## 2. `run_all.js`

**Role:** Run the three steps in order, stop on first failure.

### Flow

```text
argv: <workspace> <uvp_profile> <behavior_profile>

1. ensureRunDirs(getRunPaths(...))
2. spawn: scan_ren_epc.js        [workspace, uvp_profile]
3. spawn: analyze_profile_from_scan.js
         [workspace, uvp_profile, behavior_profile]
4. spawn: excel_mapper.js        [workspace, uvp_profile]
5. print success + run root
```

- Uses `child_process.spawn` with `stdio: "inherit"` so each script's console output appears live.
- Behavior profile is forwarded **only** to analyze.
- Non-zero exit from any step rejects and sets `process.exitCode = 1`.

---

## 3. `scan_ren_epc.js`

**Role:** Walk ren_epc source trees and build an inventory of switches: line hits + `#if` blocks.

### High-level flow

```text
main()
  |- require both REN_EPC_DIRS to exist
  |- load local switch names from config/local_switch.json
  |- collectFiles() from reference + target ren_epc
  |- for each file -> scanFile()
  |     |- buildFunctionIndex()
  |     |- scan lines for UVP / BEHAVIOR / local tokens
  |     +- buildSwitchBlocks() from preprocessor parsing
  +- buildJsonReport() -> write scan/ren_epc_scan_result.json
```

### 3.1 Collect files

- Recursively walks each root in `REN_EPC_DIRS`
- Skips dirs like `.git`, `node_modules`, `build`, etc.
- Keeps C/C++/headers, Makefiles, `.mk` / `.mak`, and a few config-like extensions
- Skips files larger than 20 MB

### 3.2 Build function index

For each source file's lines:

1. **Detect** function-looking lines with regex:
   - qualified methods (`Class::method`)
   - normal functions
   - destructors / constructors
   - split signatures (return type on previous line)
2. **Reject** C++ keywords and declarations that end with `;` (uses `looksLikeFunctionDefinition`: looks ahead for `{` within ~20 lines)
3. **Find end** with `findFunctionEndLine`:
   - counts `{` / `}` while ignoring strings and comments
   - first return to depth 0 after seeing `{` = end
   - if never balanced -> end = last line of file
4. **Clip** overlapping ranges: if function A's end would cross into function B's start, A ends at `B.startLine - 1`

That clip is why a missing `}` on Function A does not steal tokens from Function B (when B is detected).

### 3.3 Scan tokens (locations)

For each line:

1. Strip `//` comments for matching (`stripCommentsForTokenScan`)
2. Match:
   - `UVP_SW_*`
   - `BEHAVIOR_MODE_IF_*`
   - each local switch name as a whole word
3. Resolve `function`:
   - Makefile / `.mk` -> nearby makefile variable or comment context
   - else -> enclosing function from the index, or `(file-scope)`
4. Classify `role`:
   - `#if` / `#ifdef` / `#ifndef` / continuation -> `directive_open`
   - `#elif` / `#else` -> `directive_branch`
   - `#endif` -> `directive_close`
   - comment-only -> `comment_ref`
   - else -> `runtime_use`

Each hit becomes one `locations[]` entry.

### 3.4 Parse preprocessor blocks

`parsePreprocessorBlocks`:

- Stack-based walk of `#ifdef` / `#ifndef` / `#if` / `#elif` / `#else` / `#endif`
- Joins lines continued with trailing `\`
- Extracts switch names from conditions (`UVP_SW_*` + local switches)
- On `#endif`, if the opened block mentioned any switch names -> emit a raw block `{ startLine, endLine, switchNames, parentSwitchNames }`

`classifyBlockRelation` then compares the block range to the function index:

| Relation | Meaning |
|----------|---------|
| `inside_function` | Open and close sit inside the same function; no nested whole functions |
| `wraps_functions` | Block surrounds one or more whole functions |
| `mixed` | Odd overlap |

`buildSwitchBlocks` expands one raw block into one entry per switch name (same range/relation), with `parentSwitch` from the outer stack.

### 3.5 Aggregate report

`buildJsonReport` groups by switch name:

- `occurrenceCount` + `locations[]`
- `blocks[]`
- Ensures every configured local switch appears even if never found
- Writes summary counts (`uvpCount`, `behaviorCount`, `localSwitchFoundCount`, etc.)

---

## 4. `analyze_profile_from_scan.js`

**Role:** Decide `O` / `X` / `-` per switch using scan + profiles, and build impact lists for the mapper.

### High-level flow

```text
main()
  |- require UVP .mk and behavior .mk to exist
  |- loadScanResult(scanJson)
  |- parseProfileMk(uvp) + parseProfileMk(behavior)
  |- buildRows(...)
  |     |- for each scan switch -> score + impacts
  |     +- for each UVP profile name missing from scan -> result "-"
  |- writeExcelReport (Summary / Detail / Impacts sheets)
  +- writeJsonReport -> analyze/result.json
```

### 4.1 Parse profile `.mk`

`parseProfileMk` extracts `UVP_SW_* = TRUE|FALSE` (with optional `$(TRUE)` form) and some `ifeq ($(UVP_SW_*), ...)` lines into a map:

```text
{ "UVP_SW_OCR": "TRUE", "UVP_SW_FOO": "FALSE", ... }
```

### 4.2 Pick profile value per name

`getProfileValueForName`:

| Kind | Lookup |
|------|--------|
| `local_switch` | none (`null`) |
| `behavior` | pair `BEHAVIOR_MODE_IF_X` -> `UVP_SW_X`, look up in **behavior** map only |
| `uvp` (and other) | look up name in **UVP** map |

No fallback from behavior -> UVP.

### 4.3 Score result

`evaluateResult(kind, profileValue, occurrenceCount)`:

| Kind | Rule |
|------|------|
| local | found -> `O`, else `-` |
| uvp / behavior | not found -> `-`; found + TRUE -> `O`; found + FALSE/missing -> `X` |

`occurrenceCount` is `locations.length` from the scan entry.

### 4.4 Build impacts

`buildUniqueImpacts(locations, blocks)` **merges**:

1. From each block: one impact per function in `block.functions` (or `(file-scope)` if empty), keeping `relation`
2. From each location: add function impacts with `relation: "occurrence"`
   - makefile-ish names -> `(file-scope)`
   - skip `(file-scope)` location if that file already has a real function impact
3. If nothing left -> `[{ file: "Not Found", function: "" }]`

`collectFunctionsFromScanEntry` (for the Summary sheet) prefers block functions, else location functions.

### 4.5 Profile-only UVP names

After scan names, any `UVP_SW_*` present in the UVP `.mk` but absent from the scan is added as:

- `result: "-"`
- note: defined in profile but not found in ren_epc
- impact: Not Found

### 4.6 Outputs

- `result.json` - `switches[name] = { kind, profile, result, occurrenceCount, blocks?, impacts }`
- `result.xlsx` - Summary / Detail / Impacts worksheets

---

## 5. `excel_mapper.js`

**Role:** Take `result.json` and fill the official EMD sheet (column E + affecting rows).

### High-level flow

```text
main()
  |- load result.json
  |- loadTemplateWorkbook (History sheet temporarily renamed via JSZip)
  |- applyMapping(EMD sheet, switches)
  |     |- match existing EMD rows <-> analyze impacts
  |     |- insert unmatched analyze impacts
  |     +- create name blocks for switches missing from EMD
  |- write mapping_log.xlsx + mapping_log.json
  +- write updated xlsx (or *_locked.xlsx if file is locked)
```

### 5.1 Load template safely

ExcelJS can choke on the real sheet name `History`. So:

1. Read template bytes
2. In the zip's `xl/workbook.xml`, rename `History` -> temp name
3. Load with ExcelJS
4. On write, rename temp name back to `History`

### 5.2 Parse EMD structure

`collectNameGroups` walks the EMD sheet and groups rows by switch name (column B), tracking section (UVP / Behavior / Local Switch / etc.).

Each group has: name, section, start/end row, list of impact rows (column C).

### 5.3 Match one name group

For a name present in both EMD and `result.json`:

1. Map analyze `impacts` into comparable `{ file, functionToken }`
2. If all impacts are Not Found -> write `-` on E, log `NotFound` / `Orphan`
3. Else, for each EMD column-C row:
   - parse file + function (`parseEmdAffecting` / `functionToken`)
   - `impactsMatch` against unused analyze impacts
   - match -> write `O`/`X`/`-` on E, log `Matched`
   - no match -> write `-`, log `Orphan`
4. Any analyze impacts still unused -> **insert** new rows under the group (`Inserted`)
5. Makefile / `rule.mak` matching keeps `parent/filename` so client vs server Makefiles don't collide

### 5.4 Names missing from EMD

After processing existing groups, for each `result.json` name not in EMD:

- If no valid impacts -> log `NameMissingFromEmd`
- Else insert a new name block under the matching section anchor (Local Switch -> Behavior -> UVP order) -> log `CreatedNameBlock`

`createNameBlock` writes name in column B on the first row, formatted affecting text in C, result in E.

### 5.5 Affecting text format

`formatEmdAffecting`:

```text
[file] filename.cpp
methodName()
```

Makefiles become e.g. `[file] make_client/Makefile`.

(In Excel the file line is prefixed with a black square marker character.)

### 5.6 Logs

- `mapping_log.json` - summary counts + `actions[]`
- `mapping_log.xlsx` - Summary + Actions + Guide sheet explaining each action type

If the primary xlsx is open/locked, writes fall back to the `*_locked.xlsx` paths from `output_paths`.

---

## 6. Data handoff (who reads what)

```text
Source trees + local_switch.json
        |
        v
 scan_ren_epc.js
        |
        v
 ren_epc_scan_result.json     locations + blocks
        |
        v
 analyze_profile_from_scan.js + UVP.mk + behavior.mk
        |
        v
 result.json                  result + impacts
        |
        v
 excel_mapper.js + template xlsx
        |
        v
 updated EMD Excel + mapping_log
```

No later script re-opens `.cpp` files. Everything after scan is driven by JSON + profiles + the Excel template.

---

## 7. Mental model per script

| Script | Think of it as |
|--------|----------------|
| `output_paths` | Folder map for one run |
| `run_all` | Sequential runner |
| `scan_ren_epc` | Code inventory (where + which `#if` regions) |
| `analyze_profile_from_scan` | Judge (O/X/-) + impact list |
| `excel_mapper` | Report filler (match/insert into EMD) |

For CLI examples, JSON field meanings, and O/X/- tables, see [`new_scanner_and_analyze_guide.md`](./new_scanner_and_analyze_guide.md).
