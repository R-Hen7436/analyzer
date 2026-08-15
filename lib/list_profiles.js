const fs = require("fs");
const path = require("path");

const DEFAULT_P4WORK_ROOT = "/data1/p4work";
const PROFILE_DIR_RELATIVE = path.join(
    "stream_target",
    "subsys_PLP",
    "build",
    "profiles"
);

function getProfileDir(workspace, p4workRoot = DEFAULT_P4WORK_ROOT) {
    return path.join(p4workRoot, workspace, PROFILE_DIR_RELATIVE);
}

function listProfiles(workspace, p4workRoot = DEFAULT_P4WORK_ROOT) {
    const trimmedWorkspace = String(workspace || "").trim();
    if (!trimmedWorkspace) {
        throw new Error("workspace is required");
    }

    const profileDir = getProfileDir(trimmedWorkspace, p4workRoot);

    if (!fs.existsSync(profileDir)) {
        throw new Error(`profiles directory not found: ${profileDir}`);
    }

    const dirStat = fs.statSync(profileDir);
    if (!dirStat.isDirectory()) {
        throw new Error(`profiles path is not a directory: ${profileDir}`);
    }

    const entries = fs.readdirSync(profileDir, { withFileTypes: true });
    const profiles = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".mk"))
        .map((entry) => entry.name.slice(0, -3))
        .sort();

    return {
        workspace: trimmedWorkspace,
        profileDir,
        profiles
    };
}

function main() {
    const workspace = process.argv[2];
    if (!workspace) {
        throw new Error("Usage: node list_profiles.js <workspace>");
    }

    const result = listProfiles(workspace);
    const json = JSON.stringify(result, null, 4);

    const outputDir = path.join(process.cwd(), "output", result.workspace);
    fs.mkdirSync(outputDir, { recursive: true });

    const outputPath = path.join(outputDir, "profiles.json");
    fs.writeFileSync(outputPath, json, "utf8");

    console.log(json);
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error("Error:", error.message);
        process.exitCode = 1;
    }
}

module.exports = {
    listProfiles
};
