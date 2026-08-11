const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const JSZip = require("jszip");
const { getRunPaths, ensureRunDirs } = require("./output_paths");

const WORKSPACE = process.argv[2];
const PROFILE_INPUT = process.argv[3];
const MODULE_INPUT = process.argv[4] || "all";

const VALID_MODULES = ["ren_epc", "dvu_ai", "dvc_ai", "all"];

if (!WORKSPACE || !PROFILE_INPUT) {
    console.error("Usage:");
    console.error(
        "  node excel_mapper.js <workspace> <profile> [ren_epc|dvu_ai|dvc_ai|all]"
    );
    console.error("");
    console.error("Example:");
    console.error(
        "  node excel_mapper.js ubasrh_KPC02530_2291_matsuri3_mp C2YC_uvp_profile"
    );
    console.error(
        "  node excel_mapper.js ubasrh_KPC02530_2291_matsuri3_mp C2YC_uvp_profile dvu_ai"
    );
    process.exit(1);
}

if (!VALID_MODULES.includes(MODULE_INPUT)) {
    console.error(
        `Invalid module "${MODULE_INPUT}". Expected one of: ${VALID_MODULES.join(", ")}`
    );
    process.exit(1);
}

const RUN_PATHS = ensureRunDirs(getRunPaths(WORKSPACE, PROFILE_INPUT));

const MAP_MODULES = {
    ren_epc: {
        id: "ren_epc",
        label: "renEPC",
        documentName: "renEPC_change_point_list.xlsx",
        resultJsonPath:
            (RUN_PATHS.resultJsonByModule &&
                RUN_PATHS.resultJsonByModule.ren_epc) ||
            RUN_PATHS.resultJson,
        documentPath:
            (RUN_PATHS.documentXlsxByModule &&
                RUN_PATHS.documentXlsxByModule.ren_epc) ||
            RUN_PATHS.documentXlsx,
        outputPath:
            (RUN_PATHS.mapUpdatedXlsxByModule &&
                RUN_PATHS.mapUpdatedXlsxByModule.ren_epc) ||
            RUN_PATHS.mapUpdatedXlsx,
        logPath:
            (RUN_PATHS.mappingLogXlsxByModule &&
                RUN_PATHS.mappingLogXlsxByModule.ren_epc) ||
            RUN_PATHS.mappingLogXlsx,
        logJsonPath:
            (RUN_PATHS.mappingLogJsonByModule &&
                RUN_PATHS.mappingLogJsonByModule.ren_epc) ||
            RUN_PATHS.mappingLogJson,
        lockedOutputPath:
            (RUN_PATHS.mapLockedXlsxByModule &&
                RUN_PATHS.mapLockedXlsxByModule.ren_epc) ||
            RUN_PATHS.mapLockedXlsx,
        lockedLogPath:
            (RUN_PATHS.mappingLogLockedXlsxByModule &&
                RUN_PATHS.mappingLogLockedXlsxByModule.ren_epc) ||
            RUN_PATHS.mappingLogLockedXlsx
    },
    dvu_ai: {
        id: "dvu_ai",
        label: "dvuAI",
        documentName: "dvuAI_change_point_list.xlsx",
        resultJsonPath:
            (RUN_PATHS.resultJsonByModule &&
                RUN_PATHS.resultJsonByModule.dvu_ai) ||
            path.join(RUN_PATHS.analyzeDir, "dvu_ai_result.json"),
        documentPath:
            (RUN_PATHS.documentXlsxByModule &&
                RUN_PATHS.documentXlsxByModule.dvu_ai) ||
            path.join(__dirname, "document", "dvuAI_change_point_list.xlsx"),
        outputPath:
            (RUN_PATHS.mapUpdatedXlsxByModule &&
                RUN_PATHS.mapUpdatedXlsxByModule.dvu_ai) ||
            path.join(RUN_PATHS.mapDir, "dvuAI_change_point_list_updated.xlsx"),
        logPath:
            (RUN_PATHS.mappingLogXlsxByModule &&
                RUN_PATHS.mappingLogXlsxByModule.dvu_ai) ||
            path.join(RUN_PATHS.mapDir, "dvu_ai_mapping_log.xlsx"),
        logJsonPath:
            (RUN_PATHS.mappingLogJsonByModule &&
                RUN_PATHS.mappingLogJsonByModule.dvu_ai) ||
            path.join(RUN_PATHS.mapDir, "dvu_ai_mapping_log.json"),
        lockedOutputPath:
            (RUN_PATHS.mapLockedXlsxByModule &&
                RUN_PATHS.mapLockedXlsxByModule.dvu_ai) ||
            path.join(
                RUN_PATHS.mapDir,
                "dvuAI_change_point_list_Updated_locked.xlsx"
            ),
        lockedLogPath:
            (RUN_PATHS.mappingLogLockedXlsxByModule &&
                RUN_PATHS.mappingLogLockedXlsxByModule.dvu_ai) ||
            path.join(RUN_PATHS.mapDir, "dvu_ai_mapping_log_locked.xlsx")
    },
    dvc_ai: {
        id: "dvc_ai",
        label: "dvcAI",
        documentName: "dvcAI_change_point_list.xlsx",
        resultJsonPath:
            (RUN_PATHS.resultJsonByModule &&
                RUN_PATHS.resultJsonByModule.dvc_ai) ||
            path.join(RUN_PATHS.analyzeDir, "dvc_ai_result.json"),
        documentPath:
            (RUN_PATHS.documentXlsxByModule &&
                RUN_PATHS.documentXlsxByModule.dvc_ai) ||
            path.join(__dirname, "document", "dvcAI_change_point_list.xlsx"),
        outputPath:
            (RUN_PATHS.mapUpdatedXlsxByModule &&
                RUN_PATHS.mapUpdatedXlsxByModule.dvc_ai) ||
            path.join(RUN_PATHS.mapDir, "dvcAI_change_point_list_updated.xlsx"),
        logPath:
            (RUN_PATHS.mappingLogXlsxByModule &&
                RUN_PATHS.mappingLogXlsxByModule.dvc_ai) ||
            path.join(RUN_PATHS.mapDir, "dvc_ai_mapping_log.xlsx"),
        logJsonPath:
            (RUN_PATHS.mappingLogJsonByModule &&
                RUN_PATHS.mappingLogJsonByModule.dvc_ai) ||
            path.join(RUN_PATHS.mapDir, "dvc_ai_mapping_log.json"),
        lockedOutputPath:
            (RUN_PATHS.mapLockedXlsxByModule &&
                RUN_PATHS.mapLockedXlsxByModule.dvc_ai) ||
            path.join(
                RUN_PATHS.mapDir,
                "dvcAI_change_point_list_Updated_locked.xlsx"
            ),
        lockedLogPath:
            (RUN_PATHS.mappingLogLockedXlsxByModule &&
                RUN_PATHS.mappingLogLockedXlsxByModule.dvc_ai) ||
            path.join(RUN_PATHS.mapDir, "dvc_ai_mapping_log_locked.xlsx")
    }
};

