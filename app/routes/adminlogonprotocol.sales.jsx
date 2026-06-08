import {useState, useMemo} from 'react';
import {useLoaderData, useActionData, Form, useNavigation, useNavigate} from '@remix-run/react';
import {json} from '@shopify/remix-oxygen';
import {getSupabase} from '~/lib/supabase.server';
import {COUNTRY_CONFIG} from '~/lib/country-config';
import {requireAdminUser, getCountryFilter} from '~/lib/auth.server';

const fmtMoney = n => '$' + Number(n || 0).toFixed(2);

export const meta = () => [{title: 'Sales | BlackCrow Admin'}];

/* ── Server ──────────────────────────────────────────────── */
export async function loader({request, context}) {
  const user = await requireAdminUser(request);
  const cf   = getCountryFilter(user);
  const sb = getSupabase();
  if (!sb) return json({orders: [], configured: false});

  let q = sb
    .from('orders')
    .select(`
      id, order_number, date, status, payment_status, shipping_status,
      refund_status, total, currency, country, source,
      customers (id, name, email),
      order_items (product, variant, quantity, subtotal)
    `);
  if (cf) q = q.eq('country', cf);
  const {data, error} = await q.order('date', {ascending: false});

  if (error) return json({orders: [], configured: true, dbError: error.message});
  return json({orders: data ?? [], configured: true});
}

export async function action({request}) {
  const sb = getSupabase();
  if (!sb) return json({error: 'Supabase not configured.'}, {status: 500});

  const fd     = await request.formData();
  const intent = fd.get('_action');

  if (intent === 'create_order') {
    let customerId = null;
    let existingCustomer = null; // tracks whether customer was pre-existing
    const email   = (fd.get('email') || '').trim();
    const name    = (fd.get('customer_name') || 'Unknown').trim();
    const country = fd.get('country') || 'Australia';

    if (email) {
      const {data: existing} = await sb.from('customers').select('id').eq('email', email).maybeSingle();
      existingCustomer = existing;
      if (existing) {
        customerId = existing.id;
      } else {
        const {data: newCust} = await sb.from('customers').insert({name, email, country}).select('id').single();
        customerId = newCust?.id ?? null;
      }
    } else {
      const {data: newCust} = await sb.from('customers').insert({name, country}).select('id').single();
      customerId = newCust?.id ?? null;
    }

    const unitPrice  = Number(fd.get('unit_price') || 0);
    const qty        = Number(fd.get('quantity')   || 1);
    const shipping   = Number(fd.get('shipping_cost') || 0);
    const gross      = (unitPrice * qty) + shipping;
    const countryCfg = COUNTRY_CONFIG[country] ?? COUNTRY_CONFIG.Australia;
    const tax        = +(gross * countryCfg.taxRate / (1 + countryCfg.taxRate)).toFixed(2);
    const subtotal   = unitPrice * qty;
    const total      = +gross.toFixed(2);
    const currency   = fd.get('currency') || countryCfg.currency || 'AUD';

    const {data: lastOrd} = await sb.from('orders').select('order_number')
      .like('order_number', 'BCA-ORD-%').order('created_at', {ascending: false}).limit(1);
    const seq         = Number(lastOrd?.[0]?.order_number?.match(/(\d+)$/)?.[1] ?? 0) + 1;
    const orderNumber = `BCA-ORD-${String(seq).padStart(7, '0')}`;

    const {data: newOrder, error: oErr} = await sb.from('orders').insert({
      order_number:    orderNumber,
      customer_id:     customerId,
      date:            fd.get('date') || new Date().toISOString().split('T')[0],
      status:          fd.get('status')          || 'processing',
      payment_status:  fd.get('payment_status')  || 'pending',
      shipping_status: fd.get('shipping_status') || 'pending',
      subtotal, shipping_cost: shipping, tax, total,
      currency,
      country,
      source: 'admin',
    }).select('id').single();

    if (oErr) return json({error: oErr.message}, {status: 400});

    const product = fd.get('product') || 'Unknown';
    const variant = fd.get('variant') || null;
    if (product && unitPrice) {
      await sb.from('order_items').insert({
        order_id: newOrder.id, product, variant, quantity: qty, unit_price: unitPrice, subtotal,
      });
    }

    // ── CRM update after order created ──
    if (customerId && newOrder) {
      const {data: cusData} = await sb.from('customers').select('total_orders,lifetime_spend').eq('id', customerId).single();
      if (cusData) {
        const newOrders = (cusData.total_orders || 0) + 1;
        const newSpend  = Number(cusData.lifetime_spend || 0) + total;
        const newAvg    = newSpend / newOrders;
        const orderDate = fd.get('date') || new Date().toISOString().split('T')[0];
        await sb.from('customers').update({
          total_orders:        newOrders,
          lifetime_spend:      newSpend,
          average_order_value: +newAvg.toFixed(2),
          last_order_date:     orderDate,
          updated_at:          new Date().toISOString(),
        }).eq('id', customerId);

        // Auto-status (replicate SQL logic in JS)
        const {data: cusStatus} = await sb.from('customers').select('status,refund_count').eq('id', customerId).single();
        if (cusStatus && !['Trade Account','Trade Lead','Suspended'].includes(cusStatus.status)) {
          let newStatus = 'Lead';
          if ((cusStatus.refund_count || 0) >= 2) newStatus = 'Refund Risk';
          else if (newSpend >= 2000) newStatus = 'VIP';
          else if (newOrders >= 2)   newStatus = 'Repeat Buyer';
          else if (newOrders === 1)  newStatus = 'Active';
          await sb.from('customers').update({status: newStatus}).eq('id', customerId);
        }

        // Log communication
        const isNewCustomer = !email || !existingCustomer;
        await sb.from('customer_communications').insert({
          customer_id:        customerId,
          communication_type: isNewCustomer ? 'Customer Created' : 'Order Created',
          description:        isNewCustomer
            ? `Customer created from order ${orderNumber}`
            : `New order ${orderNumber} — ${fmtMoney(total)}`,
          related_order_id: newOrder.id,
          created_by:       'System',
        });
      }
    }

    return json({ok: true});
  }

  if (intent === 'delete_order') {
    const {error} = await sb.from('orders').delete().eq('id', fd.get('id'));
    if (error) return json({error: error.message}, {status: 400});
    return json({ok: true});
  }

  return json({error: 'Unknown action'}, {status: 400});
}

