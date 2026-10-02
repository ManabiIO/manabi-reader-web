/** @license BSD-3-Clause */
import { type ReactNode } from 'react';
import Runtime from '../runtime/Runtime.web';
import { RouterBinding } from '../runtime/router-binding';
export function RuntimeProvider({ children }: { children: ReactNode }) { return <><RouterBinding/><Runtime/>{children}</>; }
