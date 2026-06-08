import {useState, useEffect} from 'react';
import {useLoaderData, useFetcher, Link} from '@remix-run/react';
import {json} from '@shopify/remix-oxygen';
import {getSupabase} from '~/lib/supabase.server';
import {requireAdminUser} from '~/lib/auth.server';

export const meta = ({data}) => [
  {title: `${data?.inv?.products?.name ?? 'Inventory'} — ${data?.inv?.country ?? ''} | BlackCrow Admin`},
];

/* ─── Loader ─────────────────────────────────────────────────── */
export async function loader({request, params, context}) {
  await requireAdminUser(request);
  const sb = getSupabase();
  if (!sb) throw new Response('Supabase not configured', {status: 503});

  const {data: inv, error} = await sb
    .from('inventory')
    .select(`
      *,
      products (id, name, slug, sku, price, category, main_image_url, status)
    `)
    .eq('id', params.id)
    .single();

  if (error || !inv) throw new Response('Inventory item not found', {status: 404});

  const {data: siblings} = await sb
    .from('inventory')
    .select('id, country, location_name, stock_on_hand, stock_reserved, incoming_stock, minimum_stock_level, status, cost_per_unit')
    .eq('product_id', inv.product_id)
    .order('country');

  const {data: movements} = await sb
    .from('inventory_movements')
    .select('*')
    .eq('inventory_id', params.id)
    .order('created_at', {ascending: false})
    .limit(50);

  const {data: adjustments} = await sb
    .from('stock_adjustments')
    .select('*')
    .eq('inventory_id', params.id)
    .order('created_at', {ascending: false})
    .limit(30);

  const {data: transfers} = await sb
    .from('stock_transfers')
    .select('*')
    .eq('product_id', inv.product_id)
    .or(`from_country.eq.${inv.country},to_country.eq.${inv.country}`)
    .order('created_at', {ascending: false})
    .limit(20);

  return json({
    inv,
    siblings:    siblings    ?? [],
    movements:   movements   ?? [],
    adjustments: adjustments ?? [],
    transfers:   transfers   ?? [],
  });
}

