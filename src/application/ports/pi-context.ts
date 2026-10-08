import type {NativeContextInspection} from "@/domain/native-context";
import type {PiSessionHandle,SessionRuntimeInput} from "./pi-runtime";

/** Pi owns the model context window; the application exposes only its safe controls. */
export interface PiContextPort {
  inspect(input:SessionRuntimeInput):Promise<NativeContextInspection>;
  compact(handle:PiSessionHandle):Promise<void>;
  cancelCompaction(handle:PiSessionHandle):void;
}
