import {useState, useMemo} from 'react';
import {useLoaderData, useSearchParams, useNavigate} from '@remix-run/react';
import {json} from '@shopify/remix-oxygen';
import {getSupabase} from '~/lib/supabase.server';
import {requireAdminUser, getCountryFilter} from '~/lib/auth.server';

export const meta = () => [{title: 'KPI Performance | BlackCrow Admin'}];

/* ─── Constants ──────────────────────────────────────────────── */
const COUNTRIES = ['All', 'Australia', 'USA', 'UK', 'Canada', 'Sweden'];
const COUNTRY_FLAGS = {Australia:'🇦🇺', USA:'🇺🇸', UK:'🇬🇧', Canada:'🇨🇦', Sweden:'🇸🇪'};

/* ─── Helpers ────────────────────────────────────────────────── */
function fmtCurrency(n) {
  if (n == null || isNaN(n)) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Number(n).toFixed(2)}`;
}
function fmtNum(n) {
  if (n == null || isNaN(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
function fmtPct(n) {
  if (n == null || isNaN(n)) return '0%';
  return `${Math.round(n)}%`;
}
function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.round((new Date(b) - new Date(a)) / 86_400_000);
}
function dateRange(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(0, 0, 0, 0);
  return d;
}
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
function todayStr() { return isoDate(new Date()); }
function startOfWeekStr() {
  const d = new Date(); d.setHours(0,0,0,0);
  d.setDate(d.getDate() - d.getDay());
  return isoDate(d);
}
function startOfMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
}
function startOfYearStr() {
  return `${new Date().getFullYear()}-01-01`;
}

/* ─── Loader ─────────────────────────────────────────────────── */
export async function loader({request, context}) {
  const user = await requireAdminUser(request);
  const cf   = getCountryFilter(user);
  const sb = getSupabase();
  if (!sb) return json({configured: false});

  let qOrders   = sb.from('orders').select('id, order_number, customer_id, date, status, total, country, created_at');
  let qCustomers= sb.from('customers').select('id, name, email, country, created_at');
  let qInventory= sb.from('inventory').select('id, stock_on_hand, stock_reserved, incoming_stock, cost_per_unit, status, country, products(id, name, category, price)');
  let qTasks    = sb.from('tasks').select('id, status, completed_at, assigned_to, country, created_at, due_date, priority');
  if (cf) {
    qOrders    = qOrders.eq('country', cf);
    qCustomers = qCustomers.eq('country', cf);
    qInventory = qInventory.eq('country', cf);
    qTasks     = qTasks.eq('country', cf);
  }
  const [
    {data: orders,     error: e1},
    {data: orderItems, error: e2},
    {data: customers,  error: e3},
    {data: inventory,  error: e4},
    {data: tasks,      error: e5},
    {data: refunds,    error: e6},
  ] = await Promise.all([
    qOrders,
    sb.from('order_items').select('order_id, product, variant, quantity, unit_price, subtotal'),
    qCustomers,
    qInventory,
    qTasks,
    sb.from('refunds').select('id, order_id, amount, status, created_at'),
  ]);

  const dbError = [e1,e2,e3,e4,e5,e6].find(Boolean)?.message ?? null;

  return json({
    configured: true,
    dbError,
    orders:     orders     ?? [],
    orderItems: orderItems ?? [],
    customers:  customers  ?? [],
    inventory:  inventory  ?? [],
    tasks:      tasks      ?? [],
    refunds:    refunds    ?? [],
    generatedAt: new Date().toISOString(),
  });
}

/* ─── Page Component ─────────────────────────────────────────── */
export default function KpiPage() {
  const {configured, dbError, orders, orderItems, customers, inventory, tasks, refunds, generatedAt} =
    useLoaderData();

  const [params] = useSearchParams();
  const navigate = useNavigate();
  const countryFilter = params.get('country') || 'All';
  const [leaderSort, setLeaderSort] = useState('revenue');

  /* ── Filter orders/customers by country ── */
  const filteredOrders = useMemo(() =>
    countryFilter === 'All' ? orders : orders.filter(o => o.country === countryFilter),
  [orders, countryFilter]);

  const filteredCustomers = useMemo(() =>
    countryFilter === 'All' ? customers : customers.filter(c => c.country === countryFilter),
  [customers, countryFilter]);

  const filteredTasks = useMemo(() =>
    countryFilter === 'All' ? tasks : tasks.filter(t => t.country === countryFilter),
  [tasks, countryFilter]);

  const filteredInventory = useMemo(() =>
    countryFilter === 'All' ? inventory : inventory.filter(i => i.country === countryFilter),
  [inventory, countryFilter]);

  /* ── Revenue calculations ── */
  const activeOrders = useMemo(() =>
    filteredOrders.filter(o => !['Cancelled','Refunded','cancelled','refunded'].includes(o.status)),
  [filteredOrders]);

  const revenueTotal = useMemo(() =>
    activeOrders.reduce((s, o) => s + Number(o.total || 0), 0),
  [activeOrders]);

  const revenueToday = useMemo(() =>
    activeOrders.filter(o => o.date === todayStr() || (o.created_at||'').startsWith(todayStr()))
      .reduce((s, o) => s + Number(o.total || 0), 0),
  [activeOrders]);

  const revenueWeek = useMemo(() =>
    activeOrders.filter(o => (o.date || (o.created_at||'').slice(0,10)) >= startOfWeekStr())
      .reduce((s, o) => s + Number(o.total || 0), 0),
  [activeOrders]);

  const revenueMonth = useMemo(() =>
    activeOrders.filter(o => (o.date || (o.created_at||'').slice(0,10)) >= startOfMonthStr())
      .reduce((s, o) => s + Number(o.total || 0), 0),
  [activeOrders]);

  const revenueYear = useMemo(() =>
    activeOrders.filter(o => (o.date || (o.created_at||'').slice(0,10)) >= startOfYearStr())
      .reduce((s, o) => s + Number(o.total || 0), 0),
  [activeOrders]);

  /* ── Orders ── */
  const ordersToday = useMemo(() =>
    filteredOrders.filter(o => o.date === todayStr() || (o.created_at||'').startsWith(todayStr())).length,
  [filteredOrders]);
  const ordersWeek = useMemo(() =>
    filteredOrders.filter(o => (o.date || (o.created_at||'').slice(0,10)) >= startOfWeekStr()).length,
  [filteredOrders]);
  const ordersMonth = useMemo(() =>
    filteredOrders.filter(o => (o.date || (o.created_at||'').slice(0,10)) >= startOfMonthStr()).length,
  [filteredOrders]);

  /* ── Customers ── */
  const newCustomersMonth = useMemo(() =>
    filteredCustomers.filter(c => (c.created_at||'').slice(0,10) >= startOfMonthStr()).length,
  [filteredCustomers]);

  const repeatCustomers = useMemo(() => {
    const counts = {};
    activeOrders.forEach(o => { if (o.customer_id) counts[o.customer_id] = (counts[o.customer_id]||0)+1; });
    return Object.values(counts).filter(n => n > 1).length;
  }, [activeOrders]);

  /* ── Refund rate ── */
  const refundRate = useMemo(() => {
    if (!orders.length) return 0;
    const refunded = orders.filter(o =>
      ['Refunded','refunded'].includes(o.status) ||
      refunds.some(r => r.order_id === o.id && ['approved','completed'].includes((r.status||'').toLowerCase()))
    ).length;
    return (refunded / orders.length) * 100;
  }, [orders, refunds]);

  /* ── Inventory ── */
  const inventoryValue = useMemo(() =>
    filteredInventory.reduce((s, i) =>
      s + Number(i.cost_per_unit || 0) * Number(i.stock_on_hand || 0), 0),
  [filteredInventory]);

  const totalUnits = useMemo(() =>
    filteredInventory.reduce((s, i) => s + Number(i.stock_on_hand || 0), 0),
  [filteredInventory]);

  const lowStockCount = useMemo(() =>
    filteredInventory.filter(i =>
      Number(i.stock_on_hand || 0) <= 5 &&
      Number(i.stock_on_hand || 0) > 0
    ).length,
  [filteredInventory]);

  const outOfStockCount = useMemo(() =>
    filteredInventory.filter(i => Number(i.stock_on_hand || 0) === 0).length,
  [filteredInventory]);

  /* ── Tasks ── */
  const tasksTotal = filteredTasks.length;
  const tasksCompleted = filteredTasks.filter(t => t.status === 'Completed').length;
  const tasksOverdue = filteredTasks.filter(t => t.status === 'Overdue').length;
  const tasksDueToday = filteredTasks.filter(t =>
    t.due_date === todayStr() && !['Completed','Cancelled'].includes(t.status)
  ).length;
  const tasksCompletedWeek = filteredTasks.filter(t =>
    t.status === 'Completed' && (t.completed_at||'').slice(0,10) >= startOfWeekStr()
  ).length;
  const taskCompletionRate = tasksTotal ? (tasksCompleted / tasksTotal) * 100 : 0;

  /* ── Country leaderboard ── */
  const countryLeaderboard = useMemo(() => {
    const data = {};
    COUNTRIES.filter(c => c !== 'All').forEach(c => {
      data[c] = {country: c, revenue: 0, orders: 0, customers: 0, avgOrder: 0, tasks: 0, completedTasks: 0};
    });
    activeOrders.forEach(o => {
      const c = o.country;
      if (!data[c]) return;
      data[c].revenue += Number(o.total || 0);
      data[c].orders += 1;
    });
    customers.forEach(c => { if (data[c.country]) data[c.country].customers += 1; });
    tasks.forEach(t => {
      if (!data[t.country]) return;
      data[t.country].tasks += 1;
      if (t.status === 'Completed') data[t.country].completedTasks += 1;
    });
    return Object.values(data).map(d => ({
      ...d,
      avgOrder: d.orders ? d.revenue / d.orders : 0,
      taskRate: d.tasks ? (d.completedTasks / d.tasks) * 100 : 0,
    })).sort((a, b) => {
      if (leaderSort === 'revenue') return b.revenue - a.revenue;
      if (leaderSort === 'orders')  return b.orders - a.orders;
      if (leaderSort === 'customers') return b.customers - a.customers;
      if (leaderSort === 'avgOrder') return b.avgOrder - a.avgOrder;
      if (leaderSort === 'taskRate') return b.taskRate - a.taskRate;
      return 0;
    });
  }, [activeOrders, customers, tasks, leaderSort]);

  /* ── Top products ── */
  const topProducts = useMemo(() => {
    const map = {};
    const filteredOrderIds = new Set(filteredOrders.map(o => o.id));
    orderItems.filter(i => filteredOrderIds.has(i.order_id)).forEach(i => {
      const k = i.product || 'Unknown';
      if (!map[k]) map[k] = {product: k, qty: 0, revenue: 0, orders: new Set()};
      map[k].qty += Number(i.quantity || 0);
      map[k].revenue += Number(i.subtotal || 0);
      map[k].orders.add(i.order_id);
    });
    return Object.values(map)
      .map(p => ({...p, orders: p.orders.size}))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
  }, [orderItems, filteredOrders]);

  /* ── Category revenue ── */
  const categoryRevenue = useMemo(() => {
    const map = {};
    const filteredOrderIds = new Set(filteredOrders.map(o => o.id));
    orderItems.filter(i => filteredOrderIds.has(i.order_id)).forEach(i => {
      // Try to get category from inventory products
      const inv = inventory.find(iv => iv.products?.name === i.product);
      const cat = inv?.products?.category || 'Other';
      if (!map[cat]) map[cat] = {category: cat, revenue: 0};
      map[cat].revenue += Number(i.subtotal || 0);
    });
    return Object.values(map).sort((a, b) => b.revenue - a.revenue);
  }, [orderItems, filteredOrders, inventory]);

  /* ── Productivity by user ── */
  const userProductivity = useMemo(() => {
    const map = {};
    filteredTasks.forEach(t => {
      const u = t.assigned_to || 'Unassigned';
      if (!map[u]) map[u] = {user: u, assigned: 0, completed: 0, overdue: 0, totalDays: 0, completedWithDays: 0};
      map[u].assigned += 1;
      if (t.status === 'Completed') {
        map[u].completed += 1;
        const days = daysBetween(t.created_at, t.completed_at);
        if (days != null && days >= 0) {
          map[u].totalDays += days;
          map[u].completedWithDays += 1;
        }
      }
      if (t.status === 'Overdue') map[u].overdue += 1;
    });
    return Object.values(map)
      .map(u => ({
        ...u,
        rate: u.assigned ? (u.completed / u.assigned) * 100 : 0,
        avgDays: u.completedWithDays ? (u.totalDays / u.completedWithDays).toFixed(1) : '—',
      }))
      .sort((a, b) => b.rate - a.rate);
  }, [filteredTasks]);

  /* ── Top customers ── */
  const topCustomers = useMemo(() => {
    const map = {};
    filteredCustomers.forEach(c => {
      map[c.id] = {id: c.id, name: c.name, country: c.country, orders: 0, revenue: 0};
    });
    activeOrders.forEach(o => {
      if (o.customer_id && map[o.customer_id]) {
        map[o.customer_id].orders += 1;
        map[o.customer_id].revenue += Number(o.total || 0);
      }
    });
    return Object.values(map)
      .filter(c => c.orders > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
  }, [filteredCustomers, activeOrders]);

  /* ── 7-day trend ── */
  const trend7 = useMemo(() => {
    const days = Array.from({length: 7}, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return isoDate(d);
    });
    return days.map(day => {
      const dayOrders = filteredOrders.filter(o =>
        (o.date || (o.created_at||'').slice(0,10)) === day &&
        !['Cancelled','Refunded','cancelled','refunded'].includes(o.status)
      );
      const dayCustomers = filteredCustomers.filter(c => (c.created_at||'').slice(0,10) === day);
      const dayTasks = filteredTasks.filter(t => (t.completed_at||'').slice(0,10) === day && t.status === 'Completed');
      return {
        day: day.slice(5),
        revenue: dayOrders.reduce((s, o) => s + Number(o.total||0), 0),
        orders: dayOrders.length,
        customers: dayCustomers.length,
        tasks: dayTasks.length,
      };
    });
  }, [filteredOrders, filteredCustomers, filteredTasks]);

  /* ── Max values for chart scaling ── */
  const maxRevenue   = Math.max(...trend7.map(d => d.revenue), 1);
  const maxOrders    = Math.max(...trend7.map(d => d.orders), 1);
  const maxCustomers = Math.max(...trend7.map(d => d.customers), 1);
  const maxTasks     = Math.max(...trend7.map(d => d.tasks), 1);

  /* ── Country filter handler ── */
  function setCountry(c) {
    const p = new URLSearchParams(params);
    if (c === 'All') p.delete('country'); else p.set('country', c);
    navigate(`?${p.toString()}`, {replace: true});
  }

  /* ── CSV Export ── */
  function exportCSV() {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const date = new Date().toISOString().slice(0, 10);
    const country = countryFilter === 'All' ? 'All Countries' : countryFilter;
    const rows = [];

    rows.push(esc(`BlackCrow KPI Report — ${date} — ${country}`));
    rows.push('');

    rows.push('REVENUE SUMMARY (USD)');
    rows.push('Period,Revenue (USD),Orders');
    rows.push(`Today,${revenueToday.toFixed(2)},${ordersToday}`);
    rows.push(`This Week,${revenueWeek.toFixed(2)},${ordersWeek}`);
    rows.push(`This Month,${revenueMonth.toFixed(2)},${ordersMonth}`);
    rows.push(`All Time,${revenueTotal.toFixed(2)},${filteredOrders.length}`);
    rows.push('');

    rows.push('BUSINESS OVERVIEW');
    rows.push('Metric,Value');
    rows.push(`Total Customers,${filteredCustomers.length}`);
    rows.push(`New This Month,${newCustomersMonth}`);
    rows.push(`Repeat Customers,${repeatCustomers}`);
    rows.push(`Refund Rate,${refundRate.toFixed(1)}%`);
    rows.push(`Inventory Value (USD),${inventoryValue.toFixed(2)}`);
    rows.push(`Total SKUs,${filteredInventory.length}`);
    rows.push(`Low Stock Items,${lowStockCount}`);
    rows.push(`Out of Stock,${outOfStockCount}`);
    rows.push(`Task Completion Rate,${taskCompletionRate.toFixed(1)}%`);
    rows.push(`Tasks Overdue,${tasksOverdue}`);
    rows.push(`Tasks Due Today,${tasksDueToday}`);
    rows.push(`Tasks Completed This Week,${tasksCompletedWeek}`);
    rows.push('');

    rows.push('COUNTRY PERFORMANCE LEADERBOARD (USD)');
    rows.push('Rank,Country,Revenue (USD),Orders,Customers,Avg Order (USD),Task Rate %');
    countryLeaderboard.forEach((r, i) => {
      rows.push(`${i + 1},${r.country},${r.revenue.toFixed(2)},${r.orders},${r.customers},${r.avgOrder.toFixed(2)},${r.taskRate.toFixed(1)}`);
    });
    rows.push('');

    rows.push('TOP PRODUCTS BY REVENUE (USD)');
    rows.push('Rank,Product,Qty Sold,Revenue (USD),Orders');
    topProducts.forEach((p, i) => {
      rows.push(`${i + 1},${esc(p.product)},${p.qty},${p.revenue.toFixed(2)},${p.orders}`);
    });
    rows.push('');

    rows.push('TOP CUSTOMERS BY REVENUE (USD)');
    rows.push('Rank,Customer,Country,Orders,Revenue (USD)');
    topCustomers.forEach((c, i) => {
      rows.push(`${i + 1},${esc(c.name)},${c.country},${c.orders},${c.revenue.toFixed(2)}`);
    });
    rows.push('');

    rows.push('TEAM PRODUCTIVITY');
    rows.push('Team Member,Assigned,Completed,Overdue,Completion Rate %,Avg Days to Complete');
    userProductivity.forEach(u => {
      rows.push(`${esc(u.user)},${u.assigned},${u.completed},${u.overdue},${u.rate.toFixed(1)},${u.avgDays}`);
    });
    rows.push('');

    rows.push('7-DAY TREND');
    rows.push('Date,Revenue (USD),Orders,New Customers,Tasks Completed');
    trend7.forEach(d => {
      rows.push(`${d.day},${d.revenue.toFixed(2)},${d.orders},${d.customers},${d.tasks}`);
    });

    const blob = new Blob([rows.join('\n')], {type: 'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `blackcrow-kpi-${date}${countryFilter !== 'All' ? '-' + countryFilter.toLowerCase() : ''}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ── PDF Export ── */
  function exportPDF() {
    window.print();
  }

  if (!configured) {
    return (
      <div className="min-h-screen bg-bc-dark flex items-center justify-center">
        <p className="font-ui text-bc-secondary text-sm">Supabase not configured.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bc-dark px-4 sm:px-8 py-8">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          @page { margin: 1cm; size: A4 landscape; }
          .fixed, .sticky { display: none !important; }
          .bc-card { break-inside: avoid; }
        }
      `}</style>

      {/* ── Header ── */}
      <div className="mb-8">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="font-display text-[1.6rem] sm:text-[2rem] text-white tracking-tight leading-none mb-1">
              KPI Performance
            </h1>
            <p className="font-ui text-[0.72rem] text-bc-secondary/60 tracking-[0.08em] uppercase">
              BlackCrow Global Command Center
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={exportCSV}
              className="no-print flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-white/[0.05] border border-bc-divider font-ui text-[0.72rem] text-bc-secondary hover:text-white hover:bg-white/[0.08] transition-all duration-150"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export CSV
            </button>
            <button
              onClick={exportPDF}
              className="no-print flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-white/[0.05] border border-bc-divider font-ui text-[0.72rem] text-bc-secondary hover:text-white hover:bg-white/[0.08] transition-all duration-150"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              Export PDF
            </button>
            {generatedAt && (
              <span className="font-ui text-[0.6rem] text-bc-secondary/30 tracking-[0.06em] pl-1">
                Updated {new Date(generatedAt).toLocaleTimeString('en-AU', {hour:'2-digit', minute:'2-digit'})}
              </span>
            )}
          </div>
        </div>

        {dbError && (
          <div className="mt-4 px-4 py-3 rounded-[10px] bg-bc-red/10 border border-bc-red/20">
            <p className="font-ui text-[0.72rem] text-bc-red">Database error: {dbError}</p>
          </div>
        )}
      </div>

      {/* ── Country Filter ── */}
      <div className="no-print flex items-center gap-2 mb-8 flex-wrap">
        <span className="font-ui text-[0.6rem] uppercase tracking-[0.12em] text-bc-secondary/40 mr-1">Country</span>
        {COUNTRIES.map(c => (
          <button
            key={c}
            onClick={() => setCountry(c)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full font-ui text-[0.7rem] border transition-all duration-150 ${
              countryFilter === c
                ? 'bg-bc-red/15 border-bc-red/40 text-white'
                : 'bg-white/[0.03] border-bc-divider text-bc-secondary hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            {c !== 'All' && <span>{COUNTRY_FLAGS[c]}</span>}
            {c}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════ */}
      {/* ── SECTION 1: Revenue KPIs ── */}
      <SectionHeader icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 1 1 0 7H6"/></svg>} label="Revenue (USD)" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8 min-w-0">
        <KpiTile label="Today" value={fmtCurrency(revenueToday)} sub={`${ordersToday} orders · USD`} accent="#22c55e" />
        <KpiTile label="This Week" value={fmtCurrency(revenueWeek)} sub={`${ordersWeek} orders · USD`} accent="#3b82f6" />
        <KpiTile label="This Month" value={fmtCurrency(revenueMonth)} sub={`${ordersMonth} orders · USD`} accent="#a78bfa" />
        <KpiTile label="All Time" value={fmtCurrency(revenueTotal)} sub={`${filteredOrders.length} total orders · USD`} accent="#f59e0b" />
      </div>

      {/* ── SECTION 2: Business Overview ── */}
      <SectionHeader icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>} label="Business Overview" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8 min-w-0">
        <KpiTile label="Total Customers" value={fmtNum(filteredCustomers.length)} sub={`+${newCustomersMonth} this month`} accent="#3b82f6" />
        <KpiTile label="Repeat Customers" value={fmtNum(repeatCustomers)} sub="2+ orders" accent="#22c55e" />
        <KpiTile label="Refund Rate" value={fmtPct(refundRate)} sub="of all orders" accent={refundRate > 10 ? '#ef4444' : '#f59e0b'} />
        <KpiTile label="Inventory Value" value={fmtCurrency(inventoryValue)} sub="(USD)" accent="#a78bfa" />
        <KpiTile label="Total SKUs" value={fmtNum(filteredInventory.length)} sub={`${lowStockCount} low stock`} accent="#f59e0b" />
        <KpiTile label="Task Rate" value={fmtPct(taskCompletionRate)} sub={`${tasksOverdue} overdue`} accent={tasksOverdue > 5 ? '#ef4444' : '#22c55e'} />
      </div>

      {/* ── SECTION 3: 7-Day Trend Charts ── */}
      <SectionHeader icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>} label="7-Day Trends" />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <TrendChart
          label="Revenue"
          data={trend7.map(d => ({day: d.day, val: d.revenue}))}
          max={maxRevenue}
          formatVal={fmtCurrency}
          color="#22c55e"
        />
        <TrendChart
          label="Orders"
          data={trend7.map(d => ({day: d.day, val: d.orders}))}
          max={maxOrders}
          formatVal={v => String(v)}
          color="#3b82f6"
        />
        <TrendChart
          label="New Customers"
          data={trend7.map(d => ({day: d.day, val: d.customers}))}
          max={maxCustomers}
          formatVal={v => String(v)}
          color="#a78bfa"
        />
        <TrendChart
          label="Tasks Completed"
          data={trend7.map(d => ({day: d.day, val: d.tasks}))}
          max={maxTasks}
          formatVal={v => String(v)}
          color="#f59e0b"
        />
      </div>

      {/* ── SECTION 4: Country Leaderboard ── */}
      <SectionHeader icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>} label="Country Performance Leaderboard" />
      <div className="bc-card mb-8 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-bc-divider">
                <th className="text-left px-4 py-3 font-ui text-[0.6rem] uppercase tracking-[0.12em] text-bc-secondary/50">Rank</th>
                <th className="text-left px-4 py-3 font-ui text-[0.6rem] uppercase tracking-[0.12em] text-bc-secondary/50">Country</th>
                {[
                  {key:'revenue',   label:'Revenue (USD)'},
                  {key:'orders',    label:'Orders'},
                  {key:'customers', label:'Customers'},
                  {key:'avgOrder',  label:'Avg Order (USD)'},
                  {key:'taskRate',  label:'Task Rate'},
                ].map(col => (
                  <th key={col.key}
                    className={`text-right px-4 py-3 font-ui text-[0.6rem] uppercase tracking-[0.12em] cursor-pointer transition-colors duration-150 select-none ${
                      leaderSort === col.key ? 'text-bc-red' : 'text-bc-secondary/50 hover:text-bc-secondary'
                    }`}
                    onClick={() => setLeaderSort(col.key)}
                  >
                    {col.label} {leaderSort === col.key ? '↓' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {countryLeaderboard.map((row, i) => (
                <tr key={row.country} className="border-b border-bc-divider/50 hover:bg-white/[0.02] transition-colors duration-100">
                  <td className="px-4 py-3">
                    <RankBadge rank={i + 1} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-ui text-[0.82rem] text-white flex items-center gap-2">
                      <span className="text-base">{COUNTRY_FLAGS[row.country]}</span>
                      {row.country}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-ui text-[0.82rem] text-white">{fmtCurrency(row.revenue)}</td>
                  <td className="px-4 py-3 text-right font-ui text-[0.82rem] text-bc-secondary">{row.orders}</td>
                  <td className="px-4 py-3 text-right font-ui text-[0.82rem] text-bc-secondary">{row.customers}</td>
                  <td className="px-4 py-3 text-right font-ui text-[0.82rem] text-bc-secondary">{fmtCurrency(row.avgOrder)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-[#22c55e] rounded-full transition-all" style={{width: `${row.taskRate}%`}} />
                      </div>
                      <span className="font-ui text-[0.72rem] text-bc-secondary w-8 text-right">{fmtPct(row.taskRate)}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── SECTION 5 + 6: Sales + Productivity (side by side) ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-8">

        {/* ── Sales Performance ── */}
        <div>
          <SectionHeader icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>} label="Sales Performance" />
          <div className="bc-card overflow-hidden">
            {/* Category bars */}
            {categoryRevenue.length > 0 && (
              <div className="px-4 pt-4 pb-3 border-b border-bc-divider">
                <p className="font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40 mb-3">Revenue by Category (USD)</p>
                {categoryRevenue.slice(0, 6).map(cat => {
                  const pct = categoryRevenue[0]?.revenue > 0 ? (cat.revenue / categoryRevenue[0].revenue) * 100 : 0;
                  return (
                    <div key={cat.category} className="flex items-center gap-3 mb-2">
                      <span className="font-ui text-[0.7rem] text-bc-secondary w-28 shrink-0 truncate">{cat.category}</span>
                      <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                        <div className="h-full bg-bc-red rounded-full transition-all" style={{width: `${pct}%`}} />
                      </div>
                      <span className="font-ui text-[0.7rem] text-white w-16 text-right shrink-0">{fmtCurrency(cat.revenue)}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Top products table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-bc-divider">
                    <th className="text-left px-4 py-2.5 font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40">Product</th>
                    <th className="text-right px-4 py-2.5 font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40">Qty</th>
                    <th className="text-right px-4 py-2.5 font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40">Revenue (USD)</th>
                    <th className="text-right px-4 py-2.5 font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40">Orders</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-6 text-center font-ui text-[0.72rem] text-bc-secondary/40">No order items data</td></tr>
                  )}
                  {topProducts.map((p, i) => (
                    <tr key={p.product} className="border-b border-bc-divider/40 hover:bg-white/[0.02] transition-colors duration-100">
                      <td className="px-4 py-2.5 flex items-center gap-2">
                        <span className="font-ui text-[0.6rem] text-bc-secondary/40 w-4 shrink-0">{i+1}</span>
                        <span className="font-ui text-[0.78rem] text-white truncate max-w-[120px] sm:max-w-[200px]">{p.product}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-ui text-[0.78rem] text-bc-secondary">{p.qty}</td>
                      <td className="px-4 py-2.5 text-right font-ui text-[0.82rem] text-white">{fmtCurrency(p.revenue)}</td>
                      <td className="px-4 py-2.5 text-right font-ui text-[0.78rem] text-bc-secondary">{p.orders}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ── Productivity Leaderboard ── */}
        <div>
          <SectionHeader icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>} label="Team Productivity" />
          <div className="bc-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-bc-divider">
                    <th className="text-left px-4 py-2.5 font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40">Team Member</th>
                    <th className="text-right px-4 py-2.5 font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40">Assigned</th>
                    <th className="text-right px-4 py-2.5 font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40">Done</th>
                    <th className="text-right px-4 py-2.5 font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40">Late</th>
                    <th className="text-left px-4 py-2.5 font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40">Rate</th>
                    <th className="text-right px-4 py-2.5 font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40">Avg Days</th>
                  </tr>
                </thead>
                <tbody>
                  {userProductivity.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-6 text-center font-ui text-[0.72rem] text-bc-secondary/40">No task data</td></tr>
                  )}
                  {userProductivity.map((u, i) => (
                    <tr key={u.user} className="border-b border-bc-divider/40 hover:bg-white/[0.02] transition-colors duration-100">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-bc-red/20 flex items-center justify-center shrink-0">
                            <span className="font-ui text-[0.6rem] text-bc-red font-semibold">
                              {(u.user || 'U').charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <span className="font-ui text-[0.78rem] text-white truncate max-w-[80px] sm:max-w-[150px]">{u.user}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-ui text-[0.78rem] text-bc-secondary">{u.assigned}</td>
                      <td className="px-4 py-2.5 text-right font-ui text-[0.78rem] text-[#22c55e]">{u.completed}</td>
                      <td className="px-4 py-2.5 text-right font-ui text-[0.78rem] text-bc-red">{u.overdue}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-14 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all"
                              style={{width: `${u.rate}%`, background: u.rate >= 80 ? '#22c55e' : u.rate >= 50 ? '#f59e0b' : '#ef4444'}} />
                          </div>
                          <span className="font-ui text-[0.7rem] text-bc-secondary">{fmtPct(u.rate)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-ui text-[0.78rem] text-bc-secondary">{u.avgDays}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Task KPI strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 border-t border-bc-divider">
              {[
                {label:'Total Tasks', val: tasksTotal, color:'text-white'},
                {label:'Due Today',   val: tasksDueToday, color:'text-[#f59e0b]'},
                {label:'Overdue',     val: tasksOverdue, color:'text-bc-red'},
                {label:'Done / Wk',   val: tasksCompletedWeek, color:'text-[#22c55e]'},
              ].map(s => (
                <div key={s.label} className="px-4 py-3 text-center border-r border-bc-divider last:border-0">
                  <p className={`font-display text-[1.2rem] ${s.color}`}>{s.val}</p>
                  <p className="font-ui text-[0.58rem] uppercase tracking-[0.08em] text-bc-secondary/40 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── SECTION 7: Top Customers + Inventory (side by side) ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-8">

        {/* ── Top Customers ── */}
        <div>
          <SectionHeader icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>} label="Top Customers by Revenue (USD)" />
          <div className="bc-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-bc-divider">
                    <th className="text-left px-4 py-2.5 font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40">#</th>
                    <th className="text-left px-4 py-2.5 font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40">Customer</th>
                    <th className="text-left px-4 py-2.5 font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40">Country</th>
                    <th className="text-right px-4 py-2.5 font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40">Orders</th>
                    <th className="text-right px-4 py-2.5 font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40">Revenue (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {topCustomers.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-6 text-center font-ui text-[0.72rem] text-bc-secondary/40">No customer data</td></tr>
                  )}
                  {topCustomers.map((c, i) => (
                    <tr key={c.id} className="border-b border-bc-divider/40 hover:bg-white/[0.02] transition-colors duration-100">
                      <td className="px-4 py-2.5">
                        <RankBadge rank={i + 1} />
                      </td>
                      <td className="px-4 py-2.5 font-ui text-[0.82rem] text-white truncate max-w-[100px] sm:max-w-[180px]">{c.name}</td>
                      <td className="px-4 py-2.5 font-ui text-[0.72rem] text-bc-secondary">
                        {COUNTRY_FLAGS[c.country]} {c.country}
                      </td>
                      <td className="px-4 py-2.5 text-right font-ui text-[0.78rem] text-bc-secondary">{c.orders}</td>
                      <td className="px-4 py-2.5 text-right font-ui text-[0.85rem] text-white">{fmtCurrency(c.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ── Inventory Performance ── */}
        <div>
          <SectionHeader icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>} label="Inventory Performance" />
          <div className="bc-card overflow-hidden">

            {/* KPI strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 border-b border-bc-divider">
              {[
                {label:'Total SKUs',   val: filteredInventory.length,  color:'text-white'},
                {label:'Total Units',  val: fmtNum(totalUnits),        color:'text-white'},
                {label:'Low Stock',    val: lowStockCount,             color:'text-[#f59e0b]'},
                {label:'Out of Stock', val: outOfStockCount,           color:'text-bc-red'},
              ].map(s => (
                <div key={s.label} className="px-3 py-3 text-center border-r border-bc-divider last:border-0">
                  <p className={`font-display text-[1.2rem] ${s.color}`}>{s.val}</p>
                  <p className="font-ui text-[0.55rem] uppercase tracking-[0.08em] text-bc-secondary/40 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Status breakdown */}
            {(() => {
              const statusGroups = {};
              filteredInventory.forEach(i => {
                const st = i.status || 'Active';
                statusGroups[st] = (statusGroups[st] || 0) + 1;
              });
              const total = filteredInventory.length || 1;
              return (
                <div className="px-4 py-4 border-b border-bc-divider">
                  <p className="font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40 mb-3">Status Breakdown</p>
                  {Object.entries(statusGroups).map(([st, count]) => (
                    <div key={st} className="flex items-center gap-3 mb-2">
                      <span className="font-ui text-[0.7rem] text-bc-secondary w-24 shrink-0">{st}</span>
                      <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                        <div className="h-full bg-bc-red/60 rounded-full" style={{width:`${(count/total)*100}%`}} />
                      </div>
                      <span className="font-ui text-[0.7rem] text-white w-8 text-right shrink-0">{count}</span>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Low stock items */}
            <div className="px-4 py-3">
              <p className="font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40 mb-3">Low / Out of Stock</p>
              {filteredInventory
                .filter(i => Number(i.stock_on_hand || 0) <= 5)
                .sort((a, b) => Number(a.stock_on_hand||0) - Number(b.stock_on_hand||0))
                .slice(0, 8)
                .map(i => (
                  <div key={i.id} className="flex items-center justify-between py-1.5 border-b border-bc-divider/30 last:border-0">
                    <span className="font-ui text-[0.75rem] text-white truncate max-w-[140px] sm:max-w-[240px]">
                      {i.products?.name || 'Unknown'}
                    </span>
                    <span className={`font-ui text-[0.72rem] ml-2 shrink-0 ${
                      Number(i.stock_on_hand||0) === 0 ? 'text-bc-red' : 'text-[#f59e0b]'
                    }`}>
                      {Number(i.stock_on_hand||0) === 0 ? 'Out of Stock' : `${i.stock_on_hand} left`}
                    </span>
                  </div>
                ))}
              {filteredInventory.filter(i => Number(i.stock_on_hand||0) <= 5).length === 0 && (
                <p className="font-ui text-[0.72rem] text-[#22c55e]">All inventory levels healthy</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="mt-4 pb-8 text-center">
        <p className="font-ui text-[0.6rem] text-bc-secondary/20 tracking-[0.08em] uppercase">
          BlackCrow Global Command Center · Data refreshes on page load
        </p>
      </div>

    </div>
  );
}

/* ─── Sub-Components ─────────────────────────────────────────── */

function SectionHeader({icon, label}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-bc-red">{icon}</span>
      <span className="font-ui text-[0.65rem] uppercase tracking-[0.14em] text-bc-secondary/70">{label}</span>
      <div className="flex-1 h-px bg-bc-divider ml-1" />
    </div>
  );
}

function KpiTile({label, value, sub, accent}) {
  return (
    <div className="bc-card px-4 py-4 min-w-0 overflow-hidden">
      <div className="w-1 h-4 rounded-full mb-3" style={{background: accent}} />
      <p className="font-display text-[1.3rem] sm:text-[1.55rem] text-white leading-none mb-1 truncate">{value}</p>
      <p className="font-ui text-[0.65rem] uppercase tracking-[0.1em] text-bc-secondary/70 mb-0.5">{label}</p>
      {sub && <p className="font-ui text-[0.6rem] text-bc-secondary/40">{sub}</p>}
    </div>
  );
}

function TrendChart({label, data, max, formatVal, color}) {
  const total = data.reduce((s, d) => s + d.val, 0);
  return (
    <div className="bc-card px-4 py-4 min-w-0 overflow-hidden">
      <div className="flex items-baseline justify-between mb-3">
        <p className="font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/50">{label}</p>
        <p className="font-display text-[1.1rem] text-white">{formatVal(total)}</p>
      </div>
      <div className="flex items-end gap-1 h-12">
        {data.map(d => {
          const pct = max > 0 ? (d.val / max) * 100 : 0;
          return (
            <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full rounded-sm transition-all" style={{
                height: `${Math.max(pct, d.val > 0 ? 8 : 2)}%`,
                background: d.val > 0 ? color : 'rgba(255,255,255,0.06)',
                minHeight: 2,
              }} title={`${d.day}: ${formatVal(d.val)}`} />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1.5">
        {data.map(d => (
          <span key={d.day} className="font-ui text-[0.5rem] text-bc-secondary/30 flex-1 text-center">{d.day}</span>
        ))}
      </div>
    </div>
  );
}

function RankBadge({rank}) {
  const cfg = {
    1: 'bg-[#f59e0b]/15 text-[#f59e0b]',
    2: 'bg-white/10 text-white/60',
    3: 'bg-[#b45309]/15 text-[#b45309]',
  };
  return (
    <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full font-ui text-[0.6rem] font-semibold ${cfg[rank] || 'text-bc-secondary/40 font-ui text-[0.6rem]'}`}>
      {rank}
    </span>
  );
}
