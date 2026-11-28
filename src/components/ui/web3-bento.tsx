"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Layers3 } from "lucide-react";
import "./web3-bento.css";

interface DashboardProps {
  greeting: string;
  name: string;
  month: string;
  period: string;
  days: number[];
  previous: number[];
  elapsed: number;
  clients: { id: string; name: string; planned: number }[];
  activeClients: number;
  target: number;
  delivered: number;
  approved: number;
  planned: number;
  pendingContents: number;
}

// Midpoint Bézier segments from the reference keep the curve within adjacent data points.
function curve(points: [number, number][]) {
  return points.map(([x, y], i) => {
    if (!i) return `M ${x} ${y}`;
    const [px, py] = points[i - 1];
    const mid = (px + x) / 2;
    return `C ${mid} ${py}, ${mid} ${y}, ${x} ${y}`;
  }).join(" ");
}

function cumulative(days: number[]) {
  let total = 0;
  return days.map(n => (total += n));
}

function Trend({ days, previous, elapsed }: Pick<DashboardProps, "days" | "previous" | "elapsed">) {
  const [range, setRange] = useState(0);
  const span = range || days.length;
  const current = cumulative(days.slice(0, Math.min(span, elapsed)));
  const prior = cumulative(previous.slice(0, span));
  const max = Math.max(1, ...current, ...prior);
  const points = (values: number[]): [number, number][] => values.map((n, i) => [4 + 492 * i / (span - 1), 160 - 150 * n / max]);
  const line = points(current);
  const last = line.at(-1);
  const path = curve(line);
  return <section className="delta-bento-trend">
    <header><h2>Evolução das aprovações</h2><div className="delta-bento-pills" aria-label="Período do gráfico">
      {[7, 14, 0].map(n => <button type="button" className="df-press" key={n} onClick={() => setRange(n)} aria-pressed={range === n}>{n ? `1–${n}` : "Mês"}</button>)}
    </div></header>
    <div className="delta-bento-legend">
      <div><small>Mês selecionado</small><strong>{current.at(-1) ?? 0}</strong></div>
      <div><small>Mês anterior</small><strong>{prior.at(-1) ?? 0}</strong></div>
    </div>
    <svg viewBox="0 0 500 170" preserveAspectRatio="none" className="delta-bento-plot" role="img" aria-label={`Aprovações acumuladas até o dia ${span}. Mês selecionado: ${current.at(-1) ?? 0}. Mês anterior: ${prior.at(-1) ?? 0}.`}>
      <defs><linearGradient id="delta-trend-fill" x1="0" y1="0" x2="0" y2="1"><stop stopColor="var(--highlight)" stopOpacity=".35"/><stop offset="1" stopColor="var(--highlight)" stopOpacity=".02"/></linearGradient></defs>
      {[10,60,110,160].map(y => <path key={y} d={`M0 ${y}H500`} stroke="#393939" strokeDasharray="2 5"/>)}
      {last && <path d={`${path} L${last[0]} 160 H4 Z`} fill="url(#delta-trend-fill)"/>}
      <path d={curve(points(prior))} fill="none" stroke="#af9dbf" strokeDasharray="4 5" vectorEffect="non-scaling-stroke"/>
      <path d={path} fill="none" stroke="var(--highlight)" strokeWidth="2.4" vectorEffect="non-scaling-stroke"/>
      {last && <circle cx={last[0]} cy={last[1]} r="3.4" fill="var(--highlight)"/>}
    </svg>
    <div className="delta-bento-axis"><span>Dia 1</span><span>Dia {span}</span></div>
  </section>;
}

