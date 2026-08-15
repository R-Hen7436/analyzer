const fs = require("fs");
const path = require("path");
const { getRunPaths, ensureRunDirs } = require("./output_paths");

const PROJECT_ROOT = path.join(__dirname, "..");

const WORKSPACE = process.argv[2];
const PROFILE_INPUT = process.argv[3];
const MODULE_INPUT = process.argv[4] || "all";

const VALID_MODULES = ["ren_epc", "dvu_ai", "dvc_ai", "all"];

if (!WORKSPACE || !PROFILE_INPUT) {
    console.error("Usage:");
    console.error(
        "  node scan_switches.js <workspace> <profile> [ren_epc|dvu_ai|dvc_ai|all]"
    );
    console.error("");
    console.error("Example:");
    console.error(
        "  node scan_switches.js ubasrh_KPC02530_2291_matsuri3_mp C2YC_uvp_profile"
    );
    console.error(
        "  node scan_switches.js ubasrh_KPC02530_2291_matsuri3_mp C2YC_uvp_profile dvu_ai"
    );
    console.error("");
    console.error("Note:");
    console.error("  Profile is used for output folder organization only.");
    console.error("  Module defaults to all when omitted.");
    process.exit(1);
}

if (!VALID_MODULES.includes(MODULE_INPUT)) {
    console.error(
        `Invalid module "${MODULE_INPUT}". Expected one of: ${VALID_MODULES.join(", ")}`
    );
    process.exit(1);
}

const RUN_PATHS = ensureRunDirs(getRunPaths(WORKSPACE, PROFILE_INPUT));

const SCAN_MODULES = {
    ren_epc: {
        id: "ren_epc",
        label: "renEPC",
        outputJson: RUN_PATHS.scanJsonByModule.ren_epc,
        dirs: [
            {
                stream: "reference",
                path: `/data1/p4work/${WORKSPACE}/stream_reference/core_parts/subsys_PLP/platform_element/ren/ren_epc`
            },
            {
                stream: "target",
                path: `/data1/p4work/${WORKSPACE}/stream_target/subsys_PLP/platform_element/ren/ren_epc`
            }
        ]
    },
    dvu_ai: {
        id: "dvu_ai",
        label: "dvuAI",
        outputJson: RUN_PATHS.scanJsonByModule.dvu_ai,
        dirs: [
            {
                stream: "reference",
                path: `/data1/p4work/${WORKSPACE}/stream_reference/core_parts/subsys_PLP/platform_middleware/dvu/dvu_ai`
            },
            {
                stream: "target",
                path: `/data1/p4work/${WORKSPACE}/stream_target/subsys_PLP/platform_middleware/dvu/dvu_ai`
            }
        ]
    },
    dvc_ai: {
        id: "dvc_ai",
        label: "dvcAI",
        outputJson: RUN_PATHS.scanJsonByModule.dvc_ai,
        dirs: [
            {
                stream: "reference",
                path: `/data1/p4work/${WORKSPACE}/stream_reference/core_parts/subsys_PLP/platform_element/dvc/dvc_ai`
            },
            {
                stream: "target",
                path: `/data1/p4work/${WORKSPACE}/stream_target/subsys_PLP/platform_element/dvc/dvc_ai`
            }
        ]
    }
};

const LOCAL_SWITCH_CONFIG_PATH = path.join(
    PROJECT_ROOT,
    "config",
    "local_switch.json"
);

const TOKEN_PATTERNS = [
    {
        kind: "uvp",
        regex: /\bUVP_SW_[A-Z0-9_]+\b/g
    },
    {
        kind: "behavior",
        regex: /\bBEHAVIOR_MODE_IF_[A-Z0-9_]+\b/g
    }
];

const SKIP_DIRS = new Set([
    ".git",
    ".svn",
    "node_modules",
    "out",
    "build",
    "dist",
    "epc_test",
    "prd_test",
    "__pycache__"
]);

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

const CPP_KEYWORDS = new Set([
    "if",
    "else",
    "for",
    "while",
    "switch",
    "case",
    "catch",
    "return",
    "do"
]);

