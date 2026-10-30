import { randomUUID } from "node:crypto";
import path from "node:path";

type Callback = (error?: NodeJS.ErrnoException | null) => void;
type OutputFileSystem = {
  writeFile: (...args: any[]) => void;
  rename: (from: string, to: string, callback: Callback) => void;
  unlink: (file: string, callback: Callback) => void;
};

// These files are read by Next's static-path and route workers during compilation.
const manifestName = /^(?:build-manifest|fallback-build-manifest|app-build-manifest|react-loadable-manifest|pages-manifest|app-paths-manifest|server-reference-manifest|middleware-manifest|next-font-manifest|prerender-manifest|routes-manifest)\.json$/;
const wrappedFileSystems = new WeakSet<object>();

export function atomicManifestFileSystem<T extends OutputFileSystem>(fileSystem: T, outputDirectory: string): T {
  const root = path.resolve(outputDirectory);
  const wrapper = Object.create(fileSystem) as T;
  wrapper.writeFile = (...args: any[]) => {
    const [file, content] = args;
    const callback = args.at(-1) as Callback;
    if (typeof file !== "string" || typeof callback !== "function") {
      fileSystem.writeFile(...args);
      return;
    }
    const absolute = path.resolve(file);
    const relative = path.relative(root, absolute);
    const inOutput = relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    if (!inOutput || !manifestName.test(path.basename(absolute))) {
      fileSystem.writeFile(...args);
      return;
    }

    const temporary = path.join(path.dirname(absolute), `.${path.basename(absolute)}.${process.pid}.${randomUUID()}.tmp`);
    const options = args.length > 3 ? args.slice(2, -1) : [];
    const failed = (error: NodeJS.ErrnoException) => {
      fileSystem.unlink(temporary, () => callback(error));
    };
    fileSystem.writeFile(temporary, content, ...options, (writeError?: NodeJS.ErrnoException | null) => {
      if (writeError) {
        failed(writeError);
        return;
      }
      fileSystem.rename(temporary, absolute, (renameError?: NodeJS.ErrnoException | null) => {
        if (renameError) failed(renameError);
        else callback(null);
      });
    });
  };
  wrappedFileSystems.add(wrapper);
  return wrapper;
}

type Compiler = {
  outputFileSystem: OutputFileSystem | null;
  options: { output?: { path?: string } };
  hooks: {
    afterEnvironment: { tap(name: string, callback: () => void): void };
    beforeRun: { tap(name: string, callback: () => void): void };
    watchRun: { tap(name: string, callback: () => void): void };
  };
};

export class AtomicManifestPlugin {
  apply(compiler: Compiler) {
    const install = () => {
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
