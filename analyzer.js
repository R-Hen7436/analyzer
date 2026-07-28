const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

const SWITCHES_PATH = "./config/UVP.json";
const BEHAVIORS_PATH = "./config/behavior.json";
const LOCAL_SWITCHES_PATH = "./config/local_switch.json";
const PROFILE_MK_PATH = "./profile.mk";
const CODEFILES_DIR = "./codefiles";
const EXCEL_FILE_PATH = "result.xlsx";
const JSON_FILE_PATH = "result.json";

const RESULT = {
    PASS: "O",
    FAIL: "X",
    NONE: "-"
};

const FONT_NAME = "Meiryo UI";

function loadSwitches() {
    const config = JSON.parse(fs.readFileSync(SWITCHES_PATH, "utf8"));
    return config.switches;
}

/** Load behavior modes in behavior.json array order; first occurrence wins. */
function loadBehaviors() {
    if (!fs.existsSync(BEHAVIORS_PATH)) {
        return [];
    }

    const config = JSON.parse(fs.readFileSync(BEHAVIORS_PATH, "utf8"));
    const modes = config.behavior_modes || [];
    const seen = new Set();
    const ordered = [];

    for (const name of modes) {
        if (seen.has(name)) {
            continue;
        }
        seen.add(name);
        ordered.push(name);
    }

    return ordered;
}

/** Load Local Switch names in local_switch.json array order; first occurrence wins. */
function loadLocalSwitches() {
    if (!fs.existsSync(LOCAL_SWITCHES_PATH)) {
        return [];
    }

    const config = JSON.parse(fs.readFileSync(LOCAL_SWITCHES_PATH, "utf8"));
    const switches = config.LOCAL_SWITCH || [];
    const seen = new Set();
    const ordered = [];

    for (const name of switches) {
        if (seen.has(name)) {
            continue;
        }
        seen.add(name);
        ordered.push(name);
    }

    return ordered;
}

function parseProfileMk(profilePath) {
    const content = fs.readFileSync(profilePath, "utf8");
    const profile = {};

    const assignmentPattern =
        /^\s*(UVP_SW_[A-Z0-9_]+)\s*=\s*\$\(\s*(TRUE|FALSE)\s*\)/gim;

    let match;
    while ((match = assignmentPattern.exec(content)) !== null) {
        profile[match[1]] = match[2];
    }

    const ifeqTruePattern =
        /^\s*ifeq\s*\(\s*\$\(\s*(UVP_SW_[A-Z0-9_]+)\s*\)\s*,\s*\$\(\s*TRUE\s*\)\s*\)/gim;
    while ((match = ifeqTruePattern.exec(content)) !== null) {
        if (!profile[match[1]]) {
            profile[match[1]] = "TRUE";
        }
    }

    const ifeqFalsePattern =
        /^\s*ifeq\s*\(\s*\$\(\s*(UVP_SW_[A-Z0-9_]+)\s*\)\s*,\s*\$\(\s*FALSE\s*\)\s*\)/gim;
    while ((match = ifeqFalsePattern.exec(content)) !== null) {
        if (!profile[match[1]]) {
            profile[match[1]] = "FALSE";
        }
    }

    return profile;
}

function collectSourceFiles(dirPath) {
    const files = [];

    function walk(currentPath) {
        for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
            const fullPath = path.join(currentPath, entry.name);

            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (
                entry.isFile() &&
                (entry.name.endsWith(".cpp") || entry.name.endsWith(".h") || entry.name.endsWith(".mk"))
            ) {
                files.push(fullPath);
            }
        }
    }

    walk(dirPath);
    return files.sort();
}

