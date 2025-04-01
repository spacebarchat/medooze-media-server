export * from "../src/media-server"; // necessary for swig-generated types to be detected by TS
import * as os from "node:os";
import path from "node:path";
import * as SharedPointer from "./SharedPointer";

try 
{
    //We try first to load it via dlopen on Node 9
    process.dlopen(module,path.resolve(path.dirname(module.filename), "../build/Release/medooze-media-server.node"), os.constants.dlopen.RTLD_NOW);// | os.constants.dlopen.RTLD_DEEPBIND);
} catch (e) {
    //old one
    module.exports = require(/** @type {any} */ ("../build/Release/medooze-media-server"));
}

SharedPointer.wrapNativeModule(module);