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
    `/data1/p4work/${WORKSPACE}/stream_reference/core_parts/subsys_PLP/platform_element/ren/ren_epc`,
    `/data1/p4work/${WORKSPACE}/stream_target/subsys_PLP/platform_element/ren/ren_epc`
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

function buildFunctionIndex(lines) {
    const functions = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const methodMatch = line.match(/([A-Za-z_]\w*(?:::[A-Za-z_]\w*)+)\s*\(/);
        if (methodMatch) {
            functions.push({
                line: i,
                name: methodMatch[1]
            });
            continue;
        }

        const normalFunctionMatch = line.match(
            /^\s*(?:static\s+|virtual\s+|inline\s+|extern\s+)?(?:const\s+)?(?:unsigned\s+)?(?:void|int|bool|char|long|short|float|double|size_t|BOOL|UINT|DWORD|auto|[A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:const\s*)?(?:\{|$)/
        );

        if (normalFunctionMatch) {
            functions.push({
                line: i,
                name: normalFunctionMatch[1]
            });
            continue;
        }

        if (i > 0) {
            const previousLine = lines[i - 1];

            const isReturnTypeLine =
                /^\s*(?:static\s+)?(?:const\s+)?(?:unsigned\s+)?(?:void|int|bool|char|long|short|float|double|size_t|BOOL|UINT|DWORD|auto|[A-Za-z_]\w*)\s*$/.test(previousLine);

            if (isReturnTypeLine) {
                const splitFunctionMatch = line.match(/^\s*([A-Za-z_]\w*(?:::[A-Za-z_]\w*)?)\s*\(/);
                if (splitFunctionMatch) {
                    functions.push({
                        line: i,
                        name: splitFunctionMatch[1]
                    });
                }
            }
        }
    }

    return functions;
}

function findEnclosingFunction(functions, lineIndex) {
    let enclosingFunction = null;

    for (const fn of functions) {
        if (fn.line <= lineIndex) {
            enclosingFunction = fn;
        } else {
            break;
        }
    }

    return enclosingFunction ? enclosingFunction.name : "(global/#define)";
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
    const referenceRoot =
        `/data1/p4work/${WORKSPACE}/stream_reference/core_parts/subsys_PLP/platform_element/ren/ren_epc`;

    const targetRoot =
        `/data1/p4work/${WORKSPACE}/stream_target/subsys_PLP/platform_element/ren/ren_epc`;

    if (filePath.startsWith(referenceRoot)) {
        return {
            stream: "reference",
            path: path.relative(referenceRoot, filePath)
        };
    }

    if (filePath.startsWith(targetRoot)) {
        return {
            stream: "target",
            path: path.relative(targetRoot, filePath)
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

function scanFile(filePath, localSwitchPatterns) {
    const relativeInfo = getRelativePath(filePath);
    const relativeFile = relativeInfo.path;
    const stream = relativeInfo.stream;
    const fileType = getFileType(filePath);
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    const functions = buildFunctionIndex(lines);
    const occurrences = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        const functionName = resolveFunctionName(
            filePath,
            lines,
            lineIndex,
            functions
        );

        for (const patternInfo of TOKEN_PATTERNS) {
            patternInfo.regex.lastIndex = 0;

            let match;
            while ((match = patternInfo.regex.exec(line)) !== null) {
                occurrences.push({
                    name: match[0],
                    kind: patternInfo.kind,
                    stream,
                    file: relativeFile,
                    fileType,
                    line: lineIndex + 1,
                    function: functionName,
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
                    code: line.trim()
                });
            }
        }
    }

    return occurrences;
}

function ensureMasterLocalSwitches(byName, localSwitchNames) {
    for (const name of localSwitchNames) {
        if (byName[name]) {
            continue;
        }

        byName[name] = {
            kind: "local_switch",
            occurrenceCount: 0,
            locations: []
        };
    }
}

function buildJsonReport(
    workspace,
    renEpcDir,
    files,
    occurrences,
    localSwitchNames
) {
    const byName = {};

    for (const occurrence of occurrences) {
        if (!byName[occurrence.name]) {
            byName[occurrence.name] = {
                kind: occurrence.kind,
                occurrenceCount: 0,
                locations: []
            };
        }

        byName[occurrence.name].occurrenceCount += 1;
        byName[occurrence.name].locations.push({
            stream: occurrence.stream,
            file: occurrence.file,
            fileType: occurrence.fileType,
            line: occurrence.line,
            function: occurrence.function,
            code: occurrence.code
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

    for (const filePath of files) {
        const occurrences = scanFile(filePath, localSwitchPatterns);
        allOccurrences.push(...occurrences);
    }

    const report = buildJsonReport(
        WORKSPACE,
        REN_EPC_DIRS,
        files,
        allOccurrences,
        localSwitchNames
    );

    fs.writeFileSync(
        OUTPUT_JSON,
        JSON.stringify(report, null, 4),
        "utf8"
    );

    console.log(`Occurrences found: ${allOccurrences.length}`);
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