function lineContainsExactSwitch(line, switchName) {
    const switchPattern = escapeRegExp(switchName);
    const exactSwitchPattern = new RegExp(
        `(^|[^A-Z0-9_])${switchPattern}([^A-Z0-9_]|$)`
    );

    return exactSwitchPattern.test(line.trim());
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFunctionIndex(lines) {
    const functions = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const methodMatch = line.match(/(\w+(?:::\w+)+)\s*\(/);

        if (methodMatch) {
            functions.push({ line: i, name: methodMatch[1] });
            continue;
        }

        if (i > 0) {
            const previousLine = lines[i - 1];
            const isReturnTypeLine =
                /^\s*(?:static\s+)?(?:const\s+)?(?:unsigned\s+)?(?:void|int|bool|char|long|short|float|double|size_t|BOOL)\s*$/.test(
                    previousLine
                );

            if (isReturnTypeLine) {
                const splitMethodMatch = line.match(/(\w+(?:::\w+)+)/);
                if (splitMethodMatch) {
                    functions.push({ line: i, name: splitMethodMatch[1] });
                }
            }
        }
    }

    return functions;
}

function buildImpactRows(orderedNames, summaryRows, detailRows) {
    const impactRows = [];

    for (const switchName of orderedNames) {
        const summary = summaryRows.find(
            row => row.switchName === switchName
        );

        if (!summary) {
            continue;
        }

        const occurrences = detailRows.filter(
            row => row.switchName === switchName
        );

        if (occurrences.length === 0) {
            impactRows.push({
                Name: switchName,
                "Affecting Header/Function": "Not Found",
                Result: summary.result
            });

            continue;
        }

        const uniqueImpacts = [
            ...new Set(
                occurrences.map(
                    row => `${row.file} | ${row.functionName}`
                )
            )
        ].sort();

        uniqueImpacts.forEach(impact => {
            impactRows.push({
                Name: switchName,
                "Affecting Header/Function": impact,
                Result: summary.result
            });
        });
    }

    return impactRows;
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

    return enclosingFunction ? enclosingFunction.name : "(#define)";
}

function classifyCppLocalSwitchLine(line, switchName) {
    const trimmed = line.trim();
    const switchPattern = escapeRegExp(switchName);

    if (!lineContainsExactSwitch(trimmed, switchName)) {
        return { skip: true };
    }

    if (new RegExp(`^#\\s*endif\\b.*${switchPattern}\\b`).test(trimmed)) {
        return { skip: true };
    }

    if (new RegExp(`^#\\s*ifdef\\s+${switchPattern}\\b`).test(trimmed)) {
        return {
            skip: false,
            guardType: "#ifdef"
        };
    }

    if (new RegExp(`^#\\s*ifndef\\s+${switchPattern}\\b`).test(trimmed)) {
        return {
            skip: false,
            guardType: "#ifndef"
        };
    }

    if (
        new RegExp(
            `^#\\s*if\\b.*\\bdefined\\s*\\(?\\s*${switchPattern}\\s*\\)?`
        ).test(trimmed)
    ) {
        return {
            skip: false,
            guardType: "#if defined"
        };
    }

    return {
        skip: false,
        guardType: "unguarded"
    };
}

function classifyCppSwitchLine(line, switchName) {
    const trimmed = line.trim();
    const switchPattern = escapeRegExp(switchName);

    if (!lineContainsExactSwitch(trimmed, switchName)) {
        return { skip: true };
    }

    if (new RegExp(`^#\\s*endif\\b.*${switchPattern}\\b`).test(trimmed)) {
        return { skip: true };
    }

    if (new RegExp(`^#\\s*ifdef\\s+${switchPattern}\\b`).test(trimmed)) {
        return {
            skip: false,
            guardType: "#ifdef"
        };
    }

    if (new RegExp(`^#\\s*ifndef\\s+${switchPattern}\\b`).test(trimmed)) {
        return {
            skip: false,
            guardType: "#ifndef"
        };
    }

    if (
        new RegExp(
            `^#\\s*if\\b.*\\bdefined\\s*\\(?\\s*${switchPattern}\\s*\\)?`
        ).test(trimmed)
    ) {
        return {
            skip: false,
            guardType: "#if defined"
        };
    }

    return {
        skip: false,
        guardType: "unguarded"
    };
}

function classifyMkLocalSwitchLine(line, switchName) {
    const trimmed = line.trim();
    const switchPattern = escapeRegExp(switchName);

    if (!lineContainsExactSwitch(trimmed, switchName)) {
        return { skip: true };
    }

    if (/^endif\b/i.test(trimmed)) {
        return { skip: true };
    }

    const ifeqPatterns = [
        {
            pattern: new RegExp(
                `^else\\s+ifeq\\s*\\(\\s*\\$\\(\\s*${switchPattern}\\s*\\)\\s*,\\s*\\$\\(\\s*(TRUE|FALSE)\\s*\\)\\s*\\)`,
                "i"
            ),
            guardType: "else ifeq"
        },
        {
            pattern: new RegExp(
                `^ifeq\\s*\\(\\s*\\$\\(\\s*${switchPattern}\\s*\\)\\s*,\\s*\\$\\(\\s*(TRUE|FALSE)\\s*\\)\\s*\\)`,
                "i"
            ),
            guardType: "ifeq"
        }
    ];

    for (const { pattern, guardType } of ifeqPatterns) {
        const match = trimmed.match(pattern);
        if (match) {
            return {
                skip: false,
                guardType: `${guardType} (${match[1]})`
            };
        }
    }

    return {
        skip: false,
        guardType: "makefile usage"
    };
}

function classifyMkSwitchLine(line, switchName) {
    const trimmed = line.trim();
    const switchPattern = escapeRegExp(switchName);

    if (!lineContainsExactSwitch(trimmed, switchName)) {
        return { skip: true };
    }

    if (/^endif\b/i.test(trimmed)) {
        return { skip: true };
    }

    const ifeqPatterns = [
        {
            pattern: new RegExp(
                `^else\\s+ifeq\\s*\\(\\s*\\$\\(\\s*${switchPattern}\\s*\\)\\s*,\\s*\\$\\(\\s*(TRUE|FALSE)\\s*\\)\\s*\\)`,
                "i"
            ),
            guardType: "else ifeq"
        },
        {
            pattern: new RegExp(
                `^ifeq\\s*\\(\\s*\\$\\(\\s*${switchPattern}\\s*\\)\\s*,\\s*\\$\\(\\s*(TRUE|FALSE)\\s*\\)\\s*\\)`,
                "i"
            ),
            guardType: "ifeq"
        }
    ];

    for (const { pattern, guardType } of ifeqPatterns) {
        const match = trimmed.match(pattern);
        if (match) {
            return {
                skip: false,
                guardType: `${guardType} (${match[1]})`
            };
        }
    }

    return { skip: true };
}

function findMkBlockContext(lines, lineIndex) {
    for (let index = lineIndex; index >= 0; index--) {
        const trimmed = lines[index].trim();

        if (trimmed.startsWith("#")) {
            return `(makefile / ${trimmed.replace(/^#\s*/, "")})`;
        }

        if (/^[A-Z0-9_]+\s*(\+=|=)/.test(trimmed)) {
            const variableName = trimmed.split(/\s*(?:\+=|=)/)[0].trim();
            return `(makefile / ${variableName})`;
        }
    }

    return "(makefile)";
}

function evaluateOccurrence(profileValue) {
    if (!profileValue) {
        return RESULT.FAIL;
    }

    if (profileValue === "TRUE") {
        return RESULT.PASS;
    }

    return RESULT.FAIL;
}

function evaluateLocalSwitchSummary(occurrences) {
    if (occurrences.length === 0) {
        return {
            result: RESULT.NONE,
            notes: "Local Switch not found in renEPC files"
        };
    }

    return {
        result: RESULT.PASS,
        notes: "Local Switch found in renEPC files"
    };
}

function evaluateSwitchSummary(profileValue, occurrences) {
    if (occurrences.length === 0) {
        return {
            result: RESULT.NONE,
            notes: "Switch not found in renEPC files"
        };
    }

    if (!profileValue) {
        return {
            result: RESULT.FAIL,
            notes: "Found in renEPC files but missing from profile.mk"
        };
    }

    if (profileValue === "TRUE") {
        return {
            result: RESULT.PASS,
            notes: "Enabled in profile.mk and found in renEPC files"
        };
    }

    return {
        result: RESULT.FAIL,
        notes: "Disabled in profile.mk but found in renEPC files"
    };
}

/** Map BEHAVIOR_MODE_IF_XXX ??? UVP_SW_XXX for profile.mk lookup. */
function pairedSwitchNameFromBehavior(behaviorName) {
    const prefix = "BEHAVIOR_MODE_IF_";
    if (!behaviorName.startsWith(prefix)) {
        return null;
    }
    return `UVP_SW_${behaviorName.slice(prefix.length)}`;
}

/**
 * Same O/X/- matrix as switches; profileValue is the paired UVP_SW_* value.
 */
function evaluateBehaviorSummary(profileValue, occurrences) {
    if (occurrences.length === 0) {
        return {
            result: RESULT.NONE,
            notes: "Behavior not found in renEPC files"
        };
    }

    if (!profileValue) {
        return {
            result: RESULT.FAIL,
            notes: "Found in renEPC files but paired switch missing from profile.mk"
        };
    }

    if (profileValue === "TRUE") {
        return {
            result: RESULT.PASS,
            notes: "Enabled in profile.mk (paired switch) and found in renEPC files"
        };
    }

    return {
        result: RESULT.FAIL,
        notes: "Disabled in profile.mk (paired switch) but found in renEPC files"
    };
}

function classifyCppBehaviorLine(line, behaviorName) {
    const trimmed = line.trim();

    if (!lineContainsExactSwitch(trimmed, behaviorName)) {
        return { skip: true };
    }

    return {
        skip: false,
        guardType: "runtime if"
    };
}

function buildBehaviorOccurrence({
    switchName,
    profileValue,
    file,
    line,
    functionName,
    guardType,
    code
}) {
    return {
        switchName,
        profileValue: profileValue || "NOT_FOUND",
        file,
        line,
        functionName,
        guardType,
        code,
        result: evaluateOccurrence(profileValue)
    };
}

function scanCppFileForLocalSwitch(filePath, switchName) {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    const relativeFilePath = path.relative(CODEFILES_DIR, filePath);
    const functions = buildFunctionIndex(lines);
    const occurrences = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const classification = classifyCppLocalSwitchLine(
            lines[lineIndex],
            switchName
        );

        if (classification.skip) {
            continue;
        }

        occurrences.push(
            buildLocalSwitchOccurrence({
                switchName,
                file: relativeFilePath,
                line: lineIndex + 1,
                functionName: findEnclosingFunction(functions, lineIndex),
                guardType: classification.guardType,
                code: lines[lineIndex].trim()
            })
        );
    }

    return occurrences;
}

