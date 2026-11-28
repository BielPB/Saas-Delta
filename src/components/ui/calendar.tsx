"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const fullDate = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" });

interface CalendarProps {
  title: string;
  days: Date[];
  selected: Date;
  today: string;
  dateKey: (day: Date) => string;
  countOn: (key: string) => number;
  onSelect: (day: Date) => void;
  onShift: (direction: number) => void;
  onDropDay: (key: string) => void;
  children?: React.ReactNode;
}

export function Calendar({ title, days, selected, today, dateKey, countOn, onSelect, onShift, onDropDay, children }: CalendarProps) {
  const arrow = "grid size-10 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg";
  return (
    <section aria-label="Calendário mensal" className="mx-auto w-full max-w-[604px] rounded-2xl border border-border bg-surface p-3 shadow-lg sm:p-7">
      <header className="mb-5 flex items-center justify-between gap-2">
        <button type="button" className={arrow} onClick={() => onShift(-1)} aria-label="Mês anterior"><ChevronLeft size={20} /></button>
        <h2 className="text-center text-xl font-bold sm:text-[28px]">{title}</h2>
        <button type="button" className={arrow} onClick={() => onShift(1)} aria-label="Próximo mês"><ChevronRight size={20} /></button>
      </header>
      <div className="grid grid-cols-7 gap-1 text-center text-sm">
        {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(day => (
          <span key={day} className="mb-2 py-3 font-semibold text-muted">{day}</span>
        ))}
        {days.map(day => {
          const key = dateKey(day);
          const current = key === today;
          const active = key === dateKey(selected);
          const count = countOn(key);
          return (
            <button type="button" key={key} aria-current={current ? "date" : undefined} aria-pressed={active}
              aria-label={fullDate.format(day) + (count ? `, ${count} publicações` : "")}
              onClick={() => onSelect(day)} onDragOver={event => event.preventDefault()} onDrop={() => onDropDay(key)}
              className={cn("relative h-11 min-w-0 rounded-lg tabular hover:bg-surface-2 sm:h-[50px]",
                day.getMonth() !== selected.getMonth() && "text-subtle",
                active && "bg-blue-200 text-blue-900 hover:bg-blue-200",
                current && "bg-blue-600 font-semibold text-white hover:bg-blue-600")}>
              {day.getDate()}
              {count > 0 && <span aria-hidden className="absolute bottom-1.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-current" />}
            </button>
          );
        })}
      </div>
      <p aria-live="polite" className="mt-7 rounded-lg bg-surface-2 px-4 py-4 text-sm text-muted">Data selecionada: {fullDate.format(selected)}</p>
      {children}
    </section>
  );
}
