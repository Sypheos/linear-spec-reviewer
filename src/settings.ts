import {
  App,
  PluginSettingTab,
  Setting,
  SecretComponent,
  Notice,
} from "obsidian";
import { PluginSettings } from "./types";

/**
 * Contract the concrete plugin must satisfy so the settings tab never imports
 * the plugin class directly.
 */
export interface SettingsHost {
  settings: PluginSettings;
  saveSettings(): Promise<void>;
  updateAssetPreview(): void;
}

/** Extract a human message from an unknown thrown value. */
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class LinearSettingTab extends PluginSettingTab {
  private readonly plugin: SettingsHost;

  constructor(app: App, plugin: SettingsHost) {
    super(app, plugin as unknown as import("obsidian").Plugin);
    this.plugin = plugin;
  }

  /** Persist settings, surfacing any failure to the user via a Notice. */
  private async persist(): Promise<void> {
    try {
      await this.plugin.saveSettings();
    } catch (e) {
      new Notice(`Failed to save settings: ${errorMessage(e)}`);
    }
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // MANDATORY secret storage. No plaintext fallback is offered.
    const secretStorage = (
      this.app as unknown as { secretStorage?: unknown }
    ).secretStorage;
    if (typeof SecretComponent === "undefined" || !secretStorage) {
      containerEl.createEl("p", {
        cls: "lsr-settings-error",
        text: "This plugin requires Obsidian Secret Storage, which is unavailable. Update Obsidian.",
      });
      return;
    }

    new Setting(containerEl)
      .setName("Linear API key")
      .setDesc(
        "Select or create a secret in Obsidian Secret Storage that holds your Linear personal API key."
      )
      .addComponent((el) =>
        new SecretComponent(this.app, el)
          .setValue(this.plugin.settings.secretName)
          .onChange(async (value: string) => {
            this.plugin.settings.secretName = value;
            this.plugin.updateAssetPreview();
            await this.persist();
          })
      );

    new Setting(containerEl)
      .setName("Specs folder")
      .setDesc("Vault-relative folder where imported specs are written.")
      .addText((text) =>
        text
          .setPlaceholder("Specs")
          .setValue(this.plugin.settings.specsFolder)
          .onChange(async (value: string) => {
            const trimmed = value.trim();
            this.plugin.settings.specsFolder =
              trimmed.length > 0 ? trimmed : "Specs";
            await this.persist();
          })
      );

    new Setting(containerEl)
      .setName("Save Linear images in vault")
      .setDesc("Off: cache images outside the vault (default). On: save images under the specs folder; re-import a spec to make its Markdown point to the saved images. Comments use the same storage choice.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.storeAssetsInVault).onChange(async (enabled) => {
          this.plugin.settings.storeAssetsInVault = enabled;
          this.plugin.updateAssetPreview();
          await this.persist();
        })
      );
  }
}
