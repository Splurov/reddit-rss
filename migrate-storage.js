'use strict';

var fs = require('fs');
var path = require('path');

var config = require('./config.json');
var storageUtils = require('./lib/storage');
var migrateLegacyStorage = require('./lib/migrate-storage');

var ensureDirectory = function(directoryPath) {
    if (fs.existsSync(directoryPath)) {
        return;
    }

    var parentDirectory = path.dirname(directoryPath);
    if (parentDirectory !== directoryPath) {
        ensureDirectory(parentDirectory);
    }
    fs.mkdirSync(directoryPath);
};

var writeFileAtomicSync = function(filePath, content) {
    ensureDirectory(path.dirname(filePath));

    var temporaryPath = filePath + '.tmp-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    try {
        fs.writeFileSync(temporaryPath, content);
        fs.renameSync(temporaryPath, filePath);
    } catch (error) {
        if (fs.existsSync(temporaryPath)) {
            fs.unlinkSync(temporaryPath);
        }
        throw error;
    }
};

var main = function() {
    if (!config.storageFilePath) {
        throw new Error('Missing required config value: storageFilePath');
    }
    if (!fs.existsSync(config.storageFilePath)) {
        throw new Error('storage.json does not exist: ' + config.storageFilePath);
    }

    var source = fs.readFileSync(config.storageFilePath, 'utf8');
    var result = migrateLegacyStorage(JSON.parse(source));
    if (!result.migrated) {
        storageUtils.requireCurrentStorage(result.storage);
        console.log('storage.json already uses the current format; nothing to migrate');
        return;
    }

    var backupPath = config.storageFilePath + '.legacy-backup';
    if (fs.existsSync(backupPath)) {
        throw new Error('Migration backup already exists: ' + backupPath);
    }

    writeFileAtomicSync(backupPath, source);
    writeFileAtomicSync(config.storageFilePath, JSON.stringify(result.storage));
    console.log('Migration complete. Legacy backup: ' + backupPath);
};

try {
    main();
} catch (error) {
    console.error(error.message || String(error));
    process.exitCode = 1;
}
