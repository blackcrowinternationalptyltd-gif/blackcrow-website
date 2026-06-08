import {useState, useEffect} from 'react';
import {useLoaderData, useFetcher, Link, useNavigate} from '@remix-run/react';
import {json} from '@shopify/remix-oxygen';
import {getSupabase} from '~/lib/supabase.server';
import {requireAdminUser} from '~/lib/auth.server';
import {COUNTRY_CONFIG, resolveCountryKey} from '~/lib/country-config';

export const meta = ({data}) => [
  {title: `${data?.order?.order_number ?? 'Order'} | BlackCrow Admin`},
];

/* ── Loader ──────────────────────────────────────────────── */
export async function loader({request, params, context}) {
  await requireAdminUser(request);
  const sb = getSupabase();
  if (!sb) throw new Response('Supabase not configured', {status: 503});

  const {data: order, error} = await sb
    .from('orders')
    .select(`
      *,
      customers (*),
      order_items (*),
      invoices (*),
      refunds (*),
      email_logs (id, type, recipient_email, recipient_name, subject, status, created_at),
      internal_notes (id, author, content, created_at),
      review_requests (id, customer_email, status, sent_at)
    `)
    .eq('id', params.id)
    .single();

  if (error || !order) throw new Response('Order not found', {status: 404});
  return json({order});
}

/* ── Action ──────────────────────────────────────────────── */
export async function action({params, request}) {
  const sb = getSupabase();
  if (!sb) return json({error: 'Supabase not configured'}, {status: 503});

  const fd     = await request.formData();
  const intent = fd.get('_action');
  const oid    = params.id;

  if (intent === 'update_status') {
    const patch = {};
    for (const f of ['status', 'payment_status', 'shipping_status', 'refund_status']) {
      const v = fd.get(f);
      if (v !== null && v !== '') patch[f] = v;
    }
    patch.updated_at = new Date().toISOString();
    const {error} = await sb.from('orders').update(patch).eq('id', oid);
    return error ? json({error: error.message}, {status: 400}) : json({ok: true});
  }

  if (intent === 'update_customer') {
    const cid   = fd.get('customer_id');
    const patch = {
      name:          fd.get('name')          || '',
      email:         fd.get('email')         || null,
      phone:         fd.get('phone')         || null,
      company:       fd.get('company')       || null,
      address_line1: fd.get('address_line1') || null,
      city:          fd.get('city')          || null,
      state:         fd.get('state')         || null,
      postcode:      fd.get('postcode')      || null,
      country:       fd.get('country')       || 'Australia',
    };
    const {error} = await sb.from('customers').update(patch).eq('id', cid);
    return error ? json({error: error.message}, {status: 400}) : json({ok: true});
  }

  if (intent === 'add_note') {
    const content = fd.get('content')?.trim();
    if (!content) return json({error: 'Note cannot be empty'}, {status: 400});
    const {error} = await sb.from('internal_notes').insert({
      order_id: oid,
      author:   fd.get('author') || 'Admin',
      content,
    });
    return error ? json({error: error.message}, {status: 400}) : json({ok: true});
  }

  if (intent === 'create_refund') {
    const amount = Number(fd.get('amount'));
    if (!amount || amount <= 0) return json({error: 'Enter a valid refund amount'}, {status: 400});
    const {error: rErr} = await sb.from('refunds').insert({
      order_id: oid, amount, reason: fd.get('reason') || null, status: 'pending',
    });
    if (rErr) return json({error: rErr.message}, {status: 400});
    const [{data: all}, {data: ord}] = await Promise.all([
      sb.from('refunds').select('amount').eq('order_id', oid),
      sb.from('orders').select('total').eq('id', oid).single(),
    ]);
    const totalRefunded = all?.reduce((s, r) => s + Number(r.amount), 0) ?? 0;
    const refundStatus  = totalRefunded >= Number(ord?.total ?? 0) ? 'full' : 'partial';
    await sb.from('orders').update({refund_status: refundStatus, updated_at: new Date().toISOString()}).eq('id', oid);
    return json({ok: true});
  }

  if (intent === 'generate_invoice') {
    /* Idempotent — return existing number if already generated */
    const {data: existing} = await sb
      .from('invoices')
      .select('invoice_number')
      .eq('order_id', oid)
      .maybeSingle();
    if (existing) {
      return json({ok: true, toast: `Invoice ${existing.invoice_number} already generated.`});
    }
    /* Get next sequential BCA-INV number */
    const {data: last} = await sb
      .from('invoices')
      .select('invoice_number')
      .like('invoice_number', 'BCA-INV-%')
      .order('created_at', {ascending: false})
      .limit(1);
    const n = Number(last?.[0]?.invoice_number?.match(/(\d+)$/)?.[1] ?? 0) + 1;
    const invoiceNumber = `BCA-INV-${String(n).padStart(7, '0')}`;
    /* Fetch order + customer snapshot */
    const {data: ord} = await sb
      .from('orders')
      .select('*, customers(*)')
      .eq('id', oid)
      .single();
    const c = ord?.customers ?? {};
    const addr = [c.address_line1, c.city, c.state, c.postcode, c.country]
      .filter(Boolean).join(', ');
    /* Try full insert (schema v2 with extended columns) */
    let {error: iErr} = await sb.from('invoices').insert({
      order_id:        oid,
      invoice_number:  invoiceNumber,
      issued_date:     ord.date ?? new Date().toISOString().slice(0, 10),
      status:          ord.payment_status === 'paid' ? 'paid' : 'issued',
      customer_name:   c.name   ?? null,
      customer_email:  c.email  ?? null,
      customer_phone:  c.phone  ?? null,
      billing_address: addr,
      shipping_address: addr,
      payment_method:  'Credit Card',
      subtotal:        ord.subtotal      ?? 0,
      freight:         ord.shipping_cost ?? 0,
      rounding:        0,
      gst:             ord.tax           ?? 0,
      total:           ord.total         ?? 0,
    });
    /* Fallback: base columns only (schema v1) */
    if (iErr) {
      ({error: iErr} = await sb.from('invoices').insert({
        order_id:       oid,
        invoice_number: invoiceNumber,
        issued_date:    ord.date ?? new Date().toISOString().slice(0, 10),
        status:         ord.payment_status === 'paid' ? 'paid' : 'issued',
      }));
    }
    return iErr
      ? json({error: iErr.message}, {status: 400})
      : json({ok: true, toast: `Invoice ${invoiceNumber} generated.`, invoiceNumber});
  }

  if (intent === 'email_invoice') {
    const {data: ord} = await sb.from('orders').select('order_number, customers(name, email)').eq('id', oid).single();
    const {error} = await sb.from('email_logs').insert({
      order_id: oid, type: 'invoice',
      recipient_email: ord?.customers?.email ?? null,
      recipient_name:  ord?.customers?.name  ?? null,
      subject: `Your BlackCrow invoice — ${ord?.order_number}`,
      status: 'sent', provider: null,
    });
    return error
      ? json({error: error.message}, {status: 400})
      : json({ok: true, toast: 'Invoice email logged — connect an email provider (Resend / Postmark) to deliver.'});
  }

  if (intent === 'email_refund_remittance') {
    const {data: ord} = await sb.from('orders').select('order_number, customers(name, email)').eq('id', oid).single();
    const {error} = await sb.from('email_logs').insert({
      order_id: oid, type: 'refund_remittance',
      recipient_email: ord?.customers?.email ?? null,
      recipient_name:  ord?.customers?.name  ?? null,
      subject: `Refund remittance — ${ord?.order_number}`,
      status: 'sent', provider: null,
    });
    return error
      ? json({error: error.message}, {status: 400})
      : json({ok: true, toast: 'Refund remittance logged — connect email provider to deliver.'});
  }

  if (intent === 'send_review_request') {
    const {data: ord} = await sb.from('orders').select('order_number, customers(name, email)').eq('id', oid).single();
    const email = ord?.customers?.email ?? null;
    const name  = ord?.customers?.name  ?? null;
    await sb.from('review_requests').insert({order_id: oid, customer_email: email, status: 'sent'});
    const {error} = await sb.from('email_logs').insert({
      order_id: oid, type: 'review_request',
      recipient_email: email, recipient_name: name,
      subject: 'How was your BlackCrow experience?',
      status: 'sent', provider: null,
    });
    return error
      ? json({error: error.message}, {status: 400})
      : json({ok: true, toast: 'Review request logged — connect email provider to deliver.'});
  }

  if (intent === 'update_invoice') {
    const invId  = fd.get('invoice_id');
    if (!invId)  return json({error: 'Missing invoice_id'}, {status: 400});

    const country = fd.get('country') || 'Australia';
    const cfg     = COUNTRY_CONFIG[country] ?? COUNTRY_CONFIG.Australia;

    const subtotalRaw = Number(fd.get('subtotal') || 0);
    const freightRaw  = Number(fd.get('freight')  || 0);
    const roundingRaw = Number(fd.get('rounding') || 0);
    const gross       = subtotalRaw + freightRaw + roundingRaw;
    /* Extract tax from the gross (GST-inclusive pricing) */
    const gst         = +(gross * cfg.taxRate / (1 + cfg.taxRate)).toFixed(2);
    const total       = +gross.toFixed(2);
    const subtotal    = +(gross - gst).toFixed(2);

    /* ── Three-level fallback for progressive schema support ── */

    /* Level 1: full patch — schema v2 (Section 11 + 12 columns) */
    let {error: uErr} = await sb.from('invoices').update({
      country_entity: country,
      location:       fd.get('location') || null,
      subtotal,
      freight:        freightRaw,
      rounding:       roundingRaw,
      gst,
      total,
      payment_method: fd.get('payment_method') || 'Credit Card',
      notes:          fd.get('notes') || null,
    }).eq('id', invId);

    /* Level 2: without section-12 columns (location, country_entity) */
    if (uErr) {
      ({error: uErr} = await sb.from('invoices').update({
        subtotal,
        freight:        freightRaw,
        rounding:       roundingRaw,
        gst,
        total,
        payment_method: fd.get('payment_method') || 'Credit Card',
        notes:          fd.get('notes') || null,
      }).eq('id', invId));
    }

    /* Level 3: base columns only (schema v1 — no financial columns) */
    if (uErr) {
      const {error: baseErr} = await sb.from('invoices').update({
        status: 'issued',
      }).eq('id', invId);
      if (!baseErr) {
        return json({ok: true, toast: 'Saved (limited) — run SQL Sections 11 & 12 in Supabase to enable all invoice fields.'});
      }
      return json({error: 'Run SQL Sections 11 & 12 in Supabase SQL Editor first, then try again.'}, {status: 400});
    }

    return json({ok: true, toast: 'Invoice updated.'});
  }

  if (intent === 'assign_order_number') {
    const {data: ord} = await sb.from('orders').select('order_number').eq('id', oid).single();
    if (ord?.order_number?.startsWith('BCA-ORD-')) {
      return json({ok: true, toast: `Order already has number ${ord.order_number}.`});
    }
    /* Get next sequential BCA-ORD number */
    const {data: last} = await sb
      .from('orders')
      .select('order_number')
      .like('order_number', 'BCA-ORD-%')
      .order('created_at', {ascending: false})
      .limit(1);
    const n      = Number(last?.[0]?.order_number?.match(/(\d+)$/)?.[1] ?? 0) + 1;
    const newNum = `BCA-ORD-${String(n).padStart(7, '0')}`;
    const {error} = await sb.from('orders').update({order_number: newNum}).eq('id', oid);
    return error
      ? json({error: error.message}, {status: 400})
      : json({ok: true, toast: `Order number assigned: ${newNum}`});
  }

  if (intent === 'mark_packed') {
    const {error} = await sb.from('orders').update({
      shipping_status: 'processing',
      packed_at: new Date().toISOString(),
    }).eq('id', oid);
    return error
      ? json({error: error.message}, {status: 400})
      : json({ok: true, toast: 'Order marked as packed.'});
  }

  if (intent === 'mark_shipped') {
    const {error} = await sb.from('orders').update({
      shipping_status: 'shipped',
      shipped_at: new Date().toISOString(),
    }).eq('id', oid);
    return error
      ? json({error: error.message}, {status: 400})
      : json({ok: true, toast: 'Order marked as shipped.'});
  }

  if (intent === 'mark_delivered') {
    const {error} = await sb.from('orders').update({
      shipping_status: 'delivered',
      delivered_at: new Date().toISOString(),
    }).eq('id', oid);
    return error
      ? json({error: error.message}, {status: 400})
      : json({ok: true, toast: 'Order marked as delivered.'});
  }

  if (intent === 'add_tracking') {
    const patch = {};
    const tn = fd.get('tracking_number')?.trim();
    const tc = fd.get('tracking_carrier')?.trim();
    if (tn) patch.tracking_number  = tn;
    if (tc) patch.tracking_carrier = tc;
    if (!Object.keys(patch).length)
      return json({error: 'No tracking data provided'}, {status: 400});
    const {error} = await sb.from('orders').update(patch).eq('id', oid);
    return error
      ? json({error: error.message}, {status: 400})
      : json({ok: true, toast: 'Tracking information saved.'});
  }

  return json({error: 'Unknown action'}, {status: 400});
}

