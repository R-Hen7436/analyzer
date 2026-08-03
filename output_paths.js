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

    const templateCandidates = [
        path.join(baseDir, "templates", "renEPC_change_point_list.xlsx"),
        path.join(baseDir, "renEPC_change_point_list.xlsx")
    ];

    const templateXlsx = templateCandidates.find((candidate) =>
        fs.existsSync(candidate)
    ) || templateCandidates[0];

    return {
        workspace,
        profileName,
        runRoot,
        scanDir,
        analyzeDir,
        mapDir,
        scanJson: path.join(scanDir, "ren_epc_scan_result.json"),
        resultJson: path.join(analyzeDir, "result.json"),
        resultXlsx: path.join(analyzeDir, "result.xlsx"),
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
        templateXlsx
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