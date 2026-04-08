interface Choice {
  nodeId: number;
  label: string;
  isCanon: boolean;
}

export function ChoiceOverlay({
  choices,
  onChoose,
}: {
  choices: Choice[];
  onChoose: (nodeId: number) => void;
}) {
  return (
    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent z-20 flex items-end justify-center pb-24">
      <div className="flex gap-4 px-4 max-w-3xl w-full">
        {choices.map((choice, i) => (
          <button
            key={choice.nodeId}
            onClick={() => onChoose(choice.nodeId)}
            className="flex-1 group relative overflow-hidden rounded-xl border-2 border-white/20 hover:border-violet-500 transition-all duration-300 hover:scale-[1.02]"
          >
            <div className="bg-zinc-900/80 backdrop-blur-md p-5">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-mono text-zinc-400">
                  {String.fromCharCode(65 + i)}
                </span>
                {choice.isCanon && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded-full font-medium">
                    Canon
                  </span>
                )}
              </div>
              <p className="text-white font-medium text-left">{choice.label}</p>
              <p className="text-zinc-400 text-sm mt-1">Node #{choice.nodeId}</p>
            </div>

            {/* Hover glow */}
            <div className="absolute inset-0 bg-violet-600/0 group-hover:bg-violet-600/10 transition-colors" />
          </button>
        ))}
      </div>
    </div>
  );
}
