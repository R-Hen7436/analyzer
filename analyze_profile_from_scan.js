const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const { getRunPaths, ensureRunDirs } = require("./output_paths");

const WORKSPACE = process.argv[2];
const PROFILE_INPUT = process.argv[3];

const RESULT = {
    PASS: "O",
    FAIL: "X",
    NONE: "-"
};

const FONT_NAME = "Meiryo UI";

if (!WORKSPACE || !PROFILE_INPUT) {
    console.error("Usage:");
    console.error("  node analyze_profile_from_scan.js <workspace> <profile>");
    console.error("");
    console.error("Example:");
    console.error("  node analyze_profile_from_scan.js ubasrh_KPC02530_2291_matsuri3_mp C2WC_prd_profile");
    console.error("");
    console.error("Note:");
    console.error("  You can pass profile with or without .mk");
    process.exit(1);
}

const RUN_PATHS = ensureRunDirs(getRunPaths(WORKSPACE, PROFILE_INPUT));

const SCAN_JSON_PATH = RUN_PATHS.scanJson;
const RESULT_JSON_PATH = RUN_PATHS.resultJson;
const RESULT_XLSX_PATH = RUN_PATHS.resultXlsx;

const PROFILE_FILE_NAME = PROFILE_INPUT.endsWith(".mk")
    ? PROFILE_INPUT
    : `${PROFILE_INPUT}.mk`;

// Original work-laptop profile path (restore when using real p4work):
// const PROFILE_DIR =
//     `/data1/p4work/${WORKSPACE}/stream_target/subsys_PLP/build/profiles`;
// const PROFILE_MK_PATH =
//     path.join(PROFILE_DIR, PROFILE_FILE_NAME);

// Local dummy profile for testing without work laptop:
const PROFILE_MK_PATH = path.join(__dirname, "dummy_profile.mk");

function normalizeProfileValue(value) {
    if (!value) {
        return null;
    }

    const upper = String(value).trim().toUpperCase();

    if (upper === "TRUE") {
        return "TRUE";
    }

    if (upper === "FALSE") {
        return "FALSE";
    }

    return null;
}

function parseProfileMk(profilePath) {
    const content = fs.readFileSync(profilePath, "utf8");
    const profile = {};

    /*
     * Matches:
     *   UVP_SW_XXX = $(TRUE)
     *   UVP_SW_XXX=$(FALSE)
     *   UVP_SW_XXX = TRUE
     *   UVP_SW_XXX = FALSE
     */
    const assignmentPattern =
        /^\s*(UVP_SW_[A-Z0-9_]+)\s*=\s*(?:\$\(\s*)?(TRUE|FALSE)(?:\s*\))?/gim;

    let match;
    while ((match = assignmentPattern.exec(content)) !== null) {
        profile[match[1]] = normalizeProfileValue(match[2]);
    }

    /*
     * Matches:
     *   ifeq ($(UVP_SW_XXX),$(TRUE))
     *   ifeq ($(UVP_SW_XXX), TRUE)
     */
    const ifeqPattern =
        /^\s*ifeq\s*\(\s*\$?\(?\s*(UVP_SW_[A-Z0-9_]+)\s*\)?\s*,\s*\$?\(?\s*(TRUE|FALSE)\s*\)?\s*\)/gim;

    while ((match = ifeqPattern.exec(content)) !== null) {
        if (!profile[match[1]]) {
            profile[match[1]] = normalizeProfileValue(match[2]);
        }
    }

    return profile;
}

function loadScanResult(scanJsonPath) {
    if (!fs.existsSync(scanJsonPath)) {
        throw new Error(`Scan result not found: ${scanJsonPath}`);
    }

    const data = JSON.parse(fs.readFileSync(scanJsonPath, "utf8"));

    if (!data.switches || typeof data.switches !== "object") {
        throw new Error("Invalid scan JSON: missing switches object");
    }

    return data;
}

function pairedSwitchNameFromBehavior(behaviorName) {
    const prefix = "BEHAVIOR_MODE_IF_";

    if (!behaviorName.startsWith(prefix)) {
        return null;
    }

    return `UVP_SW_${behaviorName.slice(prefix.length)}`;
}

function getProfileValueForName(name, kind, profileValues) {
    if (kind === "local_switch") {
        return null;
    }

    if (kind === "behavior") {
        const pairedSwitch = pairedSwitchNameFromBehavior(name);

        if (!pairedSwitch) {
            return null;
        }

        return profileValues[pairedSwitch] || null;
    }

    return profileValues[name] || null;
}

function formatProfileDisplay(kind, profileValue) {
    if (kind === "local_switch") {
        return "N/A";
    }

    return profileValue || "NOT_FOUND";
}

