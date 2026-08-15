const fs = require("fs");
const path = require("path");

const DEFAULT_P4WORK_ROOT = "/data1/p4work";

function listWorkspaces(p4workRoot = DEFAULT_P4WORK_ROOT) {
    if (!fs.existsSync(p4workRoot)) {
        throw new Error(`p4work root not found: ${p4workRoot}`);
    }

    const rootStat = fs.statSync(p4workRoot);
    if (!rootStat.isDirectory()) {
        throw new Error(`p4work root is not a directory: ${p4workRoot}`);
    }

    const entries = fs.readdirSync(p4workRoot, { withFileTypes: true });
    const workspaces = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name)
        .sort();

    return {
        root: p4workRoot,
        workspaces
    };
}

function main() {
    const result = listWorkspaces();
    const json = JSON.stringify(result, null, 4);

    const outputDir = path.join(process.cwd(), "output");
    fs.mkdirSync(outputDir, { recursive: true });

    const outputPath = path.join(outputDir, "workspaces.json");
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
    listWorkspaces
};
