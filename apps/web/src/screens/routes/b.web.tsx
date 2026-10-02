/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useLocalSearchParams } from 'expo-router';
import { base } from '../../runtime/paths';
import { QualifiedWebReader } from '../../reader-react/web-qualified-reader';

export default function ReaderRoute() {
  const params = useLocalSearchParams();
  // Route-local params are ready during the new screen's first render. The
  // browser address bar can still describe the outgoing screen at this point.
  const url = new URL(
    `${base}/b`,
    typeof window === 'undefined' ? 'https://reader.invalid' : window.location.origin
  );
  for (const [name, value] of Object.entries(params)) {
    if (value == null) continue;
    if (name === '#') url.hash = Array.isArray(value) ? (value[0] ?? '') : value;
    else
      for (const item of Array.isArray(value) ? value : [value])
        url.searchParams.append(name, item);
  }
  return <QualifiedWebReader routeUrl={url.href} />;
}
