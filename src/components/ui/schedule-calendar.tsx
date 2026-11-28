"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface ScheduleDay {
  iso: string;
  weekday: string;
  month: string;
  label: string;
  count: number;
  events: ReactNode;
}

export function ScheduleCalendar({ days, failed }: { days: ScheduleDay[]; failed: boolean }) {
  const [selected, setSelected] = useState(0);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();
  const day = days[selected];
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = { ArrowRight: (index + 1) % days.length, ArrowLeft: (index + days.length - 1) % days.length,
      Home: 0, End: days.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setSelected(next);
    buttons.current[next]?.focus();
  }

  return <section aria-label="Agenda" className="mx-auto mb-5 w-full rounded-[26px] bg-[#191919] p-1 pt-5 text-white shadow-lg">
    <header className="mb-4 flex items-baseline justify-between gap-2 px-4">
      <h2 className="text-base font-semibold capitalize">{day.month}</h2>
      <span className="text-[11px] text-neutral-400">Google Agenda</span>
    </header>
    <div role="tablist" aria-label="Próximos sete dias" className="grid grid-cols-7 px-2 pb-2">
      {days.map((d, i) => <button key={d.iso} ref={el => { buttons.current[i] = el; }} type="button"
        role="tab" id={`${id}-day-${i}`} aria-controls={`${id}-events`} aria-selected={i === selected}
        aria-label={`${i === 0 ? "Hoje, " : ""}${d.label}, ${d.count} compromissos`} tabIndex={i === selected ? 0 : -1}
        onKeyDown={e => navigate(e, i)} onClick={() => setSelected(i)}
        className="group flex min-w-0 flex-col items-center gap-1 rounded-xl text-xs focus-visible:outline-white">
        <span className="capitalize text-neutral-300">{d.weekday}</span>
        <span className="grid aspect-square w-full max-w-9 place-items-center rounded-full text-sm tabular-nums group-aria-selected:bg-gradient-to-b group-aria-selected:from-white group-aria-selected:to-neutral-200 group-aria-selected:font-semibold group-aria-selected:text-neutral-900">{Number(d.iso.slice(-2))}</span>
        <span aria-hidden className={`size-1 rounded-full ${d.count && selected !== i ? "bg-neutral-400" : "bg-transparent"}`}/>
      </button>)}
    </div>
    <div key={day.iso} role="tabpanel" id={`${id}-events`} aria-labelledby={`${id}-day-${selected}`} tabIndex={0}
      className="h-[186px] overflow-y-auto rounded-[21px] bg-white px-5 text-neutral-900 focus-visible:-outline-offset-4">
      {day.count ? <ul className="divide-y divide-neutral-200">{day.events}</ul> :
        <p className="grid h-full place-items-center text-center text-sm text-neutral-600">{failed ? "Não foi possível carregar o Google Agenda." : "Nenhum compromisso neste dia."}</p>}
    </div>
  </section>;
}
