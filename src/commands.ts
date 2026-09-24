import {
  App,
  Modal,
  Notice,
  Setting,
  FuzzySuggestModal,
  TFile,
  normalizePath,
} from "obsidian";
import { posix } from "node:path";
import { ProjectOverview, ProjectSearchResult } from "./types";
import { getProjectById, searchProjects } from "./linear/queries";
import { resolveProjectFromUrl } from "./linear/parseUrl";
import {
  buildNote,
  embeddedLinearImages,
  linkLocalImages,
  sanitizeFileName,
} from "./render/overview";

/** Minimal surface the commands need from the plugin. */
export interface CommandHost {
  app: App;
  getSecretName(): string;
  getSpecsFolder(): string;
  storeAssetsInVault(): boolean;
  saveEmbeddedImage(url: string): Promise<string>;
  /** Called after a note is imported so the plugin can reveal/refresh the panel. */
  onImported(file: TFile): Promise<void>;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Modal prompting for a Linear project URL. */
export class ImportUrlModal extends Modal {
  private url = "";
  private readonly onSubmit: (url: string) => void;

  constructor(app: App, onSubmit: (url: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Import Linear project by URL" });

    new Setting(contentEl).setName("Project URL").addText((text) => {
      text
        .setPlaceholder("https://linear.app/workspace/project/…")
        .onChange((value) => {
          this.url = value;
        });
      text.inputEl.style.width = "100%";
      // Submit on Enter.
      text.inputEl.addEventListener("keydown", (evt: KeyboardEvent) => {
        if (evt.key === "Enter") {
          evt.preventDefault();
          this.submit();
        }
      });
    });

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("Import")
        .setCta()
        .onClick(() => this.submit())
    );
  }

  private submit(): void {
    const value = this.url.trim();
    if (value.length === 0) {
      new Notice("Please paste a Linear project URL.");
      return;
    }
    this.close();
    this.onSubmit(value);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Fuzzy project picker backed by Linear search. */
export class ProjectSuggestModal extends FuzzySuggestModal<ProjectSearchResult> {
  private items: ProjectSearchResult[] = [];
  private readonly onChoose: (project: ProjectSearchResult) => void;
  private readonly loader: (term: string) => Promise<ProjectSearchResult[]>;
  private debounce: number | null = null;

  constructor(
    app: App,
    loader: (term: string) => Promise<ProjectSearchResult[]>,
    onChoose: (project: ProjectSearchResult) => void
  ) {
    super(app);
    this.loader = loader;
    this.onChoose = onChoose;
    this.setPlaceholder("Type to search Linear projects…");
  }

  getItems(): ProjectSearchResult[] {
    return this.items;
  }

  getItemText(item: ProjectSearchResult): string {
    return item.name;
  }

  onChooseItem(item: ProjectSearchResult): void {
    this.onChoose(item);
  }

  // Re-query Linear as the user types (debounced), then refresh suggestions.
  onOpen(): void {
    super.onOpen();
    this.inputEl.addEventListener("input", () => {
      const term = this.inputEl.value.trim();
      if (this.debounce !== null) {
        window.clearTimeout(this.debounce);
      }
      this.debounce = window.setTimeout(() => {
        void this.runSearch(term);
      }, 250);
    });
  }

  private async runSearch(term: string): Promise<void> {
    if (term.length === 0) {
      this.items = [];
      // @ts-expect-error - updateSuggestions is internal but stable.
      this.updateSuggestions?.();
      return;
    }
    try {
      this.items = await this.loader(term);
    } catch (e) {
      new Notice(errorMessage(e));
      this.items = [];
    }
    // @ts-expect-error - updateSuggestions is internal but stable.
    this.updateSuggestions?.();
  }
}

/**
 * Writes (creating or overwriting) the note for a project overview and returns
 * the TFile. The note lives at <specsFolder>/<sanitized name>.md.
 */
export async function writeProjectNote(
  host: CommandHost,
  project: ProjectOverview
): Promise<TFile> {
  const app = host.app;
  const folder = host.getSpecsFolder().replace(/^\/+|\/+$/g, "") || "Specs";
  const base = sanitizeFileName(project.name) || project.slugId;
  const path = normalizePath(`${folder}/${base}.md`);

  // Ensure the folder exists.
  const folderPath = normalizePath(folder);
  if (folder.length > 0 && app.vault.getAbstractFileByPath(folderPath) === null) {
    await app.vault.createFolder(folderPath).catch(() => {
      /* ignore if it already exists due to a race */
    });
  }

  let content = buildNote(project);
  if (host.storeAssetsInVault()) {
    const paths = new Map<string, string>();
    for (const url of embeddedLinearImages(content)) {
      const assetPath = await host.saveEmbeddedImage(url);
      paths.set(url, posix.relative(posix.dirname(path), assetPath));
    }
    content = linkLocalImages(content, paths);
  }
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
    return existing;
  }
  return await app.vault.create(path, content);
}

/** High-level: resolve a project by URL, fetch it, write the note, reveal panel. */
export async function importByUrl(host: CommandHost, url: string): Promise<void> {
  const secretName = host.getSecretName();
  try {
    new Notice("Resolving Linear project…");
    const match: ProjectSearchResult = await resolveProjectFromUrl(
      host.app,
      secretName,
      url
    );
    const project = await getProjectById(host.app, secretName, match.id);
    const file = await writeProjectNote(host, project);
    await host.app.workspace.getLeaf(false).openFile(file);
    await host.onImported(file);
    new Notice(`Imported "${project.name}".`);
  } catch (e) {
    new Notice(errorMessage(e));
  }
}

/** High-level: fetch a chosen project by id, write the note, reveal panel. */
export async function importByProject(
  host: CommandHost,
  projectId: string
): Promise<void> {
  const secretName = host.getSecretName();
  try {
    const project = await getProjectById(host.app, secretName, projectId);
    const file = await writeProjectNote(host, project);
    await host.app.workspace.getLeaf(false).openFile(file);
    await host.onImported(file);
    new Notice(`Imported "${project.name}".`);
  } catch (e) {
    new Notice(errorMessage(e));
  }
}

/** Opens the browse picker. */
export function openBrowseModal(host: CommandHost): void {
  const secretName = host.getSecretName();
  const modal = new ProjectSuggestModal(
    host.app,
    (term) => searchProjects(host.app, secretName, term),
    (project) => {
      void importByProject(host, project.id);
    }
  );
  modal.open();
}
