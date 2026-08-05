const STEPS = ["Account", "Connect eBay"];

export default function OnboardingSteps({ current }: { current: 0 | 1 }) {
  return (
    <ol className="mb-6 flex items-center gap-2 text-xs font-medium text-zinc-500">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;

        return (
          <li key={label} className="flex items-center gap-2">
            {i > 0 && <span className="h-px w-6 bg-white/10" aria-hidden />}
            <span
              className={`flex items-center gap-1.5 ${
                active ? "text-brand-300" : done ? "text-zinc-400" : ""
              }`}
              aria-current={active ? "step" : undefined}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] text-white ${
                  done
                    ? "bg-emerald-500"
                    : active
                      ? "bg-brand-500"
                      : "bg-white/10"
                }`}
                aria-hidden
              >
                {done ? "✓" : i + 1}
              </span>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
