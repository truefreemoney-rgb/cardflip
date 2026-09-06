/** Test stand-in for `next/cache`: records revalidations instead of needing a request store. */
export const revalidated = [];

export function revalidatePath(path, type) {
  revalidated.push({ path, type });
}

export function revalidateTag(tag) {
  revalidated.push({ tag });
}

export function unstable_cache(fn) {
  return fn;
}

export function unstable_noStore() {}