function isCppKeyword(name) {
    return CPP_KEYWORDS.has(
        String(name).toLowerCase()
    );
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadLocalSwitches(configPath) {
    if (!fs.existsSync(configPath)) {
        throw new Error(`Local switch config not found: ${configPath}`);
    }

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const names = config.LOCAL_SWITCH || [];
    const seen = new Set();
    const ordered = [];

    for (const name of names) {
        const trimmed = String(name || "").trim();

        if (!trimmed || seen.has(trimmed)) {
            continue;
        }

        seen.add(trimmed);
        ordered.push(trimmed);
    }

    return ordered;
}

function isUvpSwitchName(name) {
    return String(name || "").startsWith("UVP_SW_");
}

function isBehaviorSwitchName(name) {
    return String(name || "").startsWith("BEHAVIOR_MODE_IF_");
}

function classifySwitchKind(name) {
    if (isUvpSwitchName(name)) {
        return "uvp";
    }

    if (isBehaviorSwitchName(name)) {
        return "behavior";
    }

    return "local_switch";
}

const IGNORED_PREPROCESSOR_MACROS = new Set([
    "TRUE",
    "FALSE",
    "NULL",
    "EOF",
    "MAX",
    "MIN",
    "DEBUG",
    "NDEBUG",
    "UNICODE",
    "_UNICODE",
    "_DEBUG",
    "WIN32",
    "WIN64",
    "_WIN32",
    "_WIN64",
    "unix",
    "linux",
    "__cplusplus",
    "__linux__",
    "__APPLE__",
    "__unix__",
    "__GNUC__",
    "__clang__",
    "_MSC_VER"
]);

function isHeaderGuardName(name) {
    return /(_H|_HH|_HPP|_HXX|_INCLUDED|_HEADER|_H_)$/.test(name);
}

function isIgnoredPreprocessorMacro(name) {
    if (!name) {
        return true;
    }

    if (IGNORED_PREPROCESSOR_MACROS.has(name)) {
        return true;
    }

    if (name.startsWith("__")) {
        return true;
    }

    return isHeaderGuardName(name);
}

function isUnknownLocalSwitchCandidate(name, existingNameSet) {
    const trimmed = String(name || "").trim();

    if (!trimmed || existingNameSet.has(trimmed)) {
        return false;
    }

    if (isUvpSwitchName(trimmed) || isBehaviorSwitchName(trimmed)) {
        return false;
    }

    if (isIgnoredPreprocessorMacro(trimmed)) {
        return false;
    }

    return /^[A-Z_][A-Z0-9_]*$/.test(trimmed);
}

function extractMacroNamesFromDirective(directive, rest) {
    const condition = stripCppComments(rest);
    const names = new Set();

    if (directive === "ifdef" || directive === "ifndef") {
        const first = (condition.split(/\s+/)[0] || "").trim();
        if (first) {
            names.add(first);
        }
        return [...names];
    }

    const definedRegex =
        /\bdefined\s*(?:\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)|([A-Za-z_][A-Za-z0-9_]*))/g;
    let match;

    while ((match = definedRegex.exec(condition)) !== null) {
        names.add(match[1] || match[2]);
    }

    return [...names];
}

function discoverUnknownLocalSwitches(files, existingNameSet) {
    const unknown = new Set();
    const directiveRegex = /^#\s*(ifdef|ifndef|if|elif)\b(.*)$/;

    for (const filePath of files) {
        const content = fs.readFileSync(filePath, "utf8");
        const lines = content.split(/\r?\n/);

        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            const match = trimmed.match(directiveRegex);

            if (!match) {
                continue;
            }

            const { text: fullDirectiveText, endIndex } =
                collectContinuedDirective(lines, i);
            const fullMatch = fullDirectiveText.match(directiveRegex);
            const directive = fullMatch ? fullMatch[1] : match[1];
            const rest = fullMatch
                ? (fullMatch[2] || "").trim()
                : (match[2] || "").trim();

            for (const name of extractMacroNamesFromDirective(directive, rest)) {
                if (isUnknownLocalSwitchCandidate(name, existingNameSet)) {
                    unknown.add(name);
                }
            }

            i = endIndex;
        }
    }

    return [...unknown].sort();
}

function insertLocalSwitches(configPath, newNames) {
    const namesToInsert = (newNames || [])
        .map((name) => String(name || "").trim())
        .filter(Boolean);

    if (namesToInsert.length === 0) {
        return [];
    }

    if (!fs.existsSync(configPath)) {
        throw new Error(`Local switch config not found: ${configPath}`);
    }

    const raw = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(raw);
    const existing = Array.isArray(config.LOCAL_SWITCH)
        ? config.LOCAL_SWITCH.slice()
        : [];
    const seen = new Set();

    for (const name of existing) {
        const trimmed = String(name || "").trim();
        if (trimmed) {
            seen.add(trimmed);
        }
    }

    const inserted = [];

    for (const name of namesToInsert) {
        if (seen.has(name)) {
            continue;
        }

        seen.add(name);
        existing.push(name);
        inserted.push(name);
    }

    if (inserted.length === 0) {
        return [];
    }

    config.LOCAL_SWITCH = existing;
    fs.writeFileSync(
        configPath,
        `${JSON.stringify(config, null, 2)}\n`,
        "utf8"
    );

    return inserted;
}

