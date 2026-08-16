const { spawn } = require("child_process");
const path = require("path");
const readline = require("readline");
const { getRunPaths, ensureRunDirs } = require("./lib/output_paths");
const { listWorkspaces } = require("./lib/list_workspaces");
const { listProfiles } = require("./lib/list_profiles");

const MENU_INDENT = "  ";
const MENU_COL_GAP = 2;

function printUsage() {
    console.error("Module Feature Analysis");
    console.error("");
    console.error("Usage:");
    console.error("  node analyze.js");
    console.error(
        "  node analyze.js <workspace> <uvp_profile> <behavior_profile>"
    );
    console.error("");
    console.error("Example:");
    console.error(
        "  node analyze.js ubasrh_KPC02530_2291_matsuri3_mp mo2cc5lpN01_uvp_profile C2YC_uvp_profile"
    );
}

function getTerminalWidth(options = {}) {
    if (options.terminalWidth) {
        return options.terminalWidth;
    }
    const columns = process.stdout && process.stdout.columns;
    return columns && columns > 0 ? columns : 80;
}

function formatMenuCell(number, name, numWidth, cellWidth) {
    const text = `${String(number).padStart(numWidth)}. ${name}`;
    if (!cellWidth || text.length >= cellWidth) {
        return text;
    }
    return text.padEnd(cellWidth);
}

function formatColumnMenu(items, options = {}) {
    const terminalWidth = getTerminalWidth(options);
    const count = items.length;
    if (count === 0) {
        return "";
    }

    const numWidth = String(count).length;
    const longestName = items.reduce(
        (max, name) => Math.max(max, String(name).length),
        0
    );
    const cellWidth = numWidth + 2 + longestName;
    const available = Math.max(1, terminalWidth - MENU_INDENT.length);
    const cols = Math.max(
        1,
        Math.min(
            count,
            Math.floor((available + MENU_COL_GAP) / (cellWidth + MENU_COL_GAP))
        )
    );
    const rows = Math.ceil(count / cols);

    const lines = [];
    for (let r = 0; r < rows; r += 1) {
        const cells = [];
        for (let c = 0; c < cols; c += 1) {
            const index = r * cols + c;
            if (index >= count) {
                break;
            }
            cells.push(
                formatMenuCell(
                    index + 1,
                    items[index],
                    numWidth,
                    cols > 1 ? cellWidth : null
                )
            );
        }
        lines.push(MENU_INDENT + cells.join(" ".repeat(MENU_COL_GAP)));
    }
    return lines.join("\n");
}

function printColumnMenu(items) {
    console.log(formatColumnMenu(items));
}

function printBackOption(label) {
    console.log(`${MENU_INDENT}0. ${label}`);
}

function ask(rl, prompt) {
    return new Promise((resolve, reject) => {
        const onClose = () => {
            reject(new Error("Input closed before a selection was made"));
        };
        rl.once("close", onClose);
        rl.question(prompt, (answer) => {
            rl.removeListener("close", onClose);
            if (answer == null) {
                reject(new Error("Input closed before a selection was made"));
                return;
            }
            resolve(answer);
        });
    });
}

async function promptForNumber(rl, count, options = {}) {
    const allowBack = Boolean(options.allowBack);
    const min = allowBack ? 0 : 1;
    while (true) {
        const raw = await ask(rl, "Enter number: ");
        const trimmed = String(raw).trim();
        if (!/^\d+$/.test(trimmed)) {
            continue;
        }
        const num = Number(trimmed);
        if (num < min || num > count) {
            continue;
        }
        return num;
    }
}

async function selectFromMenu(rl, title, items, options = {}) {
    const backLabel = options.backLabel;
    console.log(title);
    printColumnMenu(items);
    if (backLabel) {
        printBackOption(backLabel);
    }
    const num = await promptForNumber(rl, items.length, {
        allowBack: Boolean(backLabel)
    });
    if (num === 0) {
        return null;
    }
    return items[num - 1];
}

function cancelledError() {
    const error = new Error("Cancelled");
    error.cancelled = true;
    return error;
}

