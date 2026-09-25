import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const MOD = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl';

interface Group {
  title: string;
  rows: Array<[keys: string, does: string]>;
}

export const SHORTCUT_GROUPS: Group[] = [
  {
    title: 'Playback',
    rows: [
      ['Space', 'Play / pause'],
      ['← / →', 'Step one frame (Shift = one second)'],
      ['Home / End', 'Jump to start / end'],
      ['Click ruler', 'Scrub the playhead'],
    ],
  },
  {
    title: 'Editing',
    rows: [
      ['S', 'Split the clip at the playhead'],
      ['Q / W', 'Trim the clip’s start / end to the playhead'],
      ['Delete', 'Delete the selected clips (ripple)'],
      [`${MOD} D`, 'Duplicate the selected clips'],
      ['C', 'Add a caption at the playhead'],
      [`${MOD} Z`, 'Undo'],
      [`Shift ${MOD} Z  /  ${MOD} Y`, 'Redo'],
      [`${MOD} S`, 'Save now'],
    ],
  },
  {
    title: 'Timeline',
    rows: [
      ['Drag a clip', 'Reorder'],
      ['Drag a clip edge', 'Ripple-trim'],
      ['Right-click a clip', 'Split, duplicate, move, download, delete'],
      ['Tab, Enter', 'Focus and select a clip with the keyboard'],
      ['Alt + ← / →', 'Move the focused clip earlier / later'],
      ['Shift / ⌘ click', 'Add to the selection'],
      ['+ / −  or  ⌘ scroll', 'Zoom'],
      ['Drop a file or library clip', 'Insert at the drop position'],
    ],
  },
  { title: 'Help', rows: [['?', 'Show this list']] },
];

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts are ignored while you’re typing in a text field.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.title}
              </h3>
              <dl className="divide-y divide-border rounded-md border border-border">
                {group.rows.map(([keys, does]) => (
                  <div key={keys} className="flex items-baseline justify-between gap-4 px-3 py-1.5">
                    <dt className="text-sm">{does}</dt>
                    <dd className="shrink-0">
                      <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {keys}
                      </kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
