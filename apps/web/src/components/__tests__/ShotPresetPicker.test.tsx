/**
 * Component tests for ShotPresetPicker — the framing/angle/lens/focus
 * chip selector for scene generation.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShotPresetPicker } from '../ShotPresetPicker';
import { SHOT_CATEGORY_LABELS, SHOT_PRESETS } from '../shot-presets';

describe('ShotPresetPicker', () => {
  it('renders a chip for every preset, grouped under its category label', () => {
    render(<ShotPresetPicker value={null} onChange={vi.fn()} />);
    for (const label of Object.values(SHOT_CATEGORY_LABELS)) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const preset of SHOT_PRESETS) {
      expect(screen.getByRole('button', { name: preset.label })).toBeInTheDocument();
    }
  });

  it('selecting a chip calls onChange with its id', async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    render(<ShotPresetPicker value={null} onChange={onChange} />);
    await u.click(screen.getByRole('button', { name: 'Close-Up' }));
    expect(onChange).toHaveBeenCalledWith('cu');
  });

  it('clicking the already-active chip clears it (onChange(null))', async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    render(<ShotPresetPicker value="cu" onChange={onChange} />);
    await u.click(screen.getByRole('button', { name: 'Close-Up' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('shows a Clear control only when a value is set, and it clears', async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<ShotPresetPicker value={null} onChange={onChange} />);
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();

    rerender(<ShotPresetPicker value="low_angle" onChange={onChange} />);
    await u.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('disabled prop disables every chip and the Clear button', () => {
    render(<ShotPresetPicker value="cu" onChange={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    for (const preset of SHOT_PRESETS.slice(0, 6)) {
      expect(screen.getByRole('button', { name: preset.label })).toBeDisabled();
    }
  });

  it('marks the active chip distinctly (bg-primary/10)', () => {
    render(<ShotPresetPicker value="ms" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Medium Shot' }).className).toContain(
      'bg-primary/10'
    );
    expect(screen.getByRole('button', { name: 'Wide Shot' }).className).not.toContain(
      'bg-primary/10'
    );
  });
});
