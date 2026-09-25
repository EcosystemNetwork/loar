import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_EXPORT_SETTINGS } from '@/lib/episodeCut';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params: _p, ...rest }: any) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { ExportPanel, EXPORT_STAGE_LABELS } from '../ExportPanel';

function setup(over: Partial<React.ComponentProps<typeof ExportPanel>> = {}) {
  const props = {
    settings: DEFAULT_EXPORT_SETTINGS,
    onSettingsChange: vi.fn(),
    hasClips: true,
    exporting: false,
    progress: 0,
    stage: undefined as string | undefined,
    warnings: [] as string[],
    exportedUrl: null as string | null,
    isCanon: false,
    universeId: 'u1',
    episodeId: 'e1',
    copied: false,
    onExport: vi.fn(),
    onDownload: vi.fn(),
    onCopyLink: vi.fn(),
    ...over,
  };
  render(<ExportPanel {...props} />);
  return props;
}

afterEach(cleanup);

describe('ExportPanel', () => {
  it('changes each export setting independently', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('radio', { name: '9:16 Vertical' }));
    expect(props.onSettingsChange).toHaveBeenLastCalledWith({
      ...DEFAULT_EXPORT_SETTINGS,
      aspect: '9:16',
    });
    fireEvent.click(screen.getByRole('radio', { name: '1080p' }));
    expect(props.onSettingsChange).toHaveBeenLastCalledWith({
      ...DEFAULT_EXPORT_SETTINGS,
      resolution: '1080p',
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Fill (crop)' }));
    expect(props.onSettingsChange).toHaveBeenLastCalledWith({
      ...DEFAULT_EXPORT_SETTINGS,
      framing: 'fill',
    });
  });

  it('only explains framing once the frame differs from the source shape', () => {
    setup();
    expect(screen.queryByText(/black bars/)).toBeNull();
    cleanup();
    setup({ settings: { ...DEFAULT_EXPORT_SETTINGS, aspect: '9:16' } });
    expect(screen.getByText(/black bars/)).toBeInTheDocument();
    cleanup();
    setup({ settings: { ...DEFAULT_EXPORT_SETTINGS, aspect: '1:1', framing: 'fill' } });
    expect(screen.getByText(/cropped to fill/)).toBeInTheDocument();
  });

  it('needs clips to export, then starts the export', () => {
    const { unmount } = render(<div />);
    unmount();
    const off = setup({ hasClips: false });
    expect(screen.getByRole('button', { name: /Export episode/ })).toBeDisabled();
    expect(off.onExport).not.toHaveBeenCalled();
    cleanup();
    const on = setup();
    fireEvent.click(screen.getByRole('button', { name: /Export episode/ }));
    expect(on.onExport).toHaveBeenCalled();
  });

  it('reports progress with a readable stage and an accessible bar', () => {
    setup({ exporting: true, progress: 42.4, stage: 'concatenating' });
    expect(screen.getByText(`${EXPORT_STAGE_LABELS.concatenating}…`)).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'Export progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByRole('button', { name: /Exporting 42%/ })).toBeDisabled();
  });

  it('clamps nonsense progress and falls back for unknown stages', () => {
    setup({ exporting: true, progress: 250, stage: 'weird' });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText('Rendering…')).toBeInTheDocument();
  });

  it('surfaces server warnings (e.g. a skipped soundtrack)', () => {
    setup({ warnings: ['The soundtrack was skipped: HTTP 404'] });
    expect(screen.getByText(/soundtrack was skipped/)).toBeInTheDocument();
  });

  it('offers download, link copy and the watch page once exported', () => {
    const props = setup({ exportedUrl: 'https://cdn/x.mp4' });
    fireEvent.click(screen.getByRole('button', { name: /Download MP4/ }));
    expect(props.onDownload).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Copy watch link/ }));
    expect(props.onCopyLink).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /Open watch page/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export again/ })).toBeInTheDocument();
  });

  it('warns that a draft link is private until published as canon', () => {
    setup({ exportedUrl: 'https://cdn/x.mp4', isCanon: false });
    expect(screen.getByText(/until the episode is/i)).toBeInTheDocument();
    cleanup();
    setup({ exportedUrl: 'https://cdn/x.mp4', isCanon: true });
    expect(screen.queryByText(/until the episode is/i)).toBeNull();
  });

  it('hides the result while a new export is running', () => {
    setup({ exporting: true, exportedUrl: 'https://cdn/old.mp4', progress: 10 });
    expect(screen.queryByText('Your episode is ready')).toBeNull();
  });

  it('confirms a copied link', () => {
    setup({ exportedUrl: 'https://cdn/x.mp4', copied: true });
    expect(screen.getByRole('button', { name: /Link copied/ })).toBeInTheDocument();
  });
});
