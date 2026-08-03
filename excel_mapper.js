const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const JSZip = require("jszip");
const { getRunPaths, ensureRunDirs } = require("./output_paths");

const WORKSPACE = process.argv[2];
const PROFILE_INPUT = process.argv[3];

if (!WORKSPACE || !PROFILE_INPUT) {
    console.error("Usage:");
    console.error("  node excel_mapper.js <workspace> <profile>");
    console.error("");
    console.error("Example:");
    console.error(
        "  node excel_mapper.js ubasrh_KPC02530_2291_matsuri3_mp C2WC_prd_profile"
    );
    process.exit(1);
}

const RUN_PATHS = ensureRunDirs(getRunPaths(WORKSPACE, PROFILE_INPUT));

const JSON_FILE_PATH = RUN_PATHS.resultJson;
const TEMPLATE_PATH = RUN_PATHS.templateXlsx;
const OUTPUT_PATH = RUN_PATHS.mapUpdatedXlsx;
const LOG_PATH = RUN_PATHS.mappingLogXlsx;
const LOG_JSON_PATH = RUN_PATHS.mappingLogJson;
const LOCKED_OUTPUT_PATH = RUN_PATHS.mapLockedXlsx;
const LOCKED_LOG_PATH = RUN_PATHS.mappingLogLockedXlsx;
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

function writeMappingLogJson(logEntries, stats) {
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
        LOG_JSON_PATH,
        JSON.stringify(json, null, 4),
        "utf8"
    );

    return LOG_JSON_PATH;
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
    return /^Makefile$/i.test(String(fileName || "").trim());
}

