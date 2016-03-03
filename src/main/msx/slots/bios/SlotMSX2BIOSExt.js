// Copyright 2015 by Paulo Augusto Peccin. See license.txt distributed with this file.

// MSX2 16K BIOS Extension ROM
// 0x0000 - 0x3fff

wmsx.SlotMSX2BIOSExt = function(rom) {

    function init(self) {
        self.rom = rom;
        bytes = wmsx.Util.arrayFill(new Array(16384), 0xff);
        self.bytes = bytes;
        var content = self.rom.content;
        for(var i = 0, len = content.length; i < len; i++)
            bytes[i] = content[i];
    }

    this.read = function(address) {
        if (address < 0x4000)
            return bytes[address];
        else
            return 0xff;
    };


    var bytes;
    this.bytes = null;

    this.rom = null;
    this.format = wmsx.SlotFormats.MSX2BIOSExt;


    // Savestate  -------------------------------------------

    this.saveState = function() {
        return {
            f: this.format.name,
            r: this.rom.saveState(),
            b: wmsx.Util.compressInt8BitArrayToStringBase64(bytes)
        };
    };

    this.loadState = function(state) {
        this.rom = wmsx.ROM.loadState(state.r);
        bytes = wmsx.Util.uncompressStringBase64ToInt8BitArray(state.b, bytes);
        this.bytes = bytes;
    };


    if (rom) init(this);

};

wmsx.SlotMSX2BIOSExt.prototype = wmsx.Slot.base;

wmsx.SlotMSX2BIOSExt.recreateFromSaveState = function(state, previousSlot) {
    var ext = previousSlot || new wmsx.SlotMSX2BIOSExt();
    ext.loadState(state);
    return ext;
};