function scanMkFileForLocalSwitch(filePath, switchName) {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    const relativeFilePath = path.relative(CODEFILES_DIR, filePath);
    const occurrences = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const classification = classifyMkLocalSwitchLine(
            lines[lineIndex],
            switchName
        );

        if (classification.skip) {
            continue;
        }

        occurrences.push(
            buildLocalSwitchOccurrence({
                switchName,
                file: relativeFilePath,
                line: lineIndex + 1,
                functionName: findMkBlockContext(lines, lineIndex),
                guardType: classification.guardType,
                code: lines[lineIndex].trim()
            })
        );
    }

    return occurrences;
}

function scanSourceFileForLocalSwitch(filePath, switchName) {
    if (filePath.endsWith(".mk")) {
        return scanMkFileForLocalSwitch(filePath, switchName);
    }

    return scanCppFileForLocalSwitch(filePath, switchName);
}

function scanCppFileForBehavior(filePath, behaviorName, profileValue) {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    const relativeFilePath = path.relative(CODEFILES_DIR, filePath);
    const functions = buildFunctionIndex(lines);
    const occurrences = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const classification = classifyCppBehaviorLine(
            lines[lineIndex],
            behaviorName
        );

        if (classification.skip) {
            continue;
        }

        occurrences.push(
            buildBehaviorOccurrence({
                switchName: behaviorName,
                profileValue,
                file: relativeFilePath,
                line: lineIndex + 1,
                functionName: findEnclosingFunction(functions, lineIndex),
                guardType: classification.guardType,
                code: lines[lineIndex].trim()
            })
        );
    }

    return occurrences;
}

