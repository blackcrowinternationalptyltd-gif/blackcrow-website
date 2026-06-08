import {useState, useMemo, useEffect, useCallback} from 'react';
import {useLoaderData, useNavigate, useFetcher} from '@remix-run/react';
import {json} from '@shopify/remix-oxygen';
import {getSupabase} from '~/lib/supabase.server';
import {requireAdminUser, getCountryFilter} from '~/lib/auth.server';

export const meta = () => [{title: 'Inventory | BlackCrow Admin'}];

/* ─── Constants ──────────────────────────────────────────────── */
const STATUS_CFG = {
  in_stock:     {bg:'bg-[#22c55e]/10', text:'text-[#22c55e]',  label:'In Stock'},
  low_stock:    {bg:'bg-[#f59e0b]/10', text:'text-[#f59e0b]',  label:'Low Stock'},
  out_of_stock: {bg:'bg-bc-red/10',    text:'text-bc-red',      label:'Out of Stock'},
  incoming:     {bg:'bg-[#3b82f6]/10', text:'text-[#60a5fa]',  label:'Incoming'},
  discontinued: {bg:'bg-white/5',      text:'text-bc-secondary',label:'Discontinued'},
};
const SYNC_CFG = {
  unsynced: {bg:'bg-white/5',      text:'text-bc-secondary',label:'Unsynced'},
  synced:   {bg:'bg-[#22c55e]/10', text:'text-[#22c55e]',  label:'Synced'},
  pending:  {bg:'bg-[#f59e0b]/10', text:'text-[#f59e0b]',  label:'Pending'},
  error:    {bg:'bg-bc-red/10',    text:'text-bc-red',      label:'Error'},
};
const MOVEMENT_CFG = {
  initial_stock:     {color:'#22c55e', label:'Initial Stock'},
  manual_adjustment: {color:'#a78bfa', label:'Manual Adjustment'},
  stock_added:       {color:'#22c55e', label:'Stock Added'},
  stock_removed:     {color:'#e52b2b', label:'Stock Removed'},
  sale:              {color:'#e52b2b', label:'Sale'},
  refund_return:     {color:'#f59e0b', label:'Refund Return'},
  transfer_in:       {color:'#3b82f6', label:'Transfer In'},
  transfer_out:      {color:'#60a5fa', label:'Transfer Out'},
  incoming_shipment: {color:'#3b82f6', label:'Incoming Shipment'},
  damage:            {color:'#e52b2b', label:'Damage'},
  lost:              {color:'#e52b2b', label:'Lost'},
};
const COUNTRIES     = ['Australia','USA','UK','Canada','Sweden'];
const ALL_STATUSES  = ['in_stock','low_stock','out_of_stock','incoming','discontinued'];
const ALL_SYNCS     = ['unsynced','synced','pending','error'];
const FILTER_TABS   = [
  {label:'All',          value:'all'},
  {label:'In Stock',     value:'in_stock'},
  {label:'Low Stock',    value:'low_stock'},
  {label:'Out of Stock', value:'out_of_stock'},
  {label:'Incoming',     value:'incoming'},
  {label:'Discontinued', value:'discontinued'},
];
const CURRENCIES = ['USD','AUD','GBP','CAD','SEK'];

/* ─── Helpers ────────────────────────────────────────────────── */
function fmtDT(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-AU', {day:'numeric', month:'short', year:'numeric'});
}
function fmtMoney(n, dec = 2) {
  return `$${Number(n ?? 0).toLocaleString('en-AU', {minimumFractionDigits:dec, maximumFractionDigits:dec})}`;
}
function computeStatus(qty, minLevel, currentStatus) {
  if (currentStatus === 'discontinued') return 'discontinued';
  if (qty === 0) return 'out_of_stock';
  if (qty <= minLevel) return 'low_stock';
  return 'in_stock';
}

/* ─── Loader ─────────────────────────────────────────────────── */
export async function loader({request, context}) {
  const user = await requireAdminUser(request);
  const cf   = getCountryFilter(user);
  const sb = getSupabase();
  if (!sb) return json({rows: [], configured: false, kpis: {}, products: [], allTransfers: [], exchangeRates: {}, ratesDate: null});

  let qInv = sb.from('inventory').select(`
      id, sku, country, location_name,
      stock_on_hand, stock_reserved, incoming_stock,
      minimum_stock_level, cost_per_unit, status,
      sync_status, last_synced_at, updated_at,
      products (id, name, slug, category, price)
    `).order('updated_at', {ascending: false});
  if (cf) qInv = qInv.eq('country', cf);

  const [{data, error}, {data: prodData}, {data: xferData}, ratesJson] = await Promise.all([
    qInv,
    sb.from('products').select('id, name, category, price').order('name'),
    sb.from('stock_transfers').select('*, products(name)').order('created_at', {ascending: false}).limit(200),
    fetch('https://api.frankfurter.app/latest?from=USD&to=AUD,GBP,CAD,SEK')
      .then(r => r.ok ? r.json() : null)
      .catch(() => null),
  ]);

  const exchangeRates = ratesJson?.rates ?? {AUD: 1.55, GBP: 0.79, CAD: 1.36, SEK: 10.50};
  const ratesDate     = ratesJson?.date  ?? null;

  if (error) return json({rows: [], configured: true, kpis: {}, dbError: error.message, products: prodData ?? [], allTransfers: [], exchangeRates, ratesDate});

  const rows = data ?? [];
  const totalOnHand   = rows.reduce((s, r) => s + (r.stock_on_hand  ?? 0), 0);
  const totalReserved = rows.reduce((s, r) => s + (r.stock_reserved ?? 0), 0);
  const kpis = {
    totalUnits:     totalOnHand,
    availableUnits: totalOnHand - totalReserved,
    reservedUnits:  totalReserved,
    incomingUnits:  rows.reduce((s, r) => s + (r.incoming_stock ?? 0), 0),
    lowStockItems:  rows.filter(r => r.status === 'low_stock' || r.status === 'out_of_stock').length,
    inventoryValue: rows.reduce((s, r) => s + (r.stock_on_hand ?? 0) * Number(r.cost_per_unit ?? 0), 0),
  };
  return json({rows, configured: true, kpis, products: prodData ?? [], allTransfers: xferData ?? [], exchangeRates, ratesDate});
}

