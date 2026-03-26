import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth, signOut } from "@/lib/auth-client";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { Link } from "@tanstack/react-router";

export default function UserMenu() {
  const navigate = useNavigate();
  const { user, loading: isPending } = useAuth();

  if (isPending) {
    return <Skeleton className="h-9 w-24" />;
  }

  if (!user) {
    return (
      <Button variant="outline" asChild>
        <Link to="/login">Sign In</Link>
      </Button>
    );
  }

  const displayName = user.displayName || user.email || "User";
  const userEmail = user.email || "No email available";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">{displayName}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="bg-card">
        <DropdownMenuLabel>My Account</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>{userEmail}</DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Button
            variant="destructive"
            className="w-full"
            onClick={async () => {
              await signOut();
              navigate({ to: "/" });
            }}
          >
            Sign Out
          </Button>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