function evaluateResult(kind, profileValue, occurrenceCount) {
    if (kind === "local_switch") {
        return occurrenceCount > 0 ? RESULT.PASS : RESULT.NONE;
    }

    if (!occurrenceCount || occurrenceCount === 0) {
        return RESULT.NONE;
    }

    if (profileValue === "TRUE") {
        return RESULT.PASS;
    }

    return RESULT.FAIL;
}

function buildNotes(kind, profileValue, occurrenceCount) {
    if (kind === "local_switch") {
        if (!occurrenceCount || occurrenceCount === 0) {
            return "Local Switch not found in renEPC files";
        }

        return "Local Switch found in renEPC files";
    }

    if (!occurrenceCount || occurrenceCount === 0) {
        if (kind === "behavior") {
            return "Behavior not found in ren_epc scan result";
        }

        return "Switch not found in ren_epc scan result";
    }

    if (kind === "behavior") {
        if (profileValue === "TRUE") {
            return "Behavior found in ren_epc and paired UVP switch is TRUE in profile";
        }

        if (profileValue === "FALSE") {
            return "Behavior found in ren_epc but paired UVP switch is FALSE in profile";
        }

        return "Behavior found in ren_epc but paired UVP switch is missing from profile";
    }

    if (profileValue === "TRUE") {
        return "Switch found in ren_epc and TRUE in profile";
    }

    if (profileValue === "FALSE") {
        return "Switch found in ren_epc but FALSE in profile";
    }

    return "Switch found in ren_epc but missing from profile";
}

function normalizeImpactFunction(functionName) {
    const text = String(functionName || "").trim();

    if (!text) {
        return "";
    }

    if (
        text === "(file-scope)" ||
        text.startsWith("(makefile")
    ) {
        return "(file-scope)";
    }

    return text;
}

function buildUniqueImpacts(locations, blocks) {
    const impacts = [];
    const seen = new Set();

    function addImpact(file, fn, relation) {
        const normalizedFunction =
            !fn || fn === "(file-scope)"
                ? "(file-scope)"
                : fn;

        const key = `${file}|${normalizedFunction}`;

        if (seen.has(key)) {
            return;
        }

        seen.add(key);

        impacts.push({
            file,
            function: normalizedFunction,
            relation
        });
    }

    // Build impacts from blocks
    for (const block of blocks || []) {
        if (!block.functions || block.functions.length === 0) {
            addImpact(
                block.file || "",
                "(file-scope)",
                block.relation || ""
            );

            continue;
        }

        for (const fn of block.functions) {
            addImpact(
                block.file || "",
                fn,
                block.relation || ""
            );
        }
    }

    // Build impacts from locations
        for (const location of locations || []) {
            const normalizedFn = normalizeImpactFunction(location.function);

            if (!normalizedFn) {
                continue;
            }

            // Skip file-scope occurrence when a real function
            // impact already exists in the same file.
            if (normalizedFn === "(file-scope)") {
                const hasFunctionImpact = impacts.some(
                    impact =>
                        impact.file === (location.file || "") &&
                        impact.function !== "(file-scope)"
                );

                if (hasFunctionImpact) {
                    continue;
                }
            }

            addImpact(
                location.file || "",
                normalizedFn,
                "occurrence"
            );
        }

    if (impacts.length === 0) {
        return [
            {
                file: "Not Found",
                function: ""
            }
        ];
    }

    return impacts.sort((a, b) =>
        `${a.file}|${a.function}`.localeCompare(
            `${b.file}|${b.function}`
        )
    );
}

function collectFunctionsFromScanEntry(scanEntry) {
    const blocks = scanEntry.blocks || [];
    const fromBlocks = [];

    for (const block of blocks) {
        for (const functionName of block.functions || []) {
            if (functionName) {
                fromBlocks.push(functionName);
            }
        }
    }

    if (fromBlocks.length > 0) {
        return [...new Set(fromBlocks)].sort();
    }

    const locations = scanEntry.locations || [];

    return [
        ...new Set(locations.map((location) => location.function || ""))
    ]
        .filter(Boolean)
        .sort();
}

function buildImpactRowsForName(name, result, impacts) {
    if (
        impacts.length === 0 ||
        (impacts.length === 1 && impacts[0].file === "Not Found")
    ) {
        return [
            {
                Name: name,
                "Affecting Header/Function": "Not Found",
                Result: result
            }
        ];
    }

    return impacts.map((impact) => ({
        Name: name,
        "Affecting Header/Function": `${impact.file} | ${impact.function}`,
        Result: result
    }));
}

