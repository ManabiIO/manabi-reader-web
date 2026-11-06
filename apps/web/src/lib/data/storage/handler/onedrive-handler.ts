/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BookCardProps } from '$lib/components/book-card/book-card-props';
import { oneDriveTokenEndpoint } from '$lib/data/env';
import { ApiStorageHandler } from '$lib/data/storage/handler/api-handler';
import { BaseStorageHandler, type ExternalFile } from '$lib/data/storage/handler/base-handler';
import { StorageKey } from '$lib/data/storage/storage-types';
import { database, oneDriveStorageSource$ } from '$lib/data/store';
import pLimit from 'p-limit';
import { throwIfAborted } from '$lib/functions/replication/replication-error';

interface OneDriveFile extends ExternalFile {
  thumbnails?: ExternalThumbnail[];
  file: Record<string, string>;
  folder: Record<string, string>;
}

interface BatchRequest {
  id: string;
  method: string;
  url: string;
  body?: string;
  headers?: string;
}

interface ExternalThumbnail {
  id: string;
  large?: ExternalThumbnailData;
  medium?: ExternalThumbnailData;
  small?: ExternalThumbnailData;
}

interface ExternalThumbnailData {
  height: number;
  width: number;
  url: string;
}

export class OneDriveStorageHandler extends ApiStorageHandler {
  private baseEndpoint = 'https://graph.microsoft.com/v1.0/me/drive/items';

  constructor(window: Window) {
    super(StorageKey.ONEDRIVE, window, oneDriveTokenEndpoint);
  }

  setInternalSettings(storageSourceName: string) {
    const newStorageSource = storageSourceName || oneDriveStorageSource$.getValue();

    if (newStorageSource !== this.storageSourceName) {
      this.clearData();
    }

    this.storageSourceName = newStorageSource;
  }

  async getBookList() {
    const cancelSignal = this.cancelSignal;
    throwIfAborted(cancelSignal);
    if (!this.dataListFetched) {
      database.listLoading$.next(true);

      try {
        const root = await this.ensureTitle(undefined, undefined, true);
        if (!root) {
          this.dataListFetched = true;
          return [];
        }

        const remoteFolders = await this.list(this.rootId);
        const batchRequests: BatchRequest[][] = [];
        const completedTitles = new Map<string, OneDriveFile[]>();
        const batchIdToTitle = new Map<string, string>();
        const titleIdToName = new Map<string, string>();
        const names = new Set<string>();
        const listParams = new URLSearchParams();

        listParams.append('select', `id,name`);
        listParams.append('expand', `thumbnails(select=large)`);

        for (let index = 0, { length } = remoteFolders; index < length; index += 20) {
          const iteration = remoteFolders.slice(index, index + 20);
          const requests: BatchRequest[] = [];

          for (let index2 = 0, { length: length2 } = iteration; index2 < length2; index2 += 1) {
            const remoteFolder = iteration[index2];
            const title = BaseStorageHandler.desanitizeFilename(remoteFolder.name);
            if (names.has(title))
              throw new Error(
                'Multiple book folders have the same title. Review them before using this library.'
              );
            names.add(title);
            const id = `${batchRequests.length}_${requests.length}`;

            this.titleToId.set(title, remoteFolder.id);
            titleIdToName.set(remoteFolder.id, title);
            batchIdToTitle.set(id, remoteFolder.id);

            requests.push({
              id,
              method: 'GET',
              url: `/me/drive/items/${remoteFolder.id}/children?${listParams.toString()}`
            });
          }

          if (requests.length) {
            batchRequests.push(requests);
          }
        }

        if (batchRequests.length) {
          const listLimiter = pLimit(1);
          const listTasks: Promise<void>[] = [];

          batchRequests.forEach((requests: BatchRequest[]) =>
            listTasks.push(
              listLimiter(async () => {
                const { responses } = await this.request(
                  'https://graph.microsoft.com/v1.0/$batch',
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      requests
                    })
                  }
                );

                throwIfAborted(cancelSignal);
                if (!Array.isArray(responses) || responses.length !== requests.length)
                  throw new Error('Incomplete OneDrive batch listing');
                const expectedIds = new Set(requests.map((request) => request.id));
                for (const response of responses) {
                  if (
                    !response ||
                    !expectedIds.delete(response.id) ||
                    !Number.isInteger(response.status) ||
                    response.status < 200 ||
                    response.status > 299
                  )
                    throw new Error('Invalid OneDrive batch listing response');
                  const remoteFiles = this.validateListing(response.body);
                  if (response.body['@odata.nextLink']) {
                    await this.list(
                      'root',
                      false,
                      true,
                      remoteFiles,
                      response.body['@odata.nextLink'],
                      new Set<string>(),
                      true
                    );
                  }
                  const externalId = batchIdToTitle.get(response.id)!;
                  completedTitles.set(titleIdToName.get(externalId)!, remoteFiles);
                }
              })
            )
          );

          await Promise.all(listTasks).catch((error) => {
            listLimiter.clearQueue();
            throw error;
          });
        }