function buildLocalSwitchPatterns(localSwitchNames) {
    return localSwitchNames.map((name) => ({
        kind: "local_switch",
        name,
        regex: new RegExp(`\\b${escapeRegExp(name)}\\b`, "g")
    }));
}

function getFileType(filePath) {
    const baseName = path.basename(filePath);

    if (baseName === "Makefile") {
        return "Makefile";
    }

    const ext = path.extname(filePath);
    if (!ext) {
        return "no_extension";
    }

    return ext.replace(".", "");
}

function shouldScanFile(filePath) {
    const baseName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    if (baseName === "Makefile") {
        return true;
    }

    const allowedExtensions = new Set([
        ".c",
        ".cc",
        ".cpp",
        ".cxx",
        ".h",
        ".hh",
        ".hpp",
        ".hxx",
        ".mk",
        ".mak",
        ".am",
        ".inc",
        ".txt",
        ".conf",
        ".cfg",
        ".ini"
    ]);

    return allowedExtensions.has(ext);
}

function collectFiles(rootDir) {
    const files = [];

    function walk(currentDir) {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);

            if (entry.isDirectory()) {
                if (SKIP_DIRS.has(entry.name)) {
                    continue;
                }

                walk(fullPath);
                continue;
            }

            if (!entry.isFile()) {
                continue;
            }

            if (!shouldScanFile(fullPath)) {
                continue;
            }

            const stat = fs.statSync(fullPath);
            if (stat.size > MAX_FILE_SIZE_BYTES) {
                continue;
            }

            files.push(fullPath);
        }
    }

    walk(rootDir);
    return files.sort();
}

function looksLikeFunctionDefinition(lines, startLine) {
    for (let j = startLine; j < Math.min(startLine + 20, lines.length); j++) {
        const current = lines[j].trim();

        if (!current) {
            continue;
        }

        if (current.includes(";")) {
            return false;
        }

        if (current.includes("{")) {
            return true;
        }
    }

    return false;
}

function braceDeltaIgnoringNoise(line) {
    let delta = 0;
    let inSingle = false;
    let inDouble = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        const next = i + 1 < line.length ? line[i + 1] : "";

        if (inLineComment) {
            break;
        }

        if (inBlockComment) {
            if (ch === "*" && next === "/") {
                inBlockComment = false;
                i += 1;
            }
            continue;
        }

        if (inSingle) {
            if (ch === "\\") {
                i += 1;
                continue;
            }
            if (ch === "'") {
                inSingle = false;
            }
            continue;
        }

        if (inDouble) {
            if (ch === "\\") {
                i += 1;
                continue;
            }
            if (ch === '"') {
                inDouble = false;
            }
            continue;
        }

        if (ch === "/" && next === "/") {
            inLineComment = true;
            break;
        }

        if (ch === "/" && next === "*") {
            inBlockComment = true;
            i += 1;
            continue;
        }

        if (ch === "'") {
            inSingle = true;
            continue;
        }

        if (ch === '"') {
            inDouble = true;
            continue;
        }

        if (ch === "{") {
            delta += 1;
        } else if (ch === "}") {
            delta -= 1;
        }
    }

    return { delta, stillInBlockComment: inBlockComment };
}

function findFunctionEndLine(lines, startLineIndex) {
    let depth = 0;
    let seenOpen = false;
    let inBlockComment = false;

    for (let i = startLineIndex; i < lines.length; i++) {
        let line = lines[i];

        const { delta, stillInBlockComment } =
            braceDeltaIgnoringNoise(line);

        inBlockComment = stillInBlockComment;
        depth += delta;

        if (delta > 0) {
            seenOpen = true;
        }

        if (seenOpen && depth === 0) {
            return i;
        }
    }

    return lines.length - 1;
}

