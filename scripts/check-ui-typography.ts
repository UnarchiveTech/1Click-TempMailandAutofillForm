/**
 * Typography guard for app components. This is a source contract, not a visual
 * audit: runtime fitting, inherited fonts and injected TS styles need browser
 * checks. Badge text and avatar-derived sizes remain intentional exceptions.
 */
import { readFileSync } from 'node:fs';
import { collectSourceFiles, repoAbsolute } from './source-files';
import { stripComments } from './source-lexer';

export interface TypographyFinding {
  file: string;
  line: number;
  reason: string;
}

export function scanTypography(source: string, file: string): TypographyFinding[] {
  const clean = stripComments(source);
  const findings: TypographyFinding[] = [];
  const report = (index: number, reason: string) => {
    findings.push({ file, line: clean.slice(0, index).split('\n').length, reason });
  };
  for (const match of clean.matchAll(/\btext-\[(\d+(?:\.\d+)?)px\]/g)) {
    if (Number(match[1]) < 11) report(match.index, 'Text is below the 11px badge floor.');
  }
  // Only known copy-bearing tags are classified; div/span badges are legal.
  for (const match of clean.matchAll(
    /<(?:p|label|legend)\b[^>]*\bclass\s*=\s*"[^"]*\btext-label-sm\b[^"]*"/g
  )) {
    report(match.index, 'Readable copy or field labels must not use badge typography.');
  }
  for (const match of clean.matchAll(/\bdescriptionClass\s*=\s*"[^"]*\btext-label-sm\b[^"]*"/g)) {
    report(match.index, 'Descriptions must use supporting/body typography.');
  }
  return findings;
}

export function auditTypography(): TypographyFinding[] {
  return collectSourceFiles({ dirs: ['src/ui'], extensions: ['.svelte'] }).flatMap((file) =>
    scanTypography(readFileSync(repoAbsolute(file), 'utf8'), file)
  );
}

if (import.meta.main) {
  const findings = auditTypography();
  for (const finding of findings)
    console.error(`${finding.file}:${finding.line}: ${finding.reason}`);
  console.log(`UI typography: ${findings.length} findings.`);
  process.exitCode = findings.length ? 1 : 0;
}