/* ─── Action ─────────────────────────────────────────────────── */
export async function action({params, request}) {
  const sb = getSupabase();
  if (!sb) return json({error: 'Supabase not configured'}, {status: 503});

  const fd     = await request.formData();
  const intent = fd.get('_action');
  const iid    = params.id;

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

  const computeStatus = (qty, minLevel, currentStatus) => {
    if (currentStatus === 'discontinued') return 'discontinued';
    if (qty === 0) return 'out_of_stock';
    if (qty <= minLevel) return 'low_stock';
    return 'in_stock';
  };

  /* ── add_stock ── */
  if (intent === 'add_stock') {
    const qty = parseInt(fd.get('quantity') ?? '0', 10);
    if (!qty || qty <= 0) return json({error: 'Enter a valid quantity'}, {status: 400});
    const inv = await getInv();
    const prev   = inv.stock_on_hand ?? 0;
    const newQty = prev + qty;
    const {error} = await sb.from('inventory').update({
      stock_on_hand: newQty,
      status:        computeStatus(newQty, inv.minimum_stock_level, inv.status),
      updated_at:    new Date().toISOString(),
    }).eq('id', iid);
    if (error) return json({error: error.message}, {status: 400});
    await logMovement(inv, 'stock_added', qty, prev, newQty, fd.get('reason') || null);
    return json({ok: true, toast: `Added ${qty} units to stock.`});
  }

  /* ── adjust_stock ── */
  if (intent === 'adjust_stock') {
    const newQty = parseInt(fd.get('new_quantity') ?? '0', 10);
    if (newQty < 0) return json({error: 'Quantity cannot be negative'}, {status: 400});
    const inv = await getInv();
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
    return json({ok: true, toast: `Stock adjusted from ${prev} to ${newQty}.`});
  }

  /* ── mark_incoming ── */
  if (intent === 'mark_incoming') {
    const qty = parseInt(fd.get('quantity') ?? '0', 10);
    if (!qty || qty <= 0) return json({error: 'Enter a valid quantity'}, {status: 400});
    const inv = await getInv();
    const {error} = await sb.from('inventory').update({
      incoming_stock: (inv.incoming_stock ?? 0) + qty,
      updated_at: new Date().toISOString(),
    }).eq('id', iid);
    if (error) return json({error: error.message}, {status: 400});
    const poNum = fd.get('po_number') || null;
    await logMovement(inv, 'incoming_shipment', qty, inv.stock_on_hand ?? 0, inv.stock_on_hand ?? 0,
      poNum ? `PO: ${poNum}` : 'Incoming shipment logged', 'po', poNum);
    return json({ok: true, toast: `Marked ${qty} units as incoming.`});
  }

  /* ── receive_incoming ── */
  if (intent === 'receive_incoming') {
    const inv = await getInv();
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
    if (!qty || qty <= 0)  return json({error: 'Enter a valid quantity'}, {status: 400});
    if (!toDestination)    return json({error: 'Enter a destination'}, {status: 400});
    const inv = await getInv();
    if (qty > inv.stock_on_hand) return json({error: 'Insufficient stock for transfer'}, {status: 400});

    const prev      = inv.stock_on_hand;
    const newSrcQty = prev - qty;
    const {error: srcErr} = await sb.from('inventory').update({
      stock_on_hand: newSrcQty,
      status:        computeStatus(newSrcQty, inv.minimum_stock_level, inv.status),
      updated_at:    new Date().toISOString(),
    }).eq('id', iid);
    if (srcErr) return json({error: srcErr.message}, {status: 400});

    const reason    = fd.get('reason') || null;
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

  /* ── set_min_level ── */
  if (intent === 'set_min_level') {
    const minLevel = parseInt(fd.get('minimum_stock_level') ?? '0', 10);
    if (minLevel < 0) return json({error: 'Minimum level cannot be negative'}, {status: 400});
    const inv = await getInv();
    const {error} = await sb.from('inventory').update({
      minimum_stock_level: minLevel,
      status: computeStatus(inv.stock_on_hand ?? 0, minLevel, inv.status),
      updated_at: new Date().toISOString(),
    }).eq('id', iid);
    return error ? json({error: error.message}, {status: 400}) : json({ok: true, toast: 'Minimum level updated.'});
  }

  /* ── set_cost ── */
  if (intent === 'set_cost') {
    const cost = parseFloat(fd.get('cost_per_unit') ?? '0');
    if (cost < 0) return json({error: 'Cost cannot be negative'}, {status: 400});
    const {error} = await sb.from('inventory').update({
      cost_per_unit: cost, updated_at: new Date().toISOString(),
    }).eq('id', iid);
    return error ? json({error: error.message}, {status: 400}) : json({ok: true, toast: 'Cost per unit updated.'});
  }

  /* ── set_location ── */
  if (intent === 'set_location') {
    const {error} = await sb.from('inventory').update({
      location_name: fd.get('location_name') || null,
      updated_at: new Date().toISOString(),
    }).eq('id', iid);
    return error ? json({error: error.message}, {status: 400}) : json({ok: true, toast: 'Location updated.'});
  }

  /* ── set_status ── */
  if (intent === 'set_status') {
    const {error} = await sb.from('inventory').update({
      status: fd.get('status'), updated_at: new Date().toISOString(),
    }).eq('id', iid);
    return error ? json({error: error.message}, {status: 400}) : json({ok: true, toast: 'Status updated.'});
  }

  return json({error: 'Unknown action'}, {status: 400});
}

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
const COUNTRIES    = ['Australia','USA','UK','Canada','Sweden'];
const ALL_STATUSES = ['in_stock','low_stock','out_of_stock','incoming','discontinued'];

/* ─── Helpers ────────────────────────────────────────────────── */
function fmtDT(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-AU', {
    day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit',
  });
}
function fmtMoney(n) {
  return `$${Number(n ?? 0).toLocaleString('en-AU', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
}

/* ─── Shared UI ──────────────────────────────────────────────── */
function StatusPill({status}) {
  const c = STATUS_CFG[status] ?? {bg:'bg-white/10', text:'text-bc-secondary', label: status};
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
function Card({title, children, action}) {
  return (
    <div className="bg-bc-card border border-bc-divider rounded-[20px] p-6">
      {title && (
        <div className="flex items-center justify-between mb-4">
          <p className="font-ui text-[0.65rem] tracking-[0.12em] uppercase text-bc-secondary">{title}</p>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

/* ─── Stock Overview ─────────────────────────────────────────── */
function StockOverviewCard({inv}) {
  const available = (inv.stock_on_hand ?? 0) - (inv.stock_reserved ?? 0);
  const value     = (inv.stock_on_hand ?? 0) * Number(inv.cost_per_unit ?? 0);
  const pct       = inv.minimum_stock_level > 0
    ? Math.min(100, (inv.stock_on_hand / (inv.minimum_stock_level * 3)) * 100)
    : 0;
  const barColor = inv.status === 'out_of_stock' ? '#e52b2b'
    : inv.status === 'low_stock' ? '#f59e0b' : '#22c55e';

  return (
    <Card title="Stock Overview">
      <div className="grid grid-cols-4 gap-4 mb-5">
        {[
          {label:'On Hand',   value: inv.stock_on_hand ?? 0,       color:'text-white'},
          {label:'Available', value: available,                      color: available < 0 ? 'text-bc-red' : 'text-[#22c55e]'},
          {label:'Reserved',  value: inv.stock_reserved ?? 0,       color:'text-[#f59e0b]'},
          {label:'Incoming',  value: inv.incoming_stock ?? 0,       color:'text-[#60a5fa]'},
        ].map(({label, value: v, color}) => (
          <div key={label} className="text-center">
            <p className={`font-display text-[2rem] leading-none ${color}`}>{v}</p>
            <p className="font-ui text-[0.6rem] text-bc-secondary mt-1 tracking-[0.08em] uppercase">{label}</p>
          </div>
        ))}
      </div>

      <div className="h-2 bg-bc-surface rounded-full overflow-hidden mb-2">
        <div className="h-full rounded-full transition-all duration-500" style={{width:`${pct}%`, background: barColor}} />
      </div>
      <div className="flex justify-between items-center mb-4">
        <span className="font-ui text-[0.65rem] text-bc-secondary">
          {inv.stock_on_hand ?? 0} / {inv.minimum_stock_level * 3} target · Min level: {inv.minimum_stock_level}
        </span>
        <StatusPill status={inv.status} />
      </div>

      {/* Value + cost row */}
      <div className="flex gap-4 border-t border-bc-divider pt-4">
        <div>
          <p className="font-ui text-[0.6rem] text-bc-secondary uppercase tracking-wide">Cost / Unit</p>
          <p className="font-ui text-[0.9rem] text-white mt-0.5">
            {Number(inv.cost_per_unit ?? 0) > 0 ? fmtMoney(inv.cost_per_unit) : '—'}
          </p>
        </div>
        <div>
          <p className="font-ui text-[0.6rem] text-bc-secondary uppercase tracking-wide">Inventory Value</p>
          <p className="font-ui text-[0.9rem] text-[#22c55e] mt-0.5">
            {value > 0 ? fmtMoney(value) : '—'}
          </p>
        </div>
        <div>
          <p className="font-ui text-[0.6rem] text-bc-secondary uppercase tracking-wide">Shopify Sync</p>
          <div className="mt-0.5"><SyncPill sync={inv.sync_status} /></div>
        </div>
      </div>
    </Card>
  );
}

/* ─── Country Stock ──────────────────────────────────────────── */
function CountryStockCard({siblings, currentId}) {
  const maxStock = Math.max(...siblings.map(s => s.stock_on_hand ?? 0), 1);
  return (
    <Card title="Stock by Country">
      <div className="space-y-3">
        {siblings.map(s => {
          const isCurrent = s.id === currentId;
          const cfg       = STATUS_CFG[s.status] ?? STATUS_CFG.in_stock;
          const pct       = Math.min(100, ((s.stock_on_hand ?? 0) / maxStock) * 100);
          const available = (s.stock_on_hand ?? 0) - (s.stock_reserved ?? 0);
          return (
            <div key={s.id} className={`px-3 py-2.5 rounded-[10px] border ${
              isCurrent ? 'border-bc-red/30 bg-bc-red/5' : 'border-bc-divider/50'
            }`}>
              <div className="flex items-center gap-3 mb-1.5">
                <span className="font-ui text-[0.75rem] text-white w-20 shrink-0">{s.country}</span>
                <div className="flex-1 h-1.5 bg-bc-surface rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{width:`${pct}%`, background: cfg.text.replace('text-[','').replace(']','').replace('text-','')}} />
                </div>
                <span className={`font-ui text-[0.78rem] font-semibold w-8 text-right shrink-0 ${cfg.text}`}>
                  {s.stock_on_hand ?? 0}
                </span>
              </div>
              <div className="flex gap-3 pl-[92px]">
                <span className="font-ui text-[0.6rem] text-bc-secondary">Avail: {available}</span>
                {(s.incoming_stock ?? 0) > 0 && (
                  <span className="font-ui text-[0.6rem] text-[#60a5fa]">+{s.incoming_stock} incoming</span>
                )}
                {s.location_name && (
                  <span className="font-ui text-[0.6rem] text-bc-secondary truncate">{s.location_name}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ─── Shopify Fields Card ────────────────────────────────────── */
function ShopifyCard({inv}) {
  const fields = [
    {label:'Shopify Product ID',   value: inv.shopify_product_id},
    {label:'Shopify Variant ID',   value: inv.shopify_variant_id},
    {label:'Inventory Item ID',    value: inv.shopify_inventory_item_id},
    {label:'Location ID',          value: inv.shopify_location_id},
    {label:'Sync Status',          value: <SyncPill sync={inv.sync_status} />},
    {label:'Last Synced',          value: inv.last_synced_at ? fmtDT(inv.last_synced_at) : null},
  ];
  return (
    <Card title="Shopify Integration">
      <p className="font-ui text-[0.65rem] text-bc-secondary mb-4">
        Fields prepared for Shopify sync. Connect Shopify to populate these automatically.
      </p>
      <div className="space-y-2">
        {fields.map(({label, value}) => (
          <div key={label} className="flex items-center gap-3">
            <span className="font-ui text-[0.65rem] text-bc-secondary w-40 shrink-0">{label}</span>
            {typeof value === 'string' || value === null || value === undefined ? (
              <span className="font-mono text-[0.7rem] text-white truncate">{value ?? '—'}</span>
            ) : value}
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ─── Actions Card ───────────────────────────────────────────── */
function ActionsCard({inv}) {
  const fetcher = useFetcher();
  const [tab,   setTab]   = useState('add');
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (fetcher.data?.ok || fetcher.data?.toast) {
      setToast(fetcher.data?.toast ?? 'Done.');
      setTimeout(() => setToast(null), 5000);
    }
  }, [fetcher.data]);

  const busy = fetcher.state !== 'idle';
  const inp  = 'w-full bg-bc-surface border border-bc-divider rounded-[8px] px-3 py-2 font-ui text-[0.78rem] text-white placeholder-bc-secondary/40 focus:outline-none focus:border-bc-red transition-colors';

  const TABS = [
    {id:'add',      label:'Add'},
    {id:'adjust',   label:'Adjust'},
    {id:'incoming', label:'Incoming'},
    {id:'transfer', label:'Transfer'},
    {id:'settings', label:'Settings'},
  ];

  return (
    <Card title="Actions">
      <div className="flex gap-0.5 mb-4 flex-wrap">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-2.5 py-1 rounded-[8px] font-ui text-[0.7rem] transition-colors ${
              tab === t.id
                ? 'bg-bc-red/15 text-white border border-bc-red/30'
                : 'text-bc-secondary hover:text-white border border-transparent'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Add Stock */}
      {tab === 'add' && (
        <fetcher.Form method="post" className="flex flex-col gap-3">
          <input type="hidden" name="_action" value="add_stock" />
          <div className="bg-bc-surface border border-bc-divider rounded-[10px] px-3 py-2">
            <p className="font-ui text-[0.6rem] text-bc-secondary uppercase tracking-wide">Current On Hand</p>
            <p className="font-display text-[1.8rem] text-white leading-none">{inv.stock_on_hand ?? 0}</p>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary">Quantity to Add</span>
            <input name="quantity" type="number" min="1" placeholder="e.g. 50" required className={inp} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary">Reason</span>
            <input name="reason" type="text" placeholder="e.g. Stock replenishment" className={inp} />
          </label>
          <button type="submit" disabled={busy}
            className="w-full font-ui text-[0.78rem] font-medium bg-bc-red text-white py-2 rounded-[10px] hover:bg-bc-red/80 transition-colors disabled:opacity-40">
            {busy ? 'Adding…' : 'Add Stock'}
          </button>
        </fetcher.Form>
      )}

      {/* Adjust Stock */}
      {tab === 'adjust' && (
        <fetcher.Form method="post" className="flex flex-col gap-3">
          <input type="hidden" name="_action" value="adjust_stock" />
          <div className="bg-bc-surface border border-bc-divider rounded-[10px] px-3 py-2 mb-1">
            <p className="font-ui text-[0.6rem] text-bc-secondary uppercase tracking-wide">Current stock</p>
            <p className="font-display text-[1.8rem] text-white leading-none">{inv.stock_on_hand}</p>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary">Set New Quantity</span>
            <input name="new_quantity" type="number" min="0" defaultValue={inv.stock_on_hand} required className={inp} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary">Reason (required)</span>
            <input name="reason" type="text" placeholder="e.g. Stock count correction" required className={inp} />
          </label>
          <button type="submit" disabled={busy}
            className="w-full font-ui text-[0.78rem] font-medium bg-bc-red text-white py-2 rounded-[10px] hover:bg-bc-red/80 transition-colors disabled:opacity-40">
            {busy ? 'Adjusting…' : 'Adjust Stock'}
          </button>
        </fetcher.Form>
      )}

      {/* Mark Incoming */}
      {tab === 'incoming' && (
        <div className="flex flex-col gap-3">
          {(inv.incoming_stock ?? 0) > 0 && (
            <fetcher.Form method="post">
              <input type="hidden" name="_action" value="receive_incoming" />
              <div className="bg-[#3b82f6]/8 border border-[#3b82f6]/25 rounded-[10px] p-3 mb-1 flex items-center justify-between gap-3">
                <div>
                  <p className="font-ui text-[0.62rem] text-[#60a5fa]">Pending incoming</p>
                  <p className="font-display text-[1.4rem] text-white leading-none">{inv.incoming_stock} units</p>
                </div>
                <button type="submit" disabled={busy}
                  className="px-3 py-1.5 bg-[#3b82f6] text-white font-ui text-[0.7rem] rounded-[8px] hover:bg-[#3b82f6]/80 transition-colors disabled:opacity-40 whitespace-nowrap">
                  {busy ? '…' : 'Receive All'}
                </button>
              </div>
            </fetcher.Form>
          )}
          <fetcher.Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="_action" value="mark_incoming" />
            <label className="flex flex-col gap-1.5">
              <span className="font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary">Incoming Quantity</span>
              <input name="quantity" type="number" min="1" placeholder="e.g. 200" required className={inp} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary">PO / Reference</span>
              <input name="po_number" type="text" placeholder="e.g. PO-2026-001" className={inp} />
            </label>
            <button type="submit" disabled={busy}
              className="w-full font-ui text-[0.78rem] font-medium bg-bc-red text-white py-2 rounded-[10px] hover:bg-bc-red/80 transition-colors disabled:opacity-40">
              {busy ? 'Saving…' : 'Mark Incoming'}
            </button>
          </fetcher.Form>
        </div>
      )}

      {/* Transfer Stock */}
      {tab === 'transfer' && (
        <fetcher.Form method="post" className="flex flex-col gap-3">
          <input type="hidden" name="_action" value="transfer_stock" />
          <div className="bg-bc-surface border border-bc-divider rounded-[10px] px-3 py-2 mb-1">
            <p className="font-ui text-[0.62rem] text-bc-secondary">Transferring from</p>
            <p className="font-ui text-[0.85rem] text-white font-medium">
              {inv.country} — {(inv.stock_on_hand ?? 0) - (inv.stock_reserved ?? 0)} available
            </p>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary">Transfer Destination</span>
            <input name="to_destination" type="text" required
              placeholder="e.g. Amazon FBA, LA Warehouse, Retail Floor…" className={inp} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary">
              Country <span className="normal-case text-bc-secondary/50">(optional)</span>
            </span>
            <select name="to_country" className={inp + ' appearance-none'}>
              <option value="">— Select country —</option>
              {COUNTRIES.filter(c => c !== inv.country).map(c => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary">Quantity</span>
            <input name="quantity" type="number" min="1" max={inv.stock_on_hand}
              placeholder={`Max ${inv.stock_on_hand}`} required className={inp} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary">Reason / Notes</span>
            <input name="reason" type="text" placeholder="e.g. FBA prep, rebalancing stock…" className={inp} />
          </label>
          <button type="submit" disabled={busy}
            className="w-full font-ui text-[0.78rem] font-medium bg-bc-red text-white py-2 rounded-[10px] hover:bg-bc-red/80 transition-colors disabled:opacity-40">
            {busy ? 'Transferring…' : 'Transfer Stock'}
          </button>
          {fetcher.data?.error && <p className="font-ui text-[0.72rem] text-bc-red">{fetcher.data.error}</p>}
        </fetcher.Form>
      )}

      {/* Settings */}
      {tab === 'settings' && (
        <div className="flex flex-col gap-4">
          <fetcher.Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="_action" value="set_location" />
            <label className="flex flex-col gap-1.5">
              <span className="font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary">Location Name</span>
              <input name="location_name" type="text" defaultValue={inv.location_name ?? ''}
                placeholder="e.g. Sydney Warehouse" className={inp} />
            </label>
            <button type="submit" disabled={busy}
              className="w-full font-ui text-[0.78rem] font-medium bg-bc-red text-white py-2 rounded-[10px] hover:bg-bc-red/80 transition-colors disabled:opacity-40">
              {busy ? 'Saving…' : 'Update Location'}
            </button>
          </fetcher.Form>

          <div className="h-px bg-bc-divider" />

          <fetcher.Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="_action" value="set_cost" />
            <label className="flex flex-col gap-1.5">
              <span className="font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary">Cost per Unit ($)</span>
              <input name="cost_per_unit" type="number" min="0" step="0.01"
                defaultValue={Number(inv.cost_per_unit ?? 0).toFixed(2)} className={inp} />
            </label>
            <button type="submit" disabled={busy}
              className="w-full font-ui text-[0.78rem] font-medium bg-bc-red text-white py-2 rounded-[10px] hover:bg-bc-red/80 transition-colors disabled:opacity-40">
              {busy ? 'Saving…' : 'Update Cost'}
            </button>
          </fetcher.Form>

          <div className="h-px bg-bc-divider" />

          <fetcher.Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="_action" value="set_min_level" />
            <label className="flex flex-col gap-1.5">
              <span className="font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary">Minimum Stock Level</span>
              <input name="minimum_stock_level" type="number" min="0" defaultValue={inv.minimum_stock_level} className={inp} />
            </label>
            <button type="submit" disabled={busy}
              className="w-full font-ui text-[0.78rem] font-medium bg-bc-red text-white py-2 rounded-[10px] hover:bg-bc-red/80 transition-colors disabled:opacity-40">
              {busy ? 'Saving…' : 'Update Min Level'}
            </button>
          </fetcher.Form>

          <div className="h-px bg-bc-divider" />

          <fetcher.Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="_action" value="set_status" />
            <label className="flex flex-col gap-1.5">
              <span className="font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary">Override Status</span>
              <select name="status" defaultValue={inv.status} className={inp + ' appearance-none'}>
                {ALL_STATUSES.map(s => (
                  <option key={s} value={s}>{STATUS_CFG[s]?.label ?? s}</option>
                ))}
              </select>
              <span className="font-ui text-[0.62rem] text-bc-secondary/60">
                Auto-managed by trigger. Set to Discontinued to lock permanently.
              </span>
            </label>
            <button type="submit" disabled={busy}
              className="w-full font-ui text-[0.78rem] font-medium border border-bc-divider text-bc-secondary py-2 rounded-[10px] hover:text-white hover:border-bc-red/40 transition-colors disabled:opacity-40">
              {busy ? 'Saving…' : 'Override Status'}
            </button>
          </fetcher.Form>
        </div>
      )}

      {toast && (
        <div className="mt-3 bg-[#22c55e]/10 border border-[#22c55e]/30 rounded-[10px] p-3">
          <p className="font-ui text-[0.72rem] text-[#22c55e] leading-relaxed">{toast}</p>
        </div>
      )}
    </Card>
  );
}

/* ─── Movements Card ─────────────────────────────────────────── */
function MovementsCard({movements}) {
  return (
    <Card title={`Stock Movements (${movements.length})`}>
      {movements.length === 0 ? (
        <p className="font-ui text-[0.75rem] text-bc-secondary">No movements recorded yet.</p>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {movements.map(m => {
            const cfg   = MOVEMENT_CFG[m.movement_type] ?? {color:'#6b7280', label: m.movement_type};
            const isNeg = m.quantity < 0 || ['stock_removed','sale','transfer_out','damage','lost'].includes(m.movement_type);
            return (
              <div key={m.id} className="flex items-center gap-3 py-2 border-b border-bc-divider/40 last:border-0">
                <div className="w-1 h-10 rounded-full shrink-0" style={{background: cfg.color}} />
                <div className="flex-1 min-w-0">
                  <p className="font-ui text-[0.78rem] text-white">{cfg.label}</p>
                  {m.reason && <p className="font-ui text-[0.63rem] text-bc-secondary truncate">{m.reason}</p>}
                  {(m.reference_type || m.reference_id) && (
                    <p className="font-ui text-[0.6rem] text-bc-secondary/60">
                      {m.reference_type}{m.reference_id ? `: ${m.reference_id}` : ''}
                    </p>
                  )}
                  <p className="font-ui text-[0.6rem] text-bc-secondary/50">{fmtDT(m.created_at)} · {m.created_by}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className={`font-ui text-[0.82rem] font-semibold ${isNeg ? 'text-bc-red' : 'text-[#22c55e]'}`}>
                    {isNeg && m.quantity > 0 ? '-' : m.quantity > 0 ? '+' : ''}{Math.abs(m.quantity)}
                  </p>
                  {m.previous_stock !== undefined && m.new_stock !== undefined && (
                    <p className="font-ui text-[0.6rem] text-bc-secondary">{m.previous_stock} → {m.new_stock}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/* ─── Adjustments Card ───────────────────────────────────────── */
function AdjustmentsCard({adjustments}) {
  if (adjustments.length === 0) return null;
  return (
    <Card title={`Adjustment History (${adjustments.length})`}>
      <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
        {adjustments.map(a => {
          const delta = a.after_quantity - a.before_quantity;
          return (
            <div key={a.id} className="flex items-center gap-3 py-2 border-b border-bc-divider/40 last:border-0">
              <div className="flex-1 min-w-0">
                <p className="font-ui text-[0.78rem] text-white">{a.before_quantity} → {a.after_quantity}</p>
                {a.reason && <p className="font-ui text-[0.63rem] text-bc-secondary truncate">{a.reason}</p>}
                <p className="font-ui text-[0.6rem] text-bc-secondary/50">{fmtDT(a.created_at)} · {a.adjusted_by}</p>
              </div>
              <span className={`font-ui text-[0.82rem] font-semibold shrink-0 ${delta < 0 ? 'text-bc-red' : 'text-[#22c55e]'}`}>
                {delta >= 0 ? '+' : ''}{delta}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ─── Transfers Card ─────────────────────────────────────────── */
function TransfersCard({transfers, country}) {
  if (transfers.length === 0) return null;
  return (
    <Card title={`Transfer History (${transfers.length})`}>
      <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
        {transfers.map(t => {
          const isOut = t.from_country === country;
          return (
            <div key={t.id} className="flex items-center gap-3 py-2 border-b border-bc-divider/40 last:border-0">
              <div className="w-1 h-8 rounded-full shrink-0" style={{background: isOut ? '#e52b2b' : '#22c55e'}} />
              <div className="flex-1 min-w-0">
                <p className="font-ui text-[0.78rem] text-white">
                  {isOut ? `→ ${t.to_country}` : `← ${t.from_country}`}
                </p>
                {t.reason && <p className="font-ui text-[0.63rem] text-bc-secondary truncate">{t.reason}</p>}
                <p className="font-ui text-[0.6rem] text-bc-secondary/50">{fmtDT(t.created_at)} · {t.transferred_by}</p>
              </div>
              <span className={`font-ui text-[0.82rem] font-semibold shrink-0 ${isOut ? 'text-bc-red' : 'text-[#22c55e]'}`}>
                {isOut ? '-' : '+'}{t.quantity}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ─── Page ───────────────────────────────────────────────────── */
export default function InventoryDetailPage() {
  const {inv, siblings, movements, adjustments, transfers} = useLoaderData();
  const product   = inv.products ?? {};
  const available = (inv.stock_on_hand ?? 0) - (inv.stock_reserved ?? 0);
  const value     = (inv.stock_on_hand ?? 0) * Number(inv.cost_per_unit ?? 0);

  return (
    <div className="px-6 py-8 max-w-[1400px] mx-auto">

      {/* Back */}
      <Link to="/adminlogonprotocol/inventory"
        className="inline-flex items-center gap-1.5 font-ui text-[0.72rem] text-bc-secondary hover:text-white transition-colors mb-6 group">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="group-hover:-translate-x-0.5 transition-transform">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Back to Inventory
      </Link>

      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <h1 className="font-display text-[2.6rem] text-white leading-none tracking-wide">
            {product.name ?? 'Unknown Product'}
          </h1>
          <StatusPill status={inv.status} />
          <SyncPill sync={inv.sync_status} />
        </div>
        <p className="font-ui text-[0.78rem] text-bc-secondary">
          {inv.country}
          {inv.location_name && <> · <span className="text-white/70">{inv.location_name}</span></>}
          {inv.sku           && <> · <span className="font-mono">{inv.sku}</span></>}
          {product.category  && <> · {product.category}</>}
          {' · '}
          <span>Available: <span className="text-white font-medium">{available}</span></span>
          {value > 0 && (
            <> · <span>Value: <span className="text-[#22c55e] font-medium">{fmtMoney(value)}</span></span></>
          )}
        </p>
        <p className="font-ui text-[0.65rem] text-bc-secondary/50 mt-1">
          Updated {fmtDT(inv.updated_at)}
        </p>
      </div>

      {/* 2-column layout */}
      <div className="flex gap-6 items-start flex-col xl:flex-row">

        {/* LEFT — data cards */}
        <div className="flex-1 min-w-0 flex flex-col gap-6">
          <StockOverviewCard inv={inv} />
          <CountryStockCard siblings={siblings} currentId={inv.id} />
          <MovementsCard movements={movements} />
          <AdjustmentsCard adjustments={adjustments} />
          <TransfersCard transfers={transfers} country={inv.country} />
          <ShopifyCard inv={inv} />
        </div>

        {/* RIGHT — actions */}
        <div className="w-full xl:w-80 xl:flex-shrink-0 xl:sticky xl:top-20">
          <ActionsCard inv={inv} />
        </div>
      </div>
    </div>
  );
}
