/**
 * User Menu Dropdown
 *
 * Shows a "Sign In" link when disconnected, or a dropdown with wallet address,
 * profile actions, and sign-out when authenticated via SIWE.
 */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWalletAuth } from '@/lib/wallet-auth';
import { useNavigate } from '@tanstack/react-router';
import { Button } from './ui/button';
import { Link } from '@tanstack/react-router';
import { User, Settings, Upload, LogOut } from 'lucide-react';

export default function UserMenu() {
  const navigate = useNavigate();
  const { address, isAuthenticated, signOut } = useWalletAuth();

  if (!isAuthenticated || !address) {
    return (
      <Button variant="outline" asChild>
        <Link to="/login">Sign In</Link>
      </Button>
    );
  }

  const truncated = `${address.slice(0, 6)}...${address.slice(-4)}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2">
          <User className="h-4 w-4" />
          {truncated}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="bg-card w-56">
        <DropdownMenuLabel>My Account</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-xs text-muted-foreground font-mono">
          {address}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="cursor-pointer">
          <Link to="/dashboard" className="flex items-center gap-2">
            <Settings className="h-4 w-4" /> Dashboard
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="cursor-pointer">
          <Link to="/profile/edit" className="flex items-center gap-2">
            <User className="h-4 w-4" /> Edit Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="cursor-pointer">
          <Link to="/upload" className="flex items-center gap-2">
            <Upload className="h-4 w-4" /> Upload Content
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Button
            variant="destructive"
            className="w-full gap-2"
            onClick={() => {
              signOut();
              navigate({ to: '/' });
            }}
          >
            <LogOut className="h-4 w-4" /> Sign Out
          </Button>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