        throwIfAborted(cancelSignal);
        for (const [title, files] of completedTitles) this.setTitleData(title, files);
        this.dataListFetched = true;
      } catch (error) {
        this.clearData();
        throw error;
      }
    }

    return [...this.titleToBookCard.values()];
  }

  protected async ensureTitle(
    name = BaseStorageHandler.rootName,
    parent = 'root',
    readOnly = false
  ) {
    const cancelSignal = this.cancelSignal;
    throwIfAborted(cancelSignal);
    const isRoot = name === BaseStorageHandler.rootName && parent === 'root';
    if (isRoot && this.rootId) {
      return this.rootId;
    }

    const externalId = !isRoot && parent === this.rootId ? this.titleToId.get(name) : undefined;

    if (externalId) {
      return externalId;
    }

    const sanitizedName = BaseStorageHandler.sanitizeForFilename(name);
    const params = new URLSearchParams();

    params.append('select', `id,name`);
    params.append('filter', `name eq '${sanitizedName}'`);

    let titleId = '';

    if (isRoot) {
      const response = await this.request(
        `${this.baseEndpoint}/${parent}/children?${params.toString()}`
      );
      throwIfAborted(cancelSignal);
      const matches = this.validateListing(response);
      if (response['@odata.nextLink'])
        await this.list(
          parent,
          false,
          false,
          matches,
          response['@odata.nextLink'],
          new Set<string>(),
          true
        );
      throwIfAborted(cancelSignal);
      if (matches.length > 1) throw new Error('Multiple matching cloud folders require review');
      titleId = matches[0]?.id || '';
    } else if (this.rootId) {
      // One Drive Bug (?) - with non latin characters it will return no filter result so we need to refetch all folders
      const remoteFolders = await this.list(this.rootId);
      throwIfAborted(cancelSignal);

      for (let index = 0, { length } = remoteFolders; index < length; index += 1) {
        const remoteFolder = remoteFolders[index];
        const title = BaseStorageHandler.desanitizeFilename(remoteFolder.name);

        if (title === name) {
          if (titleId)
            throw new Error(
              'Multiple matching cloud folders require review before this library can be used.'
            );
          titleId = remoteFolder.id;
        }
      }
    } else {
      throw new Error('RootId required for search');
    }

    throwIfAborted(cancelSignal);
    if (!titleId && !readOnly) {
      params.delete('filter');

      throwIfAborted(cancelSignal);
      const response = await this.request(
        `${this.baseEndpoint}/${parent}/children?${params.toString()}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: sanitizedName,
            folder: {},
            '@microsoft.graph.conflictBehavior': 'fail'
          })
        }
      );

      titleId = response.id;
    }

    if (titleId && !isRoot && parent === this.rootId) {
      this.titleToId.set(name, titleId);
    }

    if (titleId && isRoot) {
      this.rootId = titleId;
    }

    if (!titleId && isRoot && !readOnly) {
      throw new Error('Root folder not found');
    }

    return titleId;
  }

  protected async getExternalFiles(remoteTitleId: string) {
    if (
      (!this.cacheStorageData || !this.dataListFetched) &&
      !this.titleToFiles.has(this.currentContext.title)
    ) {
      const externalFiles = await this.list(remoteTitleId, true, true);

      if (externalFiles.length) {
        this.setTitleData(this.currentContext.title, externalFiles);
      }
    }

    return this.titleToFiles.get(this.currentContext.title) || [];
  }

  protected async setRootFiles() {
    if ((!this.cacheStorageData || !this.rootFileListFetched) && !this.rootFiles.size) {
      const rootFiles = await this.list(this.rootId, false, true);

      for (let index = 0, { length } = rootFiles; index < length; index += 1) {
        const rootFile = rootFiles[index];

        this.setRootFile(rootFile.name, rootFile);
      }

      this.rootFileListFetched = true;
    }
  }

  protected retrieve(
    file: OneDriveFile,
    typeToRetrieve: XMLHttpRequestResponseType,
    progressBase = 1
  ) {
    return this.request(
      `${this.baseEndpoint}/${file.id}/content`,
      { trackDownload: true },
      typeToRetrieve,
      progressBase
    );
  }

  protected async upload(
    folderId: string,
    name: string,
    files: OneDriveFile[],
    remoteFile?: OneDriveFile,
    body?: Blob | string,
    rootFilePrefix?: string,
    progressBase = 0.8
  ) {
    const cancelSignal = this.cancelSignal;
    throwIfAborted(cancelSignal);
    const params = new URLSearchParams();
    params.append('select', `id,name`);

    if (body) {
      const { uploadUrl: uploadUrlResponse } = await this.request(
        `${this.baseEndpoint}/${
          remoteFile ? `${remoteFile.id}` : `${folderId}:/${encodeURIComponent(name)}:`
        }/createUploadSession`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            item: {
              name: remoteFile?.name || name
            }
          })
        }
      );

      throwIfAborted(cancelSignal);
      const url = new URL(uploadUrlResponse);
      const searchParams = [...url.searchParams];
      const uploadUrl = `${url.origin}${url.pathname}`;

      params.delete('select');

      for (let index = 0, { length } = searchParams; index < length; index += 1) {
        const [paramName, paramValue] = searchParams[index];

        params.append(paramName, paramValue);
      }

      params.append('select', `id,name`);

      if (!uploadUrl) {
        throw new Error('Upload url was not returned');
      }

      try {
        const byteSize = body instanceof Blob ? body.size : new Blob([body]).size;
        throwIfAborted(cancelSignal);
        const response = await this.request(
          `${uploadUrl}?${params.toString()}`,
          {
            method: 'PUT',
            headers: { 'Content-Range': `bytes 0-${byteSize - 1}/${byteSize}` },
            body,
            trackUpload: true,
            skipAuth: true
          },
          'json',
          progressBase
        );

        throwIfAborted(cancelSignal);
        if (remoteFile && name !== remoteFile.name) {
          throwIfAborted(cancelSignal);
          const renameResponse = await this.rename(name, files, remoteFile, params, rootFilePrefix);

          return renameResponse;
        }

        this.updateAfterUpload(
          response.id,
          response.name,
          files,
          remoteFile,
          {
            thumbnails: response.thumbnails
          },
          rootFilePrefix
        );

        return response;
      } catch (error) {
        await this.request(uploadUrl, { method: 'DELETE' }).catch(() => {
          // no-op
        });
        throw error;
      }
    }

    if (!remoteFile) {
      throw new Error('Renaming requires a remote id');
    }

    throwIfAborted(cancelSignal);
    const renameResponse = await this.rename(name, files, remoteFile, params, rootFilePrefix);

    return renameResponse;
  }

  protected executeDelete(id: string) {
    return this.request(`${this.baseEndpoint}/${id}`, { method: 'DELETE' });
  }

  private async list(
    parent = 'root',
    withThumbnail = false,
    listFiles = false,
    files: OneDriveFile[] = [],
    nextLink = '',
    seenNextLinks = new Set<string>(),
    preserveProjectedRows = false
  ) {
    const cancelSignal = this.cancelSignal;
    throwIfAborted(cancelSignal);
    let response;

    if (nextLink) {
      response = await this.request(nextLink);
    } else {
      const params = new URLSearchParams();

      params.append('select', `id,name,file,folder`);

      if (!listFiles) {
        params.append('filter', 'folder ne null');
      }

      if (withThumbnail) {
        params.append('expand', `thumbnails`);
      }

      response = await this.request(`${this.baseEndpoint}/${parent}/children?${params.toString()}`);
    }

    throwIfAborted(cancelSignal);
    const rows = this.validateListing(response);
    files.push(
      ...rows.filter(
        (item: OneDriveFile) =>
          preserveProjectedRows || (listFiles && !!item.file) || (!listFiles && !!item.folder)
      )
    );
    if (response['@odata.nextLink']) {
      const link = response['@odata.nextLink'];
      if (seenNextLinks.has(link)) throw new Error('Repeated OneDrive continuation link');
      seenNextLinks.add(link);
      await this.list(
        parent,
        withThumbnail,
        listFiles,
        files,
        link,
        seenNextLinks,
        preserveProjectedRows
      );
      throwIfAborted(cancelSignal);
    }

    return files;
  }

  private validateListing(response: any): OneDriveFile[] {
    if (
      !response ||
      !Array.isArray(response.value) ||
      response.value.some(
        (file: OneDriveFile) =>
          !file || typeof file.id !== 'string' || !file.id || typeof file.name !== 'string'
      ) ||
      (response['@odata.nextLink'] !== undefined &&
        (typeof response['@odata.nextLink'] !== 'string' || !response['@odata.nextLink']))
    )
      throw new Error('Malformed OneDrive file listing');
    return [...response.value];
  }

  private setTitleData(title: string, files: OneDriveFile[]) {
    if (!files.length) {
      return;
    }

    const bookCard: BookCardProps = {
      id: BaseStorageHandler.getDummyId(),
      title,
      imagePath: '',
      characters: 0,
      lastBookModified: 0,
      lastBookOpen: 0,
      progress: 0,
      lastBookmarkModified: 0,
      isPlaceholder: false
    };

    for (let index = 0, { length } = files; index < length; index += 1) {
      const file = files[index];

      if (file.name.startsWith('bookdata_')) {
        const { characters, lastBookModified, lastBookOpen } = BaseStorageHandler.getBookMetadata(
          file.name
        );

        bookCard.characters = characters;
        bookCard.lastBookModified = lastBookModified;
        bookCard.lastBookOpen = lastBookOpen;
      } else if (file.name.startsWith('progress_')) {
        const { progress, lastBookmarkModified } = BaseStorageHandler.getProgressMetadata(
          file.name
        );

        bookCard.progress = progress;
        bookCard.lastBookmarkModified = lastBookmarkModified;
      } else if (file.name.startsWith('cover_') && file.thumbnails?.[0].large?.url) {
        bookCard.imagePath = file.thumbnails?.[0].large?.url;
      }
    }

    this.titleToFiles.set(title, files);
    this.titleToBookCard.set(title, bookCard);
  }

  private async rename(
    name: string,
    files: OneDriveFile[],
    remoteFile: OneDriveFile,
    params: URLSearchParams,
    rootFilePrefix?: string
  ) {
    const renameResponse = await this.request(
      `${this.baseEndpoint}/${remoteFile.id}?${params.toString()}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      }
    );

    this.updateAfterUpload(
      renameResponse.id,
      renameResponse.name,
      files,
      remoteFile,
      {
        thumbnails: renameResponse?.thumbnails || []
      },
      rootFilePrefix
    );

    return renameResponse;
  }
}
