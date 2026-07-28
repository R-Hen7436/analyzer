const analyzer = require("./analyzer");
const excelMapper = require("./excel_mapper");

async function main() {
    try {
        console.log("=================================");
        console.log("Step 1: Running analyzer");
        console.log("=================================");

        await analyzer.main();

        console.log("\n=================================");
        console.log("Step 2: Running excel mapper");
        console.log("=================================");

        await excelMapper.main();

        console.log("\n=================================");
        console.log("Completed successfully");
        console.log("=================================");
    } catch (error) {
        console.error("\nExecution failed:");
        console.error(error);
        process.exitCode = 1;
    }
}

main();