const SHEET_NAME = "EMD";
const HISTORY_NAME = "History";
const HISTORY_TEMP = "_History_renamed_";
const RESULT_COL = 5; // E

const RESULT_SYMBOL = {
    O: "O",
    X: "X",
    "-": "-"
};

const SECTION = {
    NONE: "none",
    UVP: "uvp",
    VCP: "vcp",
    BEHAVIOR: "behavior",
    LOCAL_SWITCH: "local_switch",
    PRD_SW: "prd_sw"
};

function writeMappingLogJson(logEntries, stats, logJsonPath) {
    const json = {
        generatedAt: new Date().toISOString(),
        summary: {
            groupCount: stats.groupCount,
            matchedRows: stats.matchedRows,
            insertedRows: stats.insertedRows,
            orphans: logEntries.filter(
                (e) => e.action === "Orphan"
            ).length,
            createdNameBlocks: logEntries.filter(
                (e) => e.action === "CreatedNameBlock"
            ).length,
            notFound: logEntries.filter(
                (e) => e.action === "NotFound"
            ).length,
            nameMissingFromEmd: logEntries.filter(
                (e) => e.action === "NameMissingFromEmd"
            ).length
        },
        actions: logEntries
    };

    fs.writeFileSync(
        logJsonPath,
        JSON.stringify(json, null, 4),
        "utf8"
    );

    return logJsonPath;
}

function cellText(value) {
    if (value === null || value === undefined) {
        return "";
    }

    if (typeof value === "object") {
        if (value.richText) {
            return value.richText.map((part) => part.text || "").join("");
        }

        if (value.text) {
            return String(value.text);
        }

        if (value.result !== undefined) {
            return String(value.result);
        }
    }

    return String(value);
}

function basenameFile(filePath) {
    if (!filePath) {
        return "";
    }

    return path.basename(String(filePath).replace(/\\/g, "/")).trim();
}

function isMakefileName(fileName) {
    const name = String(fileName || "").trim();
    // Same basename under make_client/ vs make_server/ must stay distinct.
    return /^Makefile$/i.test(name) || /^rule\.mak$/i.test(name);
}

/*
 * Makefile / rule.mak paths are collapsed to basename elsewhere, which makes
 * epc_test/make_client/Makefile and epc_test/make_server/Makefile (and the same
 * for rule.mak) look identical. Keep parent/<file> for these only; all other
 * files stay basename-only.
 */
function emdFileLabel(filePath) {
    const normalized = normalizeImpactFile(filePath);

    if (!normalized) {
        return "";
    }

    if (/^Not Found$/i.test(normalized)) {
        return "Not Found";
    }

    const base = path.basename(normalized);

    if (!isMakefileName(base)) {
        return base;
    }

    const parts = normalized.split("/").filter(Boolean);

    if (parts.length >= 2) {
        return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    }

    return base;
}

