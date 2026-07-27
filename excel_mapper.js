/*
excel_mapper.js

Phase 2 – Map analyzer result.json into 1231.xlsx sheet EMD.

  Inputs:  result.json + 1231.xlsx (EMD)
  Outputs: 1231_Updated.xlsx
           mapping_log.xlsx  (separate investigation log — no extra sheets
                              inside 1231_Updated.xlsx)

  Each run rebuilds from clean 1231.xlsx and overwrites 1231_Updated.xlsx.

Column map (aligned with result.xlsx Impact):
  B = Name
  C = Affecting header/function
  E = Result (○ / × / -)

Rules: see docs/emd_mapping.md

ExcelJS workaround:
  Sheet name "History" is protected by ExcelJS. Before load/save we temporarily
  rename it to "_History_renamed_" inside xl/workbook.xml via JSZip, then restore
  "History" on write.
*/

const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const JSZip = require("jszip");

const JSON_FILE_PATH = "./result.json";
const TEMPLATE_PATH = "./1231.xlsx";
const OUTPUT_PATH = "./1231_Updated.xlsx";
const LOG_PATH = "./mapping_log.xlsx";
const SHEET_NAME = "EMD";
const HISTORY_NAME = "History";
const HISTORY_TEMP = "_History_renamed_";
const RESULT_COL = 5; // E

const RESULT_SYMBOL = {
    O: "○",
    X: "×",
    "-": "-"
};

const SECTION = {
    NONE: "none",
    UVP: "uvp",
    VCP: "vcp",
    BEHAVIOR: "behavior"
};

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
        .replace(/^■/, "")
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
        file: basenameFile(filePart),
        functionToken: functionToken(funcPart),
        raw: cleaned
    };
}

function parseAnalyzerImpact(impact) {
    const file = basenameFile(impact.file);
    const isNotFound = file === "Not Found" || !file;

    return {
        file: isNotFound ? "Not Found" : file,
        functionToken: isNotFound ? "" : functionToken(impact.function),
        rawFunction: impact.function || "",
        isNotFound,
        source: impact
    };
}

