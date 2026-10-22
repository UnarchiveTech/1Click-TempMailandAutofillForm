import { describe, expect, test } from 'bun:test';
import { auditTypography, scanTypography } from '../../../scripts/check-ui-typography.js';
import { collectSourceFiles } from '../../../scripts/source-files.js';

describe('UI typography roles', () => {
  test('rejects tiny text and badge tokens on paragraphs and external labels', () => {
    const findings = scanTypography(
      '<p class="text-[10px]">Help</p>\n<label class="text-label-sm">Name</label>\n<p\n class="text-label-sm">Warning</p>',
      'fixture.svelte'
    );
    expect(findings).toHaveLength(3);
    expect(findings.map((finding) => finding.line)).toEqual([1, 2, 3]);
  });
  test('permits actual badges, compact metadata, and fitted-action floors', () => {
    expect(
      scanTypography(
        '<span class="text-label-sm">3</span><p class="ui-support">Help</p><button class="text-xs">Copy</button>',
        'fixture.svelte'
      )
    ).toEqual([]);
  });
  test('ignores comments but checks description overrides', () => {
    expect(
      scanTypography(
        '<!-- <p class="text-[10px]">Old</p> --><SettingCard descriptionClass="text-label-sm" />',
        'fixture.svelte'
      )
    ).toHaveLength(1);
  });
  test('the live component tree has no violations', () => {
    const files = collectSourceFiles({ dirs: ['src/ui'], extensions: ['.svelte'] });
    expect(files).toContain('src/ui/components/primitives/ProgressBar.svelte');
    expect(files).toContain('src/ui/views/settings/DiagnosticsView.svelte');
    expect(auditTypography()).toEqual([]);
  });
});
