"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get AtomicManifestPlugin () {
        return AtomicManifestPlugin;
    },
    get atomicManifestFileSystem () {
        return atomicManifestFileSystem;
    }
});
const _nodecrypto = require("node:crypto");
const _nodepath = /*#__PURE__*/ _interop_require_default(require("node:path"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
// These files are read by Next's static-path and route workers during compilation.
const manifestName = /^(?:build-manifest|fallback-build-manifest|app-build-manifest|react-loadable-manifest|pages-manifest|app-paths-manifest|server-reference-manifest|middleware-manifest|next-font-manifest|prerender-manifest|routes-manifest)\.json$/;
const wrappedFileSystems = new WeakSet();
function atomicManifestFileSystem(fileSystem, outputDirectory) {
    const root = _nodepath.default.resolve(outputDirectory);
    const wrapper = Object.create(fileSystem);
    wrapper.writeFile = (...args)=>{
        const [file, content] = args;
        const callback = args.at(-1);
        if (typeof file !== "string" || typeof callback !== "function") {
            fileSystem.writeFile(...args);
            return;
        }
        const absolute = _nodepath.default.resolve(file);
        const relative = _nodepath.default.relative(root, absolute);
        const inOutput = relative !== ".." && !relative.startsWith(`..${_nodepath.default.sep}`) && !_nodepath.default.isAbsolute(relative);
        if (!inOutput || !manifestName.test(_nodepath.default.basename(absolute))) {
            fileSystem.writeFile(...args);
            return;
        }
        const temporary = _nodepath.default.join(_nodepath.default.dirname(absolute), `.${_nodepath.default.basename(absolute)}.${process.pid}.${(0, _nodecrypto.randomUUID)()}.tmp`);
        const options = args.length > 3 ? args.slice(2, -1) : [];
        const failed = (error)=>{
            fileSystem.unlink(temporary, ()=>callback(error));
        };
        fileSystem.writeFile(temporary, content, ...options, (writeError)=>{
            if (writeError) {
                failed(writeError);
                return;
            }
            fileSystem.rename(temporary, absolute, (renameError)=>{
                if (renameError) failed(renameError);
                else callback(null);
            });
        });
    };
    wrappedFileSystems.add(wrapper);
    return wrapper;
}
class AtomicManifestPlugin {
    apply(compiler) {
        const install = ()=>{
            const fileSystem = compiler.outputFileSystem;
            const directory = compiler.options.output?.path;
            if (!fileSystem || !directory || wrappedFileSystems.has(fileSystem)) return;
            compiler.outputFileSystem = atomicManifestFileSystem(fileSystem, directory);
        };
        compiler.hooks.afterEnvironment.tap("AtomicManifestPlugin", install);
        compiler.hooks.beforeRun.tap("AtomicManifestPlugin", install);
        compiler.hooks.watchRun.tap("AtomicManifestPlugin", install);
    }
}