function buildRows(scanResult, profileValues) {
    const summaryRows = [];
    const detailRows = [];
    const impactRows = [];
    const resultSwitches = {};

    const scanSwitches = scanResult.switches;
    const namesFromScan = Object.keys(scanSwitches).sort();

    for (const name of namesFromScan) {
        const scanEntry = scanSwitches[name];
        const kind = scanEntry.kind || (
            name.startsWith("BEHAVIOR_MODE_IF_")
                ? "behavior"
                : name.startsWith("UVP_SW_")
                    ? "uvp"
                    : "local_switch"
        );

        const locations = scanEntry.locations || [];
        const blocks = scanEntry.blocks || [];
        const profileValue = getProfileValueForName(name, kind, profileValues);
        const profileDisplay = formatProfileDisplay(kind, profileValue);
        const result = evaluateResult(kind, profileValue, locations.length);
        const notes = buildNotes(kind, profileValue, locations.length);

        const functions = collectFunctionsFromScanEntry(scanEntry);

        summaryRows.push({
            kind,
            name,
            profile: profileDisplay,
            occurrenceCount: locations.length,
            functions,
            result,
            notes
        });

        for (const location of locations) {
            detailRows.push({
                kind,
                name,
                profile: profileDisplay,
                stream: location.stream || "",
                file: location.file || "",
                fileType: location.fileType || "",
                line: location.line || "",
                functionName: location.function || "",
                role: location.role || "",
                result,
                code: location.code || ""
            });
        }

        const impacts = buildUniqueImpacts(locations, blocks);

        impactRows.push(...buildImpactRowsForName(name, result, impacts));

        resultSwitches[name] = {
            kind,
            profile: profileDisplay,
            result,
            occurrenceCount: locations.length,
            blocks,
            impacts
        };
    }

    /*
     * Add profile switches that were not found in scan result.
     * These are useful because profile may define UVP_SW_XXX
     * even if ren_epc does not contain it.
     */
    for (const profileName of Object.keys(profileValues).sort()) {
        if (resultSwitches[profileName]) {
            continue;
        }

        const profileValue = profileValues[profileName];
        const impacts = buildUniqueImpacts([]);

        summaryRows.push({
            kind: "uvp",
            name: profileName,
            profile: profileValue || "NOT_FOUND",
            occurrenceCount: 0,
            functions: [],
            result: RESULT.NONE,
            notes: "Defined in profile but not found in ren_epc scan result"
        });

        impactRows.push(
            ...buildImpactRowsForName(profileName, RESULT.NONE, impacts)
        );

        resultSwitches[profileName] = {
            kind: "uvp",
            profile: profileValue || "NOT_FOUND",
            result: RESULT.NONE,
            occurrenceCount: 0,
            impacts
        };
    }

    return {
        summaryRows,
        detailRows,
        impactRows,
        resultSwitches
    };
}

function expandSummaryRows(summaryRows) {
    const rows = [];

    for (const row of summaryRows) {
        const functions = row.functions.length > 0
            ? row.functions
            : [""];

        functions.forEach((functionName, index) => {
            rows.push({
                Kind: index === 0 ? row.kind : "",
                Name: index === 0 ? row.name : "",
                Profile: index === 0 ? row.profile : "",
                Occurrences: index === 0 ? row.occurrenceCount : "",
                Function: functionName,
                Result: index === 0 ? row.result : "",
                Notes: index === 0 ? row.notes : ""
            });
        });
    }

    return rows;
}

function applyHeaderStyle(cell) {
    cell.font = {
        bold: true,
        name: FONT_NAME,
        size: 11
    };

    cell.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true
    };

    cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: {
            argb: "FFD9E1F2"
        }
    };
}

function applyBodyStyle(cell, isResultColumn) {
    cell.font = {
        name: FONT_NAME,
        size: 10
    };

    cell.alignment = {
        horizontal: isResultColumn ? "center" : "left",
        vertical: "top",
        wrapText: true
    };
}

function writeSheetRows(worksheet, headers, rows, resultColumnName) {
    headers.forEach((header, index) => {
        const cell = worksheet.getCell(1, index + 1);
        cell.value = header;
        applyHeaderStyle(cell);
    });

    rows.forEach((row, rowIndex) => {
        headers.forEach((header, columnIndex) => {
            const cell = worksheet.getCell(rowIndex + 2, columnIndex + 1);
            cell.value = row[header];
            applyBodyStyle(cell, header === resultColumnName);
        });
    });

    worksheet.columns = headers.map((header) => ({
        key: header,
        width: Math.max(header.length + 2, 16)
    }));

    const widthMap = {
        Name: 42,
        File: 60,
        Function: 48,
        Code: 80,
        Notes: 60,
        Stream: 16,
        "File Type": 14,
        "Affecting Header/Function": 80
    };

    for (const [header, width] of Object.entries(widthMap)) {
        if (headers.includes(header)) {
            worksheet.getColumn(headers.indexOf(header) + 1).width = width;
        }
    }

    worksheet.views = [
        {
            state: "frozen",
            ySplit: 1
        }
    ];
}