/* ── Constants ───────────────────────────────────────────── */
const STATUS_CFG = {
  order:   {opts: ['processing','fulfilled','cancelled','refunded'],    colors: {fulfilled:'#22c55e', processing:'#f59e0b', cancelled:'#6b7280', refunded:'#e52b2b'}},
  payment: {opts: ['pending','paid','failed','refunded'],               colors: {paid:'#22c55e', pending:'#f59e0b', failed:'#e52b2b', refunded:'#6b7280'}},
  shipping:{opts: ['pending','processing','shipped','delivered','returned'], colors: {delivered:'#22c55e', shipped:'#3b82f6', processing:'#f59e0b', pending:'#6b7280', returned:'#e52b2b'}},
  refund:  {opts: ['none','partial','full'],                            colors: {none:'#6b7280', partial:'#f59e0b', full:'#e52b2b'}},
};

const EMAIL_TYPE = {
  invoice:           'Invoice',
  refund_remittance: 'Refund Remittance',
  review_request:    'Review Request',
  custom:            'Custom',
};

const COUNTRIES = ['Australia','USA','UK','Canada','Sweden','Germany','France','Japan','New Zealand','Other'];

/* ── Helpers ─────────────────────────────────────────────── */
function currSym(c) { return {GBP:'£',EUR:'€',JPY:'¥',SEK:'kr'}[c] ?? '$'; }
function fmt(n, cur = 'AUD') {
  const num = Number(n ?? 0).toLocaleString('en-AU', {minimumFractionDigits:2, maximumFractionDigits:2});
  return cur === 'SEK' ? `${num}\u00a0kr` : `${currSym(cur)}${num}`;
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-AU', {day:'numeric', month:'long', year:'numeric'});
}
function fmtDT(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-AU', {day:'numeric', month:'short', year:'numeric'})
       + ' ' + dt.toLocaleTimeString('en-AU', {hour:'2-digit', minute:'2-digit'});
}