function buildFunctionIndex(lines) {
    const functions = [];

    function addFunction(lineIndex, name) {
        if (!name || isCppKeyword(name)) {
            return;
        }

        functions.push({
            line: lineIndex,
            startLine: lineIndex + 1,
            endLine: null,
            name
        });
    }

    const constructorRegex = /^\s*([A-Za-z_]\w*(?:::[A-Za-z_]\w*)+)\s*\(/;
    const destructorRegex = /^\s*([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*::~[A-Za-z_]\w*)\s*\(/;
    const returnTypePattern =
        "(?:static\\s+|virtual\\s+|inline\\s+|extern\\s+)?" +
        "[A-Za-z_][A-Za-z0-9_:<>*&\\s]*";

    const qualifiedFunctionRegex = new RegExp(
        "^\\s*" +
            returnTypePattern +
            "\\s+" +
            "([A-Za-z_]\\w*(?:::[A-Za-z_]\\w*)+)" +
            "\\s*\\("
    );

    const normalFunctionRegex = new RegExp(
        "^\\s*" +
            returnTypePattern +
            "\\s+" +
            "([A-Za-z_]\\w*)" +
            "\\s*\\("
    );

    const returnTypeOnlyRegex = new RegExp("^\\s*" + returnTypePattern + "\\s*$");
    const splitFunctionRegex = /^\s*([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)\s*\(/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const qualifiedFunctionMatch = line.match(qualifiedFunctionRegex);
        if (qualifiedFunctionMatch) {
            if (looksLikeFunctionDefinition(lines, i)) {
                addFunction(i, qualifiedFunctionMatch[1]);
                continue;
            }
        }

        const normalFunctionMatch = line.match(normalFunctionRegex);
        if (normalFunctionMatch) {
            if (looksLikeFunctionDefinition(lines, i)) {
                addFunction(i, normalFunctionMatch[1]);
                continue;
            }
        }

        const destructorMatch = line.match(destructorRegex);
        if (destructorMatch) {
            const trimmed = line.trim();
            if (!trimmed.endsWith(";")) {
                addFunction(i, destructorMatch[1]);
                continue;
            }
        }

        const constructorMatch = line.match(constructorRegex);

        if (constructorMatch) {
            const fullName = constructorMatch[1];
            const parts = fullName.split("::");

            if (parts.length >= 2) {
                const funcName = parts[parts.length - 1];
                const className = parts[parts.length - 2];

                if (
                    funcName === className &&
                    looksLikeFunctionDefinition(lines, i)
                ) {
                    addFunction(i, fullName);
                    continue;
                }
            }
        }

        if (i > 0 && returnTypeOnlyRegex.test(lines[i - 1])) {
            const trimmedLine = line.trim();

            if (
                trimmedLine.startsWith("return ") ||
                trimmedLine.includes(";")
            ) {
                continue;
            }

            const splitFunctionMatch = line.match(splitFunctionRegex);
            if (splitFunctionMatch) {
                if (looksLikeFunctionDefinition(lines, i)) {
                    addFunction(i, splitFunctionMatch[1]);
                }
            }
        }
    }

    for (let i = 0; i < functions.length; i++) {
    const fn = functions[i];

    fn.endLine = findFunctionEndLine(lines, fn.line) + 1;

    if (i < functions.length - 1) {
        const nextStart = functions[i + 1].startLine;

        if (fn.endLine >= nextStart) {
            fn.endLine = nextStart - 1;
        }
    }
}

    return functions;
}

function findEnclosingFunction(functions, lineIndex) {
    const lineNumber = lineIndex + 1;

    for (const fn of functions) {
        if (
            fn.startLine <= lineNumber &&
            fn.endLine != null &&
            lineNumber <= fn.endLine
        ) {
            return fn.name;
        }
    }

    return "(file-scope)";
}

function classifyTokenRole(line, tokenName, options = {}) {
    if (options.isDirectiveContinuation) {
        return "directive_open";
    }

    const trimmed = line.trim();

    if (/^#\s*if(n?def)?\b/.test(trimmed)) {
        return "directive_open";
    }

    if (/^#\s*(elif|else)\b/.test(trimmed)) {
        return "directive_branch";
    }

    if (/^#\s*endif\b/.test(trimmed)) {
        return "directive_close";
    }

    if (
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("*")
    ) {
        return "comment_ref";
    }

    if (trimmed.includes(`//`) && trimmed.indexOf(tokenName) > trimmed.indexOf("//")) {
        return "comment_ref";
    }

    return "runtime_use";
}

function stripCppComments(text) {
    return String(text || "")
        .replace(/\/\/.*$/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .trim();
}

function extractSwitchNamesFromCondition(condition, localSwitchNameSet) {
    condition = stripCppComments(condition);

    const names = new Set();

    const namedSwitchRegex = /\b(?:UVP_SW_|BEHAVIOR_MODE_IF_)[A-Z0-9_]+\b/g;
    let match;

    while ((match = namedSwitchRegex.exec(condition)) !== null) {
        names.add(match[0]);
    }

    for (const localName of localSwitchNameSet) {
        const localRegex = new RegExp(
            `\\b${escapeRegExp(localName)}\\b`
        );

        if (localRegex.test(condition)) {
            names.add(localName);
        }
    }

    return [...names];
}

/**
 * Join preprocessor lines continued with trailing '\'.
 * Returns 0-based endIndex of the last continuation line.
 */
function collectContinuedDirective(lines, startIndex) {
    let text = String(lines[startIndex] || "").trim();
    let endIndex = startIndex;

    while (text.endsWith("\\")) {
        text = text.slice(0, -1).trimEnd();
        endIndex += 1;

        if (endIndex >= lines.length) {
            break;
        }

        text += " " + String(lines[endIndex] || "").trim();
    }

    return {
        text,
        endIndex
    };
}

function buildDirectiveContinuationLineSet(lines) {
    const continuationLines = new Set();
    const openRegex = /^#\s*(if|ifdef|ifndef|elif)\b/;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();

        if (!openRegex.test(trimmed)) {
            continue;
        }

        const { endIndex } = collectContinuedDirective(lines, i);

        for (let j = i + 1; j <= endIndex; j++) {
            continuationLines.add(j);
        }

        i = endIndex;
    }

    return continuationLines;
}

function parsePreprocessorBlocks(lines, localSwitchNameSet) {
    const stack = [];
    const blocks = [];
    const directiveRegex = /^#\s*(ifdef|ifndef|if|elif|else|endif)\b(.*)$/;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        const match = trimmed.match(directiveRegex);

        if (!match) {
            continue;
        }

        const directive = match[1];
        const lineNumber = i + 1;
        const { text: fullDirectiveText, endIndex } = collectContinuedDirective(
            lines,
            i
        );
        const fullMatch = fullDirectiveText.match(directiveRegex);
        const rest = fullMatch ? (fullMatch[2] || "").trim() : (match[2] || "").trim();

        if (directive === "ifdef" || directive === "ifndef" || directive === "if") {
            const condition =
                directive === "if"
                    ? rest
                    : rest.split(/\s+/)[0] || rest;

            stack.push({
                startLine: lineNumber,
                directive,
                condition,
                switchNames: extractSwitchNamesFromCondition(
                    directive === "if" ? rest : condition,
                    localSwitchNameSet
                ),
                parentSwitchNames:
                    stack.length > 0
                        ? stack[stack.length - 1].switchNames.slice()
                        : []
            });

            i = endIndex;
            continue;
        }

        if (directive === "elif") {
            if (stack.length === 0) {
                i = endIndex;
                continue;
            }

            const current = stack[stack.length - 1];
            const elifNames = extractSwitchNamesFromCondition(
                rest,
                localSwitchNameSet
            );

            for (const name of elifNames) {
                if (!current.switchNames.includes(name)) {
                    current.switchNames.push(name);
                }
            }

            i = endIndex;
            continue;
        }

        if (directive === "else") {
            continue;
        }

        if (directive === "endif") {
            if (stack.length === 0) {
                continue;
            }

            const opened = stack.pop();

            if (opened.switchNames.length === 0) {
                continue;
            }

            blocks.push({
                startLine: opened.startLine,
                endLine: lineNumber,
                switchNames: opened.switchNames,
                parentSwitchNames: opened.parentSwitchNames
            });
        }
    }

    return blocks;
}

function classifyBlockRelation(block, functions) {
    const startFn = functions.find(
        (fn) =>
            fn.startLine <= block.startLine && block.startLine <= fn.endLine
    );
    const endFn = functions.find(
        (fn) => fn.startLine <= block.endLine && block.endLine <= fn.endLine
    );

    const enclosed = functions.filter(
        (fn) =>
            block.startLine < fn.startLine && fn.endLine <= block.endLine
    );

    if (
        startFn &&
        endFn &&
        startFn.name === endFn.name &&
        enclosed.length === 0
    ) {
        return {
            relation: "inside_function",
            functions: [startFn.name]
        };
    }

    if (!startFn && !endFn && enclosed.length > 0) {
        return {
            relation: "wraps_functions",
            functions: enclosed.map((fn) => fn.name)
        };
    }

    // Block open may sit just before a function start (file-scope),
    // while close sits after last wrapped function ends.
    if (!startFn && enclosed.length > 0) {
        return {
            relation: "wraps_functions",
            functions: enclosed.map((fn) => fn.name)
        };
    }

    // Open/close both outside, but function range touches the block.
    const intersecting = functions.filter(
        (fn) =>
            fn.startLine <= block.endLine && fn.endLine >= block.startLine
    );

    if (intersecting.length > 0) {
        const fullyWrapped = intersecting.filter(
            (fn) =>
                fn.startLine >= block.startLine && fn.endLine <= block.endLine
        );

        if (
            fullyWrapped.length > 0 &&
            (!startFn || fullyWrapped.every((fn) => fn.name !== startFn.name))
        ) {
            return {
                relation: "wraps_functions",
                functions: fullyWrapped.map((fn) => fn.name)
            };
        }

        if (startFn && endFn && startFn.name === endFn.name) {
            return {
                relation: "inside_function",
                functions: [startFn.name]
            };
        }

        return {
            relation: "mixed",
            functions: intersecting.map((fn) => fn.name)
        };
    }

    return {
        relation: "mixed",
        functions: []
    };
}

function buildSwitchBlocks(lines, functions, stream, relativeFile, localSwitchNameSet) {
    const rawBlocks = parsePreprocessorBlocks(lines, localSwitchNameSet);
    const switchBlocks = [];

    for (const raw of rawBlocks) {
        const classified = classifyBlockRelation(raw, functions);
        const parentSwitch =
            raw.parentSwitchNames.length > 0
                ? raw.parentSwitchNames[0]
                : null;

        for (const switchName of raw.switchNames) {
            switchBlocks.push({
                name: switchName,
                stream,
                file: relativeFile,
                startLine: raw.startLine,
                endLine: raw.endLine,
                relation: classified.relation,
                functions: classified.functions.slice(),
                parentSwitch
            });
        }
    }

    return switchBlocks;
}

function findMakefileContext(lines, lineIndex) {
    for (let index = lineIndex; index >= 0; index--) {
        const trimmed = lines[index].trim();

        if (!trimmed) {
            continue;
        }

        if (trimmed.startsWith("#")) {
            return `(makefile / ${trimmed.replace(/^#\s*/, "")})`;
        }

        if (/^[A-Za-z0-9_]+\s*(\+=|=|:=|\?=)/.test(trimmed)) {
            const variableName = trimmed.split(/\s*(?:\+=|=|:=|\?=)/)[0].trim();
            return `(makefile / ${variableName})`;
        }
    }

    return "(makefile)";
}

function isUnderRoot(filePath, rootPath) {
    const normalizedFile = path.resolve(filePath);
    const normalizedRoot = path.resolve(rootPath);

    return (
        normalizedFile === normalizedRoot ||
        normalizedFile.startsWith(normalizedRoot + path.sep)
    );
}

function getRelativePath(filePath, roots) {
    for (const root of roots) {
        if (isUnderRoot(filePath, root.path)) {
            return {
                stream: root.stream,
                path: path.relative(root.path, filePath)
            };
        }
    }

    const localRoot = path.join(PROJECT_ROOT, "codefiles");

    if (isUnderRoot(filePath, localRoot)) {
        return {
            stream: "local",
            path: path.relative(localRoot, filePath)
        };
    }

    return {
        stream: "unknown",
        path: filePath
    };
}

function resolveFunctionName(filePath, lines, lineIndex, functions) {
    if (filePath.endsWith(".mk") || path.basename(filePath) === "Makefile") {
        return findMakefileContext(lines, lineIndex);
    }

    return findEnclosingFunction(functions, lineIndex);
}

 function stripCommentsForTokenScan(line) {
            return String(line || "")
                .replace(/\/\/.*$/, "");
    }

function scanFile(filePath, localSwitchPatterns, localSwitchNameSet, roots) {
    const relativeInfo = getRelativePath(filePath, roots);
    const relativeFile = relativeInfo.path;
    const stream = relativeInfo.stream;
    const fileType = getFileType(filePath);
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    const functions = buildFunctionIndex(lines);
    const directiveContinuationLines = buildDirectiveContinuationLineSet(lines);
    const occurrences = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];

        const scanLine = stripCommentsForTokenScan(line);

        const functionName = resolveFunctionName(
            filePath,
            lines,
            lineIndex,
            functions
        );
        const roleOptions = {
            isDirectiveContinuation: directiveContinuationLines.has(lineIndex)
        };

        for (const patternInfo of TOKEN_PATTERNS) {
            patternInfo.regex.lastIndex = 0;

            let match;
            while ((match = patternInfo.regex.exec(scanLine)) !== null) {
                const tokenName = match[0];
                occurrences.push({
                    name: tokenName,
                    kind: patternInfo.kind,
                    stream,
                    file: relativeFile,
                    fileType,
                    line: lineIndex + 1,
                    function: functionName,
                    role: classifyTokenRole(line, tokenName, roleOptions),
                    code: line.trim()
                });
            }
        }

        for (const patternInfo of localSwitchPatterns) {
            patternInfo.regex.lastIndex = 0;

            let match;
            while ((match = patternInfo.regex.exec(scanLine)) !== null) {
                occurrences.push({
                    name: patternInfo.name,
                    kind: patternInfo.kind,
                    stream,
                    file: relativeFile,
                    fileType,
                    line: lineIndex + 1,
                    function: functionName,
                    role: classifyTokenRole(line, patternInfo.name, roleOptions),
                    code: line.trim()
                });
            }
        }
    }



    const blocks = buildSwitchBlocks(
        lines,
        functions,
        stream,
        relativeFile,
        localSwitchNameSet
    );

    return { occurrences, blocks };
}

function ensureMasterLocalSwitches(byName, localSwitchNames) {
    for (const name of localSwitchNames) {
        if (byName[name]) {
            continue;
        }

        byName[name] = {
            kind: "local_switch",
            occurrenceCount: 0,
            locations: [],
            blocks: []
        };
    }
}

function buildJsonReport(
    workspace,
    moduleId,
    scanDirs,
    files,
    occurrences,
    blocks,
    localSwitchNames
) {
    const byName = {};

    for (const occurrence of occurrences) {
        if (!byName[occurrence.name]) {
            byName[occurrence.name] = {
                kind: occurrence.kind,
                occurrenceCount: 0,
                locations: [],
                blocks: []
            };
        }

        byName[occurrence.name].occurrenceCount += 1;
        byName[occurrence.name].locations.push({
            stream: occurrence.stream,
            file: occurrence.file,
            fileType: occurrence.fileType,
            line: occurrence.line,
            function: occurrence.function,
            role: occurrence.role,
            code: occurrence.code
        });
    }

    for (const block of blocks) {
        if (!byName[block.name]) {
            const kind = classifySwitchKind(block.name);

            byName[block.name] = {
                kind,
                occurrenceCount: 0,
                locations: [],
                blocks: []
            };
        }

        byName[block.name].blocks.push({
            stream: block.stream,
            file: block.file,
            startLine: block.startLine,
            endLine: block.endLine,
            relation: block.relation,
            functions: block.functions,
            parentSwitch: block.parentSwitch
        });
    }

    ensureMasterLocalSwitches(byName, localSwitchNames);

    const sortedNames = Object.keys(byName).sort();
    const sortedByName = {};

    for (const name of sortedNames) {
        byName[name].locations.sort((a, b) => {
            const streamCompare = (a.stream || "").localeCompare(b.stream || "");
            if (streamCompare !== 0) {
                return streamCompare;
            }

            const fileCompare = a.file.localeCompare(b.file);
            if (fileCompare !== 0) {
                return fileCompare;
            }

            return a.line - b.line;
        });

        byName[name].blocks.sort((a, b) => {
            const fileCompare = a.file.localeCompare(b.file);
            if (fileCompare !== 0) {
                return fileCompare;
            }

            return a.startLine - b.startLine;
        });

        sortedByName[name] = byName[name];
    }

    const localSwitchCount = localSwitchNames.length;
    const localSwitchFoundCount = localSwitchNames.filter(
        (name) => (sortedByName[name]?.occurrenceCount || 0) > 0
    ).length;

    const dirPaths = scanDirs.map((dir) => dir.path);

    return {
        generatedAt: new Date().toISOString(),
        workspace,
        module: moduleId,
        scanDirs: dirPaths,
        // Backward-compatible alias used by older ren_epc consumers
        renEpcDir: moduleId === "ren_epc" ? dirPaths : undefined,
        localSwitchConfigPath: LOCAL_SWITCH_CONFIG_PATH,
        scannedFileCount: files.length,
        occurrenceCount: occurrences.length,
        uniqueNameCount: sortedNames.length,
        summary: {
            uvpCount: sortedNames.filter(
                (name) => sortedByName[name].kind === "uvp"
            ).length,
            behaviorCount: sortedNames.filter(
                (name) => sortedByName[name].kind === "behavior"
            ).length,
            localSwitchCount,
            localSwitchFoundCount,
            localSwitchMissingCount: localSwitchCount - localSwitchFoundCount
        },
        switches: sortedByName
    };
}

function resolveSelectedModules(moduleInput) {
    if (moduleInput === "all") {
        return Object.keys(SCAN_MODULES);
    }

    return [moduleInput];
}

function scanModule(moduleConfig, localSwitchNames, localSwitchPatterns, localSwitchNameSet) {
    console.log(`\n--- Scanning ${moduleConfig.label} (${moduleConfig.id}) ---`);

    const existingDirs = [];
    const missingDirs = [];

    for (const dir of moduleConfig.dirs) {
        if (fs.existsSync(dir.path)) {
            existingDirs.push(dir);
            console.log(`Found ${dir.stream}: ${dir.path}`);
        } else {
            missingDirs.push(dir);
            console.warn(`Missing ${dir.stream}: ${dir.path}`);
        }
    }

    if (existingDirs.length === 0) {
        throw new Error(
            `${moduleConfig.id} path not found. Checked:\n` +
                moduleConfig.dirs.map((dir) => `  - ${dir.path}`).join("\n")
        );
    }

    const files = [];

    for (const dir of existingDirs) {
        const dirFiles = collectFiles(dir.path);
        console.log(
            `  ${dir.stream}: ${dirFiles.length} scannable file(s)`
        );
        files.push(...dirFiles);
    }

    console.log(`Scannable files found: ${files.length}`);

    if (files.length === 0) {
        console.warn(
            `Warning: ${moduleConfig.id} directories exist but no scannable source files were found.`
        );
    }

    const discoveredUnknown = discoverUnknownLocalSwitches(
        files,
        localSwitchNameSet
    );
    const insertedUnknown = insertLocalSwitches(
        LOCAL_SWITCH_CONFIG_PATH,
        discoveredUnknown
    );

    if (insertedUnknown.length > 0) {
        for (const name of insertedUnknown) {
            localSwitchNames.push(name);
            localSwitchNameSet.add(name);
        }
        localSwitchPatterns.push(...buildLocalSwitchPatterns(insertedUnknown));
        console.log(
            `Unknown local switches inserted: ${insertedUnknown.length}`
        );
        for (const name of insertedUnknown) {
            console.log(`  + ${name}`);
        }
    } else {
        console.log("Unknown local switches inserted: 0");
    }

    const allOccurrences = [];
    const allBlocks = [];

    for (const filePath of files) {
        const { occurrences, blocks } = scanFile(
            filePath,
            localSwitchPatterns,
            localSwitchNameSet,
            existingDirs
        );
        allOccurrences.push(...occurrences);
        allBlocks.push(...blocks);
    }

    const report = buildJsonReport(
        WORKSPACE,
        moduleConfig.id,
        existingDirs,
        files,
        allOccurrences,
        allBlocks,
        localSwitchNames
    );

    fs.writeFileSync(
        moduleConfig.outputJson,
        JSON.stringify(report, null, 4),
        "utf8"
    );

    console.log(`Occurrences found: ${allOccurrences.length}`);
    console.log(`Switch blocks found: ${allBlocks.length}`);
    console.log(`Unique names found: ${report.uniqueNameCount}`);
    console.log(`UVP_SW_ count: ${report.summary.uvpCount}`);
    console.log(`BEHAVIOR_MODE_IF_ count: ${report.summary.behaviorCount}`);
    console.log(
        `Local switch found/missing: ${report.summary.localSwitchFoundCount}/${report.summary.localSwitchMissingCount}`
    );
    console.log(`Wrote: ${moduleConfig.outputJson}`);

    return report;
}

function main() {
    const localSwitchNames = loadLocalSwitches(LOCAL_SWITCH_CONFIG_PATH);
    const localSwitchNameSet = new Set(localSwitchNames);
    const localSwitchPatterns = buildLocalSwitchPatterns(localSwitchNames);
    const selectedModules = resolveSelectedModules(MODULE_INPUT);

    console.log(`Workspace: ${WORKSPACE}`);
    console.log(`Profile: ${RUN_PATHS.profileName}`);
    console.log(`Output dir: ${RUN_PATHS.scanDir}`);
    console.log(`Modules: ${selectedModules.join(", ")}`);
    console.log(`Local switches loaded: ${localSwitchNames.length}`);
    console.log(`Local switch config: ${LOCAL_SWITCH_CONFIG_PATH}`);

    for (const moduleId of selectedModules) {
        scanModule(
            SCAN_MODULES[moduleId],
            localSwitchNames,
            localSwitchPatterns,
            localSwitchNameSet
        );
    }
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error("Error:", error.message);
        process.exitCode = 1;
    }
}