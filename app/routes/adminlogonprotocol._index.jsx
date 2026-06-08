import {useState} from 'react';
import {useLoaderData, useFetcher, Link} from '@remix-run/react';
import {json} from '@shopify/remix-oxygen';
import {getSupabase} from '~/lib/supabase.server';
import {requireAdminUser, getCountryFilter} from '~/lib/auth.server';

export const meta = () => [{title: 'Overview | BlackCrow Admin'}];

/* ── Helpers ─────────────────────────────────────────────── */
function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function today() { return localDate(); }

function formatHeaderDate() {
  const d = new Date();
  const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function currSym(c) { return {GBP:'£',EUR:'€',JPY:'¥',SEK:'kr'}[c] ?? '$'; }
function fmtNative(n, cur) {
  const c = cur ?? 'AUD';
  const num = Number(n ?? 0).toLocaleString('en-AU', {minimumFractionDigits:2, maximumFractionDigits:2});
  return c === 'SEK' ? `${num}\u00a0kr` : `${currSym(c)}${num}`;
}
function fmt(n) {
  return '$' + Number(n ?? 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

function fmtRelDate(dateStr) {
  if (!dateStr) return '—';
  const t = today();
  if (dateStr === t) return 'Today';
  const yesterday = localDate(new Date(Date.now() - 86400000));
  if (dateStr === yesterday) return 'Yesterday';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-AU', {day: 'numeric', month: 'short'});
}

function fmtDueDate(dateStr) {
  if (!dateStr) return '—';
  const t = today();
  const tomorrow = localDate(new Date(Date.now() + 86400000));
  if (dateStr < t)   return 'Overdue';
  if (dateStr === t) return 'Today';
  if (dateStr === tomorrow) return 'Tomorrow';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-AU', {day: 'numeric', month: 'short'});
}

function netRev(o) {
  return (o.status === 'cancelled' || o.status === 'refunded') ? -Number(o.total) : Number(o.total);
}

/* ── Loader ──────────────────────────────────────────────── */
export async function loader({request, context}) {
  const user = await requireAdminUser(request);
  const cf   = getCountryFilter(user);
  const sb = getSupabase();
  if (!sb) return json({configured: false});

  const todayStr = today();
  const weekStr  = (() => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return localDate(d); })();
  const yr       = new Date().getFullYear();
  const MONTHS   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  /* ── Live exchange rates (USD base, 2.5 s timeout → fallback) ── */
  const FALLBACK = {USD:1, AUD:1.54, GBP:0.79, CAD:1.36, SEK:10.35, EUR:0.92, JPY:157, NZD:1.65};
  let rates = FALLBACK;
  let ratesLive = false;
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: AbortSignal.timeout(2500),
    });
    if (r.ok) {
      const rj = await r.json();
      if (rj?.rates) { rates = rj.rates; ratesLive = true; }
    }
  } catch (_) {}
  const toUSD = (amount, currency) => Number(amount) / (rates[currency ?? 'AUD'] ?? 1);

  let qOrders = sb.from('orders').select('id, date, status, total, currency');
  if (cf) qOrders = qOrders.eq('country', cf);
  let qInventory = sb.from('inventory').select('product_name, sku, units, low_stock_threshold').order('units', {ascending: true});
  if (cf) qInventory = qInventory.eq('country', cf);
  let qTasks = sb.from('tasks').select('id, title, due_date, completed').eq('completed', false).order('due_date', {ascending: true});
  if (cf) qTasks = qTasks.eq('country', cf);
  let qRecent = sb.from('orders')
    .select('id, order_number, date, status, total, currency, customers(name), order_items(product, quantity)')
    .order('date', {ascending: false})
    .limit(5);
  if (cf) qRecent = qRecent.eq('country', cf);
  const [allOrdersRes, inventoryRes, tasksRes, recentRes] = await Promise.all([
    qOrders,
    qInventory,
    qTasks,
    qRecent,
  ]);

  const allOrders = allOrdersRes.data ?? [];
  const inventory = inventoryRes.error ? null : (inventoryRes.data ?? []);
  const tasks     = tasksRes.error     ? null : (tasksRes.data ?? []);
  const recent    = recentRes.data ?? [];

  /* ── KPIs — all monetary values in USD ── */
  const totalRevenueUSD = allOrders.reduce((s, o) => s + toUSD(netRev(o), o.currency), 0);
  const totalOrders     = allOrders.length;

  const weekOrders     = allOrders.filter(o => o.date >= weekStr);
  const weekRevenueUSD = weekOrders.reduce((s, o) => s + toUSD(netRev(o), o.currency), 0);
  const weekCount      = weekOrders.filter(o => o.status !== 'cancelled' && o.status !== 'refunded').length;

  const todayOrders  = allOrders.filter(o => o.date === todayStr);
  const todayCount   = todayOrders.filter(o => o.status !== 'cancelled' && o.status !== 'refunded').length;

  /* ── Per-currency native breakdown for this week ── */
  const weekByCurrency = {};
  weekOrders.filter(o => o.status !== 'cancelled' && o.status !== 'refunded').forEach(o => {
    const c = o.currency ?? 'AUD';
    weekByCurrency[c] = (weekByCurrency[c] ?? 0) + Number(o.total);
  });

  /* ── Monthly chart (USD) ── */
  const chart = MONTHS.map((month, i) => {
    const m = String(i + 1).padStart(2, '0');
    const monthOrders = allOrders.filter(o => o.date?.startsWith(`${yr}-${m}`));
    return {month, value: monthOrders.reduce((s, o) => s + toUSD(netRev(o), o.currency), 0)};
  });

  /* ── Inventory stats ── */
  const totalUnits   = inventory ? inventory.reduce((s, i) => s + (i.units ?? 0), 0) : null;
  const skuCount     = inventory ? inventory.length : null;
  const lowStock     = inventory ? inventory.filter(i => i.units <= i.low_stock_threshold) : null;

  /* ── Task stats ── */
  const overdueCount = tasks ? tasks.filter(t => t.due_date && t.due_date < todayStr).length : null;

  return json({
    configured: true,
    kpis: {
      totalRevenueUSD, totalOrders,
      weekRevenueUSD, weekCount,
      todayCount,
      totalUnits, skuCount, lowStockCount: lowStock?.length ?? null, tasksDue: tasks?.length ?? null, overdueCount,
    },
    weekByCurrency,
    ratesLive,
    chart,
    recentOrders: recent,
    lowStock,
    tasks,
  });
}

