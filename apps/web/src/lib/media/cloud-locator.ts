/** @license BSD-3-Clause — Manabi media integration. */
/** Device-local locator only. Never include this in the account change feed. */
export interface CloudLocator { connectionId: string; root: string; id: string }
export function validateCloudLocator(value: unknown): CloudLocator {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid saved cloud locator');
    const v = value as Record<string, unknown>;
    if (Object.keys(v).length !== 3 || typeof v.connectionId !== 'string' ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v.connectionId) ||
        ![v.root, v.id].every(x => typeof x === 'string' && x.length > 0 && x.length <= 256 && !/[\x00-\x1f\x7f]/.test(x)))
        throw new Error('Invalid saved cloud locator');
    return { connectionId: v.connectionId, root: v.root as string, id: v.id as string };
}
export function cloudInfoPath(value: unknown): string {
    const locator = validateCloudLocator(value);
    return `connections/${locator.connectionId}/media-info/?${new URLSearchParams({ root: locator.root, id: locator.id })}`;
}