async function promptInteractiveInputs() {
    const { workspaces } = listWorkspaces();
    if (workspaces.length === 0) {
        throw new Error("No workspaces found");
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        while (true) {
            const workspace = await selectFromMenu(
                rl,
                "Select Workspace",
                workspaces,
                { backLabel: "Exit" }
            );
            if (!workspace) {
                throw cancelledError();
            }

            let profiles;
            try {
                ({ profiles } = listProfiles(workspace));
            } catch (error) {
                console.log("");
                console.log(error.message);
                console.log("");
                continue;
            }

            if (profiles.length < 2) {
                console.log("");
                console.log(
                    `Need at least 2 profiles to pick UVP and behavior (found ${profiles.length} in ${workspace})`
                );
                console.log("");
                continue;
            }

            while (true) {
                console.log("");
                const uvpProfile = await selectFromMenu(
                    rl,
                    "Select Profiles (for UVP Switch)",
                    profiles,
                    { backLabel: "Back" }
                );
                if (!uvpProfile) {
                    console.log("");
                    break;
                }

                while (true) {
                    console.log("");
                    const behaviorProfile = await selectFromMenu(
                        rl,
                        "Select Profiles (for Behavior Switch)",
                        profiles,
                        { backLabel: "Back" }
                    );
                    if (!behaviorProfile) {
                        break;
                    }
                    if (behaviorProfile === uvpProfile) {
                        console.log(
                            "UVP and behavior profiles must be different."
                        );
                        continue;
                    }
                    return {
                        workspace,
                        uvpProfile,
                        behaviorProfile
                    };
                }
            }
        }
    } finally {
        rl.close();
    }
}

function runNodeScript(scriptName, args) {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, "lib", scriptName);
        const child = spawn(process.execPath, [scriptPath, ...args], {
            cwd: process.cwd(),
            stdio: "inherit"
        });

        child.on("error", reject);

        child.on("exit", (code, signal) => {
            if (signal) {
                reject(
                    new Error(`${scriptName} terminated by signal ${signal}`)
                );
                return;
            }

            if (code !== 0) {
                reject(new Error(`${scriptName} exited with code ${code}`));
                return;
            }

            resolve();
        });
    });
}

function parseRunArgs(argv = process.argv) {
    const workspace = argv[2];
    const uvpProfile = argv[3];
    const behaviorProfile = argv[4];
    const hasAllArgs = Boolean(workspace && uvpProfile && behaviorProfile);
    const hasPartialArgs = Boolean(workspace || uvpProfile || behaviorProfile);

    return {
        workspace,
        uvpProfile,
        behaviorProfile,
        hasAllArgs,
        hasPartialArgs
    };
}

async function resolveRunInputs(argv = process.argv) {
    const parsed = parseRunArgs(argv);

    if (parsed.hasAllArgs) {
        if (parsed.uvpProfile === parsed.behaviorProfile) {
            throw new Error("UVP and behavior profiles must be different.");
        }
        return {
            workspace: parsed.workspace,
            profileInput: parsed.uvpProfile,
            behaviorProfileInput: parsed.behaviorProfile
        };
    }

    const selected = await promptInteractiveInputs();
    return {
        workspace: selected.workspace,
        profileInput: selected.uvpProfile,
        behaviorProfileInput: selected.behaviorProfile
    };
}

async function runPipeline(workspace, profileInput, behaviorProfileInput) {
    const RUN_PATHS = ensureRunDirs(
        getRunPaths(workspace, profileInput, behaviorProfileInput)
    );
    console.log(`Output root: ${RUN_PATHS.runRoot}`);

    console.log("=================================");
    console.log("Step 1: Scanning switches (ren_epc, dvu_ai, dvc_ai)");
    console.log("=================================");

    await runNodeScript("scan_switches.js", [
        workspace,
        profileInput,
        behaviorProfileInput,
        "all"
    ]);

    console.log("\n=================================");
    console.log("Step 2: Analyzing profile from scan (ren_epc, dvu_ai, dvc_ai)");
    console.log("=================================");

    await runNodeScript("analyze_profile_from_scan.js", [
        workspace,
        profileInput,
        behaviorProfileInput,
        "all"
    ]);

    console.log("\n=================================");
    console.log("Step 3: Running excel mapper (ren_epc, dvu_ai, dvc_ai)");
    console.log("=================================");

    await runNodeScript("excel_mapper.js", [
        workspace,
        profileInput,
        behaviorProfileInput,
        "all"
    ]);

    console.log("\n=================================");
    console.log("Completed successfully");
    console.log(`Results: ${RUN_PATHS.runRoot}`);
    console.log("=================================");
}

async function main() {
    try {
        const parsed = parseRunArgs();

        if (!parsed.hasAllArgs && parsed.hasPartialArgs) {
            printUsage();
            process.exit(1);
        }

        console.log("Module Feature Analysis");

        if (!parsed.hasAllArgs) {
            console.log("");
        }

        const { workspace, profileInput, behaviorProfileInput } =
            await resolveRunInputs();

        if (!parsed.hasAllArgs) {
            console.log("");
        }

        await runPipeline(workspace, profileInput, behaviorProfileInput);
    } catch (error) {
        if (error && error.cancelled) {
            console.log("Cancelled.");
            return;
        }
        console.error("\nExecution failed:");
        console.error(error.message || error);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    formatColumnMenu,
    promptForNumber,
    promptInteractiveInputs,
    parseRunArgs,
    resolveRunInputs,
    runPipeline
};
