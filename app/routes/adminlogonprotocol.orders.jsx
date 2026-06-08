import {useState, useMemo} from 'react';
import {useLoaderData, useNavigate} from '@remix-run/react';
import {json} from '@shopify/remix-oxygen';
import {getSupabase} from '~/lib/supabase.server';
import {requireAdminUser, getCountryFilter} from '~/lib/auth.server';

export const meta = () => [{title: 'Orders | BlackCrow Admin'}];

/* ── Helpers ──────────────────────────────────────────────────── */
function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-AU', {day:'numeric', month:'short', year:'numeric'});
}
function currSym(c) { return {GBP:'£',EUR:'€',JPY:'¥',SEK:'kr'}[c] ?? '$'; }
function fmt(n, cur = 'AUD') {
  const num = Number(n ?? 0).toLocaleString('en-AU', {minimumFractionDigits:2, maximumFractionDigits:2});
  return cur === 'SEK' ? `${num}\u00a0kr` : `${currSym(cur)}${num}`;
}

/* ── Status config ────────────────────────────────────────────── */
const SHIP_COLORS = {
  pending:    {bg:'bg-[#f59e0b]/10', text:'text-[#f59e0b]'},
  processing: {bg:'bg-[#3b82f6]/10', text:'text-[#60a5fa]'},
  shipped:    {bg:'bg-[#a78bfa]/10', text:'text-[#a78bfa]'},
  delivered:  {bg:'bg-[#22c55e]/10', text:'text-[#22c55e]'},
  returned:   {bg:'bg-bc-red/10',    text:'text-bc-red'},
};
const PAY_COLORS = {
  pending:  {bg:'bg-[#f59e0b]/10', text:'text-[#f59e0b]'},
  paid:     {bg:'bg-[#22c55e]/10', text:'text-[#22c55e]'},
  failed:   {bg:'bg-bc-red/10',    text:'text-bc-red'},
  refunded: {bg:'bg-white/10',     text:'text-bc-secondary'},
};

const FILTER_TABS = [
  {label:'All',        value:'all'},
  {label:'Pending',    value:'pending'},
  {label:'Packed',     value:'processing'},
  {label:'Shipped',    value:'shipped'},
  {label:'Delivered',  value:'delivered'},
  {label:'Returned',   value:'returned'},
];