/* ── StatusBadge ─────────────────────────────────────────── */
function StatusBadge({type, value}) {
  const color = STATUS_CFG[type]?.colors[value] ?? '#6b7280';
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full font-ui text-[0.68rem] font-medium tracking-wide uppercase"
      style={{background: color + '1a', color}}>
      {value}
    </span>
  );
}

/* ── Card wrapper ────────────────────────────────────────── */
function Card({title, children, action}) {
  return (
    <div className="bg-bc-card border border-bc-divider rounded-[20px] p-6">
      {title && (
        <div className="flex items-center justify-between mb-4">
          <p className="font-ui text-[0.68rem] tracking-[0.12em] uppercase text-bc-secondary">{title}</p>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

/* ── CustomerCard ────────────────────────────────────────── */
function CustomerCard({customer}) {
  const fetcher  = useFetcher();
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (fetcher.data?.ok) setEditing(false);
  }, [fetcher.data]);

  const c = customer ?? {};
  const inp = 'w-full bg-bc-surface border border-bc-divider rounded-[8px] px-3 py-1.5 font-ui text-[0.78rem] text-white placeholder-bc-secondary/40 focus:outline-none focus:border-bc-red transition-colors';
  const lbl = 'flex flex-col gap-1';
  const span = 'font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary';

  return (
    <Card title="Customer" action={
      <button onClick={() => setEditing(e => !e)}
        className="font-ui text-[0.7rem] text-bc-secondary hover:text-white transition-colors">
        {editing ? 'Cancel' : 'Edit'}
      </button>
    }>
      {editing ? (
        <fetcher.Form method="post" className="flex flex-col gap-4">
          <input type="hidden" name="_action" value="update_customer" />
          <input type="hidden" name="customer_id" value={c.id} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              ['name',         'Full Name',  c.name         ?? ''],
              ['email',        'Email',      c.email        ?? ''],
              ['phone',        'Phone',      c.phone        ?? ''],
              ['company',      'Company',    c.company      ?? ''],
              ['address_line1','Address',    c.address_line1?? ''],
              ['city',         'City',       c.city         ?? ''],
              ['state',        'State/Province', c.state    ?? ''],
              ['postcode',     'Postcode',   c.postcode     ?? ''],
            ].map(([name, label, val]) => (
              <label key={name} className={lbl}>
                <span className={span}>{label}</span>
                <input name={name} defaultValue={val} className={inp} />
              </label>
            ))}
            <label className={`${lbl} col-span-2`}>
              <span className={span}>Country</span>
              <select name="country" defaultValue={c.country ?? 'Australia'}
                className={inp + ' appearance-none'}>
                {COUNTRIES.map(co => <option key={co}>{co}</option>)}
              </select>
            </label>
          </div>
          {fetcher.data?.error && (
            <p className="font-ui text-[0.72rem] text-bc-red">{fetcher.data.error}</p>
          )}
          <button type="submit"
            className="w-full font-ui text-[0.78rem] font-medium bg-bc-red text-white py-2 rounded-[10px] hover:bg-bc-red/80 transition-colors">
            {fetcher.state !== 'idle' ? 'Saving…' : 'Save Changes'}
          </button>
        </fetcher.Form>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="font-ui font-semibold text-white text-[0.95rem]">{c.name ?? '—'}</p>
            {c.company && <p className="font-ui text-[0.75rem] text-bc-secondary">{c.company}</p>}
          </div>
          {c.email && (
            <div className="flex items-center gap-2">
              <svg className="text-bc-secondary shrink-0" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
              <a href={`mailto:${c.email}`} className="font-ui text-[0.78rem] text-bc-secondary hover:text-white transition-colors">{c.email}</a>
            </div>
          )}
          {c.phone && (
            <div className="flex items-center gap-2">
              <svg className="text-bc-secondary shrink-0" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 11.1 19.36 19.36 0 0 1 1.64 2.5 2 2 0 0 1 3.62.5h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.1a16 16 0 0 0 6 6l.97-.97a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              <span className="font-ui text-[0.78rem] text-bc-secondary">{c.phone}</span>
            </div>
          )}
          {(c.address_line1 || c.city) && (
            <div className="flex items-start gap-2">
              <svg className="text-bc-secondary shrink-0 mt-0.5" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
              <div>
                {c.address_line1 && <p className="font-ui text-[0.75rem] text-bc-secondary">{c.address_line1}</p>}
                <p className="font-ui text-[0.75rem] text-bc-secondary">
                  {[c.city, c.state, c.postcode].filter(Boolean).join(' ')}{c.country ? `, ${c.country}` : ''}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ── OrderItemsCard ──────────────────────────────────────── */
function OrderItemsCard({items, order}) {
  const th = 'font-ui text-[0.6rem] tracking-[0.1em] uppercase text-bc-secondary text-left py-2 px-3';
  const td = 'font-ui text-[0.78rem] text-white py-2.5 px-3';

  return (
    <Card title="Order Items">
      <div className="overflow-x-auto -mx-2">
        <table className="w-full min-w-[420px]">
          <thead>
            <tr className="border-b border-bc-divider">
              <th className={th}>Product</th>
              <th className={th}>Variant</th>
              <th className={`${th} text-center`}>Qty</th>
              <th className={`${th} text-right`}>Unit Price</th>
              <th className={`${th} text-right`}>Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={item.id ?? i} className="border-b border-bc-divider/50">
                <td className={td}>{item.product}</td>
                <td className={`${td} text-bc-secondary`}>{item.variant ?? '—'}</td>
                <td className={`${td} text-center`}>{item.quantity}</td>
                <td className={`${td} text-right`}>{currSym(order.currency)}{Number(item.unit_price).toFixed(2)}</td>
                <td className={`${td} text-right`}>{currSym(order.currency)}{Number(item.subtotal).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-col gap-1.5 items-end">
        {[
          ['Subtotal',  order.subtotal],
          ['Shipping',  order.shipping_cost],
          ['Tax',       order.tax],
        ].map(([label, val]) => (
          <div key={label} className="flex gap-8">
            <span className="font-ui text-[0.72rem] text-bc-secondary w-20 text-right">{label}</span>
            <span className="font-ui text-[0.78rem] text-white w-24 text-right">{fmt(val, order.currency)}</span>
          </div>
        ))}
        <div className="flex gap-8 mt-1 pt-2 border-t border-bc-divider">
          <span className="font-ui text-[0.72rem] font-semibold text-white w-20 text-right">TOTAL</span>
          <span className="font-display text-[1.2rem] text-white w-24 text-right leading-none">{fmt(order.total, order.currency)}</span>
        </div>
      </div>
    </Card>
  );
}

/* ── InvoiceEditCard ─────────────────────────────────────── */
function InvoiceEditCard({invoice, order}) {
  const fetcher = useFetcher();
  const [editing, setEditing] = useState(false);

  /* Derive initial country from stored entity → fallback to customer country */
  const initCountry = invoice?.country_entity
    || resolveCountryKey(order.customers?.country ?? order.country);

  const [country,  setCountry]  = useState(initCountry);
  const [subtotalStr, setSubtotalStr] = useState(() => { const v = Number(invoice?.subtotal ?? order.subtotal      ?? 0); return v ? String(v) : ''; });
  const [freightStr,  setFreightStr]  = useState(() => { const v = Number(invoice?.freight  ?? order.shipping_cost ?? 0); return v ? String(v) : ''; });
  const [roundingStr, setRoundingStr] = useState(() => { const v = Number(invoice?.rounding ?? 0); return v ? String(v) : ''; });

  useEffect(() => { if (fetcher.data?.ok) setEditing(false); }, [fetcher.data]);

  const cfg      = COUNTRY_CONFIG[country] ?? COUNTRY_CONFIG.Australia;
  const subtotal = parseFloat(subtotalStr) || 0;
  const freight  = parseFloat(freightStr)  || 0;
  const rounding = parseFloat(roundingStr) || 0;
  const gross    = subtotal + freight + rounding;
  const gst      = +(gross * cfg.taxRate / (1 + cfg.taxRate)).toFixed(2);
  const excl     = +(gross - gst).toFixed(2);
  const sym      = currSym(cfg.currency);
  const amtStr   = (v) => cfg.currency === 'SEK' ? `${Number(v).toFixed(2)}\u00a0kr` : `${sym}${Number(v).toFixed(2)}`;

  const inp = 'w-full bg-bc-surface border border-bc-divider rounded-[8px] px-3 py-1.5 font-ui text-[0.78rem] text-white placeholder-bc-secondary/40 focus:outline-none focus:border-bc-red transition-colors';
  const lbl = 'font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary';

  if (!invoice) return null;

  return (
    <Card title="Invoice" action={
      <button onClick={() => setEditing(e => !e)}
        className="font-ui text-[0.7rem] text-bc-secondary hover:text-white transition-colors">
        {editing ? 'Cancel' : 'Edit Invoice'}
      </button>
    }>
      {editing ? (
        <fetcher.Form method="post" className="flex flex-col gap-4">
          <input type="hidden" name="_action"    value="update_invoice" />
          <input type="hidden" name="invoice_id" value={invoice.id} />
          <input type="hidden" name="gst"        value={gst} />
          <input type="hidden" name="subtotal"   value={subtotal} />

          {/* Country / Tax Entity */}
          <label className="flex flex-col gap-1.5">
            <span className={lbl}>Country / Tax Entity</span>
            <select name="country" value={country}
              onChange={e => setCountry(e.target.value)}
              className={inp + ' appearance-none'}>
              {Object.keys(COUNTRY_CONFIG).map(c => <option key={c}>{c}</option>)}
            </select>
            <span className="font-ui text-[0.64rem] text-bc-secondary/70">
              {cfg.taxLabel} {cfg.taxRate > 0 ? `${(cfg.taxRate * 100).toFixed(0)}%` : '(none)'} · code: {cfg.taxCode}
            </span>
          </label>

          {/* Items Subtotal (incl. tax) */}
          <label className="flex flex-col gap-1.5">
            <span className={lbl}>Items Subtotal (incl. {cfg.taxLabel})</span>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 font-ui text-[0.78rem] text-bc-secondary/60 pointer-events-none select-none">{sym}</span>
              <input type="text" inputMode="decimal" name="_subtotal_display"
                value={subtotalStr} onChange={e => setSubtotalStr(e.target.value)}
                placeholder="0.00"
                className={inp + ' pl-8'} />
            </div>
          </label>

          {/* Freight */}
          <label className="flex flex-col gap-1.5">
            <span className={lbl}>Freight</span>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 font-ui text-[0.78rem] text-bc-secondary/60 pointer-events-none select-none">{sym}</span>
              <input type="text" inputMode="decimal" name="freight"
                value={freightStr} onChange={e => setFreightStr(e.target.value)}
                placeholder="0.00"
                className={inp + ' pl-8'} />
            </div>
          </label>

          {/* Rounding */}
          <label className="flex flex-col gap-1.5">
            <span className={lbl}>Rounding</span>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 font-ui text-[0.78rem] text-bc-secondary/60 pointer-events-none select-none">{sym}</span>
              <input type="text" inputMode="decimal" name="rounding"
                value={roundingStr} onChange={e => setRoundingStr(e.target.value)}
                placeholder="0.00"
                className={inp + ' pl-8'} />
            </div>
          </label>

          {/* Auto-calculated breakdown */}
          <div className="bg-bc-surface border border-bc-divider rounded-[12px] p-3 space-y-2">
            <p className={lbl + ' mb-1'}>Calculated Breakdown (GST-inclusive)</p>
            {[
              [`Subtotal (incl. ${cfg.taxLabel})`, subtotal],
              ['Freight',                           freight],
              ['Rounding',                          rounding],
              ['── Gross Total',                    gross],
              [`${cfg.taxLabel} extracted (÷${1 + cfg.taxRate})`, gst],
              [`Excl. tax`,                         excl],
            ].map(([label, val]) => (
              <div key={label} className="flex justify-between items-center">
                <span className="font-ui text-[0.7rem] text-bc-secondary">{label}</span>
                <span className="font-ui text-[0.75rem] font-medium text-white">
                  {amtStr(val)}
                </span>
              </div>
            ))}
          </div>

          {/* Location */}
          <label className="flex flex-col gap-1.5">
            <span className={lbl}>Warehouse / Location</span>
            <input type="text" name="location"
              defaultValue={invoice.location ?? ''}
              placeholder="e.g. VIC-01, Aisle 3"
              className={inp} />
          </label>

          {/* Payment method */}
          <label className="flex flex-col gap-1.5">
            <span className={lbl}>Payment Method</span>
            <input type="text" name="payment_method"
              defaultValue={invoice.payment_method ?? 'Credit Card'}
              className={inp} />
          </label>

          {/* Notes */}
          <label className="flex flex-col gap-1.5">
            <span className={lbl}>Invoice Notes</span>
            <textarea name="notes" rows={3}
              defaultValue={invoice.notes ?? ''}
              placeholder="Add notes to appear on this invoice…"
              className={inp + ' resize-none'} />
          </label>

          {fetcher.data?.error && (
            <p className="font-ui text-[0.72rem] text-bc-red">{fetcher.data.error}</p>
          )}
          <button type="submit"
            className="w-full font-ui text-[0.78rem] font-medium bg-bc-red text-white py-2 rounded-[10px] hover:bg-bc-red/80 transition-colors">
            {fetcher.state !== 'idle' ? 'Saving…' : 'Save Invoice'}
          </button>
        </fetcher.Form>
      ) : (
        /* ── View mode ── */
        <div className="space-y-2.5">
          {[
            ['Invoice No.',    invoice.invoice_number],
            ['Country Entity', invoice.country_entity || 'Australia'],
            ['Tax',            `${cfg.taxLabel} ${cfg.taxRate > 0 ? (cfg.taxRate*100).toFixed(0)+'%' : 'n/a'} · ${cfg.taxCode}`],
          ].map(([label, val]) => (
            <div key={label} className="flex items-center justify-between">
              <span className="font-ui text-[0.7rem] text-bc-secondary">{label}</span>
              <span className="font-ui text-[0.75rem] font-semibold text-white">{val ?? '—'}</span>
            </div>
          ))}
          <div className="pt-2 border-t border-bc-divider/50 space-y-1.5">
            {[
              ['Sub-Total (incl. tax)', invoice.subtotal],
              ['Freight',               invoice.freight],
              ['Rounding',              invoice.rounding],
              [cfg.taxLabel + ' (extracted)', invoice.gst],
              ['TOTAL',                 invoice.total],
            ].map(([label, val]) => (
              <div key={label} className="flex items-center justify-between">
                <span className="font-ui text-[0.7rem] text-bc-secondary">{label}</span>
                <span className={`font-ui text-[0.75rem] text-white${label === 'TOTAL' ? ' font-semibold' : ''}`}>
                  {amtStr(val ?? 0)}
                </span>
              </div>
            ))}
          </div>
          {(invoice.location || invoice.payment_method) && (
            <div className="pt-2 border-t border-bc-divider/50 space-y-1.5">
              {invoice.location && (
                <div className="flex items-center justify-between">
                  <span className="font-ui text-[0.7rem] text-bc-secondary">Location</span>
                  <span className="font-ui text-[0.75rem] text-white">{invoice.location}</span>
                </div>
              )}
              {invoice.payment_method && (
                <div className="flex items-center justify-between">
                  <span className="font-ui text-[0.7rem] text-bc-secondary">Payment Method</span>
                  <span className="font-ui text-[0.75rem] text-white">{invoice.payment_method}</span>
                </div>
              )}
            </div>
          )}
          {invoice.notes && (
            <div className="pt-2 border-t border-bc-divider/50">
              <p className={lbl + ' mb-1'}>Notes</p>
              <p className="font-ui text-[0.75rem] text-bc-secondary leading-relaxed">{invoice.notes}</p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ── CommHistoryCard ─────────────────────────────────────── */
function CommHistoryCard({emailLogs, reviewRequests}) {
  const statusColor = {sent:'#22c55e', failed:'#e52b2b', pending:'#f59e0b'};
  const rrStatusColor = {sent:'#6b7280', opened:'#f59e0b', reviewed:'#22c55e'};

  const allEvents = [
    ...emailLogs.map(e => ({...e, _kind: 'email'})),
    ...reviewRequests.map(r => ({...r, _kind: 'review', created_at: r.sent_at})),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return (
    <Card title="Communication History">
      {allEvents.length === 0 ? (
        <p className="font-ui text-[0.75rem] text-bc-secondary">No communications yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {allEvents.map((ev, i) => (
            <div key={ev.id ?? i} className="flex items-start gap-3 pb-3 border-b border-bc-divider/50 last:border-0 last:pb-0">
              <div className="mt-0.5">
                {ev._kind === 'email' ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-bc-secondary"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-bc-secondary"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-ui text-[0.78rem] text-white">
                    {ev._kind === 'email' ? EMAIL_TYPE[ev.type] ?? ev.type : 'Review Request'}
                  </span>
                  <span className="font-ui text-[0.65rem] rounded-full px-2 py-0.5"
                    style={{
                      background: (ev._kind === 'email' ? statusColor[ev.status] : rrStatusColor[ev.status]) + '1a',
                      color: ev._kind === 'email' ? statusColor[ev.status] : rrStatusColor[ev.status],
                    }}>
                    {ev.status}
                  </span>
                </div>
                {ev._kind === 'email' && ev.recipient_email && (
                  <p className="font-ui text-[0.72rem] text-bc-secondary truncate">To: {ev.recipient_name ? `${ev.recipient_name} <${ev.recipient_email}>` : ev.recipient_email}</p>
                )}
                {ev._kind === 'email' && ev.subject && (
                  <p className="font-ui text-[0.72rem] text-bc-secondary/70 truncate">{ev.subject}</p>
                )}
                <p className="font-ui text-[0.68rem] text-bc-secondary/50 mt-0.5">{fmtDT(ev.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ── NotesCard ───────────────────────────────────────────── */
function NotesCard({notes, orderId}) {
  const fetcher  = useFetcher();
  const [content, setContent] = useState('');

  useEffect(() => {
    if (fetcher.data?.ok) setContent('');
  }, [fetcher.data]);

  const sorted = [...notes].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return (
    <Card title="Internal Notes">
      <div className="flex flex-col gap-3 mb-5">
        {sorted.length === 0 && <p className="font-ui text-[0.75rem] text-bc-secondary">No notes yet.</p>}
        {sorted.map((n) => (
          <div key={n.id} className="bg-bc-surface rounded-[12px] p-3 border border-bc-divider/50">
            <div className="flex items-center justify-between mb-1">
              <span className="font-ui text-[0.68rem] font-semibold text-white">{n.author}</span>
              <span className="font-ui text-[0.65rem] text-bc-secondary">{fmtDT(n.created_at)}</span>
            </div>
            <p className="font-ui text-[0.78rem] text-bc-secondary leading-relaxed">{n.content}</p>
          </div>
        ))}
      </div>

      <fetcher.Form method="post" className="flex flex-col gap-2">
        <input type="hidden" name="_action" value="add_note" />
        <textarea
          id="note-input"
          name="content"
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="Add an internal note…"
          rows={3}
          className="w-full bg-bc-surface border border-bc-divider rounded-[10px] px-3 py-2.5 font-ui text-[0.78rem] text-white placeholder-bc-secondary/40 focus:outline-none focus:border-bc-red transition-colors resize-none"
        />
        {fetcher.data?.error && <p className="font-ui text-[0.72rem] text-bc-red">{fetcher.data.error}</p>}
        <button type="submit" disabled={!content.trim() || fetcher.state !== 'idle'}
          className="self-end font-ui text-[0.75rem] font-medium bg-bc-red text-white px-4 py-1.5 rounded-[8px] hover:bg-bc-red/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          {fetcher.state !== 'idle' ? 'Adding…' : 'Add Note'}
        </button>
      </fetcher.Form>
    </Card>
  );
}

/* ── TrackingCard ────────────────────────────────────────── */
function TrackingCard({order, customer}) {
  const fetcher  = useFetcher();
  const [editing, setEditing] = useState(false);
  const [toast,   setToast]   = useState(null);
  const [tn,  setTn]  = useState(order.tracking_number  ?? '');
  const [tc,  setTc]  = useState(order.tracking_carrier ?? '');

  useEffect(() => {
    if (fetcher.data?.ok) {
      setToast(fetcher.data.toast ?? 'Tracking saved.');
      setTimeout(() => setToast(null), 5000);
      setEditing(false);
    }
  }, [fetcher.data]);

  const fmtTS = (d) => {
    if (!d) return null;
    return new Date(d).toLocaleString('en-AU', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const row = (label, value) => value ? (
    <div key={label} className="flex gap-2 items-baseline">
      <span className="font-ui text-[0.65rem] tracking-[0.08em] uppercase text-bc-secondary w-24 shrink-0">{label}</span>
      <span className="font-ui text-[0.78rem] text-white">{value}</span>
    </div>
  ) : null;

  const milestones = [
    {label: 'Delivered',  ts: order.delivered_at, color: '#22c55e'},
    {label: 'Shipped',    ts: order.shipped_at,   color: '#a78bfa'},
    {label: 'Packed',     ts: order.packed_at,    color: '#3b82f6'},
    {label: 'Order placed', ts: order.created_at, color: '#f59e0b'},
  ].filter(m => m.ts);

  const inputCls = 'bg-bc-surface border border-bc-divider rounded-[8px] px-2.5 py-1.5 font-ui text-[0.78rem] text-white placeholder-bc-secondary/50 focus:outline-none focus:border-bc-red transition-colors w-full';

  return (
    <Card title="Fulfilment & Tracking">
      {/* Delivery address */}
      <div className="mb-4 space-y-1">
        {row('Name',    customer?.name)}
        {row('Address', [customer?.address_line1, customer?.address_line2].filter(Boolean).join(', '))}
        {row('City',    [customer?.city, customer?.state, customer?.postcode].filter(Boolean).join(' '))}
        {row('Country', order.country)}
      </div>

      {/* Milestones */}
      {milestones.length > 0 && (
        <div className="mb-4 space-y-2">
          {milestones.map(m => (
            <div key={m.label} className="flex items-center gap-2.5">
              <div className="w-2 h-2 rounded-full shrink-0" style={{background: m.color}} />
              <span className="font-ui text-[0.72rem] text-bc-secondary w-20 shrink-0">{m.label}</span>
              <span className="font-ui text-[0.72rem] text-white">{fmtTS(m.ts)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tracking info */}
      {!editing ? (
        <div className="space-y-1">
          {row('Carrier',  order.tracking_carrier || '—')}
          {row('Tracking', order.tracking_number  || '—')}
          <button
            onClick={() => setEditing(true)}
            className="mt-2 font-ui text-[0.72rem] text-bc-red hover:text-bc-red/80 transition-colors"
          >
            {order.tracking_number ? 'Edit tracking' : 'Add tracking number'}
          </button>
        </div>
      ) : (
        <fetcher.Form method="post" className="space-y-2 mt-1">
          <input type="hidden" name="_action" value="add_tracking" />
          <input
            name="tracking_carrier"
            value={tc}
            onChange={e => setTc(e.target.value)}
            placeholder="Carrier (e.g. Australia Post)"
            className={inputCls}
          />
          <input
            name="tracking_number"
            value={tn}
            onChange={e => setTn(e.target.value)}
            placeholder="Tracking number"
            className={inputCls}
          />
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={fetcher.state !== 'idle'}
              className="flex-1 bg-bc-red/90 hover:bg-bc-red text-white font-ui text-[0.72rem] px-3 py-1.5 rounded-[8px] transition-colors disabled:opacity-40">
              {fetcher.state !== 'idle' ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setEditing(false)}
              className="flex-1 border border-bc-divider text-bc-secondary hover:text-white font-ui text-[0.72rem] px-3 py-1.5 rounded-[8px] transition-colors">
              Cancel
            </button>
          </div>
        </fetcher.Form>
      )}

      {toast && (
        <div className="mt-3 bg-[#22c55e]/10 border border-[#22c55e]/30 rounded-[10px] p-2.5">
          <p className="font-ui text-[0.72rem] text-[#22c55e]">{toast}</p>
        </div>
      )}
    </Card>
  );
}

/* ── TimelineCard ────────────────────────────────────────── */
function TimelineCard({order, emailLogs, notes, refunds, reviewRequests}) {
  const events = [];

  const push = (ts, label, color, icon) => {
    if (ts) events.push({ts: new Date(ts).getTime(), label, color, icon});
  };

  push(order.created_at,  'Order placed',   '#f59e0b', '🛒');
  push(order.packed_at,   'Packed',          '#3b82f6', '📦');
  push(order.shipped_at,  'Shipped',         '#a78bfa', '🚚');
  push(order.delivered_at,'Delivered',       '#22c55e', '✅');

  (refunds ?? []).forEach(r =>
    push(r.created_at, `Refund ${fmt(r.amount, order.currency)}`, '#e52b2b', '↩'));

  (emailLogs ?? []).forEach(e => {
    const labels = {
      invoice: 'Invoice emailed',
      refund_remittance: 'Refund remittance emailed',
      review_request: 'Review request sent',
    };
    push(e.created_at, labels[e.type] ?? `Email: ${e.type}`, '#60a5fa', '✉');
  });

  (reviewRequests ?? []).forEach(r =>
    push(r.sent_at, 'Review request sent', '#60a5fa', '⭐'));

  (notes ?? []).forEach(n =>
    push(n.created_at, `Note: ${n.content.slice(0, 60)}${n.content.length > 60 ? '…' : ''}`, '#6b7280', '📝'));

  events.sort((a, b) => b.ts - a.ts);

  if (events.length === 0) return null;

  const fmtTS = (ts) => new Date(ts).toLocaleString('en-AU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  return (
    <Card title="Timeline">
      <div className="relative">
        <div className="absolute left-[9px] top-0 bottom-0 w-px bg-bc-divider" />
        <div className="space-y-4">
          {events.map((ev, i) => (
            <div key={i} className="flex gap-3 items-start">
              <div className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center z-10 relative"
                style={{background: `${ev.color}1a`, border: `1px solid ${ev.color}66`}}>
                <span style={{fontSize: '0.55rem', lineHeight: 1}}>{ev.icon}</span>
              </div>
              <div className="pb-1 flex-1 min-w-0">
                <p className="font-ui text-[0.78rem] text-white leading-snug">{ev.label}</p>
                <p className="font-ui text-[0.65rem] text-bc-secondary mt-0.5">{fmtTS(ev.ts)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

/* ── PackingSlipModal ────────────────────────────────────── */
function PackingSlipModal({order, customer, items, onClose}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-white text-black rounded-[16px] w-full max-w-lg overflow-hidden shadow-2xl packing-slip max-h-[90vh] flex flex-col">
        {/* Print controls — hidden when printing */}
        <div className="flex justify-between items-center px-6 py-3 bg-gray-100 no-print">
          <span className="font-ui text-[0.78rem] text-gray-600 font-medium">Packing Slip</span>
          <div className="flex gap-2">
            <button onClick={() => window.print()}
              className="px-3 py-1.5 bg-black text-white font-ui text-[0.72rem] rounded-[8px] hover:bg-gray-800 transition-colors">
              Print
            </button>
            <button onClick={onClose}
              className="px-3 py-1.5 border border-gray-300 text-gray-600 font-ui text-[0.72rem] rounded-[8px] hover:bg-gray-50 transition-colors">
              Close
            </button>
          </div>
        </div>

        <div className="p-6 print-area overflow-y-auto flex-1">
          {/* Header */}
          <div className="flex justify-between items-start mb-6 pb-4 border-b border-gray-200">
            <div>
              <p className="font-display text-[1.4rem] tracking-[0.15em] text-black leading-none">BLACKCROW</p>
              <p className="font-ui text-[0.6rem] tracking-[0.12em] text-gray-500 uppercase mt-0.5">AUTOMOTIVE DETAILING</p>
            </div>
            <div className="text-right">
              <p className="font-ui text-[0.62rem] text-gray-400 uppercase tracking-wide">Packing Slip</p>
              <p className="font-ui text-[0.85rem] font-semibold text-black">{order.order_number ?? '—'}</p>
              <p className="font-ui text-[0.7rem] text-gray-500">{order.date ?? '—'}</p>
            </div>
          </div>

          {/* Ship to */}
          <div className="mb-6">
            <p className="font-ui text-[0.58rem] tracking-[0.12em] uppercase text-gray-400 mb-1.5">Ship To</p>
            <p className="font-ui text-[0.82rem] font-medium text-black">{customer?.name ?? '—'}</p>
            {customer?.address_line1 && <p className="font-ui text-[0.78rem] text-gray-600">{customer.address_line1}</p>}
            {customer?.address_line2 && <p className="font-ui text-[0.78rem] text-gray-600">{customer.address_line2}</p>}
            <p className="font-ui text-[0.78rem] text-gray-600">
              {[customer?.city, customer?.state, customer?.postcode].filter(Boolean).join(' ')}
            </p>
            {order.country && <p className="font-ui text-[0.78rem] text-gray-600">{order.country}</p>}
          </div>

          {/* Items */}
          <div className="overflow-x-auto">
          <table className="w-full min-w-[280px]">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="font-ui text-[0.58rem] tracking-[0.1em] uppercase text-gray-400 text-left pb-2">Item</th>
                <th className="font-ui text-[0.58rem] tracking-[0.1em] uppercase text-gray-400 text-center pb-2 w-12">Qty</th>
                <th className="font-ui text-[0.58rem] tracking-[0.1em] uppercase text-gray-400 text-right pb-2 w-20">Price</th>
              </tr>
            </thead>
            <tbody>
              {(items ?? []).map((it, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="font-ui text-[0.78rem] text-black py-2">{it.product_name ?? it.description ?? '—'}</td>
                  <td className="font-ui text-[0.78rem] text-gray-600 text-center py-2">{it.quantity ?? 1}</td>
                  <td className="font-ui text-[0.78rem] text-black text-right py-2">{fmt(it.unit_price ?? it.price ?? 0, order.currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="font-ui text-[0.72rem] font-semibold text-black text-right pt-3 pr-3">Total</td>
                <td className="font-ui text-[0.78rem] font-semibold text-black text-right pt-3">{fmt(order.total, order.currency)}</td>
              </tr>
            </tfoot>
          </table>
          </div>

          {/* Tracking */}
          {order.tracking_number && (
            <div className="mt-5 pt-4 border-t border-gray-200">
              <p className="font-ui text-[0.58rem] tracking-[0.1em] uppercase text-gray-400 mb-1">Tracking</p>
              <p className="font-ui text-[0.78rem] text-black">
                {order.tracking_carrier ? `${order.tracking_carrier} · ` : ''}{order.tracking_number}
              </p>
            </div>
          )}

          <p className="mt-6 font-ui text-[0.65rem] text-gray-400 text-center">Thank you for your order.</p>
        </div>
      </div>
    </div>
  );
}

/* ── ActionsPanel ────────────────────────────────────────── */
function ActionsPanel({order, invoice, onCreateRefund, onAddNote, onPackingSlip}) {
  const fetcher = useFetcher();
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (fetcher.data?.toast || fetcher.data?.ok) {
      setToast(fetcher.data?.toast ?? 'Action completed.');
      setTimeout(() => setToast(null), 6000);
    }
  }, [fetcher.data]);

  /* ── Icons ── */
  const IcoInvoice  = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>;
  const IcoEye      = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
  const IcoPrint    = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>;
  const IcoDownload = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
  const IcoSend     = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;
  const IcoRefund   = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>;
  const IcoMail     = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>;
  const IcoStar     = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>;
  const IcoNote     = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>;
  const IcoHash     = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>;
  const IcoBox      = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>;
  const IcoTruck    = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>;
  const IcoCheck    = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
  const IcoClipboard= () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>;

  /* ── Button builders ── */
  const ghostCls = 'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[10px] font-ui text-[0.78rem] font-medium transition-colors text-left text-white hover:bg-white/[0.06] border border-bc-divider hover:border-bc-red/40 disabled:opacity-40 disabled:cursor-not-allowed';

  const btn = (label, Icon, onClick) => (
    <button onClick={onClick} className={ghostCls}>
      <span className="text-bc-secondary"><Icon /></span>
      {label}
    </button>
  );

  const submitBtn = (intent, label, Icon) => (
    <fetcher.Form method="post" className="w-full">
      <input type="hidden" name="_action" value={intent} />
      <button type="submit" disabled={fetcher.state !== 'idle'} className={ghostCls}>
        <span className="text-bc-secondary"><Icon /></span>
        {fetcher.state !== 'idle' && fetcher.formData?.get('_action') === intent
          ? 'Processing…' : label}
      </button>
    </fetcher.Form>
  );

  const Divider = () => <div className="h-px bg-bc-divider my-1" />;

  return (
    <Card title="Actions">
      {/* Invoice number chip — visible once generated */}
      {invoice && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-bc-surface rounded-[10px] border border-bc-divider/60">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-bc-secondary shrink-0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span className="font-ui text-[0.7rem] text-bc-secondary">Invoice</span>
          <span className="font-ui text-[0.72rem] font-semibold text-white">{invoice.invoice_number}</span>
          <span className="ml-auto font-ui text-[0.62rem] rounded-full px-2 py-0.5"
            style={{
              background: invoice.status === 'paid' ? '#22c55e1a' : '#f59e0b1a',
              color:      invoice.status === 'paid' ? '#22c55e'   : '#f59e0b',
            }}>
            {invoice.status}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {/* ── Fulfilment ── */}
        {order.shipping_status === 'pending' && submitBtn('mark_packed',    'Mark as Packed',    IcoBox)}
        {order.shipping_status === 'processing' && submitBtn('mark_shipped',  'Mark as Shipped',   IcoTruck)}
        {order.shipping_status === 'shipped' && submitBtn('mark_delivered', 'Mark as Delivered', IcoCheck)}
        {btn('Print Packing Slip', IcoClipboard, onPackingSlip)}

        <Divider />

        {/* Order number — assign if missing */}
        {!order.order_number?.startsWith('BCA-ORD-') && (
          submitBtn('assign_order_number', 'Assign Order Number', IcoHash)
        )}

        <Divider />

        {/* Invoice generation */}
        {!invoice && submitBtn('generate_invoice', 'Generate Invoice', IcoInvoice)}

        {/* Invoice view / print / save */}
        {btn('Preview Invoice', IcoEye, () =>
          window.open(`/invoice/${order.id}`, '_blank'))}
        {btn('Print Invoice', IcoPrint, () =>
          window.open(`/invoice/${order.id}?print=1`, '_blank'))}
        {btn('Save Invoice PDF', IcoDownload, () =>
          window.open(`/invoice/${order.id}`, '_blank'))}
        {submitBtn('email_invoice', 'Email Invoice', IcoSend)}

        <Divider />

        {/* Refund actions */}
        {btn('Create Refund', IcoRefund, onCreateRefund)}
        {submitBtn('email_refund_remittance', 'Email Refund Remittance', IcoMail)}

        <Divider />

        {/* Review */}
        {submitBtn('send_review_request', 'Send Review Request', IcoStar)}

        <Divider />

        {/* Notes */}
        {btn('Add Internal Note', IcoNote, onAddNote)}
      </div>

      {toast && (
        <div className="mt-3 bg-[#22c55e]/10 border border-[#22c55e]/30 rounded-[10px] p-3">
          <p className="font-ui text-[0.72rem] text-[#22c55e] leading-relaxed">{toast}</p>
        </div>
      )}
    </Card>
  );
}

/* ── StatusPanel ─────────────────────────────────────────── */
function StatusPanel({order}) {
  const fetcher = useFetcher();
  const [local, setLocal] = useState({
    status:          order.status,
    payment_status:  order.payment_status,
    shipping_status: order.shipping_status,
    refund_status:   order.refund_status,
  });

  // Sync if order data revalidates
  useEffect(() => {
    setLocal({
      status:          order.status,
      payment_status:  order.payment_status,
      shipping_status: order.shipping_status,
      refund_status:   order.refund_status,
    });
  }, [order.status, order.payment_status, order.shipping_status, order.refund_status]);

  const selCls = 'w-full bg-bc-surface border border-bc-divider rounded-[8px] px-2 py-1.5 font-ui text-[0.75rem] text-white focus:outline-none focus:border-bc-red transition-colors appearance-none';

  return (
    <Card title="Order Status">
      <fetcher.Form method="post" className="flex flex-col gap-3">
        <input type="hidden" name="_action" value="update_status" />

        {[
          ['status',          'Order',    STATUS_CFG.order.opts],
          ['payment_status',  'Payment',  STATUS_CFG.payment.opts],
          ['shipping_status', 'Shipping', STATUS_CFG.shipping.opts],
          ['refund_status',   'Refund',   STATUS_CFG.refund.opts],
        ].map(([field, label, opts]) => (
          <div key={field} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-[80px]">
              <StatusBadge type={field.replace('_status', '')} value={local[field]} />
            </div>
            <div className="flex-1 min-w-0">
              <select name={field} value={local[field]}
                onChange={e => setLocal(p => ({...p, [field]: e.target.value}))}
                className={selCls}>
                {opts.map(o => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
              </select>
            </div>
          </div>
        ))}

        <button type="submit"
          className="mt-1 w-full font-ui text-[0.75rem] font-medium bg-bc-red text-white py-2 rounded-[10px] hover:bg-bc-red/80 transition-colors">
          {fetcher.state !== 'idle' ? 'Saving…' : 'Update Status'}
        </button>
      </fetcher.Form>
    </Card>
  );
}

/* ── RefundsPanel ────────────────────────────────────────── */
function RefundsPanel({refunds, currency}) {
  const statusColor = {pending:'#f59e0b', approved:'#3b82f6', rejected:'#e52b2b', processed:'#22c55e'};

  return (
    <Card title={`Refunds${refunds.length ? ` (${refunds.length})` : ''}`}>
      {refunds.length === 0 ? (
        <p className="font-ui text-[0.75rem] text-bc-secondary">No refunds on this order.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {refunds.map((r) => (
            <div key={r.id} className="bg-bc-surface rounded-[10px] p-3 border border-bc-divider/50">
              <div className="flex items-center justify-between mb-1">
                <span className="font-ui text-[0.85rem] font-semibold text-white">{fmt(r.amount, currency)}</span>
                <span className="font-ui text-[0.65rem] rounded-full px-2 py-0.5"
                  style={{background: (statusColor[r.status] ?? '#6b7280') + '1a', color: statusColor[r.status] ?? '#6b7280'}}>
                  {r.status}
                </span>
              </div>
              {r.reason && <p className="font-ui text-[0.72rem] text-bc-secondary">{r.reason}</p>}
              <p className="font-ui text-[0.65rem] text-bc-secondary/50 mt-1">{fmtDT(r.created_at)}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ── RefundModal ─────────────────────────────────────────── */
function RefundModal({orderId, maxAmount, currency, onClose}) {
  const fetcher = useFetcher();

  useEffect(() => {
    if (fetcher.data?.ok) onClose();
  }, [fetcher.data]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{background:'rgba(0,0,0,0.65)', backdropFilter:'blur(4px)'}}>
      <div className="bg-bc-bg border border-bc-divider rounded-[24px] w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-bc-divider">
          <p className="font-display text-[1.5rem] text-white leading-none">CREATE REFUND</p>
          <button onClick={onClose} className="text-bc-secondary hover:text-white transition-colors p-1">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <fetcher.Form method="post" className="px-6 py-5 flex flex-col gap-4">
          <input type="hidden" name="_action" value="create_refund" />
          <label className="flex flex-col gap-1.5">
            <span className="font-ui text-[0.65rem] uppercase tracking-[0.1em] text-bc-secondary">Amount ({currency})</span>
            <input name="amount" type="number" step="0.01" min="0.01" max={maxAmount}
              placeholder={`Max ${fmt(maxAmount, currency)}`}
              className="bg-bc-surface border border-bc-divider rounded-[10px] px-3 py-2.5 font-ui text-[0.85rem] text-white placeholder-bc-secondary/40 focus:outline-none focus:border-bc-red transition-colors"
              required />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-ui text-[0.65rem] uppercase tracking-[0.1em] text-bc-secondary">Reason</span>
            <textarea name="reason" rows={3}
              placeholder="Describe the reason for this refund…"
              className="bg-bc-surface border border-bc-divider rounded-[10px] px-3 py-2.5 font-ui text-[0.82rem] text-white placeholder-bc-secondary/40 focus:outline-none focus:border-bc-red transition-colors resize-none" />
          </label>
          {fetcher.data?.error && <p className="font-ui text-[0.72rem] text-bc-red">{fetcher.data.error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={onClose}
              className="flex-1 font-ui text-[0.78rem] text-bc-secondary border border-bc-divider rounded-[10px] py-2.5 hover:text-white hover:border-bc-divider/80 transition-colors">
              Cancel
            </button>
            <button type="submit"
              className="flex-1 font-ui text-[0.78rem] font-medium bg-bc-red text-white rounded-[10px] py-2.5 hover:bg-bc-red/80 transition-colors">
              {fetcher.state !== 'idle' ? 'Creating…' : 'Create Refund'}
            </button>
          </div>
        </fetcher.Form>
      </div>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────── */
export default function OrderDetailPage() {
  const {order}           = useLoaderData();
  const [refundModal,     setRefundModal]     = useState(false);
  const [packingSlipOpen, setPackingSlipOpen] = useState(false);

  const {
    customers:      customer,
    order_items:    items,
    email_logs:     emailLogs,
    internal_notes: notes,
    review_requests:reviewRequests,
    refunds,
    invoices:       invoiceList,
  } = order;

  const invoice = invoiceList?.[0] ?? null;

  return (
    <div className="px-4 sm:px-6 py-6 sm:py-8 max-w-[1400px] mx-auto">
      {/* Back */}
      <Link to="/adminlogonprotocol/orders"
        className="inline-flex items-center gap-1.5 font-ui text-[0.72rem] text-bc-secondary hover:text-white transition-colors mb-6 group">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="group-hover:-translate-x-0.5 transition-transform"><polyline points="15 18 9 12 15 6"/></svg>
        Back to Orders
      </Link>

      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h1 className="font-display text-[1.8rem] sm:text-[2.6rem] text-white leading-none tracking-wide break-all">
            {order.order_number}
          </h1>
        </div>
        {/* Labelled status row */}
        <div className="flex flex-wrap items-center gap-4 mb-3">
          {[
            ['Order',    'order',    order.status],
            ['Payment',  'payment',  order.payment_status],
            ['Shipping', 'shipping', order.shipping_status],
            ...(order.refund_status !== 'none' ? [['Refund', 'refund', order.refund_status]] : []),
          ].map(([label, type, value]) => (
            <div key={label} className="flex items-center gap-1.5">
              <span className="font-ui text-[0.6rem] tracking-[0.1em] uppercase text-bc-secondary">{label}</span>
              <StatusBadge type={type} value={value} />
            </div>
          ))}
        </div>
        <p className="font-ui text-[0.78rem] text-bc-secondary">
          {customer?.name ?? 'Unknown customer'}
          {' · '}
          {fmtDate(order.date)}
          {' · '}
          {[customer?.city, customer?.state, order.country].filter(Boolean).join(', ') || order.country || '—'}
          {' · '}
          <span className="text-white font-medium">{fmt(order.total, order.currency)}</span>
        </p>
      </div>

      {/* 2-column layout */}
      <div className="flex gap-6 items-start flex-col xl:flex-row">

        {/* LEFT — main content */}
        <div className="flex-1 min-w-0 flex flex-col gap-6">
          <CustomerCard customer={customer} />
          <TrackingCard order={order} customer={customer} />
          <OrderItemsCard items={items ?? []} order={order} />
          {invoice && <InvoiceEditCard invoice={invoice} order={order} />}
          <CommHistoryCard emailLogs={emailLogs ?? []} reviewRequests={reviewRequests ?? []} />
          <NotesCard notes={notes ?? []} orderId={order.id} />
          <TimelineCard
            order={order}
            emailLogs={emailLogs ?? []}
            notes={notes ?? []}
            refunds={refunds ?? []}
            reviewRequests={reviewRequests ?? []}
          />
        </div>

        {/* RIGHT — actions + status */}
        <div className="w-full xl:w-80 xl:flex-shrink-0 flex flex-col gap-4 xl:sticky xl:top-20 order-first xl:order-last">
          <ActionsPanel
            order={order}
            invoice={invoice}
            onCreateRefund={() => setRefundModal(true)}
            onPackingSlip={() => setPackingSlipOpen(true)}
            onAddNote={() => {
              const el = document.getElementById('note-input');
              el?.scrollIntoView({behavior:'smooth', block:'center'});
              setTimeout(() => el?.focus(), 300);
            }}
          />
          <StatusPanel order={order} />
          <RefundsPanel refunds={refunds ?? []} currency={order.currency} />
        </div>
      </div>

      {refundModal && (
        <RefundModal
          orderId={order.id}
          maxAmount={order.total}
          currency={order.currency}
          onClose={() => setRefundModal(false)}
        />
      )}

      {packingSlipOpen && (
        <PackingSlipModal
          order={order}
          customer={customer}
          items={items ?? []}
          onClose={() => setPackingSlipOpen(false)}
        />
      )}
    </div>
  );
}