export function Web3Bento(p: DashboardProps) {
  const colors = ["var(--highlight)", "#b59bd9", "#aeb4ca", "#777988"];
  const max = Math.max(1, ...p.days);
  const total = p.days.reduce((a,b) => a+b, 0);
  const goal = p.target ? Math.round(100 * p.delivered / p.target) : 0;
  const rate = p.planned ? Math.round(100 * p.approved / p.planned) : 0;
  const groups = p.clients.filter(c => c.planned > 0).slice(0, 3).map(c => ({ name: c.name, n: c.planned }));
  const other = p.planned - groups.reduce((sum,g) => sum + g.n, 0);
  if (other > 0) groups.push({ name: "Outros clientes", n: other });
  return <div className="delta-bento-grid">
    <section className="delta-bento-hero">
      <header><div><h1>{p.greeting}{p.name && <>, <em>{p.name}</em></>}</h1><small>Visão geral de {p.month.toLocaleLowerCase("pt-BR")}</small></div>
        <div className="delta-bento-hero-value"><small>Posts com ao menos uma entrega aprovada</small><strong>{total}</strong></div>
      </header>
      <div className="delta-bento-bars" role="img" aria-label={`Posts com aprovação por dia: ${p.days.join(", ")}`}>
        {p.days.map((n,i) => <span key={i} title={`Dia ${i+1} · ${n} com aprovação`} style={{height: n ? `${100*n/max}%` : 2, background: colors[0], opacity: n ? 1 : .3}}/>)}
      </div><div className="delta-bento-axis"><span>01</span><span>Aprovações por dia</span><span>{p.days.length}</span></div>
    </section>
    <section className="delta-bento-clients"><header><h2>Carteira de clientes</h2><Layers3 size={16}/></header>
      <div className="delta-bento-stack">{p.clients.length === 0 && <small>Nenhum cliente com produção no período.</small>}{p.clients.slice(0,3).map(c => <Link key={c.id} href={`/app/clientes/${c.id}?mes=${p.period}`}><span>{c.name}<small>{c.planned} {c.planned === 1 ? "post planejado" : "posts planejados"}</small></span><ArrowUpRight size={15}/></Link>)}</div>
      <Link href="/app/clientes" className="delta-bento-wallet"><small>Clientes ativos</small><strong>{p.activeClients}</strong></Link>
    </section>
    <section className="delta-bento-gauge"><h2>Posts totalmente aprovados</h2>
      <svg viewBox="0 0 160 92" aria-hidden="true"><path d="M12 80a68 68 0 0 1 136 0" fill="none" stroke="#333" strokeWidth="10" strokeLinecap="round"/>
        {rate > 0 && <path d="M12 80a68 68 0 0 1 136 0" fill="none" pathLength="100" stroke="var(--highlight)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${rate} 100`}/>}
        <g transform={`rotate(${rate*1.8} 80 80)`}><path d="M80 80L28 80" stroke="#fafafa" strokeWidth="2.5"/><circle cx="80" cy="80" r="5" fill="#fafafa"/></g></svg>
      <strong>{p.planned ? rate+"%" : "—"}</strong><small>{p.approved} de {p.planned} planejados no mês</small>
    </section>
    <Trend days={p.days} previous={p.previous} elapsed={p.elapsed}/>
    <section className="delta-bento-mix"><h2>Produção por cliente</h2><strong>{p.planned} <small>posts</small></strong>
      <div className="delta-bento-segments" aria-hidden>{groups.map((g,i) => <span key={i} style={{flex:g.n, background:colors[i]}}/>)}</div>
      {groups.length ? <ul>{groups.map((g,i) => <li key={i}><i style={{background:colors[i]}}/><span>{g.name}</span><b>{g.n} <small>· {Math.round(100 * g.n / p.planned)}%</small></b></li>)}</ul> : <small>Nenhum post planejado neste mês.</small>}
    </section>
    <section className="delta-bento-goal"><h2>Meta do mês</h2><strong>{p.target ? goal+"%" : "—"}</strong>
      <p>{p.target ? `${p.delivered} de ${p.target} aprovações para a meta` : "Nenhuma meta definida."}</p>
      <div className="delta-bento-meter"><span style={{width:`${Math.min(goal,100)}%`}}/></div>
      {p.target > 0 && <dl className="delta-bento-goal-details">
        <div><dt>Meta total</dt><dd>{p.target}</dd></div>
        <div><dt>Faltam aprovar</dt><dd>{Math.max(0, p.target - p.delivered)}</dd></div>
      </dl>}
      <a href="#falta">{p.target ? "Ver metas por cliente" : "Consultar metas"} <ArrowUpRight size={16}/></a>
    </section>
    <section className="delta-bento-attention"><h2>Precisam de atenção agora</h2><strong>{p.pendingContents} <small>{p.pendingContents === 1 ? "conteúdo" : "conteúdos"}</small></strong><a href="#atencao">Ver pendências <ArrowUpRight size={15}/></a></section>
  </div>;
}