function analyzeBehaviors(masterBehaviors, profileValues, sourceFiles) {
    const detailRows = [];
    const summaryRows = [];
    const sourceCodeFiles = sourceFiles.filter(
    (filePath) =>
        filePath.endsWith(".cpp") ||
        filePath.endsWith(".h")
);

    for (const behaviorName of masterBehaviors) {
        const pairedSwitch = pairedSwitchNameFromBehavior(behaviorName);
        const profileValue = pairedSwitch
            ? profileValues[pairedSwitch] || null
            : null;
        const behaviorOccurrences = [];

        for (const filePath of sourceCodeFiles) {
            behaviorOccurrences.push(
                ...scanCppFileForBehavior(
                    filePath,
                    behaviorName,
                    profileValue
                )
            );
        }

        detailRows.push(...behaviorOccurrences);

        const summary = evaluateBehaviorSummary(
            profileValue,
            behaviorOccurrences
        );
        const uniqueFunctions = [
            ...new Set(behaviorOccurrences.map((row) => row.functionName))
        ].sort();

        summaryRows.push({
            kind: "behavior",
            switchName: behaviorName,
            profileValue: profileValue || "NOT_FOUND",
            occurrenceCount: behaviorOccurrences.length,
            functions: uniqueFunctions,
            result: summary.result,
            notes: summary.notes
        });
    }

    return { summaryRows, detailRows };
}

