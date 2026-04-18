import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowDownUp } from 'lucide-react';
import type { WikiSort } from './types';

interface SortMenuProps {
  value: WikiSort;
  onChange: (v: WikiSort) => void;
}

export function SortMenu({ value, onChange }: SortMenuProps) {
  return (
    <div className="flex items-center gap-1.5">
      <ArrowDownUp className="h-3.5 w-3.5 text-muted-foreground" />
      <Select value={value} onValueChange={(v) => onChange(v as WikiSort)}>
        <SelectTrigger className="h-9 text-xs w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="newest" className="text-xs">
            Newest first
          </SelectItem>
          <SelectItem value="oldest" className="text-xs">
            Oldest first
          </SelectItem>
          <SelectItem value="a-z" className="text-xs">
            A → Z
          </SelectItem>
          <SelectItem value="z-a" className="text-xs">
            Z → A
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
