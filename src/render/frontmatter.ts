import {
  ProjectOverview,
  FM_PROJECT_ID,
  FM_DOCUMENT_CONTENT_ID,
  FM_PROJECT_URL,
} from "../types";

/**
 * Escape and double-quote a scalar string for safe YAML output.
 *
 * We always wrap in double quotes so values containing special YAML
 * characters (`:`, `#`, leading `-`, etc.) are never misinterpreted.
 * Backslashes and double quotes are escaped per the YAML double-quoted
 * scalar rules.
 */
export function yamlString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Build a YAML frontmatter block (including the opening/closing `---`
 * fences and a trailing newline) describing the project.
 *
 * Hand-rolled: no external YAML dependency, fully deterministic aside from
 * the `linear_synced_at` timestamp.
 */
export function buildFrontmatter(project: ProjectOverview): string {
  const statusName: string = project.status !== null ? project.status.name : "";
  const leadName: string = project.lead !== null ? project.lead.name : "";
  const documentContentId: string =
    project.documentContentId !== null ? project.documentContentId : "";
  const startDate: string = project.startDate !== null ? project.startDate : "";
  const targetDate: string =
    project.targetDate !== null ? project.targetDate : "";
  const teamKeys: string = project.teams.map((team) => team.key).join(", ");
  const syncedAt: string = new Date().toISOString();

  const lines: string[] = [];
  lines.push("---");

  // Machine keys used to re-link the note back to Linear.
  lines.push(`${FM_PROJECT_ID}: ${yamlString(project.id)}`);
  lines.push(`${FM_DOCUMENT_CONTENT_ID}: ${yamlString(documentContentId)}`);
  lines.push(`${FM_PROJECT_URL}: ${yamlString(project.url)}`);

  // Human-readable keys.
  lines.push(`name: ${yamlString(project.name)}`);
  lines.push(`status: ${yamlString(statusName)}`);
  lines.push(`lead: ${yamlString(leadName)}`);
  lines.push(`priority: ${yamlString(project.priorityLabel)}`);
  lines.push(`team: ${yamlString(teamKeys)}`);
  lines.push(`start_date: ${yamlString(startDate)}`);
  lines.push(`target_date: ${yamlString(targetDate)}`);

  if (project.labels.length === 0) {
    lines.push("labels: []");
  } else {
    lines.push("labels:");
    for (const label of project.labels) {
      lines.push(`  - ${yamlString(label)}`);
    }
  }

  lines.push(`linear_synced_at: ${yamlString(syncedAt)}`);
  lines.push("---");

  return `${lines.join("\n")}\n`;
}
