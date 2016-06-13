// Copyright 2015 by Paulo Augusto Peccin. See license.txt distributed with this file.

// Dual Disk Drive ( A: = drive 0, B: = drive 1 )
wmsx.FileDiskDrive = function() {
    var self = this;

    function init() {
        emptyStack(0);
        emptyStack(1);
    }

    this.connect = function(pDiskDriveSocket) {
        diskDriveSocket = pDiskDriveSocket;
        diskDriveSocket.connectDrive(this);
        images.connect(diskDriveSocket);
    };

    this.connectPeripherals = function(pScreen, pDownloader) {
        screen = pScreen;
        fileDownloader = pDownloader;
    };

    this.loadDiskStackFromFiles = function (drive, name, files, altPower, anyContent, filesFromZip) {
        var stack = [];
        try {
            for (var i = 0; i < files.length; i++) {
                var file = files[i];
                if (filesFromZip && file.content === undefined) file.content = file.asUint8Array();
                if (!checkContentIsValidImage(file.content, anyContent)) continue;
                var fileName = file.name.split("/").pop();
                stack.push({ name: fileName, content: file.content});
            }
            if (stack.length > 0) {
                loadStack(drive, name, stack);
                diskDriveSocket.autoPowerCycle(altPower);
                stackLoadedMessage(drive);
                return stack;
            }
        } catch(ez) {
            console.log(ez.stack);      // Error decompressing files. Abort
        }
        return null;
    };

    this.loadAsDiskFromFiles = function(drive, name, files, altPower, type) {
        var content = images.createFromFiles(0xF9, files);
        if (!content) return null;

        type = type || "Files as Disk";
        name = name || ("New " + type + ".dsk");
        var stack = [{ name: name, content: content }];
        loadStack(drive, name, stack);
        diskDriveSocket.autoPowerCycle(altPower);
        stackLoadedMessage(drive, type);
        return stack;
    };

    this.insertNewFormattedDisk = function(drive, mediaType) {                // Cycle among format options if no mediaType given
        if (!mediaType) {
            if (++(nextNewDiskFormatOption[drive]) >= this.FORMAT_OPTIONS_MEDIA_TYPES.length) nextNewDiskFormatOption[drive] = 0;
            mediaType = this.FORMAT_OPTIONS_MEDIA_TYPES[nextNewDiskFormatOption[drive]];
        }
        var fileName = "New " + this.MEDIA_TYPE_INFO[mediaType].desc + " Disk.dsk";
        var content = images.createNewFormattedDisk(mediaType);
        replaceCurrentDisk(drive, fileName, content);
        screen.showOSD("New formatted " + this.MEDIA_TYPE_INFO[mediaType].desc + " Disk loaded in Drive " + driveName[drive], true);
    };

    this.removeStack = function(drive) {
        if (noDiskInsertedMessage(drive)) return;

        var wasStack = driveStack[drive].length > 1;
        emptyStack(drive);
        driveDiskChanged[drive] = null;

        screen.showOSD((wasStack ? "Stack in " : "Disk ") + driveName[drive] + " removed", true);
        fireMediaStateUpdate();
    };

    this.saveDiskFile = function(drive) {
        if (noDiskInsertedMessage(drive)) return;

        try {
            fileDownloader.startDownloadBinary(makeFileNameToSave(currentDisk(drive).name), new Uint8Array(currentDisk(drive).content), "Disk " + driveName[drive] + " file");
        } catch(ex) {
            // give up
        }
    };

    this.insertPreviousDisk = function(drive) {
        var newNum = curDisk[drive] - 1;
        if (newNum >= 0) setCurrentDisk(drive, newNum);
        stackDiskInsertedMessage(drive);
    };

    this.insertNextDisk = function(drive) {
        var newNum = curDisk[drive] + 1;
        if (newNum < driveStack[drive].length) setCurrentDisk(drive, newNum);
        stackDiskInsertedMessage(drive);
    };

    function checkContentIsValidImage(content, anyContent) {
        var zip = wmsx.Util.checkContentIsZIP(content);
        if (zip) {
            var files = zip.file(/.+/);
            for (var f in files) {
                var res = checkInnerContentIsValidImage(files[f].asUint8Array(), anyContent);
                if (res) return res;
            }
            return null
        } else return checkInnerContentIsValidImage(content, anyContent);
    }

    function checkInnerContentIsValidImage(content, anyContent) {
        if (!self.MEDIA_TYPE_VALID_SIZES.has(content.length)) return null;                         // Valid image size
        return (anyContent || content[0] === 0xe9 || content[0] === 0xeb) ? content : null;        // Valid boot sector?
    }

    function emptyStack(drive) {
        driveStack[drive].length = 1;
        driveStack[drive][0] = { name: null, content: null };
        curDisk[drive] = 0;
    }

    function loadStack(drive, name, stack) {
        driveStack[drive] = stack;
        setCurrentDisk(drive, 0);
    }

    function setCurrentDisk(drive, num) {
        curDisk[drive] = num;
        driveDiskChanged[drive] = true;
        fireMediaStateUpdate();
    }

    function replaceCurrentDisk(drive, name, content) {     // Affects only current disk from stack
        currentDisk(drive).name = name;
        currentDisk(drive).content = content;
        driveDiskChanged[drive] = true;
        fireMediaStateUpdate();
        return content;
    }

    function makeFileNameToSave(fileName) {
        if (!fileName) return "New Disk.dsk";

        var period = fileName.lastIndexOf(".");
        fileName = period < 0 ? fileName : fileName.substr(0, period);
        return fileName + ".dsk";
    }

    // DiskDriver interface methods

    this.diskHasChanged = function(drive) {
        if (driveDiskChanged[drive]) {
            driveDiskChanged[drive] = false;
            return true;
        }
        return driveDiskChanged[drive];         // false = no, null = unknown
    };

    this.isDiskInserted = function(drive) {
        return !!(currentDisk(drive).content);
    };

    this.diskWriteProtected = function(drive) {
        return false;
    };

    this.readSectors = function(drive, logicalSector, quantSectors) {
        if (!this.isDiskInserted(drive)) return null;
        var dContent = currentDisk(drive).content;
        var startByte = logicalSector * BYTES_PER_SECTOR;
        var finishByte = startByte + quantSectors * BYTES_PER_SECTOR;
        // Disk boundary check
        if ((startByte >= dContent.length) || (finishByte > dContent.length)) return null;

        return dContent.slice(startByte, finishByte);
    };

    this.writeSectors = function(drive, logicalSector, quantSectors, bytes) {
        return this.writeBytes(drive, bytes, logicalSector * BYTES_PER_SECTOR, quantSectors * BYTES_PER_SECTOR);
    };

    this.writeBytes = function (drive, bytes, startByte, quantBytes) {
        if (!this.isDiskInserted(drive)) return false;

        var dContent = currentDisk(drive).content;
        if (!quantBytes) quantBytes = bytes.length;

        // Disk boundary check
        if ((startByte >= dContent.length) || (startByte + quantBytes > dContent.length)) return false;

        for (var i = 0; i < quantBytes; i++)
            dContent[startByte + i] = bytes[i];

        return true;
    };

    // Returns the extra time for motor to spin (drive LED simulation)
    this.motorOn = function(drive) {
        if (diskMotorOffTimer[drive]) {
            window.clearTimeout(diskMotorOffTimer[drive]);
            diskMotorOffTimer[drive] = null;
        }
        if (driveMotor[drive]) return 0;
        driveMotor[drive] = true;
        fireMotorStateUpdate();
        return MOTOR_SPINUP_EXTRA_ITERATIONS;
    };

    this.allMotorsOff = function(resetDelay) {          // Simulated delay
        motorOff(0, resetDelay);
        motorOff(1, resetDelay);
    };

    this.allMotorsOffNow = function() {                 // Instantly with no delays
        driveMotor[0] = driveMotor[1] = false;
        fireMotorStateUpdate();
    };

    this.insertNewEmptyDisk = function(drive, mediaType) {
        var fileName = "New " + this.MEDIA_TYPE_INFO[mediaType].desc + " Disk.dsk";
        var content = images.createNewEmptyDisk(mediaType);
        replaceCurrentDisk(drive, fileName, content);
        screen.showOSD("New blank " + this.MEDIA_TYPE_INFO[mediaType].desc + " Disk loaded in Drive " + driveName[drive], true);
    };

    this.formatDisk = function(drive, mediaType) {
        return images.formatDisk(mediaType, currentDisk(drive).content);
    };

    // Add a delay before turning the motor off (drive LED simulation)
    function motorOff(drive, resetDelay) {
        if (!driveMotor[drive]) return;
        if (diskMotorOffTimer[drive] && resetDelay) {
            window.clearTimeout(diskMotorOffTimer[drive]);
            diskMotorOffTimer[drive] = null;
        }
        if (!diskMotorOffTimer[drive])
            diskMotorOffTimer[drive] = window.setTimeout(function() {
                diskMotorOffTimer[drive] = null;
                driveMotor[drive] = false;
                fireMotorStateUpdate();
            }, MOTOR_SPINDOWN_EXTRA_MILLIS);
    }

    function fireMediaStateUpdate() {
        var stackA = driveStack[0].length > 1;
        var stackB = driveStack[1].length > 1;
        screen.diskDrivesMediaStateUpdate(stackA, stackDiskDesc(0), stackB, stackDiskDesc(1));
        fireMotorStateUpdate();
    }

    function fireMotorStateUpdate() {
        screen.diskDrivesMotorStateUpdate(currentDisk(0).content, driveMotor[0], currentDisk(1).content, driveMotor[1]);
    }

    function noDiskInsertedMessage(drive) {
        if (!self.isDiskInserted(drive)) {
            screen.showOSD("No Disk in Drive " + driveName[drive], true);
            return true;
        } else
            return false;
    }

    function stackLoadedMessage(drive, type) {
        if (driveStack[drive].length <= 1) {
            type = type ? " " + type + " " : " Disk ";
            var size = driveStack[drive][0].content ? "" + ((driveStack[drive][0].content.length / 1024) | 0) + "KB" : "";
            screen.showOSD("" + size + type + " loaded in Drive " + driveName[drive], true);
        } else {
            screen.showOSD("Disk Stack loaded in Drive " + driveName[drive] + " (" + driveStack[drive].length + " disks)", true);
        }
    }

    function stackDiskInsertedMessage(drive) {
        if (noDiskInsertedMessage(drive)) return;
        screen.showOSD(stackDiskDesc(drive), true);
    }

    function stackDiskDesc(drive) {
        var stack = driveStack[drive].length > 1;
        return "Disk " + driveName[drive] + " " + (stack ? "(" + (curDisk[drive] + 1) + "/" + driveStack[drive].length + ") " : "") + (currentDisk(drive).name || "");
    }

    function currentDisk(drive) {
        return driveStack[drive][curDisk[drive]];
    }


    // Savestate  -------------------------------------------

    this.saveState = function() {
        var stack = [[], []];
        for (var d = 0; d < driveStack[0].length; ++d) stack[0].push( { name: driveStack[0][d].name, content: wmsx.Util.compressInt8BitArrayToStringBase64(driveStack[0][d].content) });
        for (    d = 0; d < driveStack[1].length; ++d) stack[1].push( { name: driveStack[1][d].name, content: wmsx.Util.compressInt8BitArrayToStringBase64(driveStack[1][d].content) });
        return {
            s: stack,
            c: curDisk,
            g: driveDiskChanged,
            m: driveMotor
        };
    };

    this.loadState = function(state) {
        var oldStack = driveStack;
        driveStack[0].length = driveStack[1].length = 0;
        var stack = state.s;
        for (var d = 0; d < stack[0].length; ++d) driveStack[0].push( { name: stack[0][d].name, content: wmsx.Util.uncompressStringBase64ToInt8BitArray(stack[0][d].content, oldStack[0][d] && oldStack[0][d].content) });
        for (    d = 0; d < stack[1].length; ++d) driveStack[1].push( { name: stack[1][d].name, content: wmsx.Util.uncompressStringBase64ToInt8BitArray(stack[1][d].content, oldStack[1][d] && oldStack[1][d].content) });
        curDisk = state.c;
        driveDiskChanged = state.g;
        driveMotor = state.m;
        fireMediaStateUpdate();
        this.allMotorsOff(true);
    };


    this.eval = function(str) {
        return eval(str);
    };

    var images = new wmsx.DiskImages();

    var screen;
    var fileDownloader;
    var diskDriveSocket;

    var driveStack   = [[], []];                    // Several disks can be loaded for each drive
    var curDisk      = [0, 0];                      // Current disk from stack inserted in drive

    var driveDiskChanged  = [ null, null ];         // true = yes, false = no, null = unknown
    var driveMotor        = [ false, false ];
    var diskMotorOffTimer = [ null, null ];

    var driveName = [ "A:", "B:" ];
    var nextNewDiskFormatOption = [ -1, -1 ];

    var BYTES_PER_SECTOR = 512;                     // Fixed for now, for all disks

    var MOTOR_SPINUP_EXTRA_ITERATIONS = 100000;
    var MOTOR_SPINDOWN_EXTRA_MILLIS = 2300;

    this.FORMAT_OPTIONS_MEDIA_TYPES = images.FORMAT_OPTIONS_MEDIA_TYPES;
    this.MEDIA_TYPE_INFO = images.MEDIA_TYPE_INFO;
    this.MEDIA_TYPE_VALID_SIZES = images.MEDIA_TYPE_VALID_SIZES;
    this.MEDIA_TYPE_DPB = images.MEDIA_TYPE_DPB;


    init();

};