/*
 * Makefile paths are collapsed to basename elsewhere, which makes
 * epc_test/make_client/Makefile and epc_test/make_server/Makefile look identical.
 * Keep parent/Makefile for this file only; all other files stay basename-only.
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

    return "makefile";
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

async function loadTemplateWorkbook(templatePath) {
    const original = fs.readFileSync(templatePath);
    const patched = await renameHistoryInBuffer(
        original,
        HISTORY_NAME,
        HISTORY_TEMP
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(patched);
    return workbook;
}

async function writeOutputWorkbook(workbook, outputPath) {
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
            const fallback = LOCKED_OUTPUT_PATH;
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

    if (text === "¢£UVP" || text === "UVP") {
        return SECTION.UVP;
    }

    if (text === "¢£VCP" || text === "VCP") {
        return SECTION.VCP;
    }

    if (
        text === "¢£Behavior Mode" ||
        text === "Behavior Mode" ||
        /^¢£?\s*Behavior\s*Mode$/i.test(text)
    ) {
        return SECTION.BEHAVIOR;
    }

    // EMD: "Local Switch" ? analyzer kind=local_switch
    if (
        text === "Local Switch" ||
        text === "¢£Local Switch" ||
        /^¢£?\s*Local\s+Switch$/i.test(text)
    ) {
        return SECTION.LOCAL_SWITCH;
    }

    // Separate model list under ¢£PRD_SW ? out of scope (not in local_switch.json)
    if (text === "¢£PRD_SW" || text === "PRD_SW") {
        return SECTION.PRD_SW;
    }

    return current;
}

function isSectionMarker(bText) {
    const text = bText.trim();
    return (
        text === "¢£UVP" ||
        text === "¢£VCP" ||
        text === "¢£Behavior Mode" ||
        text === "¢£PRD_SW" ||
        text === "Local Switch" ||
        text === "¢£Local Switch" ||
        text === "UVP" ||
        text === "VCP" ||
        text === "PRD_SW" ||
        /^¢£?\s*Behavior\s*Mode$/i.test(text) ||
        /^¢£?\s*Local\s+Switch$/i.test(text)
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

    // Local Switch names use mixed prefixes (REN_EPC_*, WSC_*, EPC_ENV_*, RNU_*, ...)
    if (section === SECTION.LOCAL_SWITCH) {
        return /^[A-Z][A-Z0-9_]*$/.test(b);
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
                        reason: "Analyzer Not Found; wrote - on E for template impact"
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

function writeGuideSheet(workbook) {
    const guide = workbook.addWorksheet("Guide", {
        properties: { tabColor: { argb: "FF5B9BD5" } }
    });
    guide.columns = [
        { header: "Topic", key: "topic", width: 28 },
        { header: "Item", key: "item", width: 24 },
        { header: "Description", key: "description", width: 100 }
    ];

    const rows = [
        {
            topic: "About this file",
            item: "mapping_log.xlsx",
            description:
                "Investigation log for excel_mapper.js (Phase 2). Separate from renEPC_change_point_list_Updated.xlsx on purpose ? no log sheets are added inside the Updated workbook."
        },
        {
            topic: "How to use",
            item: "Workflow",
            description:
                "1) Open Summary for counts. 2) Open Actions and filter by Action. 3) Use EMD Row + Name + Affecting to find the row in renEPC_change_point_list_Updated.xlsx. 4) Read Reason."
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
            description: "Row number on EMD in renEPC_change_point_list_Updated.xlsx."
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
                "EMD C row with no analyzer match (or name missing from result.json); wrote - into E."
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
                "Name in result.json with no EMD Name block and no creatable impacts (Not Found only, or section missing)."
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
                "Inputs: result.json, renEPC_change_point_list.xlsx. Outputs: renEPC_change_point_list_Updated.xlsx (EMD E filled), mapping_log.xlsx. Each run rebuilds from renEPC_change_point_list.xlsx. Rules: docs/emd_mapping.md."
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

async function writeMappingLogWorkbook(logEntries, stats) {
    const workbook = new ExcelJS.Workbook();
    writeGuideSheet(workbook);

    const summary = workbook.addWorksheet("Summary");
    summary.columns = [
        { header: "Metric", key: "metric", width: 36 },
        { header: "Value", key: "value", width: 20 },
        { header: "Description", key: "description", width: 72 }
    ];
    summary.addRow({
        metric: "GeneratedAt",
        value: new Date().toISOString(),
        description: "When this mapping_log.xlsx was created."
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
        description: "Template C rows with no analyzer match; E set to -."
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
        description: "Names in result.json with no EMD Name block."
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
        await workbook.xlsx.writeFile(LOG_PATH);
        return LOG_PATH;
    } catch (error) {
        if (error && error.code === "EBUSY") {
            const fallback = LOCKED_LOG_PATH;
            await workbook.xlsx.writeFile(fallback);
            console.error(
                `${LOG_PATH} is open/locked. Wrote log to ${fallback} instead.`
            );
            return fallback;
        }

        throw error;
    }
}

function loadResultJson(jsonPath) {
    if (!fs.existsSync(jsonPath)) {
        throw new Error(`result.json not found: ${jsonPath}`);
    }

    const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

    if (!data.switches || typeof data.switches !== "object") {
        throw new Error("result.json missing switches map");
    }

    return data;
}

async function main() {
    if (!fs.existsSync(TEMPLATE_PATH)) {
        throw new Error(
            `Template not found: ${TEMPLATE_PATH}\n` +
                `Place renEPC_change_point_list.xlsx under templates/ or the project root.`
        );
    }

    const resultData = loadResultJson(JSON_FILE_PATH);
    const switchCount = Object.keys(resultData.switches).length;
    console.log(`Workspace: ${WORKSPACE}`);
    console.log(`Profile: ${RUN_PATHS.profileName}`);
    console.log(`Output dir: ${RUN_PATHS.mapDir}`);
    console.log(`Loaded ${switchCount} switches from ${JSON_FILE_PATH}`);
    console.log(`Template: ${TEMPLATE_PATH}`);
    console.log(`Output: ${OUTPUT_PATH}`);

    const workbook = await loadTemplateWorkbook(TEMPLATE_PATH);
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

const logJsonPath = writeMappingLogJson(
    logEntries,
    stats
);

    const logPathWritten = await writeMappingLogWorkbook(logEntries, {
        groupCount,
        matchedRows,
        insertedRows
    });
    console.log(`Wrote ${logPathWritten}`);

    const outputWritten = await writeOutputWorkbook(workbook, OUTPUT_PATH);
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