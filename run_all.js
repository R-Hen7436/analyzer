const { spawn } = require("child_process");
const path = require("path");
const { getRunPaths, ensureRunDirs } = require("./output_paths");

const WORKSPACE = process.argv[2];
const PROFILE_INPUT = process.argv[3];
const BEHAVIOR_PROFILE_INPUT = process.argv[4] || "mo2mmtsm";

if (!WORKSPACE || !PROFILE_INPUT) {
    console.error("Usage:");
    console.error(
        "  node run_all.js <workspace> <uvp_profile> [behavior_profile]"
    );
    console.error("");
    console.error("Example:");
    console.error(
        "  node run_all.js ubasrh_KPC02530_2291_matsuri3_mp C2YC_uvp_profile mo2mmtsm"
    );
    console.error("");
    console.error(
        "  behavior_profile defaults to mo2mmtsm when omitted (local);"
    );
    console.error("  it is passed only to analyze_profile_from_scan.js.");
    process.exit(1);
}

const RUN_PATHS = ensureRunDirs(getRunPaths(WORKSPACE, PROFILE_INPUT));

function runNodeScript(scriptName, args) {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, scriptName);
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

async function main() {
    try {
        console.log(`Output root: ${RUN_PATHS.runRoot}`);

        console.log("=================================");
        console.log("Step 1: Scanning ren_epc");
        console.log("=================================");

        await runNodeScript("scan_ren_epc.js", [WORKSPACE, PROFILE_INPUT]);

        console.log("\n=================================");
        console.log("Step 2: Analyzing profile from scan");
        console.log("=================================");

        await runNodeScript("analyze_profile_from_scan.js", [
            WORKSPACE,
            PROFILE_INPUT,
            BEHAVIOR_PROFILE_INPUT
        ]);

        console.log("\n=================================");
        console.log("Step 3: Running excel mapper");
        console.log("=================================");

        await runNodeScript("excel_mapper.js", [WORKSPACE, PROFILE_INPUT]);

        console.log("\n=================================");
        console.log("Completed successfully");
        console.log(`Results: ${RUN_PATHS.runRoot}`);
        console.log("=================================");
    } catch (error) {
        console.error("\nExecution failed:");
        console.error(error.message || error);
        process.exitCode = 1;
    }
}

main();