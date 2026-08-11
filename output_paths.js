const fs = require("fs");
const path = require("path");

function normalizeProfileName(profileInput) {
    const trimmed = String(profileInput || "").trim();

    if (!trimmed) {
        return trimmed;
    }

    return trimmed.endsWith(".mk") ? trimmed.slice(0, -3) : trimmed;
}

function firstExistingPath(candidates, fallback) {
    return candidates.find((candidate) => fs.existsSync(candidate)) || fallback;
}

function getRunPaths(workspace, profileInput, baseDir = process.cwd()) {
    const profileName = normalizeProfileName(profileInput);
    const runRoot = path.join(baseDir, "output", workspace, profileName);

    const scanDir = path.join(runRoot, "scan");
    const analyzeDir = path.join(runRoot, "analyze");
    const mapDir = path.join(runRoot, "map");

    const renDocumentXlsx = firstExistingPath(
        [
            path.join(baseDir, "document", "renEPC_change_point_list.xlsx"),
            path.join(baseDir, "renEPC_change_point_list.xlsx")
        ],
        path.join(baseDir, "document", "renEPC_change_point_list.xlsx")
    );

    const dvuDocumentXlsx = firstExistingPath(
        [
            path.join(baseDir, "document", "dvuAI_change_point_list.xlsx"),
            path.join(baseDir, "dvuAI_change_point_list.xlsx")
        ],
        path.join(baseDir, "document", "dvuAI_change_point_list.xlsx")
    );

    const dvcDocumentXlsx = firstExistingPath(
        [
            path.join(baseDir, "document", "dvcAI_change_point_list.xlsx"),
            path.join(baseDir, "dvcAI_change_point_list.xlsx")
        ],
        path.join(baseDir, "document", "dvcAI_change_point_list.xlsx")
    );

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

    const mapUpdatedXlsx = path.join(
        mapDir,
        "renEPC_change_point_list_updated.xlsx"
    );
    const dvuMapUpdatedXlsx = path.join(
        mapDir,
        "dvuAI_change_point_list_updated.xlsx"
    );
    const dvcMapUpdatedXlsx = path.join(
        mapDir,
        "dvcAI_change_point_list_updated.xlsx"
    );

    const mappingLogXlsx = path.join(mapDir, "mapping_log.xlsx");
    const dvuMappingLogXlsx = path.join(mapDir, "dvu_ai_mapping_log.xlsx");
    const dvcMappingLogXlsx = path.join(mapDir, "dvc_ai_mapping_log.xlsx");

    const mappingLogJson = path.join(mapDir, "mapping_log.json");
    const dvuMappingLogJson = path.join(mapDir, "dvu_ai_mapping_log.json");
    const dvcMappingLogJson = path.join(mapDir, "dvc_ai_mapping_log.json");

    const mapLockedXlsx = path.join(
        mapDir,
        "renEPC_change_point_list_Updated_locked.xlsx"
    );
    const dvuMapLockedXlsx = path.join(
        mapDir,
        "dvuAI_change_point_list_Updated_locked.xlsx"
    );
    const dvcMapLockedXlsx = path.join(
        mapDir,
        "dvcAI_change_point_list_Updated_locked.xlsx"
    );

    const mappingLogLockedXlsx = path.join(mapDir, "mapping_log_locked.xlsx");
    const dvuMappingLogLockedXlsx = path.join(
        mapDir,
        "dvu_ai_mapping_log_locked.xlsx"
    );
    const dvcMappingLogLockedXlsx = path.join(
        mapDir,
        "dvc_ai_mapping_log_locked.xlsx"
    );

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
        documentXlsx: renDocumentXlsx,
        dvuDocumentXlsx,
        dvcDocumentXlsx,
        documentXlsxByModule: {
            ren_epc: renDocumentXlsx,
            dvu_ai: dvuDocumentXlsx,
            dvc_ai: dvcDocumentXlsx
        },
        mapUpdatedXlsx,
        dvuMapUpdatedXlsx,
        dvcMapUpdatedXlsx,
        mapUpdatedXlsxByModule: {
            ren_epc: mapUpdatedXlsx,
            dvu_ai: dvuMapUpdatedXlsx,
            dvc_ai: dvcMapUpdatedXlsx
        },
        mappingLogXlsx,
        dvuMappingLogXlsx,
        dvcMappingLogXlsx,
        mappingLogXlsxByModule: {
            ren_epc: mappingLogXlsx,
            dvu_ai: dvuMappingLogXlsx,
            dvc_ai: dvcMappingLogXlsx
        },
        mappingLogJson,
        dvuMappingLogJson,
        dvcMappingLogJson,
        mappingLogJsonByModule: {
            ren_epc: mappingLogJson,
            dvu_ai: dvuMappingLogJson,
            dvc_ai: dvcMappingLogJson
        },
        mapLockedXlsx,
        dvuMapLockedXlsx,
        dvcMapLockedXlsx,
        mapLockedXlsxByModule: {
            ren_epc: mapLockedXlsx,
            dvu_ai: dvuMapLockedXlsx,
            dvc_ai: dvcMapLockedXlsx
        },
        mappingLogLockedXlsx,
        dvuMappingLogLockedXlsx,
        dvcMappingLogLockedXlsx,
        mappingLogLockedXlsxByModule: {
            ren_epc: mappingLogLockedXlsx,
            dvu_ai: dvuMappingLogLockedXlsx,
            dvc_ai: dvcMappingLogLockedXlsx
        }
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
