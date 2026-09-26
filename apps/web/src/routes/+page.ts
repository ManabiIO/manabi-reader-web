/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// The manifest launches "./", inside the worker's trailing-slash scope.
// Keep just this entry route canonical; existing deep links are unchanged.
export const trailingSlash = 'always';
