import { createFileRoute } from '@tanstack/react-router';
import { WorkflowEditorPage } from '@/components/workflows/WorkflowEditorPage';

export const Route = createFileRoute('/workflows/$id')({
  component: WorkflowEditor,
});

function WorkflowEditor() {
  const { id } = Route.useParams();
  return <WorkflowEditorPage workflowId={id} />;
}
