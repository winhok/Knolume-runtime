import { z } from "zod";

const identifierSchema = z.string().trim().min(1).max(128);
const sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const gitOidSchema = z.string().regex(/^[a-f0-9]{40,64}$/);

export const workspaceImportEntrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("directory"), path: z.string().min(1) }).strict(),
  z
    .object({
      type: z.literal("file"),
      path: z.string().min(1),
      size: z.number().int().nonnegative(),
      digest: sha256DigestSchema,
      executable: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("symlink"),
      path: z.string().min(1),
      target: z.string().min(1),
    })
    .strict(),
]);

export type WorkspaceImportEntry = z.infer<typeof workspaceImportEntrySchema>;

const filesystemSnapshotManifestSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("filesystem-snapshot"),
    entries: z.array(workspaceImportEntrySchema),
  })
  .strict();

const gitHeadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("symbolic"), ref: z.string().min(1), oid: gitOidSchema }).strict(),
  z.object({ type: z.literal("detached"), oid: gitOidSchema }).strict(),
]);

const gitWorktreeManifestSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("git-worktree"),
    entries: z.array(workspaceImportEntrySchema),
    repository: z
      .object({
        bundleDigest: sha256DigestSchema,
        bundleSize: z.number().int().nonnegative(),
        head: gitHeadSchema,
        indexTreeOid: gitOidSchema,
        refsScope: z.literal("head-only"),
      })
      .strict(),
  })
  .strict();

export const workspaceImportManifestSchema = z.discriminatedUnion("kind", [
  filesystemSnapshotManifestSchema,
  gitWorktreeManifestSchema,
]);

export type WorkspaceImportManifest = z.infer<typeof workspaceImportManifestSchema>;
export type FilesystemSnapshotManifest = z.infer<typeof filesystemSnapshotManifestSchema>;
export type GitWorktreeManifest = z.infer<typeof gitWorktreeManifestSchema>;

const workspaceBlobSchema = z
  .object({ digest: sha256DigestSchema, dataBase64: z.string() })
  .strict();

export const createWorkspaceImportRequestSchema = z
  .object({
    clientRequestId: identifierSchema,
    userId: identifierSchema,
    manifestDigest: sha256DigestSchema,
    manifest: workspaceImportManifestSchema,
    blobs: z.array(workspaceBlobSchema),
  })
  .strict();

export type CreateWorkspaceImportRequest = z.infer<typeof createWorkspaceImportRequestSchema>;

export const workspaceImportResponseSchema = z
  .object({
    workspaceId: identifierSchema,
    userId: identifierSchema,
    state: z.literal("active"),
    createdAt: z.iso.datetime(),
    manifestDigest: sha256DigestSchema,
  })
  .strict();

export type WorkspaceImportResponse = z.infer<typeof workspaceImportResponseSchema>;

export const createWorkspaceExportRequestSchema = z
  .object({
    clientRequestId: identifierSchema,
    userId: identifierSchema,
    workspaceId: identifierSchema,
  })
  .strict();

export type CreateWorkspaceExportRequest = z.infer<typeof createWorkspaceExportRequestSchema>;

export const workspaceExportArtifactSchema = z
  .object({
    exportId: identifierSchema,
    workspaceId: identifierSchema,
    createdAt: z.iso.datetime(),
    manifestDigest: sha256DigestSchema,
    manifest: filesystemSnapshotManifestSchema,
    blobs: z.array(workspaceBlobSchema),
  })
  .strict();

export type WorkspaceExportArtifact = z.infer<typeof workspaceExportArtifactSchema>;

/** Canonical UTF-8 JSON covered by manifestDigest. */
export function canonicalizeWorkspaceManifest(manifest: WorkspaceImportManifest): string {
  const entries = [...manifest.entries].sort((left, right) =>
    compareUnicodeScalar(left.path, right.path),
  );
  if (manifest.kind === "filesystem-snapshot") {
    return JSON.stringify({ version: 1, kind: manifest.kind, entries });
  }
  return JSON.stringify({
    version: 1,
    kind: manifest.kind,
    entries,
    repository: manifest.repository,
  });
}

// UTF-8 preserves Unicode scalar order, so this comparison produces the same
// ordering without requiring DOM TextEncoder types in the shared package.
function compareUnicodeScalar(left: string, right: string): number {
  const leftScalars = Array.from(left, (value) => value.codePointAt(0)!);
  const rightScalars = Array.from(right, (value) => value.codePointAt(0)!);
  const length = Math.min(leftScalars.length, rightScalars.length);
  for (let index = 0; index < length; index++) {
    const difference = leftScalars[index] - rightScalars[index];
    if (difference !== 0) return difference;
  }
  return leftScalars.length - rightScalars.length;
}
