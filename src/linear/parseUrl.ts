import { App } from "obsidian";
import { searchProjects } from "./queries";
import { ProjectSearchResult } from "../types";
import { LinearError } from "./gql";

/**
 * Extracts the trailing slugId from a Linear project URL.
 * e.g. https://linear.app/upfluence/project/shopify-discounts-on-subscriptions-1d824612fc00[/...]
 *   -> { slug: "shopify-discounts-on-subscriptions-1d824612fc00", slugId: "1d824612fc00" }
 * Returns null if the URL is not a recognizable Linear project URL.
 */
export function parseProjectUrl(
  input: string
): { slug: string; slugId: string } | null {
  const trimmed = input.trim();
  const match = trimmed.match(
    /linear\.app\/[^/]+\/project\/([^/?#]+)/i
  );
  if (!match) return null;
  const slug = match[1];
  // slugId is the last hyphen-delimited hex segment.
  const parts = slug.split("-");
  const slugId = parts[parts.length - 1];
  if (!slugId) return null;
  return { slug, slugId };
}

/** Turn a slug like "shopify-discounts-on-subscriptions-1d82..." into a search term. */
function slugToTerm(slug: string): string {
  const parts = slug.split("-");
  // Drop the trailing slugId hex segment, join the rest as words.
  parts.pop();
  return parts.join(" ");
}

/**
 * Resolves a Linear project URL to a concrete project by:
 * 1. parsing the slugId,
 * 2. searching by the humanized slug,
 * 3. matching the result whose url contains the slugId (exact),
 *    falling back to slug match.
 */
export async function resolveProjectFromUrl(
  app: App,
  secretName: string,
  url: string
): Promise<ProjectSearchResult> {
  const parsed = parseProjectUrl(url);
  if (!parsed) {
    throw new LinearError(
      "That does not look like a Linear project URL (expected .../project/<name>-<id>)."
    );
  }
  const term = slugToTerm(parsed.slug) || parsed.slugId;
  const results = await searchProjects(app, secretName, term);

  const bySlugId = results.find((r) => r.slugId === parsed.slugId);
  if (bySlugId) return bySlugId;

  const byUrl = results.find((r) => r.url.includes(parsed.slugId));
  if (byUrl) return byUrl;

  const bySlug = results.find((r) => r.url.includes(parsed.slug));
  if (bySlug) return bySlug;

  throw new LinearError(
    `Could not find a project matching "${parsed.slug}". ` +
      "You may not have access, or the URL is stale. Try Browse instead."
  );
}
