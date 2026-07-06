import { App } from "obsidian";
import { linearRequest, LinearError } from "./gql";
import {
  ProjectOverview,
  ProjectSearchResult,
  LinearComment,
} from "../types";

const PROJECT_FIELDS = `
  id
  name
  url
  slugId
  icon
  color
  content
  description
  priority
  priorityLabel
  startDate
  targetDate
  lead { id name displayName }
  status { id name type }
  teams { nodes { key name } }
  labels { nodes { name } }
  documentContent { id }
`;

const COMMENT_FIELDS = `
  id
  body
  url
  createdAt
  resolvedAt
  quotedText
  parent { id }
  user { id name displayName }
  botActor { id name }
`;

interface RawProject {
  id: string;
  name: string;
  url: string;
  slugId: string;
  icon: string | null;
  color: string | null;
  content: string | null;
  description: string | null;
  priority: number;
  priorityLabel: string;
  startDate: string | null;
  targetDate: string | null;
  lead: { id: string; name: string; displayName?: string | null } | null;
  status: { id: string; name: string; type: string } | null;
  teams: { nodes: { key: string; name: string }[] };
  labels: { nodes: { name: string }[] };
  documentContent: { id: string } | null;
}

interface RawComment {
  id: string;
  body: string;
  url: string;
  createdAt: string;
  resolvedAt: string | null;
  quotedText: string | null;
  parent: { id: string } | null;
  user: { id: string; name: string; displayName?: string | null } | null;
  botActor: { id: string; name: string } | null;
}

function mapProject(p: RawProject): ProjectOverview {
  return {
    id: p.id,
    name: p.name,
    url: p.url,
    slugId: p.slugId,
    icon: p.icon,
    color: p.color,
    content: p.content ?? "",
    description: p.description ?? "",
    priority: p.priority,
    priorityLabel: p.priorityLabel,
    startDate: p.startDate,
    targetDate: p.targetDate,
    lead: p.lead ?? null,
    status: p.status ?? null,
    teams: p.teams?.nodes ?? [],
    labels: (p.labels?.nodes ?? []).map((l) => l.name),
    documentContentId: p.documentContent?.id ?? null,
  };
}

function mapComment(c: RawComment): LinearComment {
  return {
    id: c.id,
    body: c.body,
    url: c.url,
    createdAt: c.createdAt,
    resolvedAt: c.resolvedAt,
    quotedText: c.quotedText,
    parentId: c.parent?.id ?? null,
    author: c.user ?? null,
    botActorName: c.botActor?.name ?? null,
  };
}

/** Search projects by free-text term (used for browse picker and URL matching). */
export async function searchProjects(
  app: App,
  secretName: string,
  term: string
): Promise<ProjectSearchResult[]> {
  const query = `query($t: String!) {
    searchProjects(term: $t) {
      nodes { id name slugId url }
    }
  }`;
  const data = await linearRequest<{
    searchProjects: { nodes: ProjectSearchResult[] };
  }>(app, secretName, query, { t: term });
  return data.searchProjects.nodes;
}

/** Fetch a full project overview by its UUID. */
export async function getProjectById(
  app: App,
  secretName: string,
  id: string
): Promise<ProjectOverview> {
  const query = `query($id: String!) {
    project(id: $id) { ${PROJECT_FIELDS} }
  }`;
  const data = await linearRequest<{ project: RawProject }>(
    app,
    secretName,
    query,
    { id }
  );
  return mapProject(data.project);
}

/** Fetch all comments on a project's overview (up to 250). */
export async function getProjectComments(
  app: App,
  secretName: string,
  projectId: string
): Promise<LinearComment[]> {
  const query = `query($id: String!) {
    project(id: $id) {
      comments(first: 250) {
        nodes { ${COMMENT_FIELDS} }
      }
    }
  }`;
  const data = await linearRequest<{
    project: { comments: { nodes: RawComment[] } };
  }>(app, secretName, query, { id: projectId });
  return data.project.comments.nodes.map(mapComment);
}

/**
 * Create a NEW top-level thread on a project overview.
 * Project overview comments anchor to documentContentId (NOT projectId).
 * Pass quotedText to create an inline-anchored thread.
 */
export async function createThread(
  app: App,
  secretName: string,
  documentContentId: string,
  body: string,
  quotedText?: string
): Promise<LinearComment> {
  if (!documentContentId) {
    throw new LinearError(
      "Cannot create a comment: this project has no document content id."
    );
  }
  const mutation = `mutation($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      success
      comment { ${COMMENT_FIELDS} }
    }
  }`;
  const input: Record<string, unknown> = { documentContentId, body };
  if (quotedText) input.quotedText = quotedText;
  const data = await linearRequest<{
    commentCreate: { success: boolean; comment: RawComment };
  }>(app, secretName, mutation, { input });
  if (!data.commentCreate.success) {
    throw new LinearError("Linear reported the comment was not created.");
  }
  return mapComment(data.commentCreate.comment);
}

/**
 * Reply to an existing thread.
 * IMPORTANT: a reply must carry documentContentId + parentId and MUST NOT
 * include projectId (Linear rejects that with "incorrect parent").
 */
export async function replyToThread(
  app: App,
  secretName: string,
  documentContentId: string,
  parentId: string,
  body: string
): Promise<LinearComment> {
  const mutation = `mutation($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      success
      comment { ${COMMENT_FIELDS} }
    }
  }`;
  const input = { documentContentId, parentId, body };
  const data = await linearRequest<{
    commentCreate: { success: boolean; comment: RawComment };
  }>(app, secretName, mutation, { input });
  if (!data.commentCreate.success) {
    throw new LinearError("Linear reported the reply was not created.");
  }
  return mapComment(data.commentCreate.comment);
}