/* ── Action ──────────────────────────────────────────────── */
export async function action({request}) {
  const sb = getSupabase();
  if (!sb) return json({error: 'Not configured'});
  const fd = await request.formData();
  const id = fd.get('id');
  if (!id) return json({error: 'No task id'});
  await sb.from('tasks').update({completed: true}).eq('id', id);
  return json({ok: true});
}

/* ── StatCard ────────────────────────────────────────────── */
function StatCard({label, value, sub, positive, icon, accent}) {
  const subColor = positive === true ? '#22c55e' : positive === false ? '#e52b2b' : '#9ca3af';
  return (
    <div className="bg-bc-card rounded-[20px] p-5 flex flex-col gap-3 border border-bc-divider min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="font-ui text-[0.7rem] font-medium tracking-[0.12em] uppercase text-bc-secondary min-w-0">{label}</span>
        <span className="shrink-0" style={{color: accent}}>{icon}</span>
      </div>
      <p className="font-display text-[1.8rem] sm:text-[2.4rem] leading-none text-white">{value}</p>
      <p className="font-ui text-[0.72rem] truncate overflow-hidden" style={{color: subColor}}>{sub}</p>
    </div>
  );
}

/* ── SalesChart ──────────────────────────────────────────── */
function SalesChart({data, totalRevenue}) {
  const curMonth = new Date().getMonth();
  const max      = Math.max(...data.map(d => d.value), 1);
  const hasData  = data.some(d => d.value > 0);

  // SVG coordinate space: 1200 wide, 100 tall. No text inside SVG (rendered via HTML)
  const W = 1200, H = 100;
  const stepX = W / 11;
  const topPad = 10; // breathing room above max
  const plotH  = H - topPad;

  const pts = data.map((d, i) => ({
    ...d,
    x: i * stepX,
    y: topPad + plotH - (d.value / max) * plotH,
    future: i > curMonth,
  }));

  // Solid line: Jan → curMonth
  const pastPts  = pts.slice(0, curMonth + 1);
  const lineD    = pastPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');
  const areaD    = pastPts.length
    ? `${lineD}L${pastPts.at(-1).x.toFixed(1)},${H}L0,${H}Z`
    : '';

  // Baseline for future months
  const futureBaseY = (H).toFixed(1);
  const futureLineD = curMonth < 11
    ? `M${pts[curMonth].x.toFixed(1)},${pts[curMonth].y.toFixed(1)}L${pts[11].x.toFixed(1)},${futureBaseY}`
    : '';

  return (
    <div className="bg-bc-card rounded-[20px] p-6 border border-bc-divider">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <p className="font-ui text-[0.7rem] tracking-[0.12em] uppercase text-bc-secondary">Revenue · All Currencies → USD</p>
          <p className="font-display text-[1.6rem] sm:text-[2rem] text-white leading-none mt-1">{fmt(totalRevenue)}</p>
          <p className="font-ui text-[0.62rem] text-bc-secondary/60 mt-0.5">USD · all currencies converted</p>
        </div>
        <span className="font-ui text-[0.72rem] text-bc-secondary bg-bc-surface px-3 py-1 rounded-pill border border-bc-divider shrink-0 whitespace-nowrap">
          {new Date().getFullYear()} YTD
        </span>
      </div>

      {!hasData ? (
        <div className="h-[150px] flex items-center justify-center">
          <p className="font-ui text-[0.75rem] text-bc-secondary">No revenue data yet for {new Date().getFullYear()}.</p>
        </div>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            preserveAspectRatio="none"
            style={{display: 'block', overflow: 'visible', height: '150px'}}>
            <defs>
              <linearGradient id="blueAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#3b82f6" stopOpacity="0.22"/>
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0"/>
              </linearGradient>
            </defs>

            {/* Subtle grid lines at 25 / 50 / 75 % */}
            {[0.25, 0.5, 0.75].map(p => (
              <line key={p}
                x1="0" y1={(topPad + plotH * (1 - p)).toFixed(1)}
                x2={W}  y2={(topPad + plotH * (1 - p)).toFixed(1)}
                stroke="rgba(255,255,255,0.05)" strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {/* Area fill under line */}
            {areaD && <path d={areaD} fill="url(#blueAreaGrad)"/>}

            {/* Dashed future projection line to Dec baseline */}
            {futureLineD && (
              <path d={futureLineD} fill="none"
                stroke="rgba(59,130,246,0.18)" strokeWidth="2"
                strokeDasharray="8,6" strokeLinecap="round"
                vectorEffect="non-scaling-stroke"/>
            )}

            {/* Main solid blue line */}
            <path d={lineD} fill="none"
              stroke="#3b82f6" strokeWidth="3"
              strokeLinecap="round" strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"/>

            {/* Current month: vertical dashed marker */}
            <line
              x1={pts[curMonth].x.toFixed(1)} y1="0"
              x2={pts[curMonth].x.toFixed(1)} y2={H}
              stroke="rgba(59,130,246,0.25)" strokeWidth="1.5"
              strokeDasharray="5,4"
              vectorEffect="non-scaling-stroke"/>

            {/* Current month dot */}
            <circle
              cx={pts[curMonth].x.toFixed(1)} cy={pts[curMonth].y.toFixed(1)}
              r="6" fill="#3b82f6"
              stroke="rgba(10,10,10,0.9)" strokeWidth="3"
              vectorEffect="non-scaling-stroke"/>
          </svg>

          {/* Month labels below SVG */}
          <div className="flex mt-2">
            {data.map((d, i) => (
              <div key={i} className="flex-1 text-center overflow-hidden">
                <span className={`font-ui text-[0.62rem] ${
                  i === curMonth ? 'text-[#3b82f6] font-semibold' :
                  i > curMonth  ? 'text-bc-secondary/30' :
                  'text-bc-secondary'
                }`}>
                  <span className="hidden sm:inline">{d.month}</span>
                  <span className="sm:hidden">{d.month.charAt(0)}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── RecentOrders ────────────────────────────────────────── */
function RecentOrders({orders}) {
  const statusStyle = {
    fulfilled: 'bg-[#22c55e]/10 text-[#22c55e]',
    processing: 'bg-[#f59e0b]/10 text-[#f59e0b]',
    cancelled:  'bg-[#6b7280]/10 text-[#6b7280]',
    refunded:   'bg-[#e52b2b]/10 text-[#e52b2b]',
  };

  return (
    <div className="bg-bc-card rounded-[20px] border border-bc-divider overflow-hidden">
      <div className="px-6 py-4 border-b border-bc-divider flex items-center justify-between">
        <p className="font-ui text-[0.7rem] tracking-[0.12em] uppercase text-bc-secondary">Recent Orders</p>
        <span className="font-ui text-[0.7rem] text-bc-secondary">{orders.length} shown</span>
      </div>
      {orders.length === 0 ? (
        <p className="px-6 py-8 font-ui text-[0.78rem] text-bc-secondary text-center">No orders yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-bc-divider">
                {['Order','Customer','Product','Qty','Total','Status','Date'].map(h => (
                  <th key={h} className="px-3 sm:px-5 py-3 text-left font-ui text-[0.65rem] tracking-[0.1em] uppercase text-bc-secondary font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((o, i) => {
                const product = o.order_items?.[0]?.product ?? '—';
                const qty     = o.order_items?.reduce((s, item) => s + item.quantity, 0) ?? 0;
                return (
                  <tr key={o.id} className={i < orders.length - 1 ? 'border-b border-bc-divider' : ''}>
                    <td className="px-3 sm:px-5 py-3">
                      <Link to={`/adminlogonprotocol/orders/${o.id}`}
                        className="font-ui text-[0.78rem] text-bc-red font-medium hover:underline whitespace-nowrap">
                        {o.order_number}
                      </Link>
                    </td>
                    <td className="px-3 sm:px-5 py-3 font-ui text-[0.78rem] text-white whitespace-nowrap">{o.customers?.name ?? '—'}</td>
                    <td className="px-3 sm:px-5 py-3 font-ui text-[0.78rem] text-bc-secondary max-w-[120px] truncate">{product}</td>
                    <td className="px-3 sm:px-5 py-3 font-ui text-[0.78rem] text-bc-secondary text-center">{qty}</td>
                    <td className="px-3 sm:px-5 py-3 font-ui text-[0.78rem] text-white whitespace-nowrap">{fmtNative(o.total, o.currency)}<span className="text-bc-secondary text-[0.65rem] ml-1">{o.currency}</span></td>
                    <td className="px-3 sm:px-5 py-3">
                      <span className={`font-ui text-[0.68rem] px-2 py-[3px] rounded-pill whitespace-nowrap ${statusStyle[o.status] ?? 'bg-white/10 text-white'}`}>
                        {o.status}
                      </span>
                    </td>
                    <td className="px-3 sm:px-5 py-3 font-ui text-[0.72rem] text-bc-secondary whitespace-nowrap">{fmtRelDate(o.date)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── LowStockPanel ───────────────────────────────────────── */
function LowStockPanel({items}) {
  if (items === null) {
    return (
      <div className="bg-bc-card rounded-[20px] border border-bc-divider overflow-hidden">
        <div className="px-6 py-4 border-b border-bc-divider flex items-center gap-2">
          <span className="text-bc-red">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </span>
          <p className="font-ui text-[0.7rem] tracking-[0.12em] uppercase text-bc-secondary">Low Stock</p>
        </div>
        <p className="px-6 py-6 font-ui text-[0.75rem] text-bc-secondary">
          Run the updated <code className="text-white">crm-schema.sql</code> to enable inventory tracking.
        </p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="bg-bc-card rounded-[20px] border border-bc-divider overflow-hidden">
        <div className="px-6 py-4 border-b border-bc-divider flex items-center gap-2">
          <span className="text-[#22c55e]">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </span>
          <p className="font-ui text-[0.7rem] tracking-[0.12em] uppercase text-bc-secondary">Low Stock</p>
        </div>
        <p className="px-6 py-6 font-ui text-[0.75rem] text-bc-secondary">All products are well stocked.</p>
      </div>
    );
  }

  return (
    <div className="bg-bc-card rounded-[20px] border border-bc-divider overflow-hidden">
      <div className="px-6 py-4 border-b border-bc-divider flex items-center gap-2">
        <span className="text-bc-red">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </span>
        <p className="font-ui text-[0.7rem] tracking-[0.12em] uppercase text-bc-secondary">Low Stock</p>
      </div>
      <div className="p-4 flex flex-col gap-3">
        {items.map(item => {
          const pct = Math.round((item.units / item.low_stock_threshold) * 100);
          return (
            <div key={item.sku} className="bg-bc-surface rounded-[12px] p-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="min-w-0 overflow-hidden">
                  <p className="font-display text-[1.1rem] text-white leading-none truncate">{item.product_name}</p>
                  <p className="font-ui text-[0.65rem] text-bc-secondary mt-[2px] truncate">{item.sku}</p>
                </div>
                <span className="font-display text-[1.5rem] text-bc-red leading-none shrink-0">{item.units}</span>
              </div>
              <div className="w-full h-[4px] bg-bc-divider rounded-full overflow-hidden">
                <div className="h-full bg-bc-red rounded-full" style={{width: `${Math.min(pct, 100)}%`}} />
              </div>
              <p className="font-ui text-[0.63rem] text-bc-secondary mt-1">{item.units} / {item.low_stock_threshold} units threshold</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── TasksPanel ──────────────────────────────────────────── */
function TasksPanel({tasks, overdueCount}) {
  const fetcher = useFetcher();
  const todayStr = today();

  if (tasks === null) {
    return (
      <div className="bg-bc-card rounded-[20px] border border-bc-divider overflow-hidden">
        <div className="px-6 py-4 border-b border-bc-divider">
          <p className="font-ui text-[0.7rem] tracking-[0.12em] uppercase text-bc-secondary">Tasks Due</p>
        </div>
        <p className="px-6 py-6 font-ui text-[0.75rem] text-bc-secondary">
          Run the updated <code className="text-white">crm-schema.sql</code> to enable task tracking.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-bc-card rounded-[20px] border border-bc-divider overflow-hidden">
      <div className="px-6 py-4 border-b border-bc-divider flex items-center justify-between">
        <p className="font-ui text-[0.7rem] tracking-[0.12em] uppercase text-bc-secondary">Tasks Due</p>
        {overdueCount > 0 && (
          <span className="font-ui text-[0.68rem] text-bc-red bg-bc-red/10 px-2 py-[3px] rounded-pill shrink-0 whitespace-nowrap">
            {overdueCount} overdue
          </span>
        )}
      </div>
      {tasks.length === 0 ? (
        <p className="px-6 py-6 font-ui text-[0.75rem] text-bc-secondary">No pending tasks.</p>
      ) : (
        <ul className="p-4 flex flex-col gap-2">
          {tasks.map(task => {
            const isOverdue = task.due_date && task.due_date < todayStr;
            const submitting = fetcher.state !== 'idle' && fetcher.formData?.get('id') === task.id;
            return (
              <li key={task.id} className="flex items-start gap-3 bg-bc-surface rounded-[12px] px-4 py-3">
                <fetcher.Form method="post" className="mt-[2px] shrink-0">
                  <input type="hidden" name="id" value={task.id} />
                  <button type="submit" disabled={submitting}
                    className="w-4 h-4 rounded-[4px] border border-bc-divider flex items-center justify-center hover:border-bc-red transition-colors disabled:opacity-40">
                    {submitting && (
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                    )}
                  </button>
                </fetcher.Form>
                <div className="flex-1 min-w-0">
                  <p className="font-ui text-[0.78rem] leading-snug text-white">{task.title}</p>
                  <p className={`font-ui text-[0.65rem] mt-[2px] ${isOverdue ? 'text-bc-red' : 'text-bc-secondary'}`}>
                    {isOverdue && (
                      <span className="inline-flex items-center gap-1 mr-1">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                        Overdue ·
                      </span>
                    )}
                    {fmtDueDate(task.due_date)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────── */
export default function AdminOverview() {
  const data = useLoaderData();

  if (!data.configured) {
    return (
      <div className="px-4 sm:px-6 md:px-8 py-8 max-w-[1400px] mx-auto">
        <h1 className="font-display text-[2rem] sm:text-[2.8rem] text-white leading-none tracking-wide mb-4">OVERVIEW</h1>
        <p className="font-ui text-[0.78rem] text-bc-secondary">
          Supabase not configured. Add <code className="text-white">SUPABASE_URL</code> and <code className="text-white">SUPABASE_ANON_KEY</code> to your <code className="text-white">.env</code>.
        </p>
      </div>
    );
  }

  const {kpis, chart, recentOrders, lowStock, tasks, weekByCurrency, ratesLive} = data;

  /* Per-currency native breakdown for the week card sub-text */
  const weekCurrLine = Object.entries(weekByCurrency ?? {})
    .map(([c, amt]) => `${fmtNative(amt, c)}\u00a0${c}`)
    .join(' · ') || 'no orders this week';

  const IcoDollar    = <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 1 1 0 7H6"/></svg>;
  const IcoBox       = <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>;
  const IcoCal       = <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
  const IcoPkg       = <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>;
  const IcoWarn      = <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
  const IcoCheck     = <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>;

  const stats = [
    {
      label: 'Total Revenue',
      value: fmt(kpis.totalRevenueUSD),
      sub: `USD · ${kpis.totalOrders} orders all-time`,
      positive: null,
      icon: IcoDollar,
      accent: '#e52b2b',
    },
    {
      label: 'Total Orders',
      value: String(kpis.totalOrders),
      sub: kpis.totalOrders === 0 ? 'No orders yet' : `${kpis.todayCount} order${kpis.todayCount !== 1 ? 's' : ''} today`,
      positive: null,
      icon: IcoBox,
      accent: '#7c6bff',
    },
    {
      label: 'Revenue This Week · USD',
      value: fmt(kpis.weekRevenueUSD),
      sub: `${ratesLive ? 'Live rates' : 'Est. rates'} · ${kpis.weekCount} orders · ${weekCurrLine}`,
      positive: kpis.weekCount > 0 ? true : null,
      icon: IcoCal,
      accent: '#22c55e',
    },
    {
      label: 'Inventory Units',
      value: kpis.totalUnits !== null ? kpis.totalUnits.toLocaleString() : '—',
      sub: kpis.skuCount !== null ? `Across ${kpis.skuCount} SKUs` : 'Run schema to enable',
      positive: null,
      icon: IcoPkg,
      accent: '#f59e0b',
    },
    {
      label: 'Low Stock Alerts',
      value: kpis.lowStockCount !== null ? String(kpis.lowStockCount) : '—',
      sub: kpis.lowStockCount !== null
        ? (kpis.lowStockCount === 0 ? 'All products stocked' : `${lowStock.map(i => i.product_name).join(' · ')}`)
        : 'Run schema to enable',
      positive: kpis.lowStockCount !== null ? (kpis.lowStockCount === 0 ? true : false) : null,
      icon: IcoWarn,
      accent: '#e52b2b',
    },
    {
      label: 'Tasks Due',
      value: kpis.tasksDue !== null ? String(kpis.tasksDue) : '—',
      sub: kpis.overdueCount !== null
        ? (kpis.overdueCount > 0 ? `${kpis.overdueCount} overdue` : 'All on track')
        : 'Run schema to enable',
      positive: kpis.overdueCount !== null ? (kpis.overdueCount === 0 ? true : false) : null,
      icon: IcoCheck,
      accent: '#f59e0b',
    },
  ];

  return (
    <div className="px-4 sm:px-6 md:px-8 py-8 max-w-[1400px] mx-auto">
      <div className="mb-8">
        <h1 className="font-display text-[2rem] sm:text-[2.8rem] text-white leading-none tracking-wide">OVERVIEW</h1>
        <p className="font-ui text-[0.78rem] text-bc-secondary mt-1">{formatHeaderDate()} · BlackCrow Automotive</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        {stats.map(s => <StatCard key={s.label} {...s} />)}
      </div>

      <div className="mb-6">
        <SalesChart data={chart} totalRevenue={kpis.totalRevenueUSD} />
      </div>

      <div className="mb-6">
        <RecentOrders orders={recentOrders} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-10">
        <LowStockPanel items={lowStock} />
        <TasksPanel tasks={tasks} overdueCount={kpis.overdueCount} />
      </div>
    </div>
  );
}
