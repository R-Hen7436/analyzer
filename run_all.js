const { spawn } = require("child_process");
const path = require("path");
const excelMapper = require("./excel_mapper");

const WORKSPACE = process.argv[2];
const PROFILE_INPUT = process.argv[3];

if (!WORKSPACE || !PROFILE_INPUT) {
    console.error("Usage:");
    console.error("  node run_all.js <workspace> <profile>");
    console.error("");
    console.error("Example:");
    console.error(
        "  node run_all.js ubasrh_KPC02530_2291_matsuri3_mp C2WC_prd_profile"
    );
    process.exit(1);
}

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
        console.log("=================================");
        console.log("Step 1: Scanning ren_epc");
        console.log("=================================");

        await runNodeScript("scan_ren_epc.js", [WORKSPACE]);

        console.log("\n=================================");
        console.log("Step 2: Analyzing profile from scan");
        console.log("=================================");

        await runNodeScript("analyze_profile_from_scan.js", [
            WORKSPACE,
            PROFILE_INPUT
        ]);

        console.log("\n=================================");
        console.log("Step 3: Running excel mapper");
        console.log("=================================");

        await excelMapper.main();

        console.log("\n=================================");
        console.log("Completed successfully");
        console.log("=================================");
    } catch (error) {
        console.error("\nExecution failed:");
        console.error(error.message || error);
        process.exitCode = 1;
    }
}

main();
