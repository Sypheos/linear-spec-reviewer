import { App, requestUrl } from "obsidian";

const LINEAR_ENDPOINT = "https://api.linear.app/graphql";

export class LinearError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinearError";
  }
}

/**
 * Thrown when Obsidian's SecretStorage is unavailable. Per project decision,
 * the plugin must NOT fall back to plaintext storage; it hard-fails instead.
 */
export class SecretStorageUnavailableError extends LinearError {
  constructor() {
    super(
      "Linear Spec Review requires Obsidian's Secret Storage (app.secretStorage), " +
        "which is not available in this Obsidian version. Update Obsidian to use this plugin."
    );
    this.name = "SecretStorageUnavailableError";
  }
}

/** Asserts that SecretStorage exists; throws SecretStorageUnavailableError otherwise. */
export function assertSecretStorage(app: App): void {
  // secretStorage is not yet in the public typings; access defensively.
  const ss = (app as unknown as { secretStorage?: unknown }).secretStorage;
  if (!ss || typeof (ss as { getSecret?: unknown }).getSecret !== "function") {
    throw new SecretStorageUnavailableError();
  }
}

/** Reads the Linear API key from SecretStorage by the configured secret name. */
export function getApiKey(app: App, secretName: string): string {
  assertSecretStorage(app);
  if (!secretName) {
    throw new LinearError(
      "No Linear API key configured. Open the plugin settings and select a secret."
    );
  }
  const ss = (app as unknown as {
    secretStorage: { getSecret(name: string): string | null };
  }).secretStorage;
  const key = ss.getSecret(secretName);
  if (!key) {
    throw new LinearError(
      `The secret "${secretName}" is empty or not found in Secret Storage. ` +
        "Re-select or re-enter your Linear API key in the plugin settings."
    );
  }
  return key;
}

/** Download an uploaded Linear attachment with the same secret used by GraphQL. */
export async function downloadLinearAsset(
  app: App,
  secretName: string,
  url: string
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.host !== "uploads.linear.app") {
    throw new LinearError("Refusing to download an asset outside uploads.linear.app.");
  }

  let res;
  try {
    // Signed URLs expire; the upload path remains stable and works with API-key auth.
    res = await requestUrl({
      url: parsed.origin + parsed.pathname,
      headers: { Authorization: getApiKey(app, secretName) },
      throw: false,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new LinearError(`Could not download Linear asset: ${message}`);
  }
  if (res.status !== 200) {
    throw new LinearError(`Linear asset download failed (HTTP ${res.status}).`);
  }
  return {
    bytes: res.arrayBuffer,
    contentType: (res.headers["content-type"] ?? "").split(";")[0].toLowerCase(),
  };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
    extensions?: { userPresentableMessage?: string };
  }>;
}

/**
 * Executes a GraphQL operation against the Linear API using Obsidian's
 * requestUrl (bypasses browser CORS). Throws LinearError on transport,
 * GraphQL, or auth errors. This is the single choke point for all Linear I/O.
 */
export async function linearRequest<T>(
  app: App,
  secretName: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const apiKey = getApiKey(app, secretName);

  let res;
  try {
    res = await requestUrl({
      url: LINEAR_ENDPOINT,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify({ query, variables: variables ?? {} }),
      throw: false,
    });
  } catch (e) {
    throw new LinearError(
      `Network error contacting Linear: ${(e as Error).message ?? String(e)}`
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new LinearError(
      "Linear rejected the API key (unauthorized). Check the key in plugin settings."
    );
  }

  let json: GraphQLResponse<T>;
  try {
    json = res.json as GraphQLResponse<T>;
  } catch {
    throw new LinearError(
      `Unexpected non-JSON response from Linear (HTTP ${res.status}).`
    );
  }

  if (json.errors && json.errors.length > 0) {
    const msg = json.errors
      .map((e) => e.extensions?.userPresentableMessage ?? e.message)
      .join("; ");
    throw new LinearError(`Linear API error: ${msg}`);
  }

  if (!json.data) {
    throw new LinearError(
      `Linear returned no data (HTTP ${res.status}).`
    );
  }

  return json.data;
}