/* ─── Action ─────────────────────────────────────────────────── */
export async function action({request}) {
  const sb = getSupabase();
  if (!sb) return json({error: 'Supabase not configured'}, {status: 503});

  const fd     = await request.formData();
  const intent = fd.get('_action');
  const iid    = fd.get('inventory_id');

  const getInv = async () => {
    const {data} = await sb.from('inventory')
      .select('stock_on_hand, stock_reserved, incoming_stock, minimum_stock_level, cost_per_unit, product_id, country, status')
      .eq('id', iid).single();
    return data;
  };

  const logMovement = async (inv, type, qty, prevStock, newStock, reason = null, refType = null, refId = null) => {
    await sb.from('inventory_movements').insert({
      inventory_id:   iid,
      product_id:     inv.product_id,
      movement_type:  type,
      quantity:       qty,
      previous_stock: prevStock,
      new_stock:      newStock,
      reason,
      reference_type: refType,
      reference_id:   refId,
      created_by:     'Admin',
    });
  };

  /* ── edit_inventory ── */
  if (intent === 'edit_inventory') {
    const updates = {updated_at: new Date().toISOString()};
    const locName  = fd.get('location_name');
    const minLevel = fd.get('minimum_stock_level');
    const cost     = fd.get('cost_per_unit');
    const status   = fd.get('status');
    if (locName  !== null) updates.location_name       = locName || null;
    if (minLevel !== null) updates.minimum_stock_level = Math.max(0, parseInt(minLevel, 10) || 0);
    if (cost     !== null) updates.cost_per_unit       = Math.max(0, parseFloat(cost)    || 0);
    if (status)            updates.status              = status;
    const {error} = await sb.from('inventory').update(updates).eq('id', iid);
    return error ? json({error: error.message}, {status: 400}) : json({ok: true, toast: 'Inventory updated.'});
  }

  /* ── add_stock ── */
  if (intent === 'add_stock') {
    const qty = parseInt(fd.get('quantity') ?? '0', 10);
    if (!qty || qty <= 0) return json({error: 'Enter a valid quantity'}, {status: 400});
    const inv = await getInv();
    if (!inv) return json({error: 'Row not found'}, {status: 404});
    const prev   = inv.stock_on_hand ?? 0;
    const newQty = prev + qty;
    const {error} = await sb.from('inventory').update({
      stock_on_hand: newQty,
      status:        computeStatus(newQty, inv.minimum_stock_level, inv.status),
      updated_at:    new Date().toISOString(),
    }).eq('id', iid);
    if (error) return json({error: error.message}, {status: 400});
    await logMovement(inv, 'stock_added', qty, prev, newQty, fd.get('reason') || null);
    return json({ok: true, toast: `Added ${qty} units.`});
  }

  /* ── adjust_stock ── */
  if (intent === 'adjust_stock') {
    const newQty = parseInt(fd.get('new_quantity') ?? '0', 10);
    if (newQty < 0) return json({error: 'Quantity cannot be negative'}, {status: 400});
    const inv = await getInv();
    if (!inv) return json({error: 'Row not found'}, {status: 404});
    const prev  = inv.stock_on_hand ?? 0;
    const delta = newQty - prev;
    const {error} = await sb.from('inventory').update({
      stock_on_hand: newQty,
      status:        computeStatus(newQty, inv.minimum_stock_level, inv.status),
      updated_at:    new Date().toISOString(),
    }).eq('id', iid);
    if (error) return json({error: error.message}, {status: 400});
    await sb.from('stock_adjustments').insert({
      inventory_id: iid, before_quantity: prev, after_quantity: newQty,
      reason: fd.get('reason') || null, adjusted_by: 'Admin',
    });
    await logMovement(inv, 'manual_adjustment', delta, prev, newQty, fd.get('reason') || null);
    return json({ok: true, toast: `Stock adjusted: ${prev} → ${newQty}.`});
  }

  /* ── mark_incoming ── */
  if (intent === 'mark_incoming') {
    const qty = parseInt(fd.get('quantity') ?? '0', 10);
    if (!qty || qty <= 0) return json({error: 'Enter a valid quantity'}, {status: 400});
    const inv = await getInv();
    if (!inv) return json({error: 'Row not found'}, {status: 404});
    const {error} = await sb.from('inventory').update({
      incoming_stock: (inv.incoming_stock ?? 0) + qty,
      updated_at:     new Date().toISOString(),
    }).eq('id', iid);
    if (error) return json({error: error.message}, {status: 400});
    const poNum = fd.get('po_number') || null;
    await logMovement(inv, 'incoming_shipment', qty, inv.stock_on_hand ?? 0, inv.stock_on_hand ?? 0,
      poNum ? `PO: ${poNum}` : 'Incoming shipment logged', 'po', poNum);
    return json({ok: true, toast: `Marked ${qty} units incoming.`});
  }

  /* ── receive_incoming ── */
  if (intent === 'receive_incoming') {
    const inv = await getInv();
    if (!inv) return json({error: 'Row not found'}, {status: 404});
    const incoming = inv.incoming_stock ?? 0;
    if (incoming <= 0) return json({error: 'No incoming stock to receive'}, {status: 400});
    const prev   = inv.stock_on_hand ?? 0;
    const newQty = prev + incoming;
    const {error} = await sb.from('inventory').update({
      stock_on_hand:  newQty,
      incoming_stock: 0,
      status:         computeStatus(newQty, inv.minimum_stock_level, inv.status),
      updated_at:     new Date().toISOString(),
    }).eq('id', iid);
    if (error) return json({error: error.message}, {status: 400});
    await logMovement(inv, 'stock_added', incoming, prev, newQty, 'Incoming shipment received');
    return json({ok: true, toast: `Received ${incoming} units into stock.`});
  }

  /* ── transfer_stock ── */
  if (intent === 'transfer_stock') {
    const qty           = parseInt(fd.get('quantity') ?? '0', 10);
    const toDestination = (fd.get('to_destination') ?? '').trim();
    const toCountry     = (fd.get('to_country') ?? '').trim() || null;
    if (!qty || qty <= 0)  return json({error: 'Invalid quantity'}, {status: 400});
    if (!toDestination)    return json({error: 'Enter a destination'}, {status: 400});
    const inv = await getInv();
    if (!inv) return json({error: 'Row not found'}, {status: 404});
    if (qty > inv.stock_on_hand) return json({error: 'Insufficient stock for transfer'}, {status: 400});

    const prev      = inv.stock_on_hand;
    const newSrcQty = prev - qty;
    const {error: srcErr} = await sb.from('inventory').update({
      stock_on_hand: newSrcQty,
      status:        computeStatus(newSrcQty, inv.minimum_stock_level, inv.status),
      updated_at:    new Date().toISOString(),
    }).eq('id', iid);
    if (srcErr) return json({error: srcErr.message}, {status: 400});

    const reason   = fd.get('reason') || null;
    const destLabel = toCountry ? `${toDestination} (${toCountry})` : toDestination;
    await sb.from('stock_transfers').insert({
      product_id: inv.product_id, from_country: inv.country,
      to_country: toCountry ?? toDestination, quantity: qty,
      reason, status: 'completed', transferred_by: 'Admin',
    });
    await logMovement(inv, 'transfer_out', -qty, prev, newSrcQty,
      reason ? `${reason} → ${destLabel}` : `Transfer to ${destLabel}`, 'transfer', destLabel);
    return json({ok: true, toast: `Transferred ${qty} units → ${destLabel}.`});
  }

  /* ── add_inventory ── */
  if (intent === 'add_inventory') {
    const productId  = fd.get('product_id');
    const country    = fd.get('country');
    const locName    = fd.get('location_name') || null;
    const initStock  = Math.max(0, parseInt(fd.get('initial_stock') ?? '0', 10));
    const minLevel   = Math.max(0, parseInt(fd.get('minimum_stock_level') ?? '5', 10));
    const costUnit   = Math.max(0, parseFloat(fd.get('cost_per_unit') ?? '0'));
    if (!productId) return json({error: 'Select a product'}, {status: 400});
    if (!country)   return json({error: 'Select a country'}, {status: 400});
    const {data: existing} = await sb.from('inventory')
      .select('id').eq('product_id', productId).eq('country', country).maybeSingle();
    if (existing) return json({error: 'Entry already exists for this product + country'}, {status: 400});
    const st = computeStatus(initStock, minLevel, 'in_stock');
    const {data: newRow, error: insErr} = await sb.from('inventory').insert({
      product_id: productId, country, location_name: locName,
      stock_on_hand: initStock, minimum_stock_level: minLevel,
      cost_per_unit: costUnit, status: st,
    }).select('id, product_id').single();
    if (insErr) return json({error: insErr.message}, {status: 400});
    if (initStock > 0 && newRow) {
      await sb.from('inventory_movements').insert({
        inventory_id: newRow.id, product_id: newRow.product_id,
        movement_type: 'initial_stock', quantity: initStock,
        previous_stock: 0, new_stock: initStock,
        reason: 'Initial inventory entry', created_by: 'Admin',
      });
    }
    return json({ok: true, toast: 'Inventory entry created.'});
  }

  /* ── delete_inventory ── */
  if (intent === 'delete_inventory') {
    const {error: delErr} = await sb.from('inventory').delete().eq('id', iid);
    if (delErr) return json({error: delErr.message}, {status: 400});
    return json({ok: true, toast: 'Inventory record deleted.'});
  }

  /* ── create_product_inventory ── */
  if (intent === 'create_product_inventory') {
    const pName      = (fd.get('name') ?? '').trim();
    const variant    = (fd.get('variant') ?? '').trim() || null;
    const category   = fd.get('category') || null;
    const costPrice  = Math.max(0, parseFloat(fd.get('cost_price')  ?? '0'));
    const tradePrice = Math.max(0, parseFloat(fd.get('trade_price') ?? '0'));
    const retailPrice= Math.max(0, parseFloat(fd.get('retail_price')    ?? '0'));
    const country    = fd.get('country');
    const locName    = fd.get('location_name') || null;
    const initStock  = Math.max(0, parseInt(fd.get('initial_stock') ?? '0', 10));
    const minLevel   = Math.max(0, parseInt(fd.get('minimum_stock_level') ?? '5', 10));

    if (!pName)   return json({error: 'Product name is required'}, {status: 400});
    if (!country) return json({error: 'Select a country'}, {status: 400});

    const productName = variant ? `${pName} – ${variant}` : pName;
    const slugBase = productName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const {data: existSlug} = await sb.from('products').select('id').eq('slug', slugBase).maybeSingle();
    const slug = existSlug ? `${slugBase}-${Date.now()}` : slugBase;

    const {data: newProduct, error: prodErr} = await sb.from('products').insert({
      name: productName, slug, category,
      price: retailPrice,
      status: 'active', display_order: 999,
    }).select('id').single();
    if (prodErr) return json({error: prodErr.message}, {status: 400});

    const st = computeStatus(initStock, minLevel, 'in_stock');
    const {data: newRow, error: invErr} = await sb.from('inventory').insert({
      product_id: newProduct.id, country, location_name: locName,
      stock_on_hand: initStock, minimum_stock_level: minLevel,
      cost_per_unit: costPrice, status: st,
    }).select('id, product_id').single();
    if (invErr) return json({error: invErr.message}, {status: 400});

    if (initStock > 0 && newRow) {
      await sb.from('inventory_movements').insert({
        inventory_id: newRow.id, product_id: newRow.product_id,
        movement_type: 'initial_stock', quantity: initStock,
        previous_stock: 0, new_stock: initStock,
        reason: 'Initial inventory entry', created_by: 'Admin',
      });
    }
    return json({ok: true, toast: `Product "${productName}" created with inventory entry.`});
  }

  return json({error: 'Unknown action'}, {status: 400});
}

