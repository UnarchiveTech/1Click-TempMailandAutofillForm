# Contributing to 1Click Temp Mail Autofill Form

Thank you for your interest in contributing to this project! This document provides guidelines and instructions for contributing.

## Code of Conduct

Be respectful, inclusive, and constructive. We welcome contributions from everyone regardless of background or experience level.

## Getting Started

### Prerequisites
- Node.js 18+ or Bun
- Git
- Basic knowledge of TypeScript, Svelte, and browser extension development

### Setting Up Development Environment

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/yourusername/1click-temp-mail-autofill-form.git
   cd 1click-temp-mail-autofill-form
   ```
3. Install dependencies:
   ```bash
   bun install
   ```
4. Create a new branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Development Workflow

### Making Changes

1. Make your changes following the project structure and coding standards
2. Run linting and type checking:
   ```bash
   bun run lint
   bun run typecheck
   ```
3. Fix any linting issues:
   ```bash
   bun run lint:fix
   ```
4. Test your changes:
   ```bash
   bun run dev
   ```

### Commit Messages

Use clear and descriptive commit messages:
- `feat: add OTP auto-detection feature`
- `fix: resolve email rendering issue`
- `docs: update README installation instructions`
- `style: format code with Biome`

### Pull Request Process

1. Push your changes to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```
2. Create a pull request to the `master` branch
3. Ensure your PR passes all CI checks:
   - Biome lint check
   - TypeScript type check
   - Build verification
4. Provide a clear description of your changes
5. Link related issues if applicable

## Coding Standards

### Code Style
- Use Biome for code formatting and linting
- Follow the existing code structure
- Use TypeScript for type safety
- Keep functions small and focused
- Add comments for complex logic

### File Organization
- Components go in `src/components/`
- Views go in `src/views/`
- Feature-specific logic goes in `src/features/`
- Utilities go in `src/utils/`

### AGENTS.md / CLAUDE.md Sync

`AGENTS.md` and `CLAUDE.md` must always be byte-identical - `CLAUDE.md` is read
by Claude Code, `AGENTS.md` by other AI tools. A pre-commit hook enforces this.
When you edit one, copy it to the other:

```bash
cp AGENTS.md CLAUDE.md   # or vice versa
```

### Svelte Best Practices
- Use Svelte 5 runes (`$state`, `$derived`, etc.)
- Keep components small and reusable
- Use TypeScript with Svelte components
- Follow accessibility guidelines (use ARIA attributes, semantic HTML)

## Testing

Before submitting a PR, ensure:
- Code passes linting: `bun run lint`
- Code passes type checking: `bun run typecheck`
- Extension builds successfully: `bun run build`
- Manual testing of your changes

## Reporting Issues

When reporting issues, please include:
- Clear description of the problem
- Steps to reproduce
- Expected behavior
- Actual behavior
- Browser version and OS
- Screenshots if applicable

## Feature Requests

For feature requests:
- Describe the feature clearly
- Explain the use case
- Consider if it fits the project scope
- Be open to discussion

## Questions

For questions about the project:
- Check existing documentation
- Search existing issues
- Create a new issue with the "question" label

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
