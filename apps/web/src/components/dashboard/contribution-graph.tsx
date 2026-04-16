"use client";

interface ContributionDay {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

const LEVEL_COLORS = [
  "bg-neutral-100",
  "bg-emerald-200",
  "bg-emerald-400",
  "bg-emerald-500",
  "bg-emerald-700",
];

export function ContributionGraph({ data }: { data: ContributionDay[] }) {
  if (!data.length) {
    return (
      <div className="text-sm text-neutral-400">No activity data yet.</div>
    );
  }

  // Group by week (columns), 7 rows per column
  const weeks: ContributionDay[][] = [];
  let currentWeek: ContributionDay[] = [];

  // Pad the first week to align to Sunday
  const firstDate = new Date(data[0].date);
  const startPad = firstDate.getDay();
  for (let i = 0; i < startPad; i++) {
    currentWeek.push({ date: "", count: 0, level: 0 });
  }

  for (const day of data) {
    currentWeek.push(day);
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }
  if (currentWeek.length > 0) {
    weeks.push(currentWeek);
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-[3px]">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {week.map((day, di) => (
              <div
                key={di}
                className={`w-[11px] h-[11px] rounded-sm ${day.date ? LEVEL_COLORS[day.level] : "bg-transparent"}`}
                title={
                  day.date ? `${day.date}: ${day.count} sessions` : undefined
                }
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
