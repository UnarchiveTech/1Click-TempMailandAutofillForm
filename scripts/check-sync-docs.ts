import { readFileSync } from 'node:fs';

try {
  const agentsContent = readFileSync('AGENTS.md', 'utf8');
  const claudeContent = readFileSync('CLAUDE.md', 'utf8');

  if (agentsContent !== claudeContent) {
    console.error(
      'ERROR: AGENTS.md and CLAUDE.md are out of sync. Copy one to the other before committing.'
    );
    process.exit(1);
  }
  console.log('✓ AGENTS.md and CLAUDE.md are in sync.');
} catch (error) {
  console.error('Failed to verify documentation sync:', error);
  process.exit(1);
}