function buildLocalSwitchOccurrence({
    switchName,
    file,
    line,
    functionName,
    guardType,
    code
}) {
    return {
        switchName,
        profileValue: "N/A",
        file,
        line,
        functionName,
        guardType,
        code,
        result: RESULT.PASS
    };
}

function buildOccurrence({
    switchName,
    profileValue,
    file,
    line,
    functionName,
    guardType,
    code
}) {
    return {
        switchName,
        profileValue: profileValue || "NOT_FOUND",
        file,
        line,
        functionName,
        guardType,
        code,
        result: evaluateOccurrence(profileValue)
    };
}

function scanCppFile(filePath, switchName, profileValue) {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    const relativeFilePath = path.relative(CODEFILES_DIR, filePath);
    const functions = buildFunctionIndex(lines);
    const occurrences = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const classification = classifyCppSwitchLine(lines[lineIndex], switchName);

        if (classification.skip) {
            continue;
        }

        occurrences.push(
            buildOccurrence({
                switchName,
                profileValue,
                file: relativeFilePath,
                line: lineIndex + 1,
                functionName: findEnclosingFunction(functions, lineIndex),
                guardType: classification.guardType,
                code: lines[lineIndex].trim()
            })
        );
    }

    return occurrences;
}

function scanMkFile(filePath, switchName, profileValue) {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    const relativeFilePath = path.relative(CODEFILES_DIR, filePath);
    const occurrences = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const classification = classifyMkSwitchLine(lines[lineIndex], switchName);

        if (classification.skip) {
            continue;
        }

        occurrences.push(
            buildOccurrence({
                switchName,
                profileValue,
                file: relativeFilePath,
                line: lineIndex + 1,
                functionName: findMkBlockContext(lines, lineIndex),
                guardType: classification.guardType,
                code: lines[lineIndex].trim()
            })
        );
    }

    return occurrences;
}

function scanSourceFile(filePath, switchName, profileValue) {
    if (filePath.endsWith(".mk")) {
        return scanMkFile(filePath, switchName, profileValue);
    }

    return scanCppFile(filePath, switchName, profileValue);
}