function makefileMatchKey(fileLabel) {
    const normalized = normalizeImpactFile(fileLabel);

    if (!normalized) {
        return "";
    }

    if (/^Make\s+file$/i.test(normalized)) {
        return "makefile";
    }

    const base = path.basename(normalized);

    if (!isMakefileName(base)) {
        return normalized.toLowerCase();
    }

    const parts = normalized.split("/").filter(Boolean);

    if (parts.length >= 2) {
        return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`.toLowerCase();
    }

    // Bare Makefile historically keyed as "makefile"; rule.mak keeps its basename.
    return /^Makefile$/i.test(base) ? "makefile" : base.toLowerCase();
}

function functionToken(raw) {
    if (!raw) {
        return "";
    }

    let text = String(raw).trim();

    if (
        text.startsWith("(") ||
        text === "(#define)" ||
        /^makefile/i.test(text)
    ) {
        return "";
    }

    text = text.replace(/\(\s*\)$/, "").trim();

    if (text.includes("::")) {
        text = text.split("::").pop().trim();
    }

    text = text.replace(/\(\s*\)$/, "").trim();
    return text;
}

function parseEmdAffecting(raw) {
    const cleaned = cellText(raw)
        .replace(/^\u25A0/, "")
        .trim();

    if (!cleaned) {
        return { file: "", functionToken: "", raw: "" };
    }

    const normalized = cleaned.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = normalized
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

    let filePart = lines[0] || "";
    let funcPart = lines.slice(1).join(" ");

    if (!funcPart) {
        const match = filePart.match(/^(\S+\.\w+)\s+(.+)$/);
        if (match) {
            filePart = match[1];
            funcPart = match[2];
        }
    }

    return {
        file: filePart.trim(),
        functionToken: functionToken(funcPart),
        raw: cleaned
    };
}

function normalizeImpactFile(file) {
    return String(file || "")
        .replace(/\\/g, "/")
        .trim();
}

function impactsMatch(emdParsed, analyzerParsed) {
    if (analyzerParsed.isNotFound) {
        return false;
    }

    if (!emdParsed.file || !analyzerParsed.file) {
        return false;
    }

    const emdFile = normalizeImpactFile(emdParsed.file);
    const analyzerFile = normalizeImpactFile(analyzerParsed.file);
    const emdIsMakefile =
        isMakefileName(path.basename(emdFile)) ||
        /^Make\s+file$/i.test(emdFile);
    const analyzerIsMakefile = isMakefileName(path.basename(analyzerFile));

    if (emdIsMakefile || analyzerIsMakefile) {
        if (makefileMatchKey(emdFile) !== makefileMatchKey(analyzerFile)) {
            return false;
        }
    } else if (emdFile.toLowerCase() !== analyzerFile.toLowerCase()) {
        return false;
    }

    const emdFn = emdParsed.functionToken;
    const anFn = analyzerParsed.functionToken;

    if (!emdFn && !anFn) {
        return true;
    }

    if (!emdFn || !anFn) {
        return false;
    }

    return emdFn.toLowerCase() === anFn.toLowerCase();
}

function formatEmdAffecting(impact) {
    const file = emdFileLabel(impact.file);

    if (!file || file === "Not Found") {
        return "Not Found";
    }

    const token = functionToken(impact.function);
    const markedFile = `\u25A0${file}`;

    if (!token) {
        return markedFile;
    }

    return `${markedFile}\n${token}()`;
}

function mapResultSymbol(result) {
    if (RESULT_SYMBOL[result] !== undefined) {
        return RESULT_SYMBOL[result];
    }

    return String(result || "-");
}

async function renameHistoryInBuffer(buffer, fromName, toName) {
    const zip = await JSZip.loadAsync(buffer);
    const workbookFile = zip.file("xl/workbook.xml");

    if (!workbookFile) {
        throw new Error("xl/workbook.xml missing from workbook");
    }

    const xml = await workbookFile.async("string");
    const fromAttr = `name="${fromName}"`;
    const toAttr = `name="${toName}"`;

    if (!xml.includes(fromAttr)) {
        return buffer;
    }

    zip.file("xl/workbook.xml", xml.split(fromAttr).join(toAttr));

    return zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE"
    });
}

async function loadDocumentWorkbook(documentPath) {
    const original = fs.readFileSync(documentPath);
    const patched = await renameHistoryInBuffer(
        original,
        HISTORY_NAME,
        HISTORY_TEMP
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(patched);
    return workbook;
}

async function writeOutputWorkbook(workbook, outputPath, lockedOutputPath) {
    const buffer = await workbook.xlsx.writeBuffer();
    const restored = await renameHistoryInBuffer(
        Buffer.from(buffer),
        HISTORY_TEMP,
        HISTORY_NAME
    );

    try {
        fs.writeFileSync(outputPath, restored);
        return outputPath;
    } catch (error) {
        if (error && error.code === "EBUSY") {
            const fallback = lockedOutputPath;
            fs.writeFileSync(fallback, restored);
            console.error(
                `${outputPath} is open/locked. Wrote to ${fallback} instead.`
            );
            return fallback;
        }

        throw error;
    }
}

function detectSection(bText, current) {
    const text = bText.trim();

    if (text === "■UVP" || text === "UVP") {
        return SECTION.UVP;
    }

    if (text === "■VCP" || text === "VCP") {
        return SECTION.VCP;
    }

    if (
        text === "■Behavior Mode" ||
        text === "Behavior Mode" ||
        /^■?\s*Behavior\s*Mode$/i.test(text)
    ) {
        return SECTION.BEHAVIOR;
    }

    // EMD: "Local Switch" ? analyzer kind=local_switch
    if (
        text === "Local Switch" ||
        text === "■Local Switch" ||
        /^■?\s*Local\s+Switch$/i.test(text)
    ) {
        return SECTION.LOCAL_SWITCH;
    }

    // Separate model list under ■PRD_SW ? out of scope (not in local_switch.json)
    if (text === "■PRD_SW" || text === "PRD_SW") {
        return SECTION.PRD_SW;
    }

    return current;
}

function isSectionMarker(bText) {
    const text = bText.trim();
    return (
        text === "■UVP" ||
        text === "■VCP" ||
        text === "■Behavior Mode" ||
        text === "■PRD_SW" ||
        text === "Local Switch" ||
        text === "■Local Switch" ||
        text === "UVP" ||
        text === "VCP" ||
        text === "PRD_SW" ||
        /^■?\s*Behavior\s*Mode$/i.test(text) ||
        /^■?\s*Local\s+Switch$/i.test(text)
    );
}

function isHeaderOrMetaRow(bText, cText) {
    const b = bText.trim();
    const c = cText.trim();

    if (b === "Name") {
        return true;
    }

    if (/^Affecting/i.test(c)) {
        return true;
    }

    return false;
}

function isNameStart(bText, section) {
    const b = bText.trim();

    if (!b || isSectionMarker(b)) {
        return false;
    }

    if (section === SECTION.UVP) {
        return b.startsWith("UVP_SW_");
    }

    if (section === SECTION.BEHAVIOR) {
        return b.startsWith("BEHAVIOR_MODE_IF_");
    }

    // Local Switch names use mixed prefixes (REN_EPC_*, DVU_AI_*, _DVU_AI_*, ...)
    if (section === SECTION.LOCAL_SWITCH) {
        return /^_?[A-Z][A-Z0-9_]*$/.test(b);
    }

    return false;
}

function collectNameGroups(worksheet) {
    const groups = [];
    let section = SECTION.NONE;
    let current = null;

    const maxRow = worksheet.rowCount || worksheet.actualRowCount || 0;

    for (let rowNumber = 1; rowNumber <= maxRow; rowNumber++) {
        const row = worksheet.getRow(rowNumber);
        const bText = cellText(row.getCell(2).value);
        const cText = cellText(row.getCell(3).value);
        const resultText = cellText(row.getCell(RESULT_COL).value);
        const bTrim = bText.trim();

        const nextSection = detectSection(bText, section);
        if (nextSection !== section) {
            if (current) {
                groups.push(current);
                current = null;
            }
            section = nextSection;
        }

        if (
            section === SECTION.VCP ||
            section === SECTION.PRD_SW ||
            section === SECTION.NONE ||
            isSectionMarker(bText) ||
            isHeaderOrMetaRow(bText, cText)
        ) {
            continue;
        }

        if (isNameStart(bText, section)) {

    // same merged-name block
    if (current && current.name === bTrim) {
        current.rows.push(rowNumber);
        current.endRow = rowNumber;
        continue;
    }

    // new name begins
    if (current) {
        groups.push(current);
    }

    current = {
        name: bTrim,
        section,
        startRow: rowNumber,
        endRow: rowNumber,
        rows: [rowNumber]
    };

    continue;
}

        if (current && !bTrim) {
            if (cText.trim() || resultText.trim()) {
                current.rows.push(rowNumber);
                current.endRow = rowNumber;
            }
        }
    }

    if (current) {
        groups.push(current);
    }

    return groups;
}

function parseAnalyzerImpact(impact) {
    const file = emdFileLabel(impact.file);
    const isNotFound = file === "Not Found" || !file;

    return {
        file: isNotFound ? "Not Found" : file,
        functionToken: isNotFound ? "" : functionToken(impact.function),
        rawFunction: impact.function || "",
        isNotFound,
        source: impact
    };
}

function collectSectionAnchors(groups) {
    const anchors = {};

    for (const group of groups) {
        if (
            !anchors[group.section] ||
            group.endRow > anchors[group.section].endRow
        ) {
            anchors[group.section] = {
                endRow: group.endRow,
                styleRow: group.endRow
            };
        }
    }

    return anchors;
}

function createNameBlock(
    worksheet,
    insertRow,
    switchName,
    switchEntry,
    styleRowNumber
) {
    const seenMakefileKeys = new Set();
    const impacts = (switchEntry.impacts || [])
        .map(parseAnalyzerImpact)
        .filter((impact) => !impact.isNotFound)
        .filter((impact) => {
            if (!isMakefileName(path.basename(impact.file))) {
                return true;
            }

            const key = makefileMatchKey(impact.file);

            if (seenMakefileKeys.has(key)) {
                return false;
            }

            seenMakefileKeys.add(key);
            return true;
        });

    if (impacts.length === 0) {
        return {
            insertedRows: 0,
            firstRow: null
        };
    }

    worksheet.spliceRows(
        insertRow,
        0,
        ...impacts.map(() => [])
    );

    const symbol = mapResultSymbol(switchEntry.result);

    for (let i = 0; i < impacts.length; i++) {
        const rowNumber = insertRow + i;

        copyRowStyle(
            worksheet,
            styleRowNumber,
            rowNumber
        );

        const row = worksheet.getRow(rowNumber);

        row.getCell(2).value =
            i === 0 ? switchName : null;

        row.getCell(3).value =
            formatEmdAffecting(
                impacts[i].source
            );

        writeResultCell(row, symbol);

        row.commit();
    }

    return {
        insertedRows: impacts.length,
        firstRow: insertRow
    };
}

function writeResultCell(row, symbol) {
    const cell = row.getCell(RESULT_COL);
    cell.value = symbol;
    cell.alignment = { horizontal: "center", vertical: "middle" };
}

function copyRowStyle(worksheet, fromRowNumber, toRowNumber) {
    const fromRow = worksheet.getRow(fromRowNumber);
    const toRow = worksheet.getRow(toRowNumber);
    toRow.height = fromRow.height;

    fromRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        if (colNumber > 30) {
            return;
        }

        const target = toRow.getCell(colNumber);
        if (cell.style) {
            target.style = Object.assign({}, cell.style);
        }
        if (cell.border) {
            target.border = Object.assign({}, cell.border);
        }
        if (cell.alignment) {
            target.alignment = Object.assign({}, cell.alignment);
        }
        if (cell.font) {
            target.font = Object.assign({}, cell.font);
        }
    });
}

function pushLog(logEntries, entry) {
    logEntries.push(entry);
}

/*
 * spliceRows shifts every workbook row at/after insertAt downward.
 * Log entries recorded earlier still hold pre-shift emdRow values ? bump them
 * so mapping_log stays aligned with the final Updated.xlsx.
 * Call this after splice, before logging the newly inserted rows themselves.
 */
function adjustLogRowsAfterInsert(logEntries, insertAt, insertedCount) {
    if (!insertedCount || insertedCount < 1) {
        return;
    }

    for (const entry of logEntries) {
        if (typeof entry.emdRow === "number" && entry.emdRow >= insertAt) {
            entry.emdRow += insertedCount;
        }
    }
}

function applyMapping(worksheet, switches) {
    const logEntries = [];
    const groups = collectNameGroups(worksheet);
    const sectionAnchors = collectSectionAnchors(groups);
    const emdNames = new Set(
            groups.map((group) => group.name)
        );

        const missingNames = [];

        for (const name of Object.keys(switches)) {
            if (!emdNames.has(name)) {
                missingNames.push(name);
            }
        }

    const ordered = [...groups].sort((a, b) => b.startRow - a.startRow);

    let matchedRows = 0;
    let insertedRows = 0;

    for (const group of ordered) {
        const entry = switches[group.name];

        if (!entry) {
            for (const rowNumber of group.rows) {
                const row = worksheet.getRow(rowNumber);
                const cText = cellText(row.getCell(3).value);
                if (cText.trim()) {
                    writeResultCell(row, "-");
                    matchedRows += 1;

                    pushLog(logEntries, {
                        action: "Orphan",
                        name: group.name,
                        emdRow: rowNumber,
                        affecting: cText,
                        result: "-",
                        reason: "Name not present in result.json; wrote - on E"
                    });
                }
            }
            continue;
        }

        const symbol = mapResultSymbol(entry.result);
        const analyzerImpacts = (entry.impacts || []).map(parseAnalyzerImpact);
        
        const onlyNotFound =
            analyzerImpacts.length > 0 &&
            analyzerImpacts.every((impact) => impact.isNotFound);

        if (onlyNotFound) {
            const firstRow = worksheet.getRow(group.startRow);
            writeResultCell(firstRow, "-");
            matchedRows += 1;

            pushLog(logEntries, {
                action: "NotFound",
                name: group.name,
                emdRow: group.startRow,
                affecting: cellText(firstRow.getCell(3).value),
                result: "-",
                reason: "Analyzer impacts are Not Found; wrote - on first E cell"
            });

            for (const rowNumber of group.rows) {
                const row = worksheet.getRow(rowNumber);
                const cText = cellText(row.getCell(3).value);
                if (cText.trim()) {
                    writeResultCell(row, "-");

                    pushLog(logEntries, {
                        action: "Orphan",
                        name: group.name,
                        emdRow: rowNumber,
                        affecting: cText,
                        result: "-",
                        reason: "Analyzer Not Found; wrote - on E for document impact"
                    });
                }
            }
            continue;
        }

        const unmatchedAnalyzer = analyzerImpacts.filter(
            (impact) => !impact.isNotFound
        );
        const usedAnalyzer = new Set();

        for (const rowNumber of group.rows) {
            const row = worksheet.getRow(rowNumber);
            const cText = cellText(row.getCell(3).value);
            const emdParsed = parseEmdAffecting(cText);

            if (!emdParsed.file) {
                continue;
            }

            let matchIndex = -1;

            for (let index = 0; index < unmatchedAnalyzer.length; index++) {
                if (usedAnalyzer.has(index)) {
                    continue;
                }

                if (impactsMatch(emdParsed, unmatchedAnalyzer[index])) {
                    matchIndex = index;
                    break;
                }
            }

            if (matchIndex >= 0) {
                writeResultCell(row, symbol);
                usedAnalyzer.add(matchIndex);

                // Same Makefile path is one EMD row; consume duplicate analyzer hits.
                const matched = unmatchedAnalyzer[matchIndex];
                if (isMakefileName(path.basename(matched.file))) {
                    const matchedKey = makefileMatchKey(matched.file);

                    for (let index = 0; index < unmatchedAnalyzer.length; index++) {
                        if (
                            !usedAnalyzer.has(index) &&
                            makefileMatchKey(unmatchedAnalyzer[index].file) ===
                                matchedKey
                        ) {
                            usedAnalyzer.add(index);
                        }
                    }
                }

                matchedRows += 1;

                pushLog(logEntries, {
                    action: "Matched",
                    name: group.name,
                    emdRow: rowNumber,
                    affecting: cText,
                    result: symbol,
                    reason: `Matched analyzer impact ${matched.file}${matched.functionToken ? " / " + matched.functionToken : ""}; wrote E`
                });
            } else {
                writeResultCell(row, "-");
                matchedRows += 1;

                pushLog(logEntries, {
                    action: "Orphan",
                    name: group.name,
                    emdRow: rowNumber,
                    affecting: cText,
                    result: "-",
                    reason: "No matching analyzer impact; wrote - on E"
                });
            }
        }

        const toInsert = [];
        const insertedMakefileKeys = new Set();

        for (let index = 0; index < unmatchedAnalyzer.length; index++) {
            if (usedAnalyzer.has(index)) {
                continue;
            }

            const impact = unmatchedAnalyzer[index];

            if (isMakefileName(path.basename(impact.file))) {
                const key = makefileMatchKey(impact.file);

                if (insertedMakefileKeys.has(key)) {
                    continue;
                }

                insertedMakefileKeys.add(key);
            }

            toInsert.push(impact);
        }

        if (toInsert.length === 0) {
            continue;
        }

        const insertAt = group.endRow + 1;
        worksheet.spliceRows(insertAt, 0, ...toInsert.map(() => []));
        adjustLogRowsAfterInsert(logEntries, insertAt, toInsert.length);

        for (let offset = 0; offset < toInsert.length; offset++) {
            const rowNumber = insertAt + offset;
            const impact = toInsert[offset];
            copyRowStyle(worksheet, group.endRow, rowNumber);

            const affecting = formatEmdAffecting(impact.source);
            const row = worksheet.getRow(rowNumber);
            row.getCell(2).value = null;
            row.getCell(3).value = affecting;
            writeResultCell(row, symbol);
            row.commit();
            insertedRows += 1;

            pushLog(logEntries, {
                action: "Inserted",
                name: group.name,
                emdRow: rowNumber,
                affecting,
                result: symbol,
                reason: `New analyzer impact not in EMD; inserted row under ${group.name} (B blank, Result in E)`
            });
        }
    }
    const refreshedGroups =
    collectNameGroups(worksheet);

    const refreshedAnchors =
    collectSectionAnchors(
        refreshedGroups
    );
    const sectionOrder = [
    SECTION.LOCAL_SWITCH,
    SECTION.BEHAVIOR,
    SECTION.UVP
];

for (const section of sectionOrder) {
    const namesForSection =
        missingNames.filter((name) => {
            const entry = switches[name];

            return (
                (entry.kind === "uvp" &&
                    section === SECTION.UVP) ||
                (entry.kind === "behavior" &&
                    section === SECTION.BEHAVIOR) ||
                (
                    entry.kind === "local_switch" &&
                    section === SECTION.LOCAL_SWITCH
                )
            );
        });

    for (const name of namesForSection) {
        const entry = switches[name];

        const validImpacts =
            (entry.impacts || [])
                .map(parseAnalyzerImpact)
                .filter(
                    (impact) =>
                        !impact.isNotFound
                );

        if (validImpacts.length === 0) {
            pushLog(logEntries, {
                action: "NameMissingFromEmd",
                name,
                emdRow: "",
                affecting: "",
                result: mapResultSymbol(
                    entry.result
                ),
                reason:
                    "Name missing from EMD and analyzer impacts are Not Found"
            });

            continue;
        }

        const anchor =
        refreshedAnchors[section];

        if (!anchor) {
            pushLog(logEntries, {
                action: "NameMissingFromEmd",
                name,
                emdRow: "",
                affecting: "",
                result: mapResultSymbol(
                    entry.result
                ),
                reason:
                    `Section ${section} not found in EMD`
            });

            continue;
        }

        const insertAt =
            anchor.endRow + 1;

        const result =
            createNameBlock(
                worksheet,
                insertAt,
                name,
                entry,
                anchor.styleRow
            );

        if (result.insertedRows > 0) {
            adjustLogRowsAfterInsert(
                logEntries,
                insertAt,
                result.insertedRows
            );
        }

        anchor.endRow +=
            result.insertedRows;

        insertedRows +=
            result.insertedRows;

        pushLog(logEntries, {
            action: "CreatedNameBlock",
            name,
            emdRow: result.firstRow,
            affecting:`${validImpacts.length} impact(s)`,
            result: mapResultSymbol(
                entry.result
            ),
            reason:
                "Name not present in EMD; created new block and inserted impacts"
        });
    }
}
    return { logEntries, matchedRows, insertedRows, groupCount: groups.length };
}

function writeGuideSheet(workbook, moduleConfig) {
    const guide = workbook.addWorksheet("Guide", {
        properties: { tabColor: { argb: "FF5B9BD5" } }
    });
    guide.columns = [
        { header: "Topic", key: "topic", width: 28 },
        { header: "Item", key: "item", width: 24 },
        { header: "Description", key: "description", width: 100 }
    ];

    const updatedName = path.basename(moduleConfig.outputPath);
    const documentName = moduleConfig.documentName;
    const resultName = path.basename(moduleConfig.resultJsonPath);
    const logName = path.basename(moduleConfig.logPath);

    const rows = [
        {
            topic: "About this file",
            item: logName,
            description:
                `Investigation log for excel_mapper.js (${moduleConfig.label}). Separate from ${updatedName} on purpose - no log sheets are added inside the Updated workbook.`
        },
        {
            topic: "How to use",
            item: "Workflow",
            description:
                `1) Open Summary for counts. 2) Open Actions and filter by Action. 3) Use EMD Row + Name + Affecting to find the row in ${updatedName}. 4) Read Reason.`
        },
        {
            topic: "Column",
            item: "Action",
            description:
                "Matched, Inserted, NotFound, Orphan, or NameMissingFromEmd."
        },
        {
            topic: "Column",
            item: "Name",
            description: "Switch, behavior, or Local Switch name (EMD column B)."
        },
        {
            topic: "Column",
            item: "EMD Row",
            description: `Row number on EMD in ${updatedName}.`
        },
        {
            topic: "Column",
            item: "Affecting",
            description: "EMD column C (Affecting header/function)."
        },
        {
            topic: "Column",
            item: "Result",
            description:
                "Symbol written to EMD column E: O / X / -. Orphan rows also get - when C has no matching analyzer impact."
        },
        {
            topic: "Column",
            item: "Reason",
            description: "Why this action was taken."
        },
        {
            topic: "Action type",
            item: "Matched",
            description:
                "Existing EMD C matched an analyzer impact; wrote O/X/- into E."
        },
        {
            topic: "Action type",
            item: "Inserted",
            description:
                "Analyzer impact missing from EMD; inserted row (B blank, C + E set)."
        },
        {
            topic: "Action type",
            item: "NotFound",
            description:
                "Analyzer Not Found for this Name; wrote - on first E cell."
        },
        {
            topic: "Action type",
            item: "Orphan",
            description:
                `EMD C row with no analyzer match (or name missing from ${resultName}); wrote - into E.`
        },
        {
            topic: "Action type",
            item: "CreatedNameBlock",
            description:
                "Name missing from EMD. New Name block was created and impacts inserted."
        },
        {
            topic: "Action type",
            item: "NameMissingFromEmd",
            description:
                `Name in ${resultName} with no EMD Name block and no creatable impacts (Not Found only, or section missing).`
        },
        {
            topic: "EMD Row",
            item: "Final-sheet aligned",
            description:
                "emdRow values are adjusted after every insert so Actions point at rows in the final Updated.xlsx (not pre-shift positions)."
        },
        {
            topic: "Related files",
            item: "Inputs / outputs",
            description:
                `Inputs: ${resultName}, ${documentName}. Outputs: ${updatedName} (EMD E filled), ${logName}. Each run rebuilds from ${documentName}.`
        }
    ];

    for (const row of rows) {
        guide.addRow(row);
    }

    guide.getRow(1).font = { bold: true };
    guide.views = [{ state: "frozen", ySplit: 1 }];
    guide.getColumn(3).alignment = { wrapText: true, vertical: "top" };

    for (let r = 2; r <= guide.rowCount; r++) {
        guide.getRow(r).height = 40;
    }
}

async function writeMappingLogWorkbook(logEntries, stats, moduleConfig) {
    const workbook = new ExcelJS.Workbook();
    writeGuideSheet(workbook, moduleConfig);

    const summary = workbook.addWorksheet("Summary");
    summary.columns = [
        { header: "Metric", key: "metric", width: 36 },
        { header: "Value", key: "value", width: 20 },
        { header: "Description", key: "description", width: 72 }
    ];
    summary.addRow({
        metric: "GeneratedAt",
        value: new Date().toISOString(),
        description: `When this ${path.basename(moduleConfig.logPath)} was created.`
    });
    summary.addRow({
        metric: "Module",
        value: moduleConfig.label,
        description: "Mapped module (renEPC / dvuAI / dvcAI)."
    });
    summary.addRow({
        metric: "EMD name groups",
        value: stats.groupCount,
        description:
            "UVP_SW_* / BEHAVIOR_MODE_IF_* / Local Switch Name blocks on EMD."
    });
    summary.addRow({
        metric: "Matched",
        value: stats.matchedRows,
        description: "Rows where C matched analyzer and E was written."
    });
    summary.addRow({
        metric: "Inserted",
        value: stats.insertedRows,
        description: "New impact rows inserted under a Name."
    });
    summary.addRow({
        metric: "Orphan",
        value: logEntries.filter((e) => e.action === "Orphan").length,
        description: "Document C rows with no analyzer match; E set to -."
    });
    summary.addRow({
        metric: "NotFound",
        value: logEntries.filter((e) => e.action === "NotFound").length,
        description: "Names with analyzer Not Found; first E set to -."
    });
    summary.addRow({
        metric: "NameMissingFromEmd",
        value: logEntries.filter((e) => e.action === "NameMissingFromEmd")
            .length,
        description: "Names in analyze result with no EMD Name block."
    });
    summary.addRow({
        metric: "CreatedNameBlock",
        value: logEntries.filter(
            (e) => e.action === "CreatedNameBlock"
        ).length,
        description: "Missing Name blocks automatically created."
    });
    summary.getRow(1).font = { bold: true };

    const actions = workbook.addWorksheet("Actions");
    actions.columns = [
        { header: "Action", key: "action", width: 22 },
        { header: "Name", key: "name", width: 48 },
        { header: "EMD Row", key: "emdRow", width: 12 },
        { header: "Affecting", key: "affecting", width: 64 },
        { header: "Result", key: "result", width: 10 },
        { header: "Reason", key: "reason", width: 72 }
    ];
    actions.addRow({
        action: "What happened",
        name: "Switch / behavior / Local Switch name",
        emdRow: "Row # on EMD",
        affecting: "EMD column C",
        result: "EMD column E",
        reason: "See Guide sheet"
    });
    actions.getRow(2).font = {
        italic: true,
        color: { argb: "FF666666" },
        size: 9
    };

    for (const entry of logEntries) {
        actions.addRow(entry);
    }

    actions.getRow(1).font = { bold: true };
    actions.views = [{ state: "frozen", ySplit: 2 }];

    try {
        await workbook.xlsx.writeFile(moduleConfig.logPath);
        return moduleConfig.logPath;
    } catch (error) {
        if (error && error.code === "EBUSY") {
            const fallback = moduleConfig.lockedLogPath;
            await workbook.xlsx.writeFile(fallback);
            console.error(
                `${moduleConfig.logPath} is open/locked. Wrote log to ${fallback} instead.`
            );
            return fallback;
        }

        throw error;
    }
}

function loadResultJson(jsonPath) {
    if (!fs.existsSync(jsonPath)) {
        throw new Error(`Analyze result not found: ${jsonPath}`);
    }

    const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

    if (!data.switches || typeof data.switches !== "object") {
        throw new Error(`${jsonPath} missing switches map`);
    }

    return data;
}

function resolveSelectedModules(moduleInput) {
    if (moduleInput === "all") {
        return Object.keys(MAP_MODULES);
    }

    return [moduleInput];
}

async function mapModule(moduleConfig) {
    console.log(`\n--- Mapping ${moduleConfig.label} (${moduleConfig.id}) ---`);

    if (!fs.existsSync(moduleConfig.documentPath)) {
        throw new Error(
            `Document not found: ${moduleConfig.documentPath}\n` +
                `Place ${moduleConfig.documentName} under document/ or the project root.`
        );
    }

    const resultData = loadResultJson(moduleConfig.resultJsonPath);
    const switchCount = Object.keys(resultData.switches).length;
    console.log(
        `Loaded ${switchCount} switches from ${moduleConfig.resultJsonPath}`
    );
    console.log(`Document: ${moduleConfig.documentPath}`);
    console.log(`Output: ${moduleConfig.outputPath}`);

    const workbook = await loadDocumentWorkbook(moduleConfig.documentPath);
    const worksheetNames = workbook.worksheets.map((sheet) =>
        sheet.name === HISTORY_TEMP ? HISTORY_NAME : sheet.name
    );
    console.log(`Loaded worksheets: ${worksheetNames.join(", ")}`);

    const emd = workbook.getWorksheet(SHEET_NAME);
    if (!emd) {
        throw new Error(`Sheet not found: ${SHEET_NAME}`);
    }

    const { logEntries, matchedRows, insertedRows, groupCount } = applyMapping(
        emd,
        resultData.switches
    );

    const stats = {
        groupCount,
        matchedRows,
        insertedRows
    };

    // Enabled this for Debugging
    // const logJsonPath = writeMappingLogJson(
    //     logEntries,
    //     stats,
    //     moduleConfig.logJsonPath
    // );

    // const logPathWritten = await writeMappingLogWorkbook(
    //     logEntries,
    //     stats,
    //     moduleConfig
    // );
    // console.log(`Wrote ${logPathWritten}`);

    const outputWritten = await writeOutputWorkbook(
        workbook,
        moduleConfig.outputPath,
        moduleConfig.lockedOutputPath
    );
    console.log(`Wrote ${outputWritten}`);

    console.log(`EMD name groups: ${groupCount}`);
    console.log(`Matched rows (E written): ${matchedRows}`);
    console.log(`Inserted impact rows: ${insertedRows}`);
    console.log(
        `Orphans: ${logEntries.filter((e) => e.action === "Orphan").length}; ` +
            `names missing from EMD: ${
                logEntries.filter((e) => e.action === "NameMissingFromEmd")
                    .length
            }`
    );
}

async function main() {
    const selectedModules = resolveSelectedModules(MODULE_INPUT);

    console.log(`Workspace: ${WORKSPACE}`);
    console.log(`Profile: ${RUN_PATHS.profileName}`);
    console.log(`Output dir: ${RUN_PATHS.mapDir}`);
    console.log(`Modules: ${selectedModules.join(", ")}`);

    for (const moduleId of selectedModules) {
        await mapModule(MAP_MODULES[moduleId]);
    }
}

module.exports = {
    main,
    adjustLogRowsAfterInsert
};

if (require.main === module) {
    main().catch((error) => {
        console.error("Error:", error.message);
        process.exitCode = 1;
    });
}
