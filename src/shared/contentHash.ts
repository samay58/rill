export function contentHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function entryContentHash(parts: { title?: string | null; content_text?: string | null; content_html_sanitized?: string | null }): string {
  return contentHash(`${parts.title ?? ''}|${parts.content_text ?? ''}|${parts.content_html_sanitized ?? ''}`);
}
