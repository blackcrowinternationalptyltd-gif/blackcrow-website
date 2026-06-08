import {useEffect} from 'react';
import {json} from '@shopify/remix-oxygen';
import {useLoaderData, useSearchParams} from '@remix-run/react';
import {getSupabase} from '~/lib/supabase.server';
import {requireAdminUser} from '~/lib/auth.server';
import {COUNTRY_CONFIG, resolveCountryKey} from '~/lib/country-config';

export const meta = ({data}) => [
  {title: `${data?.invoice?.invoice_number ?? 'Invoice'} | BlackCrow`},
];

/* ── Helpers ─────────────────────────────────────────────── */
async function nextInvoiceNumber(sb) {
  const {data} = await sb
    .from('invoices')
    .select('invoice_number')
    .like('invoice_number', 'BCA-INV-%')
    .order('created_at', {ascending: false})
    .limit(1);
  const n =
    Number(data?.[0]?.invoice_number?.match(/(\d+)$/)?.[1] ?? 0) + 1;
  return `BCA-INV-${String(n).padStart(7, '0')}`;
}

function buildAddr(c) {
  return [c?.address_line1, c?.city, c?.state, c?.postcode, c?.country]
    .filter(Boolean)
    .join(', ');
}

/* ── Loader ──────────────────────────────────────────────── */
export async function loader({request, params}) {
  await requireAdminUser(request); // Invoices contain customer PII — admin only
  const sb = getSupabase();
  if (!sb) throw new Response('Supabase not configured', {status: 503});

  const {data: order, error} = await sb
    .from('orders')
    .select(`*, customers(*), order_items(*), invoices(*)`)
    .eq('id', params.id)
    .single();

  if (error || !order) throw new Response('Order not found', {status: 404});

  const customer = order.customers ?? {};
  let invoice = order.invoices?.[0] ?? null;

  /* Auto-create invoice if none exists */
  if (!invoice) {
    const invNum = await nextInvoiceNumber(sb);
    const addr   = buildAddr(customer);

    /* Try full insert (schema v2 with extended columns) */
    let {data: created, error: insErr} = await sb
      .from('invoices')
      .insert({
        order_id:        order.id,
        invoice_number:  invNum,
        issued_date:     order.date ?? new Date().toISOString().slice(0, 10),
        status:          order.payment_status === 'paid' ? 'paid' : 'issued',
        customer_name:   customer.name    ?? null,
        customer_email:  customer.email   ?? null,
        customer_phone:  customer.phone   ?? null,
        billing_address: addr,
        shipping_address: addr,
        payment_method:  'Credit Card',
        subtotal:        order.subtotal      ?? 0,
        freight:         order.shipping_cost ?? 0,
        rounding:        0,
        gst:             order.tax           ?? 0,
        total:           order.total         ?? 0,
      })
      .select()
      .single();

    /* Fallback: insert with base columns only (schema v1) */
    if (insErr) {
      ({data: created, error: insErr} = await sb
        .from('invoices')
        .insert({
          order_id:       order.id,
          invoice_number: invNum,
          issued_date:    order.date ?? new Date().toISOString().slice(0, 10),
          status:         order.payment_status === 'paid' ? 'paid' : 'issued',
        })
        .select()
        .single());
    }

    /* Use persisted row if saved, otherwise use an in-memory draft */
    invoice = created ?? {
      invoice_number: invNum,
      issued_date:    order.date,
      status:         order.payment_status === 'paid' ? 'paid' : 'issued',
    };
  }

  /* Determine country entity key for company header + tax config */
  const countryKey = invoice?.country_entity
    || resolveCountryKey(customer?.country ?? order.country);

  return json({
    order,
    customer,
    items:      order.order_items ?? [],
    invoice,
    countryKey,
  });
}