/* ─── Shared UI ──────────────────────────────────────────────── */
function StatusPill({status}) {
  const c = STATUS_CFG[status] ?? {bg:'bg-white/10', text:'text-bc-secondary', label: status ?? '—'};
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-ui text-[0.6rem] font-medium uppercase tracking-wide whitespace-nowrap ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}
function SyncPill({sync}) {
  const c = SYNC_CFG[sync] ?? SYNC_CFG.unsynced;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-ui text-[0.6rem] font-medium uppercase tracking-wide whitespace-nowrap ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}
function KpiCard({label, value, accent, active, onClick}) {
  return (
    <button onClick={onClick} className={`bg-bc-card rounded-[20px] p-5 flex flex-col gap-3 border text-left transition-all duration-150 w-full ${
      active ? 'border-bc-red/40 shadow-[0_0_0_1px_rgba(229,43,43,0.15)]' : 'border-bc-divider hover:border-bc-divider/80'
    }`}>
      <span className="font-ui text-[0.65rem] font-medium tracking-[0.12em] uppercase text-bc-secondary leading-tight">{label}</span>
      <p className="font-display text-[2.2rem] leading-none text-white">{value}</p>
      <div className="h-[2px] rounded-full mt-auto" style={{background: accent, opacity: active ? 1 : 0.45}} />
    </button>
  );
}

