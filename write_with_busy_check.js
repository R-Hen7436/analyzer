const fs = require("fs");

function isFileBusyError(error) {
    if (!error || !error.code) {
        return false;
    }

    return (
        error.code === "EBUSY" ||
        error.code === "EPERM" ||
        error.code === "EACCES"
    );
}

function buildBusyWarning(filePath) {
    return (
        `Warning: "${filePath}" is open or locked.\n` +
        `Close the Excel file, then run the command again in the terminal.`
    );
}

function writeFileSyncWithBusyCheck(filePath, data, options) {
    try {
        fs.writeFileSync(filePath, data, options);
        return filePath;
    } catch (error) {
        if (isFileBusyError(error)) {
            console.warn(buildBusyWarning(filePath));
            throw new Error(
                `"${filePath}" is open/locked. Close it and run again.`
            );
        }

        throw error;
    }
}

async function writeExcelFileWithBusyCheck(workbook, filePath) {
    try {
        await workbook.xlsx.writeFile(filePath);
        return filePath;
    } catch (error) {
        if (isFileBusyError(error)) {
            console.warn(buildBusyWarning(filePath));
            throw new Error(
                `"${filePath}" is open/locked. Close it and run again.`
            );
        }

        throw error;
    }
}

module.exports = {
    isFileBusyError,
    buildBusyWarning,
    writeFileSyncWithBusyCheck,
    writeExcelFileWithBusyCheck
};
