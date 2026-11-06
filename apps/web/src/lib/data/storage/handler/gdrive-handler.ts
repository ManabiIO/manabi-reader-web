/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BookCardProps } from '$lib/components/book-card/book-card-props';
import { gDriveRefreshEndpoint } from '$lib/data/env';
import { ApiStorageHandler } from '$lib/data/storage/handler/api-handler';
import { BaseStorageHandler, type ExternalFile } from '$lib/data/storage/handler/base-handler';
import { StorageKey } from '$lib/data/storage/storage-types';
import { database, gDriveStorageSource$ } from '$lib/data/store';
import pLimit from 'p-limit';
import { throwIfAborted } from '$lib/functions/replication/replication-error';

interface GDriveFile extends ExternalFile {
  thumbnailLink?: string;
  parents: string[];
}

export class GDriveStorageHandler extends ApiStorageHandler {
  private baseFileApiUrl = 'https://www.googleapis.com/drive/v3/files';

  private baseUploadApiUrl = 'https://www.googleapis.com/upload/drive/v3/files';

  constructor(window: Window) {
    super(StorageKey.GDRIVE, window, gDriveRefreshEndpoint);
  }

  setInternalSettings(storageSourceName: string) {
    const newStorageSource = storageSourceName || gDriveStorageSource$.getValue();

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

        const titles = await this.list(
          `trashed=false and mimeType='application/vnd.google-apps.folder' and '${this.rootId}' in parents`,
          'files(id,name),nextPageToken'
        );
        const titleIdToName = new Map<string, string>();
        const names = new Set<string>();

        for (let index = 0, { length } = titles; index < length; index += 1) {
          const title = titles[index];
          const desanitizedTitle = BaseStorageHandler.desanitizeFilename(title.name);
          if (names.has(desanitizedTitle))
            throw new Error(
              'Multiple book folders have the same title. Review them before using this library.'
            );
          names.add(desanitizedTitle);

          this.titleToId.set(desanitizedTitle, title.id);
          titleIdToName.set(title.id, desanitizedTitle);
        }

        if (titles.length) {
          const titleIdChunks = [];

          for (let index = 0, { length } = titles; index < length; index += 50) {
            titleIdChunks.push(titles.slice(index, index + 50).map((title) => title.id));
          }

          const listLimiter = pLimit(1);
          const listTasks: Promise<void>[] = [];

          titleIdChunks.forEach((titleIdChunk) =>
            listTasks.push(
              listLimiter(async () => {
                this.setTitleData(
                  this.groupExternalFiles(
                    await this.list(
                      `trashed=false and ('${titleIdChunk.join(`' in parents or '`)}' in parents)`,
                      'files(id,name,thumbnailLink,parents),nextPageToken'
                    ),
                    titleIdToName
                  )
                );
              })
            )
          );

          await Promise.all(listTasks).catch((error) => {
            listLimiter.clearQueue();
            throw error;
          });
        }

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

    // A title can equal the compatibility root's name. Root IDs and book IDs
    // must not share a name-only cache or a book can target its parent library.
    const externalId = !isRoot && parent === this.rootId ? this.titleToId.get(name) : undefined;

    if (externalId) {
      return externalId;
    }

    const sanitizedName = BaseStorageHandler.sanitizeForFilename(name);
    let titleId = '';
    if (!isRoot) {
      const folders = await this.list(
        `trashed=false and '${parent}' in parents and mimeType='application/vnd.google-apps.folder'`,
        'files(id,name),nextPageToken'
      );
      throwIfAborted(cancelSignal);
      const matches = folders.filter(
        (folder) => BaseStorageHandler.desanitizeFilename(folder.name) === name
      );
      throwIfAborted(cancelSignal);
      if (matches.length > 1)
        throw new Error(
          'Multiple matching cloud folders require review before this library can be used.'
        );
      if (matches.length) {
        if (parent === this.rootId) this.titleToId.set(name, matches[0].id);
        return matches[0].id;
      }
      if (readOnly) return '';
    } else {
      const matches = await this.list(
        `trashed=false and '${parent}' in parents and mimeType = 'application/vnd.google-apps.folder' and name = "${sanitizedName}"`,
        'files(id),nextPageToken'
      );
      throwIfAborted(cancelSignal);
      if (matches.length > 1)
        throw new Error(
          'Multiple matching cloud folders require review before this library can be used.'
        );
      titleId = matches[0]?.id || '';
    }

    throwIfAborted(cancelSignal);
    if (!titleId && !readOnly) {
      const body = JSON.stringify({
        mimeType: 'application/vnd.google-apps.folder',
        name: sanitizedName,
        parents: [parent]
      });

      throwIfAborted(cancelSignal);
      const response = await this.request(this.baseFileApiUrl, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json' }
      });

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
      const externalFiles = await this.list(
        `trashed=false and '${remoteTitleId}' in parents`,
        'files(id,name,thumbnailLink,parents)'
      );

      if (externalFiles.length) {
        const groupedExternalFiles = new Map<string, GDriveFile[]>();

        groupedExternalFiles.set(this.currentContext.title, externalFiles);
        this.setTitleData(groupedExternalFiles);
      }
    }

