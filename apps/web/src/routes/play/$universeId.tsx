import { createFileRoute } from '@tanstack/react-router';
import { BranchingPlayer } from '@/components/player/BranchingPlayer';
import { TokenGateGuard } from '@/components/governance/TokenGateGuard';

export const Route = createFileRoute('/play/$universeId')({
  component: PlayPage,
});

function PlayPage() {
  const { universeId } = Route.useParams();

  return (
    <div className="min-h-screen bg-black">
      <TokenGateGuard universeId={universeId} target="play">
        <BranchingPlayer universeId={universeId} />
      </TokenGateGuard>
    </div>
  );
}
