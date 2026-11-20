import "server-only";
import { ImageWorkbenchService } from "@/application/image-workbench-service";
import { ImageRepository } from "@/infrastructure/database/image-repository";
import {
  database,
  imageSchemaCompatible,
} from "@/infrastructure/database/database.server";
import { createImageFiles } from "@/infrastructure/images/files.server";
import { createImageProviders } from "@/infrastructure/images/providers.server";
import { createImageDiscussion } from "@/infrastructure/pi/image-discussion.server";
import { applicationConfigRoot } from "@/infrastructure/application-config-root";
import path from "node:path";
function create() {
  const store = new ImageRepository(database, () => imageSchemaCompatible);
  const service = new ImageWorkbenchService(
    store,
    createImageFiles(path.join(applicationConfigRoot, "images"), store),
    createImageDiscussion(applicationConfigRoot),
    createImageProviders(applicationConfigRoot),
  );
  if (imageSchemaCompatible) service.start();
  return service;
}
// Next can reload a route in a different globalThis while an accepted worker
// is still running. Keep its queue/subscribers and startup cleanup on the actual
// Node process so a reload cannot mark that worker PROCESS_INTERRUPTED.
const state = process as typeof process & {
  __imageWorkbenchCurrentV9?: Map<string, ImageWorkbenchService>;
};
const services = (state.__imageWorkbenchCurrentV9 ??= new Map());
// Route inspection workers import this module too. Only an actual HTTP request
// may initialize the service and perform startup interruption handling.
export function getImageWorkbench() {
  let service = services.get(applicationConfigRoot);
  if (!service) {
    service = create();
    services.set(applicationConfigRoot, service);
  } else if (Object.getPrototypeOf(service) !== ImageWorkbenchService.prototype) {
    // Refresh compatible methods after a module reload, preserving active work,
    // queue state and subscriptions on the existing process-scoped instance.
    Object.setPrototypeOf(service, ImageWorkbenchService.prototype);
    service.refreshDiscussion(createImageDiscussion(applicationConfigRoot));
  }
  return service;
}
