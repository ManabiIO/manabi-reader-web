/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export interface EpubMetadataMeta {
  '@_name'?: string;
  '@_content'?: string;
  '@_refines'?: string;
  '@_property'?: string;
  '#text'?: string;
}

export interface EpubCreator {
  '#text': string;
  '@_id'?: string;
  '@_role'?: string;
  '@_opf:role'?: string;
  '@_file-as'?: string;
  '@_opf:file-as'?: string;
}

export interface EpubManifestItem {
  '@_href': string;
  '@_id': string;
  '@_media-type': string;
  '@_properties'?: string;
  '@_fallback'?: string;
}

export interface EpubSpineItemRef {
  '@_idref': string;
  '@_linear'?: string;
}

export interface EpubContent {
  package: {
    metadata: {
      'dc:title':
        | string
        | {
            '#text': string;
          };
      'dc:language':
        | string
        | {
            '#text': string;
          };
      'dc:creator'?: string | EpubCreator | (string | EpubCreator)[];
      meta?: EpubMetadataMeta | EpubMetadataMeta[];
    };
    manifest: {
      item: EpubManifestItem[];
    };
    spine: {
      '@_page-progression-direction'?: string;
      itemref: EpubSpineItemRef[];
    };
  };
}

export interface EpubOPFContent {
  'opf:package': {
    'opf:metadata': {
      'dc:title':
        | string
        | {
            '#text': string;
          };
      'dc:language':
        | string
        | {
            '#text': string;
          };
      'dc:creator'?: string | EpubCreator | (string | EpubCreator)[];
      'opf:meta'?: EpubMetadataMeta | EpubMetadataMeta[];
    };
    'opf:manifest': {
      'opf:item': EpubManifestItem[];
    };
    'opf:spine': {
      '@_page-progression-direction'?: string;
      'opf:itemref': EpubSpineItemRef[];
    };
  };
}

export function isOPFType(contents: EpubContent | EpubOPFContent): contents is EpubOPFContent {
  return (contents as EpubOPFContent)['opf:package'] !== undefined;
}
