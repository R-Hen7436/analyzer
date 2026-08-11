const fs = require("fs");
const path = require("path");

function normalizeProfileName(profileInput) {
    const trimmed = String(profileInput || "").trim();

    if (!trimmed) {
        return trimmed;
    }

    return trimmed.endsWith(".mk") ? trimmed.slice(0, -3) : trimmed;
}

function getRunPaths(workspace, profileInput, baseDir = process.cwd()) {
    const profileName = normalizeProfileName(profileInput);
    const runRoot = path.join(baseDir, "output", workspace, profileName);

    const scanDir = path.join(runRoot, "scan");
    const analyzeDir = path.join(runRoot, "analyze");
    const mapDir = path.join(runRoot, "map");

    const documentCandidates = [
        path.join(baseDir, "document", "renEPC_change_point_list.xlsx"),
        path.join(baseDir, "renEPC_change_point_list.xlsx")
    ];

    const documentXlsx = documentCandidates.find((candidate) =>
        fs.existsSync(candidate)
    ) || documentCandidates[0];

    const scanJson = path.join(scanDir, "ren_epc_scan_result.json");
    const dvuAiScanJson = path.join(scanDir, "dvu_ai_scan_result.json");
    const dvcAiScanJson = path.join(scanDir, "dvc_ai_scan_result.json");

    // Keep result.json/xlsx as ren_epc aliases for excel_mapper compatibility.
    const resultJson = path.join(analyzeDir, "result.json");
    const resultXlsx = path.join(analyzeDir, "result.xlsx");
    const dvuAiResultJson = path.join(analyzeDir, "dvu_ai_result.json");
    const dvuAiResultXlsx = path.join(analyzeDir, "dvu_ai_result.xlsx");
    const dvcAiResultJson = path.join(analyzeDir, "dvc_ai_result.json");
    const dvcAiResultXlsx = path.join(analyzeDir, "dvc_ai_result.xlsx");

    return {
        workspace,
        profileName,
        runRoot,
        scanDir,
        analyzeDir,
        mapDir,
        scanJson,
        dvuAiScanJson,
        dvcAiScanJson,
        scanJsonByModule: {
            ren_epc: scanJson,
            dvu_ai: dvuAiScanJson,
            dvc_ai: dvcAiScanJson
        },
        resultJson,
        resultXlsx,
        dvuAiResultJson,
        dvuAiResultXlsx,
        dvcAiResultJson,
        dvcAiResultXlsx,
        resultJsonByModule: {
            ren_epc: resultJson,
            dvu_ai: dvuAiResultJson,
            dvc_ai: dvcAiResultJson
        },
        resultXlsxByModule: {
            ren_epc: resultXlsx,
            dvu_ai: dvuAiResultXlsx,
            dvc_ai: dvcAiResultXlsx
        },
        mapUpdatedXlsx: path.join(
            mapDir,
            "renEPC_change_point_list_updated.xlsx"
        ),
        mappingLogXlsx: path.join(mapDir, "mapping_log.xlsx"),
        mappingLogJson: path.join(mapDir, "mapping_log.json"),
        mapLockedXlsx: path.join(
            mapDir,
            "renEPC_change_point_list_Updated_locked.xlsx"
        ),
        mappingLogLockedXlsx: path.join(mapDir, "mapping_log_locked.xlsx"),
        documentXlsx
    };
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function ensureRunDirs(paths) {
    ensureDir(paths.scanDir);
    ensureDir(paths.analyzeDir);
    ensureDir(paths.mapDir);
    return paths;
}

module.exports = {
    normalizeProfileName,
    getRunPaths,
    ensureDir,
    ensureRunDirs
};