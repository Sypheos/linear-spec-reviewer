import {
  Plugin,
  WorkspaceLeaf,
  TFile,
  Notice,
} from "obsidian";
import {
  PluginSettings,
  DEFAULT_SETTINGS,
  LINEAR_COMMENTS_VIEW,
  FM_PROJECT_ID,
  FM_DOCUMENT_CONTENT_ID,
} from "./types";
import { assertSecretStorage } from "./linear/gql";
import { CommentsView, CommentsHost } from "./view/CommentsView";
import { LinearSettingTab, SettingsHost } from "./settings";
import {
  CommandHost,
  ImportUrlModal,
  importByUrl,
  openBrowseModal,
} from "./commands";

export default class LinearSpecReviewPlugin
  extends Plugin
  implements CommentsHost, SettingsHost, CommandHost
{
  settings: PluginSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Hard requirement: Secret Storage must be available. No plaintext fallback.
    // We warn (not crash) so the user can still open settings to read guidance,
    // but every API action will surface the same error via the gql layer.
    try {
      assertSecretStorage(this.app);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(`Linear Spec Review: ${msg}`);
      console.error("[linear-spec-review]", msg);
    }

    this.registerView(
      LINEAR_COMMENTS_VIEW,
      (leaf: WorkspaceLeaf) => new CommentsView(leaf, this)
    );

    this.addSettingTab(new LinearSettingTab(this.app, this));

    this.addCommand({
      id: "import-project-url",
      name: "Import project overview (URL)",
      callback: () => {
        new ImportUrlModal(this.app, (url: string) => {
          void importByUrl(this, url);
        }).open();
      },
    });

    this.addCommand({
      id: "browse-import-project",
      name: "Browse & import project",
      callback: () => {
        openBrowseModal(this);
      },
    });

    this.addCommand({
      id: "open-comments-panel",
      name: "Open comments panel",
      callback: () => {
        void this.activateCommentsView();
      },
    });

    // Keep the panel in sync when the user switches notes.
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        void this.refreshCommentsView();
      })
    );
  }

  onunload(): void {
    // Views are cleaned up by Obsidian; nothing persistent to tear down.
  }

  // --- Settings persistence -------------------------------------------------

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<PluginSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // --- CommentsHost / CommandHost ------------------------------------------

  getSecretName(): string {
    return this.settings.secretName;
  }

  getSpecsFolder(): string {
    return this.settings.specsFolder;
  }

  /** Reads the active markdown note's Linear context from its frontmatter. */
  getActiveContext(): {
    projectId: string;
    documentContentId: string;
    projectName: string;
  } | null {
    const file = this.app.workspace.getActiveFile();
    if (file === null || file.extension !== "md") {
      return null;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    if (fm === undefined) {
      return null;
    }
    const projectId = fm[FM_PROJECT_ID];
    if (typeof projectId !== "string" || projectId.length === 0) {
      return null;
    }
    const documentContentId =
      typeof fm[FM_DOCUMENT_CONTENT_ID] === "string"
        ? (fm[FM_DOCUMENT_CONTENT_ID] as string)
        : "";
    const projectName =
      typeof fm["name"] === "string" ? (fm["name"] as string) : file.basename;
    return { projectId, documentContentId, projectName };
  }

  async onImported(_file: TFile): Promise<void> {
    await this.activateCommentsView();
    await this.refreshCommentsView();
  }

  // --- View management ------------------------------------------------------

  private async activateCommentsView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(LINEAR_COMMENTS_VIEW);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf === null) {
      new Notice("Could not open the comments panel (no right sidebar).");
      return;
    }
    await leaf.setViewState({ type: LINEAR_COMMENTS_VIEW, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  private async refreshCommentsView(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(LINEAR_COMMENTS_VIEW);
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof CommentsView) {
        await view.reload();
      }
    }
  }
}