function analyzeLocalSwitches(masterLocalSwitches, sourceFiles) {
    const detailRows = [];
    const summaryRows = [];

    for (const switchName of masterLocalSwitches) {
        const localOccurrences = [];

        for (const filePath of sourceFiles) {
            localOccurrences.push(
                ...scanSourceFileForLocalSwitch(filePath, switchName)
            );
        }

        detailRows.push(...localOccurrences);

        const summary = evaluateLocalSwitchSummary(localOccurrences);
        const uniqueFunctions = [
            ...new Set(localOccurrences.map((row) => row.functionName))
        ].sort();

        summaryRows.push({
            kind: "local_switch",
            switchName,
            profileValue: "N/A",
            occurrenceCount: localOccurrences.length,
            functions: uniqueFunctions,
            result: summary.result,
            notes: summary.notes
        });
    }

    return { summaryRows, detailRows };
}

function analyzeSwitches(masterSwitches, profileValues, sourceFiles) {
    const detailRows = [];
    const summaryRows = [];
    const profileSwitchNames = Object.keys(profileValues);

    for (const switchName of masterSwitches) {
        const profileValue = profileValues[switchName] || null;
        const switchOccurrences = [];

        for (const filePath of sourceFiles) {
            switchOccurrences.push(
                ...scanSourceFile(filePath, switchName, profileValue)
            );
        }

        detailRows.push(...switchOccurrences);

        const summary = evaluateSwitchSummary(profileValue, switchOccurrences);

        const uniqueFunctions = [
            ...new Set(switchOccurrences.map((row) => row.functionName))
        ].sort();

        summaryRows.push({
            kind: "switch",
            switchName,
            profileValue: profileValue || "NOT_FOUND",
            occurrenceCount: switchOccurrences.length,
            functions: uniqueFunctions,
            result: summary.result,
            notes: summary.notes
        });
    }

    for (const switchName of profileSwitchNames) {
        if (!masterSwitches.includes(switchName)) {
            summaryRows.push({
                kind: "switch",
                switchName,
                profileValue: profileValues[switchName],
                occurrenceCount: 0,
                functions: [],
                result: RESULT.NONE,
                notes: "Defined in profile.mk but missing from UVP.json"
            });
        }
    }

    // Keep master entries in UVP.json order; profile-only extras stay
    // appended after those rows. Do not alphabetically re-sort.
    return { summaryRows, detailRows };
}

/**
 * Summary sheet order: orderedNames (UVP.json then behavior.json),
 * then profile-only extras that are not in that master list.
 */
function orderSummaryRowsForExcel(orderedNames, summaryRows) {
    const byName = new Map(
        summaryRows.map((row) => [row.switchName, row])
    );
    const ordered = [];
    const included = new Set();

    for (const name of orderedNames) {
        const row = byName.get(name);
        if (!row) {
            continue;
        }
        ordered.push(row);
        included.add(name);
    }

    for (const row of summaryRows) {
        if (!included.has(row.switchName)) {
            ordered.push(row);
        }
    }

    return ordered;
}

function expandSummaryRowsForExcel(summaryRows) {
    const expandedRows = [];

    for (const row of summaryRows) {
        const functionList =
            row.functions.length > 0 ? row.functions : [""];

        functionList.forEach((functionName, index) => {
            expandedRows.push({
                Switch: index === 0 ? row.switchName : "",
                Profile: index === 0 ? (row.profileValue ?? "") : "",
                Occurrences: index === 0 ? row.occurrenceCount : "",
                Function: functionName,
                Result: index === 0 ? row.result : "",
                Notes: index === 0 ? row.notes : ""
            });
        });
    }

    return expandedRows;
}

function applyHeaderStyle(cell) {
    cell.font = { bold: true, name: FONT_NAME, size: 11 };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFD9E1F2" }
    };
}

function applyBodyStyle(cell, isResultColumn) {
    cell.font = { name: FONT_NAME, size: 10 };
    cell.alignment = {
        horizontal: isResultColumn ? "center" : "left",
        vertical: "middle",
        wrapText: true
    };
}

