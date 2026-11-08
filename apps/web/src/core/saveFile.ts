// Saving a file the person asked for (exports, backups, a workout image) where they expect it, and saying where.
// A plain `<a download>` only works in a browser: the Android app's web view ignores it (nothing happens), so the apps
// save through window.motusNative.saveFile: Android writes into Downloads, the desktop app asks where with a save dialog.
import { toast } from "./toast";

/** Saves the file and says where it went. False when the person cancelled the desktop app's save dialog. */
export async function saveFile(blob: Blob, name: string): Promise<boolean> {
  const native = (globalThis as any).motusNative?.saveFile as ((name: string, bytes: Uint8Array) => Promise<string | null>) | undefined;
  if (native) {
    const where = await native(name, new Uint8Array(await blob.arrayBuffer()));
    if (!where) return false;
    toast(`Saved to ${where}`, { ms: 6000 });
    return true;
  }
  // some browsers only follow a link that is in the page
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  toast(`Saved ${name} to your downloads`, { ms: 6000 });
  return true;
}