function impactsMatch(emdParsed, analyzerParsed) {
    if (analyzerParsed.isNotFound) {
        return false;
    }

    if (!emdParsed.file || !analyzerParsed.file) {
        return false;
    }

    if (emdParsed.file.toLowerCase() !== analyzerParsed.file.toLowerCase()) {
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
    const file = basenameFile(impact.file);

    if (!file || file === "Not Found") {
        return "■Not Found";
    }

    const token = functionToken(impact.function);

    if (!token) {
        return `■${file}`;
    }

    return `■${file}\n${token}()`;
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
            const fallback = "./1231_Updated_locked.xlsx";
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

    return current;
}

function isSectionMarker(bText) {
    const text = bText.trim();
    return (
        text === "■UVP" ||
        text === "■VCP" ||
        text === "■Behavior Mode" ||
        text === "UVP" ||
        text === "VCP" ||
        /^■?\s*Behavior\s*Mode$/i.test(text)
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
            section === SECTION.NONE ||
            isSectionMarker(bText) ||
            isHeaderOrMetaRow(bText, cText)
        ) {
            continue;
        }

        // ExcelJS expands merged Name cells onto every row in the block.
        if (isNameStart(bText, section)) {
            if (current && current.name === bTrim) {
                if (cText.trim() || resultText.trim()) {
                    current.rows.push(rowNumber);
                    current.endRow = rowNumber;
                }
                continue;
            }

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

function applyMapping(worksheet, switches) {
    const logEntries = [];
    const groups = collectNameGroups(worksheet);
    const emdNames = new Set(groups.map((group) => group.name));

    for (const name of Object.keys(switches)) {
        if (!emdNames.has(name)) {
            pushLog(logEntries, {
                action: "NameMissingFromEmd",
                name,
                emdRow: "",
                affecting: "",
                result: mapResultSymbol(switches[name].result),
                reason: `Name exists in result.json (kind=${switches[name].kind}) but not in EMD; no Name block created`
            });
        }
    }

    const ordered = [...groups].sort((a, b) => b.startRow - a.startRow);

    let matchedRows = 0;
    let insertedRows = 0;

    for (const group of ordered) {
        const entry = switches[group.name];

        if (!entry) {
            for (const rowNumber of group.rows) {
                const cText = cellText(
                    worksheet.getRow(rowNumber).getCell(3).value
                );
                if (cText.trim()) {
                    pushLog(logEntries, {
                        action: "Orphan",
                        name: group.name,
                        emdRow: rowNumber,
                        affecting: cText,
                        result: "",
                        reason: "Name not present in result.json; E left unchanged"
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
                const cText = cellText(
                    worksheet.getRow(rowNumber).getCell(3).value
                );
                if (cText.trim()) {
                    pushLog(logEntries, {
                        action: "Orphan",
                        name: group.name,
                        emdRow: rowNumber,
                        affecting: cText,
                        result: "",
                        reason: "Analyzer Not Found; template impact left unchanged"
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
                matchedRows += 1;

                const matched = unmatchedAnalyzer[matchIndex];
                pushLog(logEntries, {
                    action: "Matched",
                    name: group.name,
                    emdRow: rowNumber,
                    affecting: cText,
                    result: symbol,
                    reason: `Matched analyzer impact ${matched.file}${matched.functionToken ? " / " + matched.functionToken : ""}; wrote E`
                });
            } else {
                pushLog(logEntries, {
                    action: "Orphan",
                    name: group.name,
                    emdRow: rowNumber,
                    affecting: cText,
                    result: "",
                    reason: "No matching analyzer impact; E left unchanged"
                });
            }
        }

        const toInsert = [];

        for (let index = 0; index < unmatchedAnalyzer.length; index++) {
            if (!usedAnalyzer.has(index)) {
                toInsert.push(unmatchedAnalyzer[index]);
            }
        }

        if (toInsert.length === 0) {
            continue;
        }

        const insertAt = group.endRow + 1;
        worksheet.spliceRows(insertAt, 0, ...toInsert.map(() => []));

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
                "Investigation log for excel_mapper.js (Phase 2). Separate from 1231_Updated.xlsx on purpose — no log sheets are added inside the Updated workbook."
        },
        {
            topic: "How to use",
            item: "Workflow",
            description:
                "1) Open Summary for counts. 2) Open Actions and filter by Action. 3) Use EMD Row + Name + Affecting to find the row in 1231_Updated.xlsx. 4) Read Reason."
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
            description: "Switch or behavior name (EMD column B)."
        },
        {
            topic: "Column",
            item: "EMD Row",
            description: "Row number on EMD in 1231_Updated.xlsx."
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
                "Symbol written to EMD column E: ○ / × / -. Empty when E was left unchanged (Orphan)."
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
                "Existing EMD C matched an analyzer impact; wrote ○/×/- into E."
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
                "EMD C row with no analyzer match; E left unchanged."
        },
        {
            topic: "Action type",
            item: "NameMissingFromEmd",
            description:
                "Name in result.json but no EMD Name block (v1 does not create blocks)."
        },
        {
            topic: "Related files",
            item: "Inputs / outputs",
            description:
                "Inputs: result.json, 1231.xlsx. Outputs: 1231_Updated.xlsx (EMD E filled), mapping_log.xlsx. Each run rebuilds from 1231.xlsx. Rules: docs/emd_mapping.md."
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
        description: "UVP_SW_* / BEHAVIOR_MODE_IF_* Name blocks on EMD."
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
        description: "Template C rows with no analyzer match."
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
        name: "Switch / behavior name",
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
            const fallback = "./mapping_log_locked.xlsx";
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
        throw new Error(`Template not found: ${TEMPLATE_PATH}`);
    }

    const resultData = loadResultJson(JSON_FILE_PATH);
    const switchCount = Object.keys(resultData.switches).length;
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

main().catch((error) => {
    console.error("Error:", error.message);
    process.exitCode = 1;
});