/* ── Constants ───────────────────────────────────────────── */
const COUNTRIES   = ['Australia','USA','UK','Canada','Sweden','Germany','France','Japan','New Zealand','Other'];
const PRODUCTS    = ['Crimson','Phantom','Titan','Arctic'];
const CURRENCIES  = ['AUD','USD','GBP','CAD','SEK','EUR','JPY','NZD'];
const STATUSES    = ['processing','fulfilled','cancelled','refunded'];
const PAY_STATUSES  = ['pending','paid','failed','refunded'];
const SHIP_STATUSES = ['pending','processing','shipped','delivered','returned'];

const STATUS_COLOR = {
  fulfilled:'#22c55e', processing:'#f59e0b', cancelled:'#6b7280', refunded:'#e52b2b',
  paid:'#22c55e', pending:'#f59e0b', failed:'#e52b2b',
  shipped:'#3b82f6', delivered:'#22c55e', returned:'#e52b2b',
};

/* ── Helpers ─────────────────────────────────────────────── */
function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function today()        { return localDate(); }
function startOfWeek()  { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return localDate(d); }
function startOfMonth() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; }
function fmtDate(d)     { return d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', {day:'numeric', month:'short', year:'numeric'}) : '—'; }
function currSym(c)     { return {GBP:'£',EUR:'€',JPY:'¥',SEK:'kr'}[c] ?? '$'; }
function fmt(n, cur)    { const c = cur ?? 'AUD'; const num = Number(n).toLocaleString('en-AU', {minimumFractionDigits:2, maximumFractionDigits:2}); return c === 'SEK' ? `${num}\u00a0kr` : `${currSym(c)}${num}`; }
function netRevenue(r)  { return (r.status === 'cancelled' || r.status === 'refunded') ? -Number(r.total) : Number(r.total); }
function formatHeaderDate() {
  const d = new Date();
  const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/* ── Sub-components ──────────────────────────────────────── */
function StatusPill({value}) {
  const color = STATUS_COLOR[value] ?? '#6b7280';
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full font-ui text-[0.62rem] font-medium uppercase tracking-wide"
      style={{background: color + '1a', color}}>
      {value}
    </span>
  );
}

function KpiCard({label, value, sub, accent}) {
  return (
    <div className="bg-bc-card rounded-[20px] p-5 flex flex-col gap-3 border border-bc-divider overflow-hidden">
      <span className="font-ui text-[0.7rem] font-medium tracking-[0.12em] uppercase text-bc-secondary">{label}</span>
      <p className="font-display text-[1.6rem] sm:text-[2.4rem] leading-none text-white truncate">{value}</p>
      {sub && <p className="font-ui text-[0.72rem] text-bc-secondary">{sub}</p>}
      <div className="h-[2px] rounded-full mt-auto" style={{background: accent, opacity: 0.6}} />
    </div>
  );
}

function CountryCard({country, revenue, orders, aov}) {
  const CODES = {Australia:'AU', USA:'US', UK:'GB', Canada:'CA', Sweden:'SE'};
  return (
    <div className="bg-bc-card rounded-[20px] p-5 border border-bc-divider flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <span className="font-ui text-[0.6rem] font-bold tracking-widest text-bc-secondary bg-white/[0.06] border border-white/10 rounded-[4px] px-1.5 py-0.5 shrink-0">{CODES[country] ?? '—'}</span>
        <span className="font-ui text-[0.82rem] text-white font-medium">{country}</span>
      </div>
      <div className="flex flex-col gap-2">
        {[['Revenue', fmt(revenue)], ['Orders', orders], ['Avg Order', fmt(aov)]].map(([k, v]) => (
          <div key={k} className="flex justify-between items-center">
            <span className="font-ui text-[0.68rem] tracking-[0.1em] uppercase text-bc-secondary">{k}</span>
            <span className={`font-ui text-[0.82rem] ${k === 'Avg Order' ? 'text-bc-red' : 'text-white'} font-medium`}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FilterBar({filters, onChange}) {
  const cls = 'bg-bc-card border border-bc-divider rounded-[10px] px-3 py-2 font-ui text-[0.78rem] text-white focus:outline-none focus:border-bc-red transition-colors';
  const lbl = 'flex flex-col gap-1';
  const sp  = 'font-ui text-[0.62rem] tracking-[0.1em] uppercase text-bc-secondary';
  const hasFilters = filters.from || filters.to || filters.country || filters.product || filters.status;
  return (
    <div className="flex flex-wrap gap-3 items-end">
      <label className={lbl}><span className={sp}>From</span>
        <input type="date" value={filters.from} onChange={e => onChange('from', e.target.value)} className={`${cls} min-w-[130px]`} /></label>
      <label className={lbl}><span className={sp}>To</span>
        <input type="date" value={filters.to} onChange={e => onChange('to', e.target.value)} className={`${cls} min-w-[130px]`} /></label>
      <label className={lbl}><span className={sp}>Country</span>
        <select value={filters.country} onChange={e => onChange('country', e.target.value)} className={`${cls} min-w-[130px]`}>
          <option value="">All</option>{COUNTRIES.map(c => <option key={c}>{c}</option>)}</select></label>
      <label className={lbl}><span className={sp}>Product</span>
        <select value={filters.product} onChange={e => onChange('product', e.target.value)} className={`${cls} min-w-[120px]`}>
          <option value="">All</option>{PRODUCTS.map(p => <option key={p}>{p}</option>)}</select></label>
      <label className={lbl}><span className={sp}>Status</span>
        <select value={filters.status} onChange={e => onChange('status', e.target.value)} className={`${cls} min-w-[130px]`}>
          <option value="">All</option>{STATUSES.map(s => <option key={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}</select></label>
      {hasFilters && (
        <div className="flex items-end">
          <button onClick={() => onChange('__reset__', '')}
            className="font-ui text-[0.72rem] text-bc-secondary hover:text-white transition-colors px-3 py-2 border border-bc-divider rounded-[10px] hover:border-bc-red">
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

function NewOrderModal({onClose, actionError, isPending}) {
  const [country,      setCountry]      = useState('Australia');
  const [unitPriceStr, setUnitPriceStr] = useState('');
  const [qtyStr,       setQtyStr]       = useState('1');
  const [shippingStr,  setShippingStr]  = useState('');

  const cfg      = COUNTRY_CONFIG[country] ?? COUNTRY_CONFIG.Australia;
  const currency = cfg.currency;
  const sym      = currSym(currency);

  const unitPrice = parseFloat(unitPriceStr) || 0;
  const qty       = Math.max(1, parseInt(qtyStr) || 1);
  const shipping  = parseFloat(shippingStr)  || 0;
  const gross     = (unitPrice * qty) + shipping;
  const taxAmt    = cfg.taxRate > 0 ? +(gross * cfg.taxRate / (1 + cfg.taxRate)).toFixed(2) : 0;
  const excl      = +(gross - taxAmt).toFixed(2);
  const fmtAmt    = (v) => currency === 'SEK' ? `${Number(v).toFixed(2)}\u00a0kr` : `${sym}${Number(v).toFixed(2)}`;

  const inp = 'w-full bg-bc-surface border border-bc-divider rounded-[10px] px-3 py-2 font-ui text-[0.82rem] text-white placeholder-bc-secondary/40 focus:outline-none focus:border-bc-red transition-colors';
  const lbl = 'flex flex-col gap-1';
  const sp  = 'font-ui text-[0.62rem] tracking-[0.1em] uppercase text-bc-secondary';
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{background:'rgba(0,0,0,0.65)', backdropFilter:'blur(4px)'}}>
      <div className="bg-bc-bg border border-bc-divider rounded-[24px] w-full max-w-lg shadow-2xl overflow-hidden flex flex-col" style={{maxHeight:'min(90vh,90dvh)'}}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-bc-divider shrink-0">
          <p className="font-display text-[1.4rem] text-white leading-none">NEW ORDER</p>
          <button onClick={onClose} className="text-bc-secondary hover:text-white transition-colors p-1">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <Form method="post" onSubmit={onClose} className="px-6 py-5 flex flex-col gap-4 overflow-y-auto min-h-0">
          <input type="hidden" name="_action" value="create_order" />
          <input type="hidden" name="currency" value={currency} />
          <p className="font-ui text-[0.7rem] uppercase tracking-[0.1em] text-bc-secondary">Customer</p>
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
            <label className={`${lbl} col-span-1 min-[420px]:col-span-2`}><span className={sp}>Full Name *</span>
              <input name="customer_name" required placeholder="James Harrington" className={inp} /></label>
            <label className={lbl}><span className={sp}>Email</span>
              <input name="email" type="email" placeholder="james@example.com" className={inp} /></label>
            <label className={lbl}><span className={sp}>Country</span>
              <select name="country" value={country} onChange={e => setCountry(e.target.value)} className={inp}>
                {COUNTRIES.map(c => <option key={c}>{c}</option>)}</select></label>
          </div>
          <div className="h-px bg-bc-divider" />
          <p className="font-ui text-[0.7rem] uppercase tracking-[0.1em] text-bc-secondary">Order Item</p>
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
            <label className={lbl}><span className={sp}>Product</span>
              <select name="product" defaultValue="Crimson" className={inp}>
                {PRODUCTS.map(p => <option key={p}>{p}</option>)}</select></label>
            <label className={lbl}><span className={sp}>Variant</span>
              <input name="variant" placeholder="Standard" className={inp} /></label>
            <label className={lbl}><span className={sp}>Quantity</span>
              <input name="quantity" type="number" min="1" value={qtyStr}
                onChange={e => setQtyStr(e.target.value)} required className={inp} /></label>
            <label className={lbl}>
              <span className={sp}>Unit Price (incl. {cfg.taxLabel})</span>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-ui text-[0.82rem] text-bc-secondary/60 pointer-events-none select-none">{sym}</span>
                <input name="unit_price" type="text" inputMode="decimal"
                  value={unitPriceStr} onChange={e => setUnitPriceStr(e.target.value)}
                  placeholder="0.00" required className={inp + ' pl-8'} />
              </div>
            </label>
            <label className={`${lbl} col-span-1 min-[420px]:col-span-2`}>
              <span className={sp}>Shipping / Freight</span>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-ui text-[0.82rem] text-bc-secondary/60 pointer-events-none select-none">{sym}</span>
                <input name="shipping_cost" type="text" inputMode="decimal"
                  value={shippingStr} onChange={e => setShippingStr(e.target.value)}
                  placeholder="0.00" className={inp + ' pl-8'} />
              </div>
            </label>
          </div>
          {/* Auto-calculated tax breakdown */}
          <div className="bg-bc-surface border border-bc-divider rounded-[12px] p-3 space-y-1.5">
            <p className={sp + ' mb-1.5'}>
              {cfg.taxLabel} INCLUSIVE BREAKDOWN · {currency}
              {cfg.taxRate > 0 && <span className="ml-1 opacity-50">({(cfg.taxRate * 100).toFixed(0)}%)</span>}
            </p>
            {cfg.taxRate > 0 ? (
              <>
                {([
                  [`Items (${qty} × ${fmtAmt(unitPrice)})`, unitPrice * qty],
                  ['Shipping', shipping],
                  ['Gross Total', gross],
                  [`${cfg.taxLabel} extracted`, taxAmt],
                  ['Excl. tax', excl],
                ]).map(([label, val]) => (
                  <div key={label} className="flex justify-between items-center">
                    <span className="font-ui text-[0.68rem] text-bc-secondary">{label}</span>
                    <span className="font-ui text-[0.78rem] font-medium text-white">{fmtAmt(val)}</span>
                  </div>
                ))}
              </>
            ) : (
              <div className="flex justify-between items-center">
                <span className="font-ui text-[0.68rem] text-bc-secondary">Total (tax exempt)</span>
                <span className="font-ui text-[0.78rem] font-medium text-white">{fmtAmt(gross)}</span>
              </div>
            )}
          </div>
          <label className={lbl}><span className={sp}>Date</span>
            <input name="date" type="date" defaultValue={today()} className={inp} /></label>
          <div className="h-px bg-bc-divider" />
          <p className="font-ui text-[0.7rem] uppercase tracking-[0.1em] text-bc-secondary">Status</p>
          <div className="grid grid-cols-1 xs:grid-cols-3 sm:grid-cols-3 gap-3">
            {[['status','Order',STATUSES],['payment_status','Payment',PAY_STATUSES],['shipping_status','Shipping',SHIP_STATUSES]].map(([n,l,opts]) => (
              <label key={n} className={lbl}><span className={sp}>{l}</span>
                <select name={n} defaultValue={opts[0]} className={inp}>
                  {opts.map(o => <option key={o}>{o}</option>)}</select></label>
            ))}
          </div>
          {actionError && <p className="font-ui text-[0.75rem] text-bc-red">{actionError}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 font-ui text-[0.78rem] text-bc-secondary border border-bc-divider rounded-[10px] py-2.5 hover:text-white transition-colors">
              Cancel
            </button>
            <button type="submit"
              className="flex-1 font-ui text-[0.78rem] font-medium bg-bc-red text-white rounded-[10px] py-2.5 hover:bg-bc-red/80 transition-colors">
              {isPending ? 'Creating…' : 'Create Order'}
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}

function DeleteModal({order, onClose, isPending}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{background:'rgba(0,0,0,0.65)', backdropFilter:'blur(4px)'}}>
      <div className="bg-bc-bg border border-bc-divider rounded-[24px] w-full max-w-sm shadow-2xl p-6">
        <p className="font-display text-[1.4rem] text-white leading-none mb-2">DELETE ORDER</p>
        <p className="font-ui text-[0.8rem] text-bc-secondary mb-5">
          Permanently delete <strong className="text-white">{order.order_number}</strong>? This removes all items, notes, refunds and logs.
        </p>
        <Form method="post" onSubmit={onClose} className="flex gap-3">
          <input type="hidden" name="_action" value="delete_order" />
          <input type="hidden" name="id" value={order.id} />
          <button type="button" onClick={onClose}
            className="flex-1 font-ui text-[0.78rem] text-bc-secondary border border-bc-divider rounded-[10px] py-2.5 hover:text-white transition-colors">
            Cancel
          </button>
          <button type="submit"
            className="flex-1 font-ui text-[0.78rem] font-medium bg-bc-red text-white rounded-[10px] py-2.5 hover:bg-bc-red/80 transition-colors">
            {isPending ? 'Deleting…' : 'Delete'}
          </button>
        </Form>
      </div>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────── */
export default function SalesPage() {
  const {orders, configured, dbError} = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const navigate   = useNavigate();
  const isPending  = navigation.state !== 'idle';

  const [modal, setModal]     = useState(null);
  const [filters, setFilters] = useState({from:'', to:'', country:'', product:'', status:''});

  function handleFilter(key, val) {
    if (key === '__reset__') { setFilters({from:'', to:'', country:'', product:'', status:''}); return; }
    setFilters(f => ({...f, [key]: val}));
  }

  const kpis = useMemo(() => {
    const todayStr = today(); const weekStr = startOfWeek(); const monthStr = startOfMonth();
    const active = r => r.status === 'fulfilled' || r.status === 'processing';
    const todaySales = orders.filter(r => r.date === todayStr);
    return {
      revToday:    todaySales.reduce((s, r) => s + netRevenue(r), 0),
      revWeek:     orders.filter(r => r.date >= weekStr).reduce((s, r)  => s + netRevenue(r), 0),
      revMonth:    orders.filter(r => r.date >= monthStr).reduce((s, r) => s + netRevenue(r), 0),
      ordersToday: todaySales.filter(active).length,
    };
  }, [orders]);

  const countryStats = useMemo(() => ['Australia','USA','UK','Canada','Sweden'].map(country => {
    const rows = orders.filter(r => r.country === country);
    const revenue = rows.reduce((s, r) => s + netRevenue(r), 0);
    const count   = rows.filter(r => r.status === 'fulfilled' || r.status === 'processing').length;
    return {country, revenue, orders: count, aov: count ? revenue / count : 0};
  }), [orders]);

  const filtered = useMemo(() => orders.filter(r => {
    if (filters.from    && r.date < filters.from)      return false;
    if (filters.to      && r.date > filters.to)        return false;
    if (filters.country && r.country !== filters.country) return false;
    if (filters.product && !r.order_items?.some(i => i.product === filters.product)) return false;
    if (filters.status  && r.status  !== filters.status)  return false;
    return true;
  }), [orders, filters]);

  const tableRevenue = useMemo(() => filtered.reduce((s, r) => s + netRevenue(r), 0), [filtered]);

  const th = 'font-ui text-[0.6rem] tracking-[0.1em] uppercase text-bc-secondary text-left py-3 px-3 whitespace-nowrap';
  const td = 'font-ui text-[0.78rem] text-white py-3 px-3';

  return (
    <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-[1400px] mx-auto">
      <div className="mb-8">
        <h1 className="font-display text-[2.2rem] sm:text-[2.8rem] text-white leading-none tracking-wide">SALES</h1>
        <p className="font-ui text-[0.78rem] text-bc-secondary mt-1">{formatHeaderDate()} · BlackCrow Automotive</p>
      </div>

      {!configured && (
        <div className="mb-6 bg-[#f59e0b]/10 border border-[#f59e0b]/30 rounded-[16px] px-5 py-4 flex items-start gap-3">
          <svg className="text-[#f59e0b] shrink-0 mt-[1px]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <p className="font-ui text-[0.78rem] text-bc-secondary">
            Run <code className="text-white">supabase/crm-schema.sql</code> in Supabase SQL Editor. Ensure <code className="text-white">SUPABASE_URL</code> and <code className="text-white">SUPABASE_ANON_KEY</code> are in <code className="text-white">.env</code>.
          </p>
        </div>
      )}
      {dbError && (
        <div className="mb-6 bg-bc-red/10 border border-bc-red/30 rounded-[16px] px-5 py-3">
          <p className="font-ui text-[0.78rem] text-bc-red">{dbError}</p>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <KpiCard label="Revenue Today"      value={fmt(kpis.revToday)}        sub={`${kpis.ordersToday} orders`} accent="#e52b2b" />
        <KpiCard label="Revenue This Week"  value={fmt(kpis.revWeek)}         sub="rolling 7 days"               accent="#7c6bff" />
        <KpiCard label="Revenue This Month" value={fmt(kpis.revMonth)}        sub={new Date().toLocaleDateString('en-AU', {month:'long',year:'numeric'})} accent="#22c55e" />
        <KpiCard label="Orders Today"       value={String(kpis.ordersToday)}  sub={fmt(kpis.revToday)+' total'}  accent="#f59e0b" />
      </div>

      {/* Country performance */}
      <div className="mb-6">
        <p className="font-ui text-[0.7rem] tracking-[0.12em] uppercase text-bc-secondary mb-3">Country Performance</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
          {countryStats.map(c => <CountryCard key={c.country} {...c} />)}
        </div>
      </div>

      {/* Filter + action bar */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-4">
        <FilterBar filters={filters} onChange={handleFilter} />
        <button onClick={() => setModal('create')}
          className="self-start lg:self-auto inline-flex items-center gap-2 font-ui text-[0.78rem] font-medium bg-bc-red text-white px-4 py-2.5 rounded-[10px] hover:bg-bc-red/80 transition-colors shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Order
        </button>
      </div>

      {/* Table */}
      <div className="bg-bc-card border border-bc-divider rounded-[20px] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-bc-divider">
          <span className="font-ui text-[0.72rem] text-bc-secondary">
            <strong className="text-white">{filtered.length}</strong> ORDERS · Click a row to view details
          </span>
          <span className="font-display text-[1.2rem] text-white leading-none">{fmt(tableRevenue)}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]" style={{tableLayout:'fixed'}}>
            <colgroup>
              <col style={{width:'100px'}} />{/* Date */}
              <col style={{width:'130px'}} />{/* Order # */}
              <col style={{width:'180px'}} />{/* Customer */}
              <col style={{width:'90px'}} />{/* Country */}
              <col style={{width:'140px'}} />{/* Products */}
              <col style={{width:'100px'}} />{/* Total */}
              <col style={{width:'90px'}} />{/* Order */}
              <col style={{width:'90px'}} />{/* Payment */}
              <col style={{width:'90px'}} />{/* Shipping */}
              <col style={{width:'44px'}} />{/* Delete */}
            </colgroup>
            <thead>
              <tr className="border-b border-bc-divider">
                <th className={th}>Date</th>
                <th className={th}>Order #</th>
                <th className={th}>Customer</th>
                <th className={th}>Country</th>
                <th className={th}>Products</th>
                <th className={`${th} text-right`}>Total</th>
                <th className={th}>Order</th>
                <th className={th}>Payment</th>
                <th className={th}>Shipping</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="text-center font-ui text-[0.78rem] text-bc-secondary py-10">
                  {orders.length === 0 ? 'No orders yet — create your first order.' : 'No orders match the current filters.'}
                </td></tr>
              )}
              {filtered.map(order => {
                const products = [...new Set((order.order_items ?? []).map(i => i.product))].join(', ') || '—';
                return (
                  <tr key={order.id}
                    onClick={() => navigate(`/adminlogonprotocol/orders/${order.id}`)}
                    className="border-b border-bc-divider/50 hover:bg-white/[0.025] transition-colors cursor-pointer group">
                    <td className={`${td} text-bc-secondary`}>{fmtDate(order.date)}</td>
                    <td className={`${td} font-medium`}>
                      <span className="text-bc-red group-hover:underline">{order.order_number}</span>
                    </td>
                    <td className={td}>
                      <p className="text-white leading-snug">{order.customers?.name ?? '—'}</p>
                      {order.customers?.email && <p className="text-bc-secondary text-[0.68rem]">{order.customers.email}</p>}
                    </td>
                    <td className={`${td} text-bc-secondary`}>{order.country ?? '—'}</td>
                    <td className={`${td} text-bc-secondary max-w-[160px] truncate`} title={products}>{products}</td>
                    <td className={`${td} text-right font-medium`}>
                      {fmt(order.total, order.currency)}<span className="text-bc-secondary text-[0.65rem] ml-1">{order.currency}</span>
                    </td>
                    <td className={td}><StatusPill value={order.status} /></td>
                    <td className={td}><StatusPill value={order.payment_status} /></td>
                    <td className={td}><StatusPill value={order.shipping_status} /></td>
                    <td className={td} onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => setModal({type:'delete', order})}
                        className="text-bc-secondary hover:text-bc-red transition-colors p-1.5 opacity-0 group-hover:opacity-100 rounded-[6px] hover:bg-bc-red/10">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {modal === 'create' && (
        <NewOrderModal onClose={() => setModal(null)} actionError={actionData?.error} isPending={isPending} />
      )}
      {modal?.type === 'delete' && (
        <DeleteModal order={modal.order} onClose={() => setModal(null)} isPending={isPending} />
      )}
    </div>
  );
}
