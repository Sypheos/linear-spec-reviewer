import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { App, FileSystemAdapter, TFile, TFolder, normalizePath } from "obsidian";
import { downloadLinearAsset, LinearError } from "./gql";

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
};

export interface StoredImage {
  bytes: ArrayBuffer;
  contentType: string;
  /** Present only when stored inside the vault. */
  vaultPath?: string;
}

/** Stores Linear uploads in a vault folder or an OS-local, vault-specific cache. */
export class AssetStore {
  constructor(
    private readonly app: App,
    private readonly secretName: () => string,
    private readonly specsFolder: () => string
  ) {}

  async load(url: string, inVault: boolean): Promise<StoredImage> {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.host !== "uploads.linear.app") {
      throw new LinearError("Refusing to load an image outside uploads.linear.app.");
    }
    const stem = createHash("sha256").update(parsed.pathname).digest("hex");
    const existing = inVault
      ? await this.readVaultImage(stem)
      : await this.readCacheImage(stem);
    if (existing) return existing;

    const { bytes, contentType } = await downloadLinearAsset(this.app, this.secretName(), url);
    const extension = Object.keys(IMAGE_TYPES).find((ext) => IMAGE_TYPES[ext] === contentType);
    if (!extension) throw new LinearError(`Unsupported Linear image type: ${contentType || "unknown"}.`);
    const name = `${stem}.${extension}`;
    if (inVault) {
      const folder = this.vaultFolder();
      await this.ensureVaultFolder(folder);
      const vaultPath = `${folder}/${name}`;
      if (!this.app.vault.getAbstractFileByPath(vaultPath)) {
        try {
          await this.app.vault.createBinary(vaultPath, bytes);
        } catch (e) {
          // A concurrent preview or import may have created the same image.
          if (!(this.app.vault.getAbstractFileByPath(vaultPath) instanceof TFile)) throw e;
        }
      }
      return { bytes, contentType, vaultPath };
    }

    const folder = this.cacheFolder();
    await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    await fs.chmod(folder, 0o700);
    const temporary = join(folder, `${name}.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, Buffer.from(bytes), { flag: "wx", mode: 0o600 });
      // Linking the complete file is atomic and never overwrites another writer.
      try {
        await fs.link(temporary, join(folder, name));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
    } finally {
      await fs.unlink(temporary).catch((e: unknown) => {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn("[linear-spec-review] could not remove temporary image:", e);
        }
      });
    }
    return { bytes, contentType };
  }

  private vaultFolder(): string {
    const folder = this.specsFolder().replace(/^\/+|\/+$/g, "") || "Specs";
    return normalizePath(`${folder}/_assets`);
  }

  private cacheFolder(): string {
    if (!(this.app.vault.adapter instanceof FileSystemAdapter)) {
      throw new Error("Linear image caching requires a local desktop vault.");
    }
    const vaultId = createHash("sha256")
      .update(this.app.vault.adapter.getBasePath())
      .digest("hex");
    return join(homedir(), ".cache", "linear-spec-review", vaultId);
  }

  private async readVaultImage(stem: string): Promise<StoredImage | null> {
    const folder = this.vaultFolder();
    for (const [ext, contentType] of Object.entries(IMAGE_TYPES)) {
      const vaultPath = `${folder}/${stem}.${ext}`;
      const file = this.app.vault.getAbstractFileByPath(vaultPath);
      if (file instanceof TFile) {
        return { bytes: await this.app.vault.readBinary(file), contentType, vaultPath };
      }
    }
    return null;
  }

  private async readCacheImage(stem: string): Promise<StoredImage | null> {
    const folder = this.cacheFolder();
    for (const [ext, contentType] of Object.entries(IMAGE_TYPES)) {
      try {
        const bytes = await fs.readFile(join(folder, `${stem}.${ext}`));
        return {
          bytes: Uint8Array.from(bytes).buffer,
          contentType,
        };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    return null;
  }

  private async ensureVaultFolder(path: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFolder) return;
    if (existing) throw new Error(`Cannot create asset folder: ${path} is a file.`);
    const parent = path.slice(0, path.lastIndexOf("/"));
    if (parent) await this.ensureVaultFolder(parent);
    try {
      await this.app.vault.createFolder(path);
    } catch (e) {
      if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFolder)) throw e;
    }
  }
}
