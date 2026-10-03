/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Metro registers Android vector XML as an opaque packaged image asset. */
declare module '*.xml' {
  const asset: import('react-native').ImageSourcePropType;
  export default asset;
}
