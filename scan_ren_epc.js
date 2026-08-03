const fs = require("fs");
const path = require("path");
const { getRunPaths, ensureRunDirs } = require("./output_paths");

const WORKSPACE = process.argv[2];
const PROFILE_INPUT = process.argv[3];

if (!WORKSPACE || !PROFILE_INPUT) {
    console.error("Usage:");
    console.error("  node scan_ren_epc.js <workspace> <profile>");
    console.error("");
    console.error("Example:");
    console.error(
        "  node scan_ren_epc.js ubasrh_KPC02530_2291_matsuri3_mp C2WC_prd_profile"
    );
    console.error("");
    console.error("Note:");
    console.error("  Profile is used for output folder organization only.");
    process.exit(1);
}

const RUN_PATHS = ensureRunDirs(getRunPaths(WORKSPACE, PROFILE_INPUT));

const REN_EPC_DIRS = [
    // Original work-laptop paths (restore when scanning real p4work):
    // `/data1/p4work/${WORKSPACE}/stream_reference/core_parts/subsys_PLP/platform_element/ren/ren_epc`,
    // `/data1/p4work/${WORKSPACE}/stream_target/subsys_PLP/platform_element/ren/ren_epc`,

    // Local dummy testing path:
    path.join(__dirname, "codefiles")
];

const OUTPUT_JSON = RUN_PATHS.scanJson;
const LOCAL_SWITCH_CONFIG_PATH = path.join(
    __dirname,
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

        if (inBlockComment) {
            const endIdx = line.indexOf("*/");
            if (endIdx === -1) {
                continue;
            }
            line = line.slice(endIdx + 2);
            inBlockComment = false;
        }

        const { delta, stillInBlockComment } = braceDeltaIgnoringNoise(line);
        inBlockComment = stillInBlockComment;

        if (delta !== 0) {
            depth += delta;
            if (delta > 0) {
                seenOpen = true;
            }
        }

        if (seenOpen && depth <= 0) {
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
                const trimmed = line.trim();
                const nextLine =
                    i + 1 < lines.length ? lines[i + 1].trim() : "";

                const looksLikeDefinition =
                    funcName === className &&
                    !trimmed.endsWith(";") &&
                    !trimmed.includes(".") &&
                    !trimmed.includes("->") &&
                    (trimmed.includes("{") || nextLine.startsWith("{"));

                if (looksLikeDefinition) {
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

    for (const fn of functions) {
        fn.endLine = findFunctionEndLine(lines, fn.line) + 1;
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

function extractSwitchNamesFromCondition(condition, localSwitchNameSet) {
    const names = new Set();
    const uvpRegex = /\bUVP_SW_[A-Z0-9_]+\b/g;
    let match;

    while ((match = uvpRegex.exec(condition)) !== null) {
        names.add(match[0]);
    }

    for (const localName of localSwitchNameSet) {
        const localRegex = new RegExp(`\\b${escapeRegExp(localName)}\\b`);
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

function getRelativePath(filePath) {
    // Original work-laptop roots (restore when scanning real p4work):
    // const referenceRoot =
    //     `/data1/p4work/${WORKSPACE}/stream_reference/core_parts/subsys_PLP/platform_element/ren/ren_epc`;
    // const targetRoot =
    //     `/data1/p4work/${WORKSPACE}/stream_target/subsys_PLP/platform_element/ren/ren_epc`;

    // Local dummy testing root:
    const localRoot = path.join(__dirname, "codefiles");

    if (filePath.startsWith(localRoot)) {
        return {
            stream: "local",
            path: path.relative(localRoot, filePath)
        };
    }

    // if (filePath.startsWith(referenceRoot)) {
    //     return {
    //         stream: "reference",
    //         path: path.relative(referenceRoot, filePath)
    //     };
    // }
    //
    // if (filePath.startsWith(targetRoot)) {
    //     return {
    //         stream: "target",
    //         path: path.relative(targetRoot, filePath)
    //     };
    // }

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

function scanFile(filePath, localSwitchPatterns, localSwitchNameSet) {
    const relativeInfo = getRelativePath(filePath);
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
            while ((match = patternInfo.regex.exec(line)) !== null) {
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
            while ((match = patternInfo.regex.exec(line)) !== null) {
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
    renEpcDir,
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
            const kind = block.name.startsWith("UVP_SW_")
                ? "uvp"
                : "local_switch";

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

    return {
        generatedAt: new Date().toISOString(),
        workspace,
        renEpcDir,
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

function main() {
    for (const dir of REN_EPC_DIRS) {
        if (!fs.existsSync(dir)) {
            throw new Error(`ren_epc path not found: ${dir}`);
        }
    }

    const localSwitchNames = loadLocalSwitches(LOCAL_SWITCH_CONFIG_PATH);
    const localSwitchNameSet = new Set(localSwitchNames);
    const localSwitchPatterns = buildLocalSwitchPatterns(localSwitchNames);

    console.log(`Workspace: ${WORKSPACE}`);
    console.log(`Profile: ${RUN_PATHS.profileName}`);
    console.log(`Output dir: ${RUN_PATHS.scanDir}`);
    console.log(`Scanning: ${REN_EPC_DIRS}`);
    console.log(`Local switches loaded: ${localSwitchNames.length}`);
    console.log(`Local switch config: ${LOCAL_SWITCH_CONFIG_PATH}`);

    const files = [];

    for (const dir of REN_EPC_DIRS) {
        files.push(...collectFiles(dir));
    }

    console.log(`Scannable files found: ${files.length}`);

    const allOccurrences = [];
    const allBlocks = [];

    for (const filePath of files) {
        const { occurrences, blocks } = scanFile(
            filePath,
            localSwitchPatterns,
            localSwitchNameSet
        );
        allOccurrences.push(...occurrences);
        allBlocks.push(...blocks);
    }

    const report = buildJsonReport(
        WORKSPACE,
        REN_EPC_DIRS,
        files,
        allOccurrences,
        allBlocks,
        localSwitchNames
    );

    fs.writeFileSync(
        OUTPUT_JSON,
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
    console.log(`Wrote: ${OUTPUT_JSON}`);
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error("Error:", error.message);
        process.exitCode = 1;
    }
}