/**
 * The mailbox selection has ONE source of truth.
 *
 * `active` and `count` are the same fact as `selectedEmailIds.size`, so they are
 * `$derived` from it and published to the shell in a single `$effect`. They used
 * to be assigned at eleven sites, and the invariant
 * `active ⇔ count > 0 ⇔ size > 0` held only by hand - which it did not:
 *
 *   - the avatar click force-set `active = true` BEFORE toggling, so removing the
 *     last id left `active: true, count: 0` and the shell's bar up over an empty
 *     selection;
 *   - `selectAllVisible()` set `active = true` even when the filter matched
 *     nothing, the same phantom state;
 *   - `toggleEmailSelection()` only ever turned `active` OFF, so the flag's
 *     correctness depended on which of those guards ran first;
 *   - and four drop-on-tab handlers had to re-check BOTH `!active` and
 *     `size === 0`, because the two could disagree.
 *
 * The published object itself was later demoted from eleven imperative writes to
 * ONE `$derived.by` construction: there is no assignment site left to keep in
 * sync at all, and the object can only be what its inputs say. This test reads
 * the view's source: it cannot prove runtime behaviour, but it pins the
 * STRUCTURE those bugs needed - one derivation, one publish site, no read-back
 * from the published object, and no in-place mutation of the set the derivation
 * depends on. Re-introducing any of the four fails here.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const VIEW = 'src/ui/views/mailbox/MailboxView.svelte';
const source = readFileSync(join(process.cwd(), VIEW), 'utf8');

describe('mailbox selection state is derived, never assigned', () => {
  test('`active` and `count` are derived from the selected-id set', () => {
    // Verbatim, so a re-derivation from something else (the filtered list, a
    // stored copy) is a deliberate edit rather than a silent substitution.
    expect(source).toContain('let selectionCount = $derived(selectedEmailIds.size);');
    expect(source).toContain('let selectionActive = $derived(selectedEmailIds.size > 0);');
  });

  test('the published state is constructed ONCE, reactively, never assigned', () => {
    // One `$derived.by` literal: there is no assignment site left to keep in
    // sync, and the invariant `active ⇔ count > 0` holds by construction rather
    // than by ordering eight writes correctly.
    expect(source.match(/const selectionState = \$derived\.by/g)?.length).toBe(1);
    // An imperative write to the published object would recreate the drift this
    // file exists to prevent - the derived construction and an assignment could
    // then disagree about the same field.
    expect(source).not.toMatch(/selectionState\.\w+ =/);
    // The facts come from the deriveds by NAME (a read-back or a copied value
    // would be one effect-flush stale exactly as before).
    expect(source).toContain('active: selectionActive,');
    expect(source).toContain('count: selectionCount,');
  });

  test('the derived state is published at exactly ONE reactive site', () => {
    // A second publish effect would race the first for the same registry key.
    expect(source.match(/publishSelectionSurface\(/g)?.length).toBe(1);
    // Asserted as ONE CALL EXPRESSION rather than one source line: the arrow body
    // is wrapped onto its own line by the formatter, so pinning the layout would
    // fail on a formatting-only change while catching nothing. The surface id and
    // both handed-over values stay verbatim, so a renamed list or a swapped
    // argument still fails here.
    expect(source).toContain(
      "publishSelectionSurface({ surface: 'mailbox', state: selectionState, api: selectionApi })"
    );
    // …and it must be REACTIVE: the registry entry is refreshed when the facts
    // change, so a one-shot call would leave the shell's strip stale.
    expect(/\$effect\(\(\)\s*=>\s*publishSelectionSurface\(/.test(source)).toBe(true);
  });

  test('the view never reads the published object back', () => {
    // Reading the published object is how the view would trust a value one
    // effect flush behind its own state. The name exists only in its
    // declaration and in the publish effect that hands it to the shell.
    const occurrences = [...source.matchAll(/\bselectionState\b/g)].length;
    expect(occurrences).toBe(2);
  });

  test('the selected-id set is never mutated in place', () => {
    // `$state` tracking on a `Set` needs reassignment: `selectedEmailIds.add(id)`
    // changes the size without notifying, so `selectionActive`/`selectionCount`
    // would go stale and the bar would never open. Every site builds a new Set.
    expect(source).not.toMatch(/selectedEmailIds\.(add|delete|clear)\(/);
  });

  test('the compensating guards the drift required are gone', () => {
    // Both existed only because the flag and the set could disagree.
    expect(source).not.toContain('!selectionState.active');
    expect(source).not.toContain('!selectionActive && selectedEmailIds.size === 0');
    // …and the derived value is what the view now asks.
    expect(source).toContain('if (!selectionActive) return;');
  });
});
