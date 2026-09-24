import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Loader2, Send, Sparkles } from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { splitCitations } from './ask';

interface AskTabProps {
  universeAddress?: string;
}

type AskResult = Awaited<ReturnType<typeof trpcClient.wiki.ask.mutate>>;
interface Turn {
  question: string;
  result: AskResult;
}

const EXAMPLES = [
  'Who are the main characters?',
  'What factions are at war?',
  'How does it all begin?',
];

export function AskTab({ universeAddress }: AskTabProps) {
  const { isAuthenticated } = useWalletAuth();
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);

  const ask = useMutation({
    mutationFn: (q: string) =>
      trpcClient.wiki.ask.mutate({ universeAddress: universeAddress!, question: q }),
    onSuccess: (result, q) => {
      setTurns((prev) => [{ question: q, result }, ...prev]);
      setQuestion('');
    },
  });

  if (!universeAddress) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Sparkles className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
        <p className="mb-2">Pick a universe to ask its wiki questions.</p>
        <p className="text-xs">Answers come only from that universe's canon, with sources.</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Sparkles className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
        <p>Sign in with your wallet to ask the wiki.</p>
      </div>
    );
  }

  const submit = (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length >= 3 && !ask.isPending) ask.mutate(trimmed);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(question);
        }}
      >
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask anything about this universe…"
          maxLength={500}
          aria-label="Question about this universe"
        />
        <Button type="submit" disabled={ask.isPending || question.trim().length < 3}>
          {ask.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          <span className="sr-only">Ask</span>
        </Button>
      </form>

      {turns.length === 0 && !ask.isPending && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => submit(ex)}
              className="text-xs rounded-full border px-3 py-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {ask.isError && (
        <p role="alert" className="text-sm text-destructive">
          {ask.error instanceof Error ? ask.error.message : 'Something went wrong.'}
        </p>
      )}

      {turns.map((turn, i) => (
        <AnswerCard key={`${turns.length - i}`} turn={turn} />
      ))}
    </div>
  );
}

function AnswerCard({ turn }: { turn: Turn }) {
  const { answer, sources, grounded } = turn.result;
  const parts = splitCitations(answer, sources.length);
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <p className="text-sm font-medium">{turn.question}</p>
      <p className="text-sm leading-relaxed whitespace-pre-wrap">
        {parts.map((p, i) =>
          p.type === 'text' ? (
            <span key={i}>{p.text}</span>
          ) : (
            <Link
              key={i}
              to="/wiki/entity/$id"
              params={{ id: sources[p.index].id }}
              title={sources[p.index].name}
              className="align-super text-[10px] font-semibold text-primary hover:underline mx-0.5"
            >
              [{p.index + 1}]
            </Link>
          )
        )}
      </p>
      {grounded && sources.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {sources.map((s, i) => (
            <Link key={s.id} to="/wiki/entity/$id" params={{ id: s.id }}>
              <Badge variant={s.cited ? 'default' : 'outline'} className="text-xs font-normal">
                {i + 1}. {s.name}
              </Badge>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
