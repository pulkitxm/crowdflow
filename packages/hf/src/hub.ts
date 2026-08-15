import { createRepo, downloadFile as hubDownloadFile, uploadFiles as hubUploadFiles } from '@huggingface/hub';

export type HubRepoType = 'model' | 'dataset';
export interface HubFile { path: string; content: string | Blob }

function repoId(name: string, type: HubRepoType): string {
  return type === 'dataset' ? `datasets/${name}` : name;
}

export interface RepoOptions { accessToken?: string | undefined; visibility?: 'public' | 'private' | undefined; license?: string | undefined }

/** Create a model or dataset repo; requires a write token. */
export async function ensureRepo(name: string, type: HubRepoType, options: RepoOptions): Promise<{ repoUrl: string; id: string }> {
  if (!options.accessToken) throw new Error('HF_TOKEN is required to create a repo');
  return createRepo({
    repo: { type, name },
    ...(options.visibility ? { visibility: options.visibility } : {}),
    ...(options.license ? { license: options.license } : {}),
    accessToken: options.accessToken,
  });
}

export interface UploadOptions { accessToken?: string | undefined; repoType?: HubRepoType; commitTitle?: string | undefined }

/** Upload files to a model or dataset repo. */
export async function uploadHubFiles(repo: string, files: HubFile[], options: UploadOptions = {}): Promise<unknown> {
  return hubUploadFiles({
    repo: repoId(repo, options.repoType ?? 'model'),
    files: files.map((file) => ({ path: file.path, content: typeof file.content === 'string' ? new Blob([file.content]) : file.content })),
    ...(options.commitTitle ? { commitTitle: options.commitTitle } : {}),
    ...(options.accessToken ? { accessToken: options.accessToken } : {}),
  });
}

export interface DownloadOptions { accessToken?: string | undefined; repoType?: HubRepoType }

/** Download a text file (e.g. a JSONL dataset or model config) as a string. */
export async function downloadHubText(repo: string, path: string, options: DownloadOptions = {}): Promise<string | null> {
  const blob = await hubDownloadFile({
    repo: repoId(repo, options.repoType ?? 'model'),
    path,
    ...(options.accessToken ? { accessToken: options.accessToken } : {}),
  });
  return blob ? blob.text() : null;
}

export interface ModelCardMeta { model_id: string; task: string; description?: string; features: string[]; outputs: string[]; license?: string }

/** A minimal, publishable model card describing the model contract. */
export function renderModelCard(meta: ModelCardMeta): string {
  return `---
license: ${meta.license ?? 'other'}
library_name: sklearn
tags:
- crowdflow
- tabular
---

# ${meta.model_id}

${meta.description ?? ''}

Task: ${meta.task}

## Contract

Features (columns): ${meta.features.join(', ')}
Outputs: ${meta.outputs.join(', ')}
`;
}