/* ── Format helpers ──────────────────────────────────────── */
function money(n, sym) {
  const num = Number(n ?? 0).toFixed(2);
  if (!sym || sym === '$') return `$${num}`;
  if (sym === 'kr') return `${num}\u00a0kr`;
  return `${sym}${num}`;
}
function fmtDate(d) {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-AU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

/* ── SVG Icons ───────────────────────────────────────────── */
const IcoShield = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
);
const IcoBox = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
    <line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>
);
const IcoHeadset = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
    <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/>
    <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
  </svg>
);
const IcoCheck = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
    <polyline points="22 4 12 14.01 9 11.01"/>
  </svg>
);
const IcoCart = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="21" r="1"/>
    <circle cx="20" cy="21" r="1"/>
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
  </svg>
);
const IcoHandshake = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
    <line x1="9" y1="9" x2="9.01" y2="9"/>
    <line x1="15" y1="9" x2="15.01" y2="9"/>
  </svg>
);

/* ── Page ────────────────────────────────────────────────── */
export default function InvoicePrint() {
  const {order, customer, items, invoice, countryKey} = useLoaderData();
  const [params] = useSearchParams();

  useEffect(() => {
    if (params.get('print') === '1') setTimeout(() => window.print(), 900);
  }, []);

  const cfg           = COUNTRY_CONFIG[countryKey] ?? COUNTRY_CONFIG.Australia;
  const co            = cfg.company;
  const c             = customer ?? {};
  const addrParts     = [c.address_line1, c.city, c.state, c.postcode, c.country].filter(Boolean);
  const payStatus     = (order.payment_status ?? 'pending').toUpperCase();
  const payMethod     = invoice?.payment_method ?? 'Credit Card';
  const subtotal      = Number(invoice?.subtotal    ?? order.subtotal      ?? 0);
  const freight       = Number(invoice?.freight     ?? order.shipping_cost ?? 0);
  const rounding      = Number(invoice?.rounding    ?? 0);
  const gst           = Number(invoice?.gst         ?? order.tax           ?? 0);
  const total         = Number(invoice?.total       ?? order.total         ?? 0);
  const taxLabel      = cfg.taxLabel;
  const taxCode       = cfg.taxCode;
  const location      = invoice?.location ?? '';
  const mCur          = order.currency ?? cfg.currency ?? 'AUD';
  const mSym          = mCur === 'SEK' ? 'kr' : ({GBP:'£',EUR:'€',JPY:'¥'}[mCur] ?? '$');
  const emptyRows     = Math.max(0, 2 - items.length);

  const TOTALS = [
    ['Sub-Total',  subtotal],
    ['Freight',    freight],
    ['Rounding',   rounding],
    [taxLabel,     gst],
    ['TOTAL',      total],
  ];

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          font-family: Arial, Helvetica, sans-serif;
          background: #e0e0e0;
          color: #000;
          font-size: 11px;
        }

        /* ── Screen toolbar ── */
        .toolbar {
          display: flex;
          justify-content: center;
          gap: 12px;
          padding: 14px;
          background: #222;
        }
        .toolbar-btn-print {
          background: #e52b2b;
          color: #fff;
          border: none;
          border-radius: 6px;
          padding: 9px 28px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          font-family: Arial, sans-serif;
        }
        .toolbar-btn-close {
          background: #555;
          color: #ccc;
          border: none;
          border-radius: 6px;
          padding: 9px 20px;
          font-size: 13px;
          cursor: pointer;
          font-family: Arial, sans-serif;
        }

        /* ── Invoice page ── */
        .inv {
          background: #fff;
          width: 100%;
          max-width: 1060px;
          margin: 20px auto 40px;
          padding: 20px 22px 0;
          box-shadow: 0 4px 32px rgba(0,0,0,0.22);
        }

        /* ── Header ── */
        .inv-hdr {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 14px;
        }
        .inv-logo {
          font-family: 'Arial Black', 'Arial', Impact, sans-serif;
          font-weight: 900;
          font-size: 52px;
          line-height: 0.92;
          color: #000;
          text-transform: uppercase;
          letter-spacing: -0.01em;
        }
        .inv-co {
          text-align: right;
          font-size: 10.5px;
          line-height: 1.6;
        }
        .inv-co .b { font-weight: 700; }

        /* ── Bordered boxes ── */
        .box {
          border: 1px solid #000;
          position: relative;
          padding: 18px 9px 9px;
        }
        .box-lbl {
          position: absolute;
          top: -8px;
          left: 8px;
          background: #fff;
          padding: 0 4px;
          font-size: 11px;
          font-weight: 700;
        }

        /* Three-column info row */
        .info-row {
          display: grid;
          grid-template-columns: 1fr 1fr 230px;
          margin-bottom: 10px;
        }
        .info-row .box { min-height: 115px; }
        .info-row .box:not(:last-child) { border-right: none; }

        .dt { display: flex; gap: 4px; margin-bottom: 3px; }
        .dt-lbl { font-weight: 700; min-width: 66px; }

        /* Note / Payment Status row */
        .note-row {
          display: grid;
          grid-template-columns: 2fr 1fr;
          margin-bottom: 10px;
        }
        .note-row .box { min-height: 65px; }
        .note-row .box:first-child { border-right: none; }

        /* ── Items table ── */
        .tbl {
          width: 100%;
          border-collapse: collapse;
          font-size: 10.5px;
        }
        .tbl th, .tbl td {
          border: 1px solid #000;
          padding: 4px 5px;
          white-space: nowrap;
        }
        .tbl th {
          font-weight: 700;
          text-align: center;
          background: #fff;
        }
        .tbl td { vertical-align: middle; height: 26px; }
        .tbl .tc { text-align: center; }
        .tbl .tr { text-align: right; }
        .tbl .tl { text-align: left; }
        .tbl .desc { white-space: normal; }

        /* Column widths */
        .col-lineno   { width: 48px; }
        .col-loc      { width: 62px; }
        .col-stock    { width: 90px; }
        .col-desc     { width: auto; }
        .col-ordered  { width: 56px; }
        .col-bo       { width: 40px; }
        .col-supplied { width: 62px; }
        .col-ulist    { width: 70px; }
        .col-unet     { width: 70px; }
        .col-tax      { width: 68px; }
        .col-total    { width: 70px; }

        /* ── Footer section ── */
        .inv-footer {
          display: grid;
          grid-template-columns: 250px 1fr 290px;
          border: 1px solid #000;
          border-top: none;
        }

        /* Left: QR + thank you */
        .ft-left {
          border-right: 1px solid #000;
          padding: 10px;
          font-size: 10px;
        }
        .ft-qr-row {
          display: flex;
          gap: 8px;
          margin-bottom: 8px;
          align-items: flex-start;
        }
        .ft-qr-img {
          width: 76px;
          height: 76px;
          flex-shrink: 0;
          border: 1px solid #ccc;
        }
        .ft-bold { font-weight: 700; font-size: 10px; line-height: 1.3; }
        .ft-para { font-size: 9.5px; line-height: 1.45; margin-top: 4px; }
        .ft-stars { color: #e52b2b; font-size: 16px; margin-top: 6px; letter-spacing: 2px; }
        .ft-love { font-weight: 700; font-size: 10px; margin-top: 2px; }
        .ft-scan { font-size: 9.5px; margin-top: 2px; }
        .ft-hr { border: none; border-top: 1px solid #bbb; margin: 8px 0; }
        .ft-more {
          display: flex;
          align-items: flex-start;
          gap: 5px;
          font-size: 9.5px;
          margin-top: 2px;
        }

        /* Middle: icons */
        .ft-icons {
          border-right: 1px solid #000;
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 13px;
        }
        .ft-icon-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 10.5px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.02em;
          color: #222;
        }

        /* Right: totals */
        .ft-right {
          display: flex;
          flex-direction: column;
        }
        .totals-hdr {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          border-bottom: 1px solid #000;
        }
        .totals-hdr-cell {
          padding: 6px 4px;
          text-align: center;
          font-weight: 700;
          font-size: 11px;
          border-right: 1px solid #000;
        }
        .totals-hdr-cell:last-child {
          background: #000;
          color: #fff;
          border-right: none;
        }
        .totals-val {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          border-bottom: 1px solid #000;
        }
        .totals-val-cell {
          padding: 7px 4px;
          text-align: center;
          font-weight: 700;
          font-size: 12px;
          border-right: 1px solid #000;
        }
        .totals-val-cell:last-child { border-right: none; }
        .ft-ty {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px;
          flex: 1;
        }
        .ft-ty-text .hd {
          font-weight: 700;
          font-size: 11px;
          text-transform: uppercase;
          margin-bottom: 5px;
        }
        .ft-ty-text p { font-size: 10px; line-height: 1.5; }

        /* ── Bottom label ── */
        .inv-btm {
          border-top: 1px solid #aaa;
          text-align: center;
          padding: 7px;
          font-weight: 700;
          font-size: 13px;
          letter-spacing: 0.14em;
          margin-top: 8px;
        }

        /* ── Print ── */
        @media print {
          body { background: #fff; }
          .toolbar { display: none !important; }
          .inv {
            box-shadow: none;
            margin: 0;
            padding: 0 0 0;
            width: 100%;
            max-width: 100%;
          }
          @page { size: A4; margin: 8mm 10mm; }
        }

        @media screen and (max-width: 800px) {
          .inv-logo { font-size: 34px; }
          .info-row { grid-template-columns: 1fr; }
          .info-row .box:not(:last-child) { border-right: 1px solid #000; border-bottom: none; }
          .note-row { grid-template-columns: 1fr; }
          .note-row .box:first-child { border-right: 1px solid #000; border-bottom: none; }
          .inv-footer { grid-template-columns: 1fr; }
          .ft-left, .ft-icons { border-right: none; border-bottom: 1px solid #000; }
        }
      `}</style>

      {/* Toolbar (screen only) */}
      <div className="toolbar">
        <button className="toolbar-btn-print" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
        <button className="toolbar-btn-close" onClick={() => window.close()}>
          Close
        </button>
      </div>

      {/* ══════════════ Invoice Page ══════════════ */}
      <div className="inv">

        {/* ── HEADER ── */}
        <div className="inv-hdr">
          <div className="inv-logo">
            BLACKCROW<br />AUTOMOTIVE
          </div>
          <div className="inv-co">
            <p className="b">{co.line1}</p>
            {co.line2 && <p className="b">{co.line2}</p>}
            <p>{co.reg}</p>
            <p>{co.addr}</p>
            {co.tel && <p>{co.tel}</p>}
            {co.emails.map(e => <p key={e}>{e}</p>)}
            <p>{co.web}</p>
          </div>
        </div>

        {/* ── CUSTOMER / DELIVER TO / INVOICE DETAILS ── */}
        <div className="info-row">
          <div className="box">
            <div className="box-lbl">Customer</div>
            {c.name    && <p style={{fontWeight:700, marginBottom:2}}>{c.name}</p>}
            {c.company && <p>{c.company}</p>}
            {addrParts.map((line, i) => <p key={i}>{line}</p>)}
            {c.phone   && <p style={{marginTop:4}}>{c.phone}</p>}
            {c.email   && <p>{c.email}</p>}
          </div>

          <div className="box">
            <div className="box-lbl">Deliver To</div>
            {c.name && <p style={{fontWeight:700, marginBottom:2}}>{c.name}</p>}
            {c.company && <p>{c.company}</p>}
            {addrParts.map((line, i) => <p key={i}>{line}</p>)}
          </div>

          <div className="box">
            <div className="box-lbl">Invoice Details</div>
            {[
              ['Inv No:',   invoice?.invoice_number ?? '—'],
              ['Order No:', order.order_number],
              ['Date:',     fmtDate(invoice?.issued_date ?? order.date)],
              ['Payment:',  payStatus],
              ['Method:',   payMethod],
            ].map(([lbl, val]) => (
              <div key={lbl} className="dt">
                <span className="dt-lbl">{lbl}</span>
                <span>{val}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── NOTE / PAYMENT STATUS ── */}
        <div className="note-row">
          <div className="box">
            <div className="box-lbl">Note</div>
            {invoice?.notes && <p>{invoice.notes}</p>}
          </div>
          <div className="box">
            <div className="box-lbl">Payment Status</div>
            <p style={{marginTop:4}}>
              Status:&nbsp;&nbsp;<strong>{payStatus}</strong>
            </p>
          </div>
        </div>

        {/* ── ITEMS TABLE ── */}
        <table className="tbl">
          <thead>
            <tr>
              <th className="col-lineno">Line No</th>
              <th className="col-loc">Location</th>
              <th className="col-stock">Stock Number</th>
              <th className="col-desc tl">Description</th>
              <th className="col-ordered">Ordered</th>
              <th className="col-bo">B.O.</th>
              <th className="col-supplied">Supplied</th>
              <th className="col-ulist tr">Unit List</th>
              <th className="col-unet tr">Unit Net</th>
              <th className="col-tax">Tax Code</th>
              <th className="col-total tr">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={item.id ?? i}>
                <td className="tc">{i + 1}</td>
                <td className="tc">{location}</td>
                <td>{item.variant ?? ''}</td>
                <td className="desc tl">{item.product}</td>
                <td className="tc">{item.quantity}</td>
                <td className="tc">0</td>
                <td className="tc">{item.quantity}</td>
                <td className="tr">{money(item.unit_price, mSym)}</td>
                <td className="tr">{money(item.unit_price, mSym)}</td>
                <td className="tc">{taxCode}</td>
                <td className="tr">{money(item.subtotal, mSym)}</td>
              </tr>
            ))}
            {/* Blank filler rows */}
            {Array.from({length: emptyRows}).map((_, i) => (
              <tr key={`e${i}`}>
                <td></td><td></td><td></td>
                <td></td>
                <td></td>
                <td className="tc">0</td>
                <td className="tc">0</td>
                <td className="tr">{money(0, mSym)}</td>
                <td className="tr">{money(0, mSym)}</td>
                <td className="tc">{taxCode}</td>
                <td className="tr">{money(0, mSym)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ── FOOTER ── */}
        <div className="inv-footer">

          {/* LEFT: QR + thank you text */}
          <div className="ft-left">
            <div className="ft-qr-row">
              <img
                className="ft-qr-img"
                src={`https://api.qrserver.com/v1/create-qr-code/?size=76x76&data=${encodeURIComponent('https://www.blackcrowauto.com.au')}`}
                alt="Review QR"
                width={76}
                height={76}
              />
              <div>
                <p className="ft-bold">THANK YOU FOR CHOOSING BLACKCROW AUTOMOTIVE.</p>
                <p className="ft-para">
                  We appreciate your business and trust in our products.
                  Your support helps us continue delivering premium automotive
                  accessories with quality and reliability you can count on.
                </p>
              </div>
            </div>
            <p className="ft-stars">★★★★★</p>
            <p className="ft-love">LOVE YOUR PURCHASE?</p>
            <p className="ft-scan">Scan the QR code to leave a review.</p>
            <hr className="ft-hr" />
            <div className="ft-more">
              <span style={{flexShrink:0, marginTop:1}}><IcoCart /></span>
              <p>
                <strong>NEED MORE?</strong>&nbsp; Explore our full range of premium
                automotive accessories online at{' '}
                <strong>www.blackcrowauto.com.au</strong>
              </p>
            </div>
          </div>

          {/* MIDDLE: Feature icons */}
          <div className="ft-icons">
            {([
              [IcoShield,  'PREMIUM QUALITY PRODUCTS'],
              [IcoBox,     'FAST & RELIABLE DISPATCH'],
              [IcoHeadset, 'DEDICATED CUSTOMER SUPPORT'],
              [IcoCheck,   'AUSTRALIAN OWNED & OPERATED'],
            ]).map(([Icon, label], i) => (
              <div key={i} className="ft-icon-item">
                <span style={{flexShrink:0}}><Icon /></span>
                <span>{label}</span>
              </div>
            ))}
          </div>

          {/* RIGHT: Totals table + thank you */}
          <div className="ft-right">
            {/* Headers */}
            <div className="totals-hdr">
              {TOTALS.map(([label]) => (
                <div key={label} className="totals-hdr-cell">{label}</div>
              ))}
            </div>
            {/* Values */}
            <div className="totals-val">
              {TOTALS.map(([label, val]) => (
                <div key={label} className="totals-val-cell">{money(val, mSym)}</div>
              ))}
            </div>
            {/* Thank you box */}
            <div className="ft-ty">
              <span style={{flexShrink:0, color:'#555'}}><IcoHandshake /></span>
              <div className="ft-ty-text">
                <p className="hd">THANK YOU FOR YOUR BUSINESS</p>
                <p>
                  We value your trust and look forward to continuing to
                  support your business.
                </p>
              </div>
            </div>
          </div>

        </div>{/* end .inv-footer */}

        {/* ── BOTTOM: TAX INVOICE label ── */}
        <div className="inv-btm">TAX INVOICE</div>

      </div>{/* end .inv */}
    </>
  );
}
