import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function cssRule(selector: string): string {
  const css = readFileSync('src/client/styles.css', 'utf8');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`));
  return match?.groups?.body ?? '';
}

describe('Notebook UI CSS', () => {
  it('keeps the save pill roomy and prevents label clipping', () => {
    const rule = cssRule('.reader-save');

    expect(rule).toContain('padding: 7px 16px;');
    expect(rule).toContain('white-space: nowrap;');
    expect(rule).toContain('flex: 0 0 auto;');
  });
});
