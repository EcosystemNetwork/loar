import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CharacterChips, ClampedText, characterChips } from '../wiki/CharacterHero';

describe('characterChips', () => {
  it('reads spec keys first, then legacy seeded keys', () => {
    expect(
      characterChips({ role: 'Antagonist', faction: 'The Panopticon Authority', age: 55 })
    ).toEqual([
      { label: 'Role', value: 'Antagonist' },
      { label: 'Faction', value: 'The Panopticon Authority' },
      { label: 'Age', value: '55' },
    ]);
    expect(characterChips({ affiliations: 'A', faction: 'B' })[0].value).toBe('A');
  });

  it('skips placeholder dashes and sentence-length values', () => {
    expect(characterChips({ role: '—', status: 'x'.repeat(80) })).toEqual([]);
    expect(characterChips(null)).toEqual([]);
  });

  it('renders nothing without chips', () => {
    const { container } = render(<CharacterChips metadata={{}} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('ClampedText', () => {
  it('leaves short text alone', () => {
    render(<ClampedText text="Short bio." />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('collapses long text and toggles', async () => {
    render(<ClampedText text={'word '.repeat(200)} />);
    const btn = screen.getByRole('button', { name: 'Read more' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(btn);
    expect(screen.getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded')).toBe(
      'true'
    );
  });
});
