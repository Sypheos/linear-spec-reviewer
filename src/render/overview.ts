import { ProjectOverview } from "../types";
import { buildFrontmatter } from "./frontmatter";

/**
 * Defensive cleanup for Linear's proprietary inline tags.
 *
 * The API is expected to return clean markdown, but we strip these wrappers
 * so we stay robust if tagged content ever leaks through:
 *
 *  - `<linear-embed ...>...</linear-embed>`  removed entirely (the element
 *    wraps a JSON payload we never want in the note body).
 *  - `<linear-comment ...>` / `</linear-comment>`  tags dropped, inner text
 *    kept.
 *  - `<user ...>NAME</user>`   unwrapped to just `NAME`.
 *  - `<issue ...>ID</issue>`   unwrapped to just `ID`.
 *
 * Ordinary markdown is left untouched.
 */
export function stripLinearTags(md: string): string {
  let out: string = md;

  // Drop the whole linear-embed element (including its JSON payload).
  // Non-greedy and `[\s\S]` so it spans newlines without swallowing
  // adjacent elements.
  out = out.replace(/<linear-embed\b[^>]*>[\s\S]*?<\/linear-embed>/g, "");

  // Also drop any self-closing linear-embed tags just in case.
  out = out.replace(/<linear-embed\b[^>]*\/>/g, "");

  // Keep the inner text of linear-comment, drop the surrounding tags.
  out = out.replace(/<linear-comment\b[^>]*>/g, "");
  out = out.replace(/<\/linear-comment>/g, "");

  // Unwrap <user ...>NAME</user> to NAME.
  out = out.replace(/<user\b[^>]*>([\s\S]*?)<\/user>/g, "$1");

  // Unwrap <issue ...>ID</issue> to ID.
  out = out.replace(/<issue\b[^>]*>([\s\S]*?)<\/issue>/g, "$1");

  return out;
}

/**
 * Produce a filesystem/Obsidian-safe note base name (no `.md` extension).
 *
 * Illegal characters (`\ / : * ? " < > |`) and Obsidian-reserved characters
 * (`# ^ [ ]`) are replaced with a space; runs of whitespace are collapsed
 * and the result is trimmed. Unicode/emoji are preserved.
 */
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build the full note content: YAML frontmatter, a blank line, then the
 * (defensively cleaned) overview markdown body.
 */
export function buildNote(project: ProjectOverview): string {
  const frontmatter: string = buildFrontmatter(project);
  const body: string = stripLinearTags(project.content);
  return `${frontmatter}\n${body}`;
}

/** Match only Markdown image embeds hosted by Linear; ordinary links stay links. */
const UPLOAD_EMBED = /(!\[[^\]\n]*\]\()(https:\/\/uploads\.linear\.app\/[^\s)]+)(\))/g;

export function embeddedLinearImages(md: string): string[] {
  return [...new Set([...md.matchAll(UPLOAD_EMBED)].map((match) => match[2]))];
}

export function linkLocalImages(md: string, paths: ReadonlyMap<string, string>): string {
  return md.replace(UPLOAD_EMBED, (original, prefix: string, url: string, suffix: string) => {
    const path = paths.get(url);
    return path ? `${prefix}${encodeURI(path)}${suffix}` : original;
  });
}