    return this.titleToFiles.get(this.currentContext.title) || [];
  }

  protected async setRootFiles() {
    if ((!this.cacheStorageData || !this.rootFileListFetched) && !this.rootFiles.size) {
      const rootFiles = await this.list(
        `trashed=false and mimeType!='application/vnd.google-apps.folder' and '${this.rootId}' in parents`,
        'files(id,name)'
      );

      for (let index = 0, { length } = rootFiles; index < length; index += 1) {
        const rootFile = rootFiles[index];

        this.setRootFile(rootFile.name, rootFile);
      }

      this.rootFileListFetched = true;
    }
  }

  protected retrieve(
    file: GDriveFile,
    typeToRetrieve: XMLHttpRequestResponseType,
    progressBase = 1
  ) {
    const params = new URLSearchParams();
    params.append('fields', 'files(name)');
    params.append('alt', 'media');

    return this.request(
      `${this.baseFileApiUrl}/${file.id}?${params.toString()}`,
      { trackDownload: true },
      typeToRetrieve,
      progressBase
    );
  }

  protected async upload(
    folderId: string,
    name: string,
    files: GDriveFile[],
    externalFile: GDriveFile | undefined,
    data: Blob | string | undefined,
    rootFilePrefix?: string,
    progressBase = 0.8
  ): Promise<GDriveFile> {
    const cancelSignal = this.cancelSignal;
    throwIfAborted(cancelSignal);
    const form = new FormData();
    const params = new URLSearchParams();

    form.append(
      'resource',
      new Blob(
        [
          JSON.stringify(
            externalFile
              ? {
                  name
                }
              : {
                  name,
                  parents: [folderId]
                }
          )
        ],
        { type: 'application/json' }
      )
    );

    if (data) {
      form.append('file', data);
    }

    params.append('uploadType', 'multipart');

    throwIfAborted(cancelSignal);
    const response = await this.request(
      `${this.baseUploadApiUrl}${externalFile ? `/${externalFile.id}` : ''}?${params.toString()}`,
      { method: externalFile ? 'PATCH' : 'POST', body: form, trackUpload: true },
      'json',
      progressBase
    );

    throwIfAborted(cancelSignal);
    this.updateAfterUpload(
      response.id,
      response.name,
      files,
      externalFile,
      {
        parents: [folderId]
      },
      rootFilePrefix
    );

    return response;
  }

  protected executeDelete(id: string) {
    return this.request(`${this.baseFileApiUrl}/${id}`, { method: 'DELETE' });
  }

  private async list(
    query: string,
    fields: string,
    files: GDriveFile[] = [],
    pageToken = '',
    seenPageTokens = new Set<string>()
  ): Promise<GDriveFile[]> {
    const cancelSignal = this.cancelSignal;
    throwIfAborted(cancelSignal);
    const params = new URLSearchParams();
    params.append('corpora', 'user');
    params.append('spaces', 'drive');
    params.append('fields', fields.includes('nextPageToken') ? fields : `${fields},nextPageToken`);
    params.append('q', query);

    if (pageToken) {
      params.append('pageToken', pageToken);
    }

    const response = await this.request(`${this.baseFileApiUrl}?${params.toString()}`);

    throwIfAborted(cancelSignal);
    if (
      !response ||
      !Array.isArray(response.files) ||
      response.files.some(
        (file: GDriveFile) =>
          !file ||
          typeof file.id !== 'string' ||
          !file.id ||
          (fields.includes('name') && typeof file.name !== 'string')
      ) ||
      (response.nextPageToken !== undefined &&
        (typeof response.nextPageToken !== 'string' || !response.nextPageToken))
    )
      throw new Error('Malformed Google Drive file listing');

    files.push(...response.files);
    if (response.nextPageToken) {
      if (seenPageTokens.has(response.nextPageToken))
        throw new Error('Repeated Google Drive continuation token');
      seenPageTokens.add(response.nextPageToken);
      await this.list(query, fields, files, response.nextPageToken, seenPageTokens);
      throwIfAborted(cancelSignal);
    }

    return files;
  }

  private groupExternalFiles(remoteFiles: GDriveFile[], titleIdToName: Map<string, string>) {
    const groupedExternalFiles = new Map<string, GDriveFile[]>();

    for (let index = 0, { length } = remoteFiles; index < length; index += 1) {
      const remoteFile = remoteFiles[index];
      const title = titleIdToName.get(remoteFile.parents[0]);

      if (title) {
        const groupedFiles = groupedExternalFiles.get(title) || [];

        groupedFiles.push(remoteFile);
        groupedExternalFiles.set(title, groupedFiles);
      }
    }

    return groupedExternalFiles;
  }

  private setTitleData(groupedExternalFiles: Map<string, GDriveFile[]>) {
    const entries = [...groupedExternalFiles.entries()];

    for (let index = 0, { length } = entries; index < length; index += 1) {
      const [title, files] = entries[index];

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

      for (let index2 = 0, { length: length2 } = files; index2 < length2; index2 += 1) {
        const file = files[index2];

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
        } else if (file.name.startsWith('cover_') && file.thumbnailLink) {
          bookCard.imagePath = file.thumbnailLink.replace(/=s\d+$/, '=s720');
        }
      }

      this.titleToFiles.set(title, files);
      this.titleToBookCard.set(title, bookCard);
    }
  }
}