/* ── Sub-components ───────────────────────────────────────────── */
function StatusPill({value, colorMap, overrideLabel}) {
  const c = colorMap[value] ?? {bg:'bg-white/10', text:'text-bc-secondary'};
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-ui text-[0.62rem] font-medium uppercase tracking-wide whitespace-nowrap ${c.bg} ${c.text}`}>
      {overrideLabel ?? (value === 'processing' ? 'packed' : (value ?? '—'))}
    </span>
  );
}

function KpiCard({label, value, accent, onClick, active}) {
  return (
    <button
      onClick={onClick}
      className={`bg-bc-card rounded-[20px] p-5 flex flex-col gap-3 border text-left transition-all duration-150 w-full ${
        active ? 'border-bc-red/40' : 'border-bc-divider hover:border-bc-divider/80'
      }`}
    >
      <span className="font-ui text-[0.68rem] font-medium tracking-[0.12em] uppercase text-bc-secondary">{label}</span>
      <p className="font-display text-[2.4rem] leading-none text-white">{value}</p>
      <div className="h-[2px] rounded-full mt-auto" style={{background: accent, opacity: active ? 1 : 0.5}} />
    </button>
  );
}

/* ── Loader ───────────────────────────────────────────────────── */
export async function loader({request, context}) {
  const user = await requireAdminUser(request);
  const cf   = getCountryFilter(user);
  const sb = getSupabase();
  if (!sb) return json({orders: [], configured: false, kpis: {}});

  let q = sb
    .from('orders')
    .select(`
      id, order_number, date, status, payment_status, shipping_status,
      total, currency, country, tracking_number, created_at,
      customers (id, name),
      order_items (id)
    `);
  if (cf) q = q.eq('country', cf);
  const {data, error} = await q.order('created_at', {ascending: false});

  if (error) return json({orders: [], configured: true, kpis: {}, dbError: error.message});

  const orders = data ?? [];
  const today  = localDate();

  const kpis = {
    today:      orders.filter(o => o.date === today).length,
    pending:    orders.filter(o => o.shipping_status === 'pending').length,
    processing: orders.filter(o => o.shipping_status === 'processing').length,
    shipped:    orders.filter(o => o.shipping_status === 'shipped').length,
    delivered:  orders.filter(o => o.shipping_status === 'delivered').length,
  };

  return json({orders, configured: true, kpis});
}

/* ── Page ─────────────────────────────────────────────────────── */
export default function OrdersPage() {
  const {orders, configured, kpis, dbError} = useLoaderData();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const KPI_CONFIG = [
    {label:'Orders Today', kpiKey:'today',      accent:'#e52b2b', filterVal:null},
    {label:'Pending',      kpiKey:'pending',    accent:'#f59e0b', filterVal:'pending'},
    {label:'Packed',       kpiKey:'processing', accent:'#3b82f6', filterVal:'processing'},
    {label:'Shipped',      kpiKey:'shipped',    accent:'#a78bfa', filterVal:'shipped'},
    {label:'Delivered',    kpiKey:'delivered',  accent:'#22c55e', filterVal:'delivered'},
  ];

  const filtered = useMemo(() => {
    return orders.filter(o => {
      if (filter !== 'all' && o.shipping_status !== filter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!o.order_number?.toLowerCase().includes(q) &&
            !o.customers?.name?.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [orders, filter, search]);

  const th = 'font-ui text-[0.62rem] tracking-[0.12em] uppercase text-bc-secondary text-left px-4 py-3 whitespace-nowrap';
  const td = 'font-ui text-[0.8rem] text-white px-4 py-3 align-middle';

  return (
    <div className="px-6 py-8 lg:px-10">

      {/* ── Page header ── */}
      <div className="mb-8">
        <h1 className="font-display text-[2.2rem] text-white tracking-[0.12em] leading-none">ORDERS</h1>
        <p className="font-ui text-[0.72rem] text-bc-secondary mt-1">
          {configured
            ? `${orders.length} order${orders.length !== 1 ? 's' : ''} total`
            : 'Supabase not configured'}
          {dbError && <span className="text-bc-red ml-2">· {dbError}</span>}
        </p>
      </div>

      {/* ── KPI cards (clickable as filters) ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        {KPI_CONFIG.map(({label, kpiKey, accent, filterVal}, idx) => (
          <div key={kpiKey} className={idx === KPI_CONFIG.length - 1 && KPI_CONFIG.length % 2 !== 0 ? 'col-span-2 sm:col-span-1' : ''}>
          <KpiCard
            label={label}
            value={kpis[kpiKey] ?? 0}
            accent={accent}
            active={filterVal !== null && filter === filterVal}
            onClick={() => {
              if (filterVal === null) return;
              setFilter(prev => prev === filterVal ? 'all' : filterVal);
            }}
          />
          </div>
        ))}
      </div>

      {/* ── Filter tabs + Search ── */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:items-center mb-5">
        <div className="flex gap-1 flex-wrap min-w-0">
          {FILTER_TABS.map(t => (
            <button
              key={t.value}
              onClick={() => setFilter(t.value)}
              className={`px-3 py-1.5 rounded-[8px] font-ui text-[0.75rem] transition-all duration-150 ${
                filter === t.value
                  ? 'bg-bc-red/15 text-white border border-bc-red/30'
                  : 'text-bc-secondary hover:text-white border border-transparent hover:border-bc-divider'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="sm:ml-auto relative">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Order # or customer…"
            className="bg-bc-card border border-bc-divider rounded-[10px] px-3 py-1.5 pl-8 font-ui text-[0.78rem] text-white placeholder-bc-secondary/50 focus:outline-none focus:border-bc-red transition-colors w-full sm:w-52"
          />
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-bc-secondary pointer-events-none" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-bc-secondary hover:text-white transition-colors">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          )}
        </div>
      </div>

      {/* ── Orders table ── */}
      {filtered.length === 0 ? (
        <div className="text-center py-20 border border-bc-divider rounded-[14px]">
          <p className="font-ui text-bc-secondary text-[0.85rem]">
            {search || filter !== 'all'
              ? 'No orders match your filters.'
              : configured ? 'No orders yet.' : 'Run the Supabase schema to get started.'}
          </p>
        </div>
      ) : (
        <div className="border border-bc-divider rounded-[14px] overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[540px]">
            <thead>
              <tr className="border-b border-bc-divider" style={{background:'rgba(255,255,255,0.03)'}}>
                <th className={th}>Order #</th>
                <th className={`${th} hidden sm:table-cell`}>Date</th>
                <th className={th}>Customer</th>
                <th className={`${th} hidden md:table-cell`}>Country</th>
                <th className={`${th} hidden sm:table-cell text-center`}>Items</th>
                <th className={`${th} text-right`}>Total</th>
                <th className={`${th} hidden lg:table-cell`}>Payment</th>
                <th className={th}>Fulfilment</th>
                <th className={`${th} hidden xl:table-cell`}>Tracking #</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((order, i) => (
                <tr
                  key={order.id}
                  onClick={() => navigate(`/adminlogonprotocol/orders/${order.id}`)}
                  className={`border-b border-bc-divider/50 cursor-pointer transition-colors duration-100 hover:bg-white/[0.04] ${
                    i === filtered.length - 1 ? 'border-b-0' : ''
                  }`}
                >
                  {/* Order # */}
                  <td className={td}>
                    <span className="font-ui text-[0.72rem] font-semibold" style={{color:'#e52b2b99'}}>
                      {order.order_number}
                    </span>
                  </td>

                  {/* Date */}
                  <td className={`${td} hidden sm:table-cell text-bc-secondary text-[0.72rem] whitespace-nowrap`}>
                    {fmtDate(order.date)}
                  </td>

                  {/* Customer */}
                  <td className={td}>
                    <p className="text-[0.82rem] truncate max-w-[140px]">
                      {order.customers?.name ?? '—'}
                    </p>
                  </td>

                  {/* Country */}
                  <td className={`${td} hidden md:table-cell text-bc-secondary text-[0.75rem]`}>
                    {order.country ?? '—'}
                  </td>

                  {/* Items count */}
                  <td className={`${td} hidden sm:table-cell text-center text-bc-secondary text-[0.78rem]`}>
                    {order.order_items?.length ?? 0}
                  </td>

                  {/* Total */}
                  <td className={`${td} text-right font-medium whitespace-nowrap`}>
                    {fmt(order.total, order.currency)}
                  </td>

                  {/* Payment status */}
                  <td className={`${td} hidden lg:table-cell`}>
                    <StatusPill value={order.payment_status} colorMap={PAY_COLORS} />
                  </td>

                  {/* Fulfilment status */}
                  <td className={td}>
                    <StatusPill value={order.shipping_status} colorMap={SHIP_COLORS} />
                  </td>

                  {/* Tracking number */}
                  <td className={`${td} hidden xl:table-cell font-mono text-[0.7rem] text-bc-secondary`}>
                    {order.tracking_number ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Row count */}
      {filtered.length > 0 && (
        <p className="font-ui text-[0.65rem] text-bc-secondary/40 mt-3 text-right">
          {filtered.length} of {orders.length} orders
        </p>
      )}
    </div>
  );
}