function writeJsonReport(orderedNames, summaryRows, detailRows) {
    const jsonData = {
        generatedAt: new Date().toISOString(),
        switches: {}
    };

    // Object key insertion order is the official emit order.
    for (const switchName of orderedNames) {
        const summary = summaryRows.find(
            row => row.switchName === switchName
        );

        if (!summary) {
            continue;
        }

        const kind = summary.kind || "switch";
        const profile = summary.profileValue ?? null;
        const occurrences = detailRows.filter(
            row => row.switchName === switchName
        );

        if (occurrences.length === 0) {
            jsonData.switches[switchName] = {
                kind,
                profile,
                result: summary.result,
                occurrenceCount: summary.occurrenceCount,
                impacts: [
                    {
                        file: "Not Found",
                        function: ""
                    }
                ]
            };

            continue;
        }

        const uniqueImpacts = [
            ...new Map(
                occurrences.map(row => [
                    `${row.file} | ${row.functionName}`,
                    {
                        file: row.file,
                        function: row.functionName
                    }
                ])
            ).values()
        ].sort((a, b) =>
            `${a.file} | ${a.function}`.localeCompare(
                `${b.file} | ${b.function}`
            )
        );

        jsonData.switches[switchName] = {
            kind,
            profile,
            result: summary.result,
            occurrenceCount: summary.occurrenceCount,
            impacts: uniqueImpacts
        };
    }

    fs.writeFileSync(
        JSON_FILE_PATH,
        JSON.stringify(jsonData, null, 4),
        "utf8"
    );
}

function writeSheetRows(worksheet, headers, rows, resultColumnIndex) {
    headers.forEach((header, index) => {
        const cell = worksheet.getCell(1, index + 1);
        cell.value = header;
        applyHeaderStyle(cell);
    });

    rows.forEach((row, rowIndex) => {
        headers.forEach((header, columnIndex) => {
            const cell = worksheet.getCell(rowIndex + 2, columnIndex + 1);
            cell.value = row[header];
            applyBodyStyle(
                cell,
                columnIndex + 1 === resultColumnIndex
            );
        });
    });

    worksheet.columns = headers.map((header) => ({
        key: header,
        width: Math.max(header.length + 2, 16)
    }));

    if (headers.includes("Affecting Header/Function")) 
        {worksheet.getColumn( headers.indexOf("Affecting Header/Function") + 1 ).width = 80;
 }

    if (headers.includes("Code")) {
        worksheet.getColumn(headers.indexOf("Code") + 1).width = 48;
    }
    if (headers.includes("Notes")) {
        worksheet.getColumn(headers.indexOf("Notes") + 1).width = 42;
    }
    if (headers.includes("Function")) {
        worksheet.getColumn(headers.indexOf("Function") + 1).width = 48;
    }
    if (headers.includes("Name")) {
    worksheet.getColumn( headers.indexOf("Name") + 1 ).width = 40;
}
}

