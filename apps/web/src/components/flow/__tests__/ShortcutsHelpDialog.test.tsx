/**
 * Component test for ShortcutsHelpDialog — the timeline editor's "?" overlay.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShortcutsHelpDialog } from '../ShortcutsHelpDialog';

describe('ShortcutsHelpDialog', () => {
  it('lists shortcut rows with a key and a description', () => {
    render(<ShortcutsHelpDialog onClose={vi.fn()} />);
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
    // a representative spread of the documented bindings
    for (const key of ['Ctrl+K', 'Ctrl+Z', 'Ctrl+Shift+Z', 'Shift+Click', 'Del', '?']) {
      expect(screen.getByText(key)).toBeInTheDocument();
    }
    expect(screen.getByText('Undo')).toBeInTheDocument();
    expect(screen.getByText('Select all nodes')).toBeInTheDocument();
  });

  it('calls onClose from the X button', async () => {
    const u = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(<ShortcutsHelpDialog onClose={onClose} />);
    await u.click(container.querySelector('button')!);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