async function writeExcelReport(summaryRows, detailRows, impactRows) {
    const workbook = new ExcelJS.Workbook();

    const summarySheet = workbook.addWorksheet("Summary");
    const detailSheet = workbook.addWorksheet("Detail");
    const impactSheet = workbook.addWorksheet("Impact");

    const summaryHeaders = [
        "Kind",
        "Name",
        "Profile",
        "Occurrences",
        "Function",
        "Result",
        "Notes"
    ];

    const detailHeaders = [
        "Kind",
        "Name",
        "Profile",
        "Stream",
        "File",
        "File Type",
        "Line",
        "Function",
        "Result",
        "Code"
    ];

    const impactHeaders = [
        "Name",
        "Affecting Header/Function",
        "Result"
    ];

    writeSheetRows(
        summarySheet,
        summaryHeaders,
        expandSummaryRows(summaryRows),
        "Result"
    );

    writeSheetRows(
        detailSheet,
        detailHeaders,
        detailRows.map((row) => ({
            Kind: row.kind,
            Name: row.name,
            Profile: row.profile,
            Stream: row.stream,
            File: row.file,
            "File Type": row.fileType,
            Line: row.line,
            Function: row.functionName,
            Result: row.result,
            Code: row.code
        })),
        "Result"
    );

    writeSheetRows(
        impactSheet,
        impactHeaders,
        impactRows,
        "Result"
    );

    workbook.views = [
        {
            activeTab: 0
        }
    ];

    await workbook.xlsx.writeFile(RESULT_XLSX_PATH);
}

function writeJsonReport(scanResult, profileValues, resultSwitches) {
    const jsonData = {
        generatedAt: new Date().toISOString(),
        workspace: WORKSPACE,
        profileFile: PROFILE_FILE_NAME,
        profilePath: PROFILE_MK_PATH,
        scanJsonPath: SCAN_JSON_PATH,
        scanGeneratedAt: scanResult.generatedAt || "",
        summary: {
            scanUniqueNameCount: scanResult.uniqueNameCount || 0,
            profileSwitchCount: Object.keys(profileValues).length,
            resultSwitchCount: Object.keys(resultSwitches).length,
            pass: Object.values(resultSwitches).filter((entry) => entry.result === RESULT.PASS).length,
            fail: Object.values(resultSwitches).filter((entry) => entry.result === RESULT.FAIL).length,
            none: Object.values(resultSwitches).filter((entry) => entry.result === RESULT.NONE).length
        },
        switches: resultSwitches
    };

    fs.writeFileSync(
        RESULT_JSON_PATH,
        JSON.stringify(jsonData, null, 4),
        "utf8"
    );
}

async function main() {
    if (!fs.existsSync(PROFILE_MK_PATH)) {
        throw new Error(`Profile file not found: ${PROFILE_MK_PATH}`);
    }

    const scanResult = loadScanResult(SCAN_JSON_PATH);
    const profileValues = parseProfileMk(PROFILE_MK_PATH);

    const {
        summaryRows,
        detailRows,
        impactRows,
        resultSwitches
    } = buildRows(scanResult, profileValues);

    await writeExcelReport(summaryRows, detailRows, impactRows);
    writeJsonReport(scanResult, profileValues, resultSwitches);

    const pass = summaryRows.filter((row) => row.result === RESULT.PASS).length;
    const fail = summaryRows.filter((row) => row.result === RESULT.FAIL).length;
    const none = summaryRows.filter((row) => row.result === RESULT.NONE).length;

    console.log(`Workspace: ${WORKSPACE}`);
    console.log(`Profile: ${PROFILE_FILE_NAME}`);
    console.log(`Profile path: ${PROFILE_MK_PATH}`);
    console.log(`Output dir: ${RUN_PATHS.analyzeDir}`);
    console.log(`Scan JSON: ${SCAN_JSON_PATH}`);
    console.log(`Analyzed names: ${summaryRows.length}`);
    console.log(`Results: O=${pass}, X=${fail}, -=${none}`);
    console.log(`Wrote: ${RESULT_JSON_PATH}`);
    console.log(`Wrote: ${RESULT_XLSX_PATH}`);
}

if (require.main === module) {
    main().catch((error) => {
        console.error("Error:", error.message);
        process.exitCode = 1;
    });
}