import { createFileRoute } from '@tanstack/react-router';
import { BranchingPlayer } from '../../components/player/BranchingPlayer';

export const Route = createFileRoute('/play/$universeId')({
  component: PlayPage,
});

function PlayPage() {
  const { universeId } = Route.useParams();

  return (
    <div className="min-h-screen bg-black">
      <BranchingPlayer universeId={universeId} />
    </div>
  );
}
