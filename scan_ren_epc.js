const fs = require("fs");
const path = require("path");

const WORKSPACE = process.argv[2];

if (!WORKSPACE) {
    console.error("Usage:");
    console.error("  node scan_ren_epc.js <workspace>");
    console.error("");
    console.error("Example:");
    console.error("  node scan_ren_epc.js ubasrh_KPC02530_2291_matsuri3_mp");
    process.exit(1);
}

const REN_EPC_DIRS = [
    `/data1/p4work/${WORKSPACE}/stream_reference/core_parts/subsys_PLP/platform_element/ren/ren_epc`,
    `/data1/p4work/${WORKSPACE}/stream_target/subsys_PLP/platform_element/ren/ren_epc`
];

const OUTPUT_JSON = "ren_epc_scan_result.json";

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

function findEnclosingFunction(functions, lineIndex, filePath) {
    if (filePath.endsWith(".mk") || path.basename(filePath) === "Makefile") {
        return findMakefileContext;
    }

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
``

function scanFile(filePath) {
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

        for (const patternInfo of TOKEN_PATTERNS) {
            patternInfo.regex.lastIndex = 0;

            let match;
            while ((match = patternInfo.regex.exec(line)) !== null) {
                const token = match[0];

                const functionName =
                    filePath.endsWith(".mk") || path.basename(filePath) === "Makefile"
                        ? findMakefileContext(lines, lineIndex)
                        : findEnclosingFunction(functions, lineIndex, filePath);

                occurrences.push({
                name: token,
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

function buildJsonReport(workspace, renEpcDir, files, occurrences) {
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
            file: occurrence.file,
            fileType: occurrence.fileType,
            line: occurrence.line,
            function: occurrence.function,
            code: occurrence.code
        });
    }

    const sortedNames = Object.keys(byName).sort();
    const sortedByName = {};

    for (const name of sortedNames) {
        byName[name].locations.sort((a, b) => {
            const fileCompare = a.file.localeCompare(b.file);
            if (fileCompare !== 0) {
                return fileCompare;
            }

            return a.line - b.line;
        });

        sortedByName[name] = byName[name];
    }

    return {
        generatedAt: new Date().toISOString(),
        workspace,
        renEpcDir,
        scannedFileCount: files.length,
        occurrenceCount: occurrences.length,
        uniqueNameCount: sortedNames.length,
        summary: {
            uvpCount: sortedNames.filter((name) => name.startsWith("UVP_SW_")).length,
            behaviorCount: sortedNames.filter((name) => name.startsWith("BEHAVIOR_MODE_IF_")).length
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

    console.log(`Workspace: ${WORKSPACE}`);
    console.log(`Scanning: ${REN_EPC_DIRS}`);

    const files = [];

    for (const dir of REN_EPC_DIRS) {
        files.push(...collectFiles(dir));
    }

    console.log(`Scannable files found: ${files.length}`);

    const allOccurrences = [];

    for (const filePath of files) {
        const occurrences = scanFile(filePath);
        allOccurrences.push(...occurrences);
    }

    const report = buildJsonReport(
        WORKSPACE,
        REN_EPC_DIRS,
        files,
        allOccurrences
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