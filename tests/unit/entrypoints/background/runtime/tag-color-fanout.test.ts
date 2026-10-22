/**
 * The tag-edit fan-out: the color chosen for a tag is written to EVERY address that
 * carries it, not only the one the dialog was opened from.
 *
 * A tag is one tag, so its color is a property of the tag. Writing the pick only to
 * the target left the tag stored in two colors - and because the chips resolve a tag
 * to ONE color, the user watched their pick get ignored.
 */
import { describe, expect, test } from 'bun:test';
import { applyTagEditToAddresses } from '@/entrypoints/background/runtime/message-handler';
import type { Address } from '@/utils/types.js';

function address(overrides: Partial<Address> & { address: string }): Address {
  return {
    id: overrides.address,
    provider: 'demo',
    createdAt: 0,
    expiresAt: 0,
    ...overrides,
  } as Address;
}

const tag = (name: string, color: string) => ({ name, color });

/** An address that already carries `name` in `color`, both schemas in step. */
function carrier(email: string, name: string, color: string): Address {
  return address({ address: email, tags: [tag(name, color)], tag: name, tagColor: color });
}

describe('applyTagEditToAddresses', () => {
  test('applies the tag list to the named address', () => {
    const target = address({ address: 'a@x.com' });
    const next = applyTagEditToAddresses([target], new Set([target.id]), {
      tags: [tag('banking', '#6366F1')],
      tag: 'banking',
      color: '#6366F1',
    });
    expect(next[0]?.tags).toEqual([tag('banking', '#6366F1')]);
    expect(next[0]?.tag).toBe('banking');
    expect(next[0]?.tagColor).toBe('#6366F1');
  });

  test('writes the chosen color to EVERY address carrying the tag', () => {
    const target = address({ address: 'a@x.com' });
    const other = carrier('b@x.com', 'banking', '#EC4899');
    const next = applyTagEditToAddresses([target, other], new Set([target.id]), {
      tags: [tag('banking', '#6366F1')],
      tag: 'banking',
      color: '#6366F1',
    });
    expect(next[0]?.tags).toEqual([tag('banking', '#6366F1')]);
    // The address the message never named follows: the pick is the tag's color.
    expect(next[1]?.tags).toEqual([tag('banking', '#6366F1')]);
    expect(next[1]?.tag).toBe('banking');
    expect(next[1]?.tagColor).toBe('#6366F1');
  });

  test('reaches a carrier that spells the tag differently, and leaves its spelling alone', () => {
    const target = address({ address: 'a@x.com' });
    const other = carrier('b@x.com', 'Banking', '#EC4899');
    const next = applyTagEditToAddresses([target, other], new Set([target.id]), {
      tags: [tag('banking', '#6366F1')],
      tag: 'banking',
      color: '#6366F1',
    });
    // One tag, so it takes one color - but a color edit is not a rename.
    expect(next[1]?.tags).toEqual([tag('Banking', '#6366F1')]);
  });

  test('leaves addresses without the tag, and other tags, as the SAME object', () => {
    const target = address({ address: 'a@x.com' });
    const untouched = address({ address: 'c@x.com', tags: [tag('work', '#10B981')] });
    const input = [target, untouched];
    const next = applyTagEditToAddresses(input, new Set([target.id]), {
      tags: [tag('banking', '#6366F1')],
      tag: 'banking',
      color: '#6366F1',
    });
    expect(next[1]).toBe(untouched);
  });

  test('recolors a carrier that already writes the color as the SAME object', () => {
    const target = address({ address: 'a@x.com' });
    const already = carrier('b@x.com', 'banking', '#6366F1');
    const next = applyTagEditToAddresses([target, already], new Set([target.id]), {
      tags: [tag('banking', '#6366F1')],
      tag: 'banking',
      color: '#6366F1',
    });
    expect(next[1]).toBe(already);
  });

  test('the single-tag shape fans out too, when it names a color', () => {
    const target = address({ address: 'a@x.com' });
    const other = carrier('b@x.com', 'banking', '#EC4899');
    const next = applyTagEditToAddresses([target, other], new Set([target.id]), {
      tag: 'banking',
      color: '#6366F1',
    });
    expect(next[0]?.tags).toEqual([tag('banking', '#6366F1')]);
    expect(next[1]?.tags).toEqual([tag('banking', '#6366F1')]);
  });

  test('a single-tag message with NO color recolors nobody', () => {
    const target = address({ address: 'a@x.com' });
    const other = carrier('b@x.com', 'banking', '#EC4899');
    const next = applyTagEditToAddresses([target, other], new Set([target.id]), { tag: 'banking' });
    // The target takes the handler's own default...
    expect(next[0]?.tags).toEqual([tag('banking', '#6750a4')]);
    // ...and the carrier is untouched: inventing a color would recolor a tag
    // nobody edited, which is the exact drift this fan-out exists to prevent.
    expect(next[1]).toBe(other);
  });

  test('clearing the tag list clears the target and recolors nothing', () => {
    const target = carrier('a@x.com', 'banking', '#EC4899');
    const other = carrier('b@x.com', 'banking', '#6366F1');
    const next = applyTagEditToAddresses([target, other], new Set([target.id]), {
      tags: [],
      tag: '',
    });
    expect(next[0]?.tags).toEqual([]);
    expect(next[0]?.tag).toBeUndefined();
    expect(next[1]).toBe(other);
  });

  test('a color for a tag the target does not yet carry still reaches its carriers', () => {
    const target = address({ address: 'a@x.com' });
    const other = carrier('b@x.com', 'banking', '#EC4899');
    const next = applyTagEditToAddresses([target, other], new Set([target.id]), {
      tags: [tag('work', '#10B981'), tag('banking', '#6366F1')],
    });
    // Every tag in the list takes its color everywhere; `work` is on one address,
    // so it has nothing to fan out to.
    expect(next[0]?.tags).toEqual([tag('work', '#10B981'), tag('banking', '#6366F1')]);
    expect(next[1]?.tags).toEqual([tag('banking', '#6366F1')]);
  });
});