async function writeExcelReport(summaryRows, detailRows, orderedNames) {
    const workbook = new ExcelJS.Workbook();

    if (fs.existsSync(EXCEL_FILE_PATH)) {
        await workbook.xlsx.readFile(EXCEL_FILE_PATH);
    }

    const summarySheet =
        workbook.getWorksheet("Summary") || workbook.addWorksheet("Summary");
    const detailSheet =
        workbook.getWorksheet("Detail") || workbook.addWorksheet("Detail");
    const impactSheet =
        workbook.getWorksheet("Impact") || workbook.addWorksheet("Impact");

    summarySheet.spliceRows(1, summarySheet.rowCount);
    detailSheet.spliceRows(1, detailSheet.rowCount);
    impactSheet.spliceRows(1, impactSheet.rowCount);

    const impactRows = buildImpactRows(
        orderedNames,
        summaryRows,
        detailRows
    );

    const summaryHeaders = [
        "Switch",
        "Profile",
        "Occurrences",
        "Function",
        "Result",
        "Notes"
    ];
    const detailHeaders = [
        "Switch",
        "Profile",
        "File",
        "Line",
        "Function",
        "Guard Type",
        "Result",
        "Code"
    ];

    const impactHeaders = [
        "Name",
        "Affecting Header/Function",
        "Result"
    ];

    const formattedSummaryRows = expandSummaryRowsForExcel(
        orderSummaryRowsForExcel(orderedNames, summaryRows)
    );

    const formattedDetailRows = detailRows.map((row) => ({
        Switch: row.switchName,
        Profile: row.profileValue,
        File: row.file,
        Line: row.line,
        Function: row.functionName,
        "Guard Type": row.guardType,
        Result: row.result,
        Code: row.code
    }));

    writeSheetRows(summarySheet, summaryHeaders, formattedSummaryRows, 5);
    writeSheetRows(detailSheet, detailHeaders, formattedDetailRows, 7);

    writeSheetRows(
        impactSheet, impactHeaders, impactRows, 3
    );

    workbook.views = [{ activeTab: summarySheet.id - 1 }];

    await workbook.xlsx.writeFile(EXCEL_FILE_PATH);
}

function printConsoleSummary(summaryRows) {
    const totals = summaryRows.reduce(
        (acc, row) => {
            acc[row.result] = (acc[row.result] || 0) + 1;
            return acc;
        },
        {}
    );

    console.log(`Analyzed ${summaryRows.length} switches/behaviors/Local Switches`);
    console.log(
        `Results: O=${totals[RESULT.PASS] || 0}, X=${totals[RESULT.FAIL] || 0}, -=${totals[RESULT.NONE] || 0}`
    );
    console.log(`Report written to ${EXCEL_FILE_PATH} and ${JSON_FILE_PATH}`);
}

async function main() {
    if (!fs.existsSync(SWITCHES_PATH)) {
        throw new Error(`Switch list not found: ${SWITCHES_PATH}`);
    }

    if (!fs.existsSync(PROFILE_MK_PATH)) {
        throw new Error(`Profile file not found: ${PROFILE_MK_PATH}`);
    }

    if (!fs.existsSync(CODEFILES_DIR)) {
        throw new Error(`Code directory not found: ${CODEFILES_DIR}`);
    }

    const masterSwitches = loadSwitches();
    const masterBehaviors = loadBehaviors();
    const masterLocalSwitches = loadLocalSwitches();
    // Official order for JSON + Excel Impact/Summary masters.
    const orderedNames = [...masterSwitches, ...masterBehaviors, ...masterLocalSwitches];
    const profileValues = parseProfileMk(PROFILE_MK_PATH);
    const sourceFiles = collectSourceFiles(CODEFILES_DIR);

    if (sourceFiles.length === 0) {
        throw new Error(`No .cpp, .h or .mk files found in ${CODEFILES_DIR}`);
    }

    const { summaryRows: switchSummaryRows, detailRows: switchDetailRows } =
    analyzeSwitches(masterSwitches, profileValues, sourceFiles);

    const { summaryRows: behaviorSummaryRows, detailRows: behaviorDetailRows } =
        analyzeBehaviors(masterBehaviors, profileValues, sourceFiles);

    const { summaryRows: localSummaryRows, detailRows: localDetailRows } =
        analyzeLocalSwitches(masterLocalSwitches, sourceFiles);

    const summaryRows = [
        ...switchSummaryRows,
        ...behaviorSummaryRows,
        ...localSummaryRows
    ];

    const detailRows = [
        ...switchDetailRows,
        ...behaviorDetailRows,
        ...localDetailRows
    ];

    await writeExcelReport(summaryRows, detailRows, orderedNames);
    writeJsonReport(orderedNames, summaryRows, detailRows);

    printConsoleSummary(summaryRows);
}

module.exports = { main };

if (require.main === module) {
    main().catch((error) => {
        console.error("Error:", error.message);
        process.exitCode = 1;
    });
}