/* ─── Modal shell ────────────────────────────────────────────── */
function Modal({title, subtitle, onClose, wide, children}) {
  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative z-10 w-full ${wide ? 'max-w-xl' : 'max-w-md'} bg-bc-card border border-bc-divider rounded-[20px] shadow-2xl flex flex-col max-h-[90vh] max-h-[90svh]`}>
        <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-bc-divider shrink-0">
          <div>
            <p key="t" className="font-ui text-[0.65rem] tracking-[0.12em] uppercase text-bc-secondary">{title}</p>
            {subtitle && <p key="s" className="font-ui text-[0.78rem] text-white mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-bc-secondary hover:text-white transition-colors ml-4 mt-0.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5 flex-1">{children}</div>
      </div>
    </div>
  );
}

const inp = 'w-full bg-bc-surface border border-bc-divider rounded-[8px] px-3 py-2 font-ui text-[0.82rem] text-white placeholder-bc-secondary/40 focus:outline-none focus:border-bc-red transition-colors';
const btnPrimary   = 'flex-1 py-2.5 font-ui text-[0.78rem] font-medium bg-bc-red text-white rounded-[10px] hover:bg-bc-red/80 transition-colors disabled:opacity-40';
const btnSecondary = 'flex-1 py-2.5 font-ui text-[0.78rem] border border-bc-divider text-bc-secondary rounded-[10px] hover:text-white hover:border-bc-divider/70 transition-colors';
const fieldLabel   = 'font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary';

function ModalActions({onClose, submitLabel, busy, error}) {
  return (
    <>
      {error && <p className="font-ui text-[0.72rem] text-bc-red mb-3">{error}</p>}
      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
        <button type="submit" disabled={busy} className={btnPrimary}>
          {busy ? '…' : submitLabel}
        </button>
      </div>
    </>
  );
}

/* ─── CostInput ──────────────────────────────────────────────── */
function CostInput({name, label, rates, defaultUsd, defaultCurrency = 'AUD', required}) {
  const [cur, setCur] = useState(defaultCurrency);
  const [raw, setRaw] = useState(
    defaultUsd != null && Number(defaultUsd) > 0
      ? String(Number(defaultUsd).toFixed(2))
      : ''
  );

  const usd = useMemo(() => {
    const n = parseFloat(raw);
    if (!raw || isNaN(n)) return 0;
    if (cur === 'USD') return n;
    return n / (rates[cur] ?? 1);
  }, [raw, cur, rates]);

  return (
    <label className="flex flex-col gap-1.5">
      <span className={fieldLabel}>{label}</span>
      <div className="flex gap-1.5">
        <select value={cur} onChange={e => setCur(e.target.value)}
          className="bg-bc-surface border border-bc-divider rounded-[8px] px-2 py-2 font-ui text-[0.72rem] text-white focus:outline-none focus:border-bc-red appearance-none shrink-0 w-[4.5rem] cursor-pointer">
          {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="number" min="0" step="0.01" placeholder="0.00" required={required}
          value={raw} onChange={e => setRaw(e.target.value)} className={inp} />
      </div>
      <input type="hidden" name={name} value={usd.toFixed(4)} />
      {cur !== 'USD' && raw && !isNaN(parseFloat(raw)) && (
        <p className="font-ui text-[0.62rem] text-bc-secondary/60">
          ≈ USD ${usd.toFixed(2)}
          <span className="ml-2 text-bc-secondary/40">· 1 USD = {(rates[cur] ?? 1).toFixed(3)} {cur}</span>
        </p>
      )}
    </label>
  );
}

/* ─── Edit Modal ─────────────────────────────────────────────── */
function EditModal({row, onClose, onToast, rates}) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== 'idle';
  useEffect(() => {
    if (fetcher.data?.ok) { onToast(fetcher.data.toast); onClose(); }
  }, [fetcher.data]);

  return (
    <Modal title="Edit Inventory Record"
      subtitle={`${row.products?.name ?? '—'} · ${row.country}`}
      onClose={onClose}>
      <fetcher.Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="_action"     value="edit_inventory" />
        <input type="hidden" name="inventory_id" value={row.id} />

        <label className="flex flex-col gap-1.5">
          <span className={fieldLabel}>Location Name</span>
          <input name="location_name" type="text" defaultValue={row.location_name ?? ''}
            placeholder="e.g. Sydney Warehouse" className={inp} />
        </label>

        <div className="grid grid-cols-1 xs:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Min Stock Level</span>
            <input name="minimum_stock_level" type="number" min="0"
              defaultValue={row.minimum_stock_level ?? 5} className={inp} />
          </label>
          <CostInput name="cost_per_unit" label="Cost per Unit (USD)" rates={rates ?? {}} defaultUsd={row.cost_per_unit} defaultCurrency="USD" />
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={fieldLabel}>Status Override</span>
          <select name="status" defaultValue={row.status} className={inp + ' appearance-none'}>
            {ALL_STATUSES.map(s => (
              <option key={s} value={s}>{STATUS_CFG[s]?.label ?? s}</option>
            ))}
          </select>
          <span className="font-ui text-[0.62rem] text-bc-secondary/60">
            Status auto-updates on stock changes unless set to Discontinued.
          </span>
        </label>

        <ModalActions onClose={onClose} submitLabel="Save Changes" busy={busy} error={fetcher.data?.error} />
      </fetcher.Form>
    </Modal>
  );
}

/* ─── Add Stock Modal ────────────────────────────────────────── */
function AddStockModal({row, onClose, onToast}) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== 'idle';
  useEffect(() => {
    if (fetcher.data?.ok) { onToast(fetcher.data.toast); onClose(); }
  }, [fetcher.data]);

  return (
    <Modal title="Add Stock"
      subtitle={`${row.products?.name ?? '—'} · ${row.country}`}
      onClose={onClose}>
      <fetcher.Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="_action"      value="add_stock" />
        <input type="hidden" name="inventory_id" value={row.id} />

        <div className="bg-bc-surface border border-bc-divider rounded-[10px] px-4 py-3">
          <p className={fieldLabel}>Current Stock On Hand</p>
          <p className="font-display text-[2.4rem] leading-none text-white mt-1">{row.stock_on_hand ?? 0}</p>
          <p className="font-ui text-[0.65rem] text-bc-secondary mt-1">
            Available: {(row.stock_on_hand ?? 0) - (row.stock_reserved ?? 0)} · Reserved: {row.stock_reserved ?? 0}
          </p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={fieldLabel}>Quantity to Add</span>
          <input name="quantity" type="number" min="1" placeholder="e.g. 50" required className={inp} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabel}>Reason</span>
          <input name="reason" type="text" placeholder="e.g. Stock replenishment" className={inp} />
        </label>

        <ModalActions onClose={onClose} submitLabel="Add Stock" busy={busy} error={fetcher.data?.error} />
      </fetcher.Form>
    </Modal>
  );
}

/* ─── Adjust Stock Modal ─────────────────────────────────────── */
function AdjustStockModal({row, onClose, onToast}) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== 'idle';
  const [newQty, setNewQty] = useState(String(row.stock_on_hand ?? 0));
  useEffect(() => {
    if (fetcher.data?.ok) { onToast(fetcher.data.toast); onClose(); }
  }, [fetcher.data]);

  const delta = parseInt(newQty || '0', 10) - (row.stock_on_hand ?? 0);

  return (
    <Modal title="Adjust Stock"
      subtitle={`${row.products?.name ?? '—'} · ${row.country}`}
      onClose={onClose}>
      <fetcher.Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="_action"      value="adjust_stock" />
        <input type="hidden" name="inventory_id" value={row.id} />

        <div className="bg-bc-surface border border-bc-divider rounded-[10px] px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="min-w-0">
            <p className={fieldLabel}>Current</p>
            <p className="font-display text-[2rem] leading-none text-white">{row.stock_on_hand ?? 0}</p>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-bc-secondary shrink-0">
            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
          </svg>
          <div className="min-w-0">
            <p className={fieldLabel}>New</p>
            <p className={`font-display text-[2rem] leading-none ${delta > 0 ? 'text-[#22c55e]' : delta < 0 ? 'text-bc-red' : 'text-white'}`}>
              {newQty || '—'}
            </p>
          </div>
          {delta !== 0 && (
            <span className={`sm:ml-auto font-ui text-[0.78rem] font-semibold shrink-0 ${delta > 0 ? 'text-[#22c55e]' : 'text-bc-red'}`}>
              {delta > 0 ? '+' : ''}{delta}
            </span>
          )}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={fieldLabel}>Set New Quantity</span>
          <input name="new_quantity" type="number" min="0" required
            value={newQty} onChange={e => setNewQty(e.target.value)} className={inp} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabel}>Reason for Adjustment</span>
          <input name="reason" type="text" placeholder="e.g. Stock count correction" required className={inp} />
        </label>

        <ModalActions onClose={onClose} submitLabel="Adjust Stock" busy={busy} error={fetcher.data?.error} />
      </fetcher.Form>
    </Modal>
  );
}

/* ─── Mark Incoming Modal ────────────────────────────────────── */
function MarkIncomingModal({row, onClose, onToast}) {
  const fetcher     = useFetcher();
  const rcvFetcher  = useFetcher();
  const busy        = fetcher.state !== 'idle';
  const rcvBusy     = rcvFetcher.state !== 'idle';

  useEffect(() => {
    if (fetcher.data?.ok)    { onToast(fetcher.data.toast);    onClose(); }
    if (rcvFetcher.data?.ok) { onToast(rcvFetcher.data.toast); onClose(); }
  }, [fetcher.data, rcvFetcher.data]);

  return (
    <Modal title="Incoming Shipment"
      subtitle={`${row.products?.name ?? '—'} · ${row.country}`}
      onClose={onClose}>
      <div className="flex flex-col gap-5">

        {/* Receive pending */}
        {(row.incoming_stock ?? 0) > 0 && (
          <div className="bg-[#3b82f6]/8 border border-[#3b82f6]/25 rounded-[12px] p-4">
            <p className="font-ui text-[0.65rem] text-[#60a5fa] uppercase tracking-wide mb-1">Pending Incoming</p>
            <div className="flex items-center justify-between gap-3">
              <p className="font-display text-[1.8rem] text-white leading-none min-w-0 truncate">{row.incoming_stock} <span className="font-ui text-[0.78rem] text-bc-secondary">units</span></p>
              <rcvFetcher.Form method="post">
                <input type="hidden" name="_action"      value="receive_incoming" />
                <input type="hidden" name="inventory_id" value={row.id} />
                <button type="submit" disabled={rcvBusy}
                  className="px-4 py-2 bg-[#3b82f6] text-white font-ui text-[0.75rem] font-medium rounded-[8px] hover:bg-[#3b82f6]/80 transition-colors disabled:opacity-40 whitespace-nowrap">
                  {rcvBusy ? '…' : 'Receive All'}
                </button>
              </rcvFetcher.Form>
            </div>
            {rcvFetcher.data?.error && (
              <p className="font-ui text-[0.7rem] text-bc-red mt-2">{rcvFetcher.data.error}</p>
            )}
          </div>
        )}

        {/* Log new incoming */}
        <div>
          <p className={fieldLabel + ' mb-3'}>Log New Incoming Shipment</p>
          <fetcher.Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="_action"      value="mark_incoming" />
            <input type="hidden" name="inventory_id" value={row.id} />
            <label className="flex flex-col gap-1.5">
              <span className={fieldLabel}>Incoming Quantity</span>
              <input name="quantity" type="number" min="1" placeholder="e.g. 200" required className={inp} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={fieldLabel}>PO / Reference Number</span>
              <input name="po_number" type="text" placeholder="e.g. PO-2026-001" className={inp} />
            </label>
            {fetcher.data?.error && (
              <p className="font-ui text-[0.72rem] text-bc-red">{fetcher.data.error}</p>
            )}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
              <button type="submit" disabled={busy} className={btnPrimary}>
                {busy ? '…' : 'Mark Incoming'}
              </button>
            </div>
          </fetcher.Form>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Transfer Modal ─────────────────────────────────────────── */
function TransferModal({row, onClose, onToast}) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== 'idle';
  useEffect(() => {
    if (fetcher.data?.ok) { onToast(fetcher.data.toast); onClose(); }
  }, [fetcher.data]);

  return (
    <Modal title="Transfer Stock"
      subtitle={`${row.products?.name ?? '—'} · from ${row.country}`}
      onClose={onClose}>
      <fetcher.Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="_action"      value="transfer_stock" />
        <input type="hidden" name="inventory_id" value={row.id} />

        <div className="bg-bc-surface border border-bc-divider rounded-[10px] px-4 py-3">
          <p className={fieldLabel}>Available to Transfer (From {row.country})</p>
          <p className="font-display text-[2rem] leading-none text-white mt-1">
            {(row.stock_on_hand ?? 0) - (row.stock_reserved ?? 0)} <span className="font-ui text-[0.75rem] text-bc-secondary">of {row.stock_on_hand ?? 0}</span>
          </p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={fieldLabel}>Transfer Destination</span>
          <input name="to_destination" type="text" required
            placeholder="e.g. Amazon FBA, LA Warehouse, Retail Floor…" className={inp} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabel}>Country <span className="normal-case text-bc-secondary/50">(optional)</span></span>
          <select name="to_country" className={inp + ' appearance-none'}>
            <option value="">— Select country —</option>
            {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabel}>Quantity to Transfer</span>
          <input name="quantity" type="number" min="1" max={row.stock_on_hand ?? 0}
            placeholder={`Max ${row.stock_on_hand ?? 0}`} required className={inp} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabel}>Reason / Notes</span>
          <input name="reason" type="text" placeholder="e.g. Rebalancing stock, FBA prep…" className={inp} />
        </label>

        <ModalActions onClose={onClose} submitLabel="Transfer Stock" busy={busy} error={fetcher.data?.error} />
      </fetcher.Form>
    </Modal>
  );
}

/* ─── Add Inventory Modal ────────────────────────────────────── */
function AddInventoryModal({products, onClose, onToast, rates}) {
  const fetcher = useFetcher();
  const busy    = fetcher.state !== 'idle';
  const [mode, setMode]       = useState('existing');
  const [tradePrice, setTrade]  = useState('');
  const [retailPrice,setRetail] = useState('');

  useEffect(() => {
    if (fetcher.data?.ok) { onToast(fetcher.data.toast); onClose(); }
  }, [fetcher.data]);

  const gstUp   = v => v ? `$${(parseFloat(v) * 1.1).toFixed(2)}` : '—';
  const gstDown = v => v ? `$${(parseFloat(v) / 1.1).toFixed(2)}` : '—';

  const tabCls = (active) =>
    `flex-1 py-2 font-ui text-[0.75rem] rounded-[8px] transition-all duration-150 ${
      active ? 'bg-bc-card text-white shadow-sm' : 'text-bc-secondary hover:text-white'
    }`;

  return (
    <Modal
      title="Add Inventory"
      subtitle={mode === 'existing' ? 'Link to an existing product' : 'Create a brand-new product'}
      onClose={onClose} wide>

      {/* ── Mode toggle ── */}
      <div className="flex gap-1 mb-5 bg-bc-surface rounded-[10px] p-1">
        <button type="button" onClick={() => setMode('existing')} className={tabCls(mode === 'existing')}>
          Existing Product
        </button>
        <button type="button" onClick={() => setMode('new')} className={tabCls(mode === 'new')}>
          New Product
        </button>
      </div>

      {/* ── Existing product mode ── */}
      {mode === 'existing' && (
        <fetcher.Form method="post" className="flex flex-col gap-4">
          <input type="hidden" name="_action" value="add_inventory" />

          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Product</span>
            <select name="product_id" required className={inp + ' appearance-none'}>
              <option value="">— Select product —</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name}{p.category ? ` · ${p.category}` : ''}</option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-1 xs:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className={fieldLabel}>Country</span>
              <select name="country" required className={inp + ' appearance-none'}>
                <option value="">— Select —</option>
                {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={fieldLabel}>Location Name</span>
              <input name="location_name" type="text" placeholder="e.g. Sydney Warehouse" className={inp} />
            </label>
          </div>

          <div className="grid grid-cols-1 xs:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className={fieldLabel}>Initial Stock</span>
              <input name="initial_stock" type="number" min="0" defaultValue="0" required className={inp} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={fieldLabel}>Min Level</span>
              <input name="minimum_stock_level" type="number" min="0" defaultValue="5" className={inp} />
            </label>
          </div>

          <CostInput name="cost_per_unit" label="Cost per Unit (USD)" rates={rates ?? {}} defaultCurrency="AUD" />

          <ModalActions onClose={onClose} submitLabel="Create Entry" busy={busy} error={fetcher.data?.error} />
        </fetcher.Form>
      )}

      {/* ── New product mode ── */}
      {mode === 'new' && (
        <fetcher.Form method="post" className="flex flex-col gap-4">
          <input type="hidden" name="_action" value="create_product_inventory" />

          {/* Name + Variant */}
          <div className="grid grid-cols-1 xs:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className={fieldLabel}>Product Name</span>
              <input name="name" type="text" required placeholder="e.g. BlackCrow Ceramic Coat" className={inp} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={fieldLabel}>Variant <span className="normal-case text-bc-secondary/50">(optional)</span></span>
              <input name="variant" type="text" placeholder="e.g. 500ml, Pro" className={inp} />
            </label>
          </div>

          {/* Category */}
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Category</span>
            <select name="category" required className={inp + ' appearance-none'}>
              <option value="">— Select category —</option>
              <option value="Interior">Interior</option>
              <option value="Exterior">Exterior</option>
              <option value="Drying">Drying</option>
              <option value="Other">Other</option>
            </select>
          </label>

          {/* Pricing — GST */}
          <div className="bg-bc-surface border border-bc-divider rounded-[12px] p-4 flex flex-col gap-4">
            <p className={fieldLabel}>Pricing · Australian GST 10%</p>

            {/* Cost Price */}
            <CostInput name="cost_price" label="Cost Price · excl. GST (USD)" rates={rates ?? {}} defaultCurrency="AUD" required />

            {/* Trade Price */}
            <div className="grid grid-cols-1 xs:grid-cols-2 gap-3 items-end">
              <label className="flex flex-col gap-1.5">
                <span className={fieldLabel}>Trade Price (excl. GST)</span>
                <input name="trade_price" type="number" min="0" step="0.01"
                  value={tradePrice} onChange={e => setTrade(e.target.value)}
                  placeholder="0.00" className={inp} />
              </label>
              <div>
                <p className={fieldLabel}>Incl. GST</p>
                <p className="font-ui text-[0.88rem] text-[#a78bfa] mt-2">{gstUp(tradePrice)}</p>
              </div>
            </div>

            {/* Retail Price */}
            <div className="grid grid-cols-1 xs:grid-cols-2 gap-3 items-end">
              <label className="flex flex-col gap-1.5">
                <span className={fieldLabel}>Retail Price (incl. GST)</span>
                <input name="retail_price" type="number" min="0" step="0.01"
                  value={retailPrice} onChange={e => setRetail(e.target.value)}
                  placeholder="0.00" className={inp} />
              </label>
              <div>
                <p className={fieldLabel}>Excl. GST</p>
                <p className="font-ui text-[0.88rem] text-white mt-2">{gstDown(retailPrice)}</p>
              </div>
            </div>
          </div>

          {/* Inventory fields */}
          <div className="grid grid-cols-1 xs:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className={fieldLabel}>Country</span>
              <select name="country" required className={inp + ' appearance-none'}>
                <option value="">— Select —</option>
                {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={fieldLabel}>Location Name</span>
              <input name="location_name" type="text" placeholder="e.g. Sydney Warehouse" className={inp} />
            </label>
          </div>

          <div className="grid grid-cols-1 xs:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className={fieldLabel}>Initial Stock</span>
              <input name="initial_stock" type="number" min="0" defaultValue="0" required className={inp} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={fieldLabel}>Min Stock Level</span>
              <input name="minimum_stock_level" type="number" min="0" defaultValue="5" className={inp} />
            </label>
          </div>

          <ModalActions onClose={onClose} submitLabel="Create Product + Inventory" busy={busy} error={fetcher.data?.error} />
        </fetcher.Form>
      )}
    </Modal>
  );
}

/* ─── Delete Modal ───────────────────────────────────────────── */
function DeleteModal({row, onClose, onToast}) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== 'idle';
  useEffect(() => {
    if (fetcher.data?.ok) { onToast(fetcher.data.toast); onClose(); }
  }, [fetcher.data]);

  return (
    <Modal title="Delete Inventory Record"
      subtitle={`${row.products?.name ?? '—'} · ${row.country}`}
      onClose={onClose}>
      <fetcher.Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="_action"      value="delete_inventory" />
        <input type="hidden" name="inventory_id" value={row.id} />

        <div className="bg-bc-red/10 border border-bc-red/30 rounded-[10px] px-4 py-3">
          <p className="font-ui text-[0.78rem] text-white font-medium">This action cannot be undone.</p>
          <p className="font-ui text-[0.72rem] text-bc-secondary mt-1">
            Deleting this record will remove all associated stock movements and adjustments for{' '}
            <span className="text-white">{row.products?.name ?? '—'}</span> in{' '}
            <span className="text-white">{row.country}</span>.
          </p>
        </div>

        {fetcher.data?.error && <p className="font-ui text-[0.72rem] text-bc-red">{fetcher.data.error}</p>}
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button type="submit" disabled={busy}
            className="flex-1 py-2.5 font-ui text-[0.78rem] font-medium bg-bc-red text-white rounded-[10px] hover:bg-bc-red/80 transition-colors disabled:opacity-40">
            {busy ? 'Deleting…' : 'Delete Record'}
          </button>
        </div>
      </fetcher.Form>
    </Modal>
  );
}

/* ─── History Modal ──────────────────────────────────────────── */
function HistoryModal({row, onClose}) {
  const fetcher = useFetcher();

  useEffect(() => {
    fetcher.load(`/adminlogonprotocol/inventory/${row.id}`);
  }, [row.id]);

  const movements   = fetcher.data?.movements   ?? [];
  const adjustments = fetcher.data?.adjustments ?? [];
  const transfers   = fetcher.data?.transfers   ?? [];
  const loading     = fetcher.state === 'loading';

  return (
    <Modal title="Stock History" subtitle={`${row.products?.name ?? '—'} · ${row.country}`} onClose={onClose} wide>
      {loading ? (
        <p className="font-ui text-[0.78rem] text-bc-secondary text-center py-8">Loading…</p>
      ) : (
        <div className="space-y-6">
          {/* Movements */}
          <div>
            <p className={fieldLabel + ' mb-3'}>Stock Movements ({movements.length})</p>
            {movements.length === 0 ? (
              <p className="font-ui text-[0.75rem] text-bc-secondary">No movements yet.</p>
            ) : (
              <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                {movements.map(m => {
                  const cfg   = MOVEMENT_CFG[m.movement_type] ?? {color:'#6b7280', label: m.movement_type};
                  const isNeg = m.quantity < 0;
                  return (
                    <div key={m.id} className="flex items-center gap-3 py-2 border-b border-bc-divider/30 last:border-0">
                      <div className="w-1 h-8 rounded-full shrink-0" style={{background: cfg.color}} />
                      <div className="flex-1 min-w-0">
                        <p className="font-ui text-[0.75rem] text-white">{cfg.label}</p>
                        {m.reason && <p className="font-ui text-[0.63rem] text-bc-secondary truncate">{m.reason}</p>}
                        <p className="font-ui text-[0.6rem] text-bc-secondary/50">{fmtDT(m.created_at)} · {m.created_by}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`font-ui text-[0.8rem] font-semibold ${isNeg ? 'text-bc-red' : 'text-[#22c55e]'}`}>
                          {isNeg ? '' : '+'}{m.quantity}
                        </p>
                        {(m.previous_stock !== undefined && m.new_stock !== undefined) && (
                          <p className="font-ui text-[0.6rem] text-bc-secondary">{m.previous_stock} → {m.new_stock}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Adjustments */}
          {adjustments.length > 0 && (
            <div>
              <p className={fieldLabel + ' mb-3'}>Adjustments ({adjustments.length})</p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {adjustments.map(a => {
                  const delta = a.after_quantity - a.before_quantity;
                  return (
                    <div key={a.id} className="flex items-center gap-3 py-1.5 border-b border-bc-divider/30 last:border-0">
                      <div className="flex-1 min-w-0">
                        <p className="font-ui text-[0.75rem] text-white">{a.before_quantity} → {a.after_quantity}</p>
                        {a.reason && <p className="font-ui text-[0.63rem] text-bc-secondary truncate">{a.reason}</p>}
                        <p className="font-ui text-[0.6rem] text-bc-secondary/50">{fmtDT(a.created_at)} · {a.adjusted_by}</p>
                      </div>
                      <span className={`font-ui text-[0.8rem] font-semibold shrink-0 ${delta < 0 ? 'text-bc-red' : 'text-[#22c55e]'}`}>
                        {delta >= 0 ? '+' : ''}{delta}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Transfers */}
          {transfers.length > 0 && (
            <div>
              <p className={fieldLabel + ' mb-3'}>Transfers ({transfers.length})</p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {transfers.map(t => {
                  const isOut = t.from_country === row.country;
                  return (
                    <div key={t.id} className="flex items-center gap-3 py-1.5 border-b border-bc-divider/30 last:border-0">
                      <div className="w-1 h-6 rounded-full shrink-0" style={{background: isOut ? '#e52b2b' : '#22c55e'}} />
                      <div className="flex-1 min-w-0">
                        <p className="font-ui text-[0.75rem] text-white">
                          {isOut ? `→ ${t.to_country}` : `← ${t.from_country}`}
                        </p>
                        <p className="font-ui text-[0.6rem] text-bc-secondary/50">{fmtDT(t.created_at)}</p>
                      </div>
                      <span className={`font-ui text-[0.8rem] font-semibold shrink-0 ${isOut ? 'text-bc-red' : 'text-[#22c55e]'}`}>
                        {isOut ? '-' : '+'}{t.quantity}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="pt-4 mt-2 border-t border-bc-divider">
        <button onClick={onClose} className="w-full py-2 font-ui text-[0.78rem] border border-bc-divider text-bc-secondary rounded-[10px] hover:text-white transition-colors">
          Close
        </button>
      </div>
    </Modal>
  );
}

/* ─── Transfer History Section ───────────────────────────────── */
function TransferHistorySection({transfers}) {
  const [open, setOpen] = useState(true);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search) return transfers;
    const q = search.toLowerCase();
    return transfers.filter(t =>
      (t.products?.name ?? '').toLowerCase().includes(q) ||
      t.from_country.toLowerCase().includes(q) ||
      t.to_country.toLowerCase().includes(q) ||
      (t.reason ?? '').toLowerCase().includes(q)
    );
  }, [transfers, search]);

  return (
    <div className="mt-10">
      {/* Section header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="font-display text-[1.4rem] text-white tracking-[0.1em] leading-none truncate">STOCK TRANSFER HISTORY</h2>
          <span className="font-ui text-[0.65rem] text-bc-secondary bg-white/5 border border-bc-divider px-2 py-0.5 rounded-full">
            {transfers.length} record{transfers.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {open && (
            <div className="relative">
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Filter transfers…"
                className="bg-bc-card border border-bc-divider rounded-[10px] px-3 py-1.5 pl-8 font-ui text-[0.75rem] text-white placeholder-bc-secondary/50 focus:outline-none focus:border-bc-red transition-colors w-44" />
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-bc-secondary pointer-events-none" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </div>
          )}
          <button onClick={() => setOpen(o => !o)}
            className="flex items-center gap-1.5 font-ui text-[0.72rem] text-bc-secondary hover:text-white border border-bc-divider rounded-[8px] px-3 py-1.5 transition-colors">
            {open ? 'Collapse' : 'Expand'}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              style={{transform: open ? 'rotate(180deg)' : 'none', transition:'transform 0.2s'}}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
        </div>
      </div>

      {open && (
        transfers.length === 0 ? (
          <div className="text-center py-12 border border-bc-divider rounded-[14px]">
            <p className="font-ui text-bc-secondary text-[0.85rem]">No transfers recorded yet.</p>
          </div>
        ) : (
          <div className="border border-bc-divider rounded-[14px] overflow-hidden overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr style={{background:'rgba(255,255,255,0.025)'}}>
                  <th className="font-ui text-[0.6rem] tracking-[0.12em] uppercase text-bc-secondary text-left px-4 py-3 border-b border-bc-divider">Date</th>
                  <th className="font-ui text-[0.6rem] tracking-[0.12em] uppercase text-bc-secondary text-left px-4 py-3 border-b border-bc-divider">Product</th>
                  <th className="font-ui text-[0.6rem] tracking-[0.12em] uppercase text-bc-secondary text-left px-4 py-3 border-b border-bc-divider">From</th>
                  <th className="font-ui text-[0.6rem] tracking-[0.12em] uppercase text-bc-secondary text-left px-4 py-3 border-b border-bc-divider">To / Destination</th>
                  <th className="font-ui text-[0.6rem] tracking-[0.12em] uppercase text-bc-secondary text-right px-4 py-3 border-b border-bc-divider">Qty</th>
                  <th className="font-ui text-[0.6rem] tracking-[0.12em] uppercase text-bc-secondary text-left px-4 py-3 border-b border-bc-divider">Reason / Notes</th>
                  <th className="font-ui text-[0.6rem] tracking-[0.12em] uppercase text-bc-secondary text-left px-4 py-3 border-b border-bc-divider">By</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t, i) => (
                  <tr key={t.id} className={`transition-colors hover:bg-white/[0.02] ${i < filtered.length - 1 ? 'border-b border-bc-divider/50' : ''}`}>
                    <td className="font-ui text-[0.72rem] text-bc-secondary px-4 py-3 whitespace-nowrap">{fmtDT(t.created_at)}</td>
                    <td className="font-ui text-[0.78rem] text-white px-4 py-3 max-w-[160px] truncate">{t.products?.name ?? '—'}</td>
                    <td className="font-ui text-[0.78rem] text-bc-secondary px-4 py-3">{t.from_country}</td>
                    <td className="font-ui text-[0.78rem] text-white px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round">
                          <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                        </svg>
                        {t.to_country}
                      </span>
                    </td>
                    <td className="font-ui text-[0.82rem] font-semibold text-bc-red text-right px-4 py-3">-{t.quantity}</td>
                    <td className="font-ui text-[0.72rem] text-bc-secondary px-4 py-3 max-w-[200px] truncate">{t.reason ?? '—'}</td>
                    <td className="font-ui text-[0.7rem] text-bc-secondary/60 px-4 py-3">{t.transferred_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {search && filtered.length === 0 && (
              <p className="font-ui text-[0.75rem] text-bc-secondary text-center py-6">No transfers match "{search}"</p>
            )}
          </div>
        )
      )}
    </div>
  );
}

/* ─── Row action buttons ─────────────────────────────────────── */
const ACTIONS = [
  {id:'edit',     title:'Edit',          color:'text-bc-secondary hover:text-white',
    Icon: () => (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
    )},
  {id:'add',      title:'Add Stock',     color:'text-[#22c55e]/70 hover:text-[#22c55e]',
    Icon: () => (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
      </svg>
    )},
  {id:'adjust',   title:'Adjust Stock',  color:'text-[#a78bfa]/70 hover:text-[#a78bfa]',
    Icon: () => (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/>
        <line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>
        <line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>
      </svg>
    )},
  {id:'incoming', title:'Mark Incoming', color:'text-[#60a5fa]/70 hover:text-[#60a5fa]',
    Icon: () => (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/>
        <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
      </svg>
    )},
  {id:'transfer', title:'Transfer',      color:'text-[#f59e0b]/70 hover:text-[#f59e0b]',
    Icon: () => (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
        <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
      </svg>
    )},
  {id:'history',  title:'View History',  color:'text-bc-secondary hover:text-white',
    Icon: () => (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
    )},
  {id:'delete',   title:'Delete Record', color:'text-bc-red/50 hover:text-bc-red',
    Icon: () => (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
        <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
      </svg>
    )},
];

function RowActions({row, onOpen}) {
  return (
    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
      {ACTIONS.map(({id, title, color, Icon}) => (
        <button key={id} title={title} onClick={() => onOpen(id, row)}
          className={`p-1.5 rounded-[6px] border border-transparent hover:border-bc-divider transition-all duration-100 ${color}`}>
          <Icon />
        </button>
      ))}
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────── */
export default function InventoryPage() {
  const {rows, configured, kpis, dbError, products, allTransfers, exchangeRates, ratesDate} = useLoaderData();
  const navigate = useNavigate();

  /* Filter state */
  const [statusFilter, setStatusFilter] = useState('all');
  const [countryFilter, setCountry]     = useState('all');
  const [syncFilter,    setSync]        = useState('all');
  const [search,        setSearch]      = useState('');

  /* Modal + toast state */
  const [addInventoryOpen, setAddInventoryOpen] = useState(false);
  const [modal, setModal] = useState(null); // {type, row}
  const [toast, setToast] = useState(null);
  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const openModal = (type, row) => setModal({type, row});
  const closeModal = () => setModal(null);

  /* KPI config */
  const KPI_CONFIG = [
    {label:'Total Units',     key:'totalUnits',     accent:'#e52b2b', fmt: n => n.toLocaleString()},
    {label:'Available Units', key:'availableUnits', accent:'#22c55e', fmt: n => n.toLocaleString()},
    {label:'Reserved Units',  key:'reservedUnits',  accent:'#f59e0b', fmt: n => n.toLocaleString()},
    {label:'Incoming Units',  key:'incomingUnits',  accent:'#3b82f6', fmt: n => n.toLocaleString()},
    {label:'Low / OOS Items', key:'lowStockItems',  accent:'#f59e0b', fmt: n => n,          filter:'low_stock'},
    {label:'Inventory Value (USD)', key:'inventoryValue', accent:'#22c55e', fmt: n => fmtMoney(n, 0)},
  ];

  /* Filtered rows */
  const filtered = useMemo(() => rows.filter(r => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (countryFilter !== 'all' && r.country !== countryFilter) return false;
    if (syncFilter !== 'all' && r.sync_status !== syncFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const name = r.products?.name?.toLowerCase() ?? '';
      const sku  = (r.sku ?? '').toLowerCase();
      const loc  = (r.location_name ?? '').toLowerCase();
      if (!name.includes(q) && !sku.includes(q) && !r.country.toLowerCase().includes(q) && !loc.includes(q)) return false;
    }
    return true;
  }), [rows, statusFilter, countryFilter, syncFilter, search]);

  const th    = 'font-ui text-[0.6rem] tracking-[0.12em] uppercase text-bc-secondary text-left px-4 py-3 whitespace-nowrap border-b border-bc-divider';
  const thSticky = th + ' sticky right-0 bg-bc-card';
  const td    = 'font-ui text-[0.78rem] text-white px-4 py-3 align-middle';
  const tdSticky = td + ' sticky right-0 bg-bc-card';

  return (
    <div className="px-6 py-8 lg:px-10">

      {/* ── Page header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-[2.2rem] text-white tracking-[0.12em] leading-none">INVENTORY</h1>
          <p className="font-ui text-[0.72rem] text-bc-secondary mt-1">
            {configured
              ? `${rows.length} row${rows.length !== 1 ? 's' : ''} across ${[...new Set(rows.map(r => r.country))].length} countries`
              : 'Supabase not configured'}
            {dbError && <span className="text-bc-red ml-2">· {dbError}</span>}
          </p>
        </div>
        <button onClick={() => setAddInventoryOpen(true)}
          className="flex items-center gap-2 px-5 py-3 bg-bc-red text-white font-ui text-[0.82rem] font-semibold rounded-[12px] hover:bg-bc-red/85 active:scale-[0.97] transition-all duration-100 shadow-lg shadow-bc-red/20">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          ADD INVENTORY
        </button>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        {KPI_CONFIG.map(({label, key, accent, fmt, filter}) => (
          <KpiCard
            key={key}
            label={label}
            value={fmt(kpis[key] ?? 0)}
            accent={accent}
            active={filter ? statusFilter === filter : false}
            onClick={() => {
              if (!filter) return;
              setStatusFilter(prev => prev === filter ? 'all' : filter);
            }}
          />
        ))}
      </div>

      {/* ── Exchange rates bar ── */}
      {Object.keys(exchangeRates ?? {}).length > 0 && (
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <span className="font-ui text-[0.58rem] uppercase tracking-[0.1em] text-bc-secondary/40">1 USD =</span>
          {Object.entries(exchangeRates).map(([cur, rate]) => (
            <span key={cur} className="font-ui text-[0.65rem] text-bc-secondary bg-white/5 border border-bc-divider px-2.5 py-0.5 rounded-full">
              {Number(rate).toFixed(2)} {cur}
            </span>
          ))}
          {ratesDate && (
            <span className="font-ui text-[0.58rem] text-bc-secondary/30 ml-1">· {ratesDate}</span>
          )}
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-3 items-center mb-5">
        {/* Status tabs */}
        <div className="flex gap-1 flex-wrap">
          {FILTER_TABS.map(t => (
            <button key={t.value} onClick={() => setStatusFilter(t.value)}
              className={`px-3 py-1.5 rounded-[8px] font-ui text-[0.72rem] transition-all duration-150 ${
                statusFilter === t.value
                  ? 'bg-bc-red/15 text-white border border-bc-red/30'
                  : 'text-bc-secondary hover:text-white border border-transparent hover:border-bc-divider'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Country */}
        <select value={countryFilter} onChange={e => setCountry(e.target.value)}
          className="bg-bc-card border border-bc-divider rounded-[10px] px-3 py-1.5 font-ui text-[0.72rem] text-white focus:outline-none focus:border-bc-red transition-colors appearance-none">
          <option value="all">All Countries</option>
          {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        {/* Sync status */}
        <select value={syncFilter} onChange={e => setSync(e.target.value)}
          className="bg-bc-card border border-bc-divider rounded-[10px] px-3 py-1.5 font-ui text-[0.72rem] text-white focus:outline-none focus:border-bc-red transition-colors appearance-none">
          <option value="all">All Sync</option>
          {ALL_SYNCS.map(s => <option key={s} value={s}>{SYNC_CFG[s].label}</option>)}
        </select>

        {/* Search */}
        <div className="sm:ml-auto relative w-full sm:w-auto">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Product, SKU, location…"
            className="bg-bc-card border border-bc-divider rounded-[10px] px-3 py-1.5 pl-8 font-ui text-[0.75rem] text-white placeholder-bc-secondary/50 focus:outline-none focus:border-bc-red transition-colors w-full sm:w-52" />
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

      {/* ── Inventory table ── */}
      {filtered.length === 0 ? (
        <div className="text-center py-20 border border-bc-divider rounded-[14px]">
          <p className="font-ui text-bc-secondary text-[0.85rem]">
            {search || statusFilter !== 'all' || countryFilter !== 'all' || syncFilter !== 'all'
              ? 'No rows match your filters.'
              : configured ? 'Run the updated Section 15 SQL in Supabase to seed inventory.' : 'Configure Supabase to get started.'}
          </p>
        </div>
      ) : (
        <div className="border border-bc-divider rounded-[14px] overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr style={{background:'rgba(255,255,255,0.025)'}}>
                <th className={th}>Product</th>
                <th className={`${th} hidden sm:table-cell`}>SKU</th>
                <th className={th}>Country / Location</th>
                <th className={`${th} text-right`}>On Hand</th>
                <th className={`${th} text-right hidden md:table-cell`}>Available</th>
                <th className={`${th} text-right hidden lg:table-cell`}>Reserved</th>
                <th className={`${th} text-right hidden md:table-cell`}>Incoming</th>
                <th className={`${th} text-right hidden lg:table-cell`}>Min Level</th>
                <th className={`${th} text-right hidden xl:table-cell`}>Cost/Unit</th>
                <th className={`${th} text-right hidden xl:table-cell`}>Value</th>
                <th className={th}>Status</th>
                <th className={`${th} hidden xl:table-cell`}>Sync</th>
                <th className={`${th} hidden 2xl:table-cell`}>Updated</th>
                <th className={thSticky}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => {
                const available = (row.stock_on_hand ?? 0) - (row.stock_reserved ?? 0);
                const value     = (row.stock_on_hand ?? 0) * Number(row.cost_per_unit ?? 0);
                return (
                  <tr key={row.id}
                    onClick={() => navigate(`/adminlogonprotocol/inventory/${row.id}`)}
                    className={`cursor-pointer transition-colors duration-100 hover:bg-white/[0.035] ${
                      i < filtered.length - 1 ? 'border-b border-bc-divider/50' : ''
                    }`}>

                    {/* Product */}
                    <td className={td}>
                      <p className="font-ui text-[0.82rem] font-medium truncate max-w-[160px]">
                        {row.products?.name ?? '—'}
                      </p>
                      {row.products?.category && (
                        <p className="font-ui text-[0.63rem] text-bc-secondary">{row.products.category}</p>
                      )}
                    </td>

                    {/* SKU */}
                    <td className={`${td} hidden sm:table-cell font-mono text-[0.7rem] text-bc-secondary`}>
                      {row.sku ?? '—'}
                    </td>

                    {/* Country / Location */}
                    <td className={`${td}`}>
                      <p className="text-[0.78rem]">{row.country}</p>
                      {row.location_name && (
                        <p className="font-ui text-[0.63rem] text-bc-secondary truncate max-w-[120px]">{row.location_name}</p>
                      )}
                    </td>

                    {/* On Hand */}
                    <td className={`${td} text-right`}>
                      <span className={`font-semibold ${
                        row.status === 'out_of_stock' ? 'text-bc-red'
                        : row.status === 'low_stock'  ? 'text-[#f59e0b]'
                        : 'text-white'
                      }`}>{row.stock_on_hand ?? 0}</span>
                    </td>

                    {/* Available */}
                    <td className={`${td} text-right hidden md:table-cell`}>
                      <span className={available < 0 ? 'text-bc-red' : 'text-bc-secondary text-[0.75rem]'}>{available}</span>
                    </td>

                    {/* Reserved */}
                    <td className={`${td} text-right hidden lg:table-cell text-bc-secondary text-[0.75rem]`}>
                      {row.stock_reserved ?? 0}
                    </td>

                    {/* Incoming */}
                    <td className={`${td} text-right hidden md:table-cell`}>
                      {(row.incoming_stock ?? 0) > 0
                        ? <span className="text-[#60a5fa] text-[0.75rem]">+{row.incoming_stock}</span>
                        : <span className="text-bc-secondary/40 text-[0.75rem]">—</span>}
                    </td>

                    {/* Min Level */}
                    <td className={`${td} text-right hidden lg:table-cell text-bc-secondary text-[0.75rem]`}>
                      {row.minimum_stock_level}
                    </td>

                    {/* Cost/Unit */}
                    <td className={`${td} text-right hidden xl:table-cell text-bc-secondary text-[0.75rem]`}>
                      {Number(row.cost_per_unit ?? 0) > 0 ? fmtMoney(row.cost_per_unit) : '—'}
                    </td>

                    {/* Value */}
                    <td className={`${td} text-right hidden xl:table-cell`}>
                      {value > 0
                        ? <span className="text-[#22c55e] text-[0.75rem]">{fmtMoney(value, 0)}</span>
                        : <span className="text-bc-secondary/40 text-[0.75rem]">—</span>}
                    </td>

                    {/* Status */}
                    <td className={td}><StatusPill status={row.status} /></td>

                    {/* Sync */}
                    <td className={`${td} hidden xl:table-cell`}><SyncPill sync={row.sync_status} /></td>

                    {/* Updated */}
                    <td className={`${td} hidden 2xl:table-cell text-bc-secondary text-[0.7rem]`}>
                      {fmtDT(row.updated_at)}
                    </td>

                    {/* Actions */}
                    <td className={tdSticky}>
                      <RowActions row={row} onOpen={openModal} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > 0 && (
        <p className="font-ui text-[0.63rem] text-bc-secondary/40 mt-3 text-right">
          {filtered.length} of {rows.length} rows shown
        </p>
      )}

      {/* ── Stock Transfer History ── */}
      <TransferHistorySection transfers={allTransfers} />

      {/* ── Modals ── */}
      {addInventoryOpen && <AddInventoryModal products={products} onClose={() => setAddInventoryOpen(false)} onToast={showToast} rates={exchangeRates ?? {}} />}
      {modal?.type === 'edit'     && <EditModal         row={modal.row} onClose={closeModal} onToast={showToast} rates={exchangeRates ?? {}} />}
      {modal?.type === 'add'      && <AddStockModal      row={modal.row} onClose={closeModal} onToast={showToast} />}
      {modal?.type === 'adjust'   && <AdjustStockModal   row={modal.row} onClose={closeModal} onToast={showToast} />}
      {modal?.type === 'incoming' && <MarkIncomingModal  row={modal.row} onClose={closeModal} onToast={showToast} />}
      {modal?.type === 'transfer' && <TransferModal      row={modal.row} onClose={closeModal} onToast={showToast} />}
      {modal?.type === 'history'  && <HistoryModal       row={modal.row} onClose={closeModal} />}
      {modal?.type === 'delete'   && <DeleteModal        row={modal.row} onClose={closeModal} onToast={showToast} />}

      {/* ── Toast ── */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#22c55e]/15 border border-[#22c55e]/30 backdrop-blur-sm rounded-[12px] px-5 py-3 shadow-xl">
          <p className="font-ui text-[0.78rem] text-[#22c55e] whitespace-nowrap">{toast}</p>
        </div>
      )}
    </div>
  );
}
