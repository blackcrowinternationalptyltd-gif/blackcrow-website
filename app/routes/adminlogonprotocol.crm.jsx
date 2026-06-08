import {useState, useMemo, useEffect} from 'react';
import {useLoaderData, useFetcher, useNavigate} from '@remix-run/react';
import {json} from '@shopify/remix-oxygen';
import {getSupabase} from '~/lib/supabase.server';
import {requireAdminUser, getCountryFilter} from '~/lib/auth.server';

export const meta = () => [{title: 'CRM | BlackCrow Admin'}];

/* ─── Constants ──────────────────────────────────────────────── */
const COUNTRIES    = ['All','Australia','USA','UK','Canada','Sweden'];
const FLAGS        = {Australia:'🇦🇺',USA:'🇺🇸',UK:'🇬🇧',Canada:'🇨🇦',Sweden:'🇸🇪'};
const STATUSES     = ['Lead','Active','Repeat Buyer','VIP','Trade Lead','Trade Account','Refund Risk','Inactive','Suspended'];
const ALL_TAGS     = ['VIP','Wholesale Lead','Trade Customer','Repeat Buyer','High Value','Refund Risk','Marketing Subscriber','Detailer','Fleet Customer','Trade Candidate'];
const COMM_TYPES   = ['Invoice Emailed','Review Request Sent','Customer Contacted','Phone Call','Email Sent','Refund Issued','Other'];
const DETAIL_TABS  = ['Overview','Orders','Invoices','Communications','Notes','Reviews'];
const PAGE_SIZE    = 25;

const STATUS_CFG = {
  Lead:            {bg:'bg-[#3b82f6]/10',  text:'text-[#60a5fa]'},
  Active:          {bg:'bg-[#22c55e]/10',  text:'text-[#22c55e]'},
  'Repeat Buyer':  {bg:'bg-[#22c55e]/15',  text:'text-[#4ade80]'},
  VIP:             {bg:'bg-[#f59e0b]/10',  text:'text-[#f59e0b]'},
  'Trade Lead':    {bg:'bg-[#a78bfa]/10',  text:'text-[#a78bfa]'},
  'Trade Account': {bg:'bg-[#8b5cf6]/15',  text:'text-[#c4b5fd]'},
  'Refund Risk':   {bg:'bg-bc-red/10',     text:'text-bc-red'},
  Inactive:        {bg:'bg-white/5',       text:'text-bc-secondary/50'},
  Suspended:       {bg:'bg-bc-red/15',     text:'text-bc-red'},
};

const ORDER_STATUS_CFG = {
  processing: {text:'text-[#3b82f6]'}, fulfilled: {text:'text-[#22c55e]'},
  cancelled:  {text:'text-bc-secondary/50'}, refunded: {text:'text-bc-red'},
  pending:    {text:'text-[#f59e0b]'}, paid: {text:'text-[#22c55e]'},
  failed:     {text:'text-bc-red'}, shipped: {text:'text-[#a78bfa]'},
  delivered:  {text:'text-[#22c55e]'}, returned: {text:'text-bc-red'},
};

const COMM_ICONS = {
  'Customer Created':           '✦',
  'Order Created':              '🛒',
  'Invoice Emailed':            '📄',
  'Refund Remittance Emailed':  '💸',
  'Review Request Sent':        '⭐',
  'Customer Contacted':         '📞',
  'Internal Note Added':        '📝',
  'Phone Call':                 '📞',
  'Email Sent':                 '✉️',
  'Status Changed':             '⚡',
  'Refund Issued':              '↩️',
  'Other':                      '💬',
};

/* ─── Helpers ────────────────────────────────────────────────── */
const fmtMoney  = n => (!n || isNaN(n)) ? '$0.00' : `$${Number(n).toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const fmtDate   = d => d ? new Date(d).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'}) : '—';
const fmtDT     = d => d ? new Date(d).toLocaleString('en-AU',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
const cusName   = c => (`${c?.first_name||''} ${c?.last_name||''}`.trim() || c?.name || c?.email || '—');
const thisMonth = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; };

/* ─── Loader ─────────────────────────────────────────────────── */
export async function loader({request}) {
  const user = await requireAdminUser(request);
  const cf   = getCountryFilter(user);
  const sb   = getSupabase();
  const url  = new URL(request.url);

  /* ── Detail fetch (for drawer) ── */
  const customerId = url.searchParams.get('customer_id');
  if (customerId && sb) {
    const [notesRes, commsRes, tagsRes, ordersRes, reviewsRes] = await Promise.all([
      sb.from('customer_notes').select('*').eq('customer_id', customerId).order('created_at',{ascending:false}),
      sb.from('customer_communications').select('*').eq('customer_id', customerId).order('created_at',{ascending:false}),
      sb.from('customer_tags').select('*').eq('customer_id', customerId),
      sb.from('orders').select('id,order_number,date,status,payment_status,shipping_status,total,currency').eq('customer_id', customerId).order('date',{ascending:false}),
      sb.from('customer_reviews').select('*').eq('customer_id', customerId).order('created_at',{ascending:false}),
    ]);

    const orders   = ordersRes.data ?? [];
    const orderIds = orders.map(o => o.id);
    let invoices   = [];
    if (orderIds.length > 0) {
      const {data: invData} = await sb
        .from('invoices')
        .select('id,invoice_number,issued_date,due_date,status,order_id')
        .in('order_id', orderIds)
        .order('issued_date', {ascending:false});
      invoices = invData ?? [];
    }

    return json({
      isDetail: true,
      notes:    notesRes.data  ?? [],
      comms:    commsRes.data  ?? [],
      tags:     tagsRes.data   ?? [],
      orders,
      invoices,
      reviews:  reviewsRes.data ?? [],
    });
  }

  if (!sb) return json({configured:false, customers:[], tagsAll:[], kpis:{}, dbError:null});

  /* ── Main CRM list ── */
  let qCus = sb
    .from('customers')
    .select('id,customer_number,first_name,last_name,name,email,phone,country,status,lifetime_spend,total_orders,last_order_date,refund_count,average_order_value,created_at')
    .order('created_at', {ascending:false});
  if (cf) qCus = qCus.eq('country', cf);
  const {data: cusData, error: cusError} = await qCus;

  const {data: tagsAll} = await sb.from('customer_tags').select('customer_id,tag');

  const cusArr = cusData ?? [];

  /* ── KPIs ── */
  const totalCustomers  = cusArr.length;
  const newThisMonth    = cusArr.filter(c => (c.created_at||'').startsWith(thisMonth())).length;
  const repeatCustomers = cusArr.filter(c => Number(c.total_orders||0) >= 2).length;
  const vipCustomers    = cusArr.filter(c => c.status === 'VIP').length;
  const tradeLeads      = cusArr.filter(c => c.status === 'Trade Lead').length;
  const refundRisk      = cusArr.filter(c => c.status === 'Refund Risk').length;
  const totalRevenue    = cusArr.reduce((s,c) => s + Number(c.lifetime_spend||0), 0);
  const totalOrders     = cusArr.reduce((s,c) => s + Number(c.total_orders||0), 0);
  const avgOrderValue   = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  return json({
    configured: true,
    dbError:    cusError?.message ?? null,
    customers:  cusArr,
    tagsAll:    tagsAll ?? [],
    kpis: {
      totalCustomers,
      newThisMonth,
      repeatCustomers,
      vipCustomers,
      tradeLeads,
      refundRisk,
      totalRevenue,
      avgOrderValue,
    },
  });
}

/* ─── Action ─────────────────────────────────────────────────── */
export async function action({request}) {
  const sb = getSupabase();
  if (!sb) return json({error:'Supabase not configured'},{status:500});

  const form   = await request.formData();
  const intent = form.get('intent');

  if (intent === 'create_customer') {
    const email      = (form.get('email') || '').trim();
    const first_name = (form.get('first_name') || '').trim();
    const last_name  = (form.get('last_name')  || '').trim();
    const phone      = (form.get('phone')      || '').trim();
    const country    = form.get('country')  || 'Australia';
    const status     = form.get('status')   || 'Lead';
    const note       = (form.get('note')    || '').trim();
    const name       = `${first_name} ${last_name}`.trim() || email || 'Unknown';

    // Check for duplicate email
    if (email) {
      const {data: existing} = await sb.from('customers').select('id').eq('email', email).maybeSingle();
      if (existing) {
        return json({error:'A customer with this email already exists.', existingId: existing.id},{status:400});
      }
    }

    const {data: newCust, error: cErr} = await sb
      .from('customers')
      .insert({first_name, last_name, name, email: email || null, phone: phone || null, country, status})
      .select('id')
      .single();
    if (cErr) return json({error: cErr.message},{status:400});

    const customerId = newCust.id;
    await sb.from('customer_communications').insert({
      customer_id: customerId,
      communication_type: 'Customer Created',
      description: `Customer ${name} created manually.`,
      created_by: 'Admin',
    });

    if (note) {
      await sb.from('customer_notes').insert({customer_id: customerId, note, created_by: 'Admin'});
    }

    return json({ok:true, customerId});
  }

  if (intent === 'edit_customer') {
    const customer_id = form.get('customer_id');
    const first_name  = (form.get('first_name') || '').trim();
    const last_name   = (form.get('last_name')  || '').trim();
    const fields = {
      first_name,
      last_name,
      name: `${first_name} ${last_name}`.trim() || form.get('email') || '',
      updated_at: new Date().toISOString(),
    };
    for (const f of ['email','phone','country','status']) {
      const v = form.get(f);
      if (v !== null) fields[f] = v;
    }
    const {error} = await sb.from('customers').update(fields).eq('id', customer_id);
    if (error) return json({error: error.message},{status:400});
    return json({ok:true});
  }

  if (intent === 'add_note') {
    const customer_id = form.get('customer_id');
    const note        = form.get('note');
    const created_by  = form.get('created_by') || 'Admin';
    const {error} = await sb.from('customer_notes').insert({customer_id, note, created_by});
    if (error) return json({error: error.message},{status:400});
    await sb.from('customer_communications').insert({
      customer_id,
      communication_type: 'Internal Note Added',
      description: String(note).slice(0,120),
      created_by,
    });
    return json({ok:true});
  }

  if (intent === 'delete_note') {
    const note_id = form.get('note_id');
    const {error} = await sb.from('customer_notes').delete().eq('id', note_id);
    if (error) return json({error: error.message},{status:400});
    return json({ok:true});
  }

  if (intent === 'add_tag') {
    const customer_id = form.get('customer_id');
    const tag         = form.get('tag');
    await sb.from('customer_tags').upsert({customer_id, tag},{onConflict:'customer_id,tag'});
    return json({ok:true});
  }

  if (intent === 'remove_tag') {
    const customer_id = form.get('customer_id');
    const tag         = form.get('tag');
    await sb.from('customer_tags').delete().eq('customer_id', customer_id).eq('tag', tag);
    return json({ok:true});
  }

  if (intent === 'update_status') {
    const customer_id = form.get('customer_id');
    const status      = form.get('status');
    const old_status  = form.get('old_status');
    await sb.from('customers').update({status, updated_at: new Date().toISOString()}).eq('id', customer_id);
    await sb.from('customer_communications').insert({
      customer_id,
      communication_type: 'Status Changed',
      description: `Status changed: ${old_status} → ${status}`,
      created_by: 'Admin',
    });
    return json({ok:true});
  }

  if (intent === 'add_communication') {
    const customer_id        = form.get('customer_id');
    const communication_type = form.get('communication_type');
    const description        = form.get('description');
    const created_by         = form.get('created_by') || 'Admin';
    const {error} = await sb.from('customer_communications').insert({
      customer_id, communication_type, description, created_by,
    });
    if (error) return json({error: error.message},{status:400});
    return json({ok:true});
  }

  if (intent === 'send_review_request') {
    const customer_id = form.get('customer_id');
    const order_id    = form.get('order_id') || null;
    await sb.from('customer_reviews').insert({
      customer_id,
      order_id,
      review_request_sent_at: new Date().toISOString(),
    });
    await sb.from('customer_communications').insert({
      customer_id,
      communication_type: 'Review Request Sent',
      description: 'Review request email sent to customer.',
      created_by: 'Admin',
    });
    return json({ok:true});
  }

  if (intent === 'mark_vip') {
    const customer_id = form.get('customer_id');
    const old_status  = form.get('old_status') || '';
    await sb.from('customers').update({status:'VIP', updated_at: new Date().toISOString()}).eq('id', customer_id);
    await sb.from('customer_communications').insert({
      customer_id,
      communication_type: 'Status Changed',
      description: `Marked as VIP${old_status ? ` (was: ${old_status})` : ''}.`,
      created_by: 'Admin',
    });
    return json({ok:true});
  }

  if (intent === 'mark_trade_lead') {
    const customer_id = form.get('customer_id');
    const old_status  = form.get('old_status') || '';
    await sb.from('customers').update({status:'Trade Lead', updated_at: new Date().toISOString()}).eq('id', customer_id);
    await sb.from('customer_communications').insert({
      customer_id,
      communication_type: 'Status Changed',
      description: `Marked as Trade Lead${old_status ? ` (was: ${old_status})` : ''}.`,
      created_by: 'Admin',
    });
    return json({ok:true});
  }

  if (intent === 'deactivate') {
    const customer_id = form.get('customer_id');
    const old_status  = form.get('old_status') || '';
    await sb.from('customers').update({status:'Inactive', updated_at: new Date().toISOString()}).eq('id', customer_id);
    await sb.from('customer_communications').insert({
      customer_id,
      communication_type: 'Status Changed',
      description: `Customer deactivated${old_status ? ` (was: ${old_status})` : ''}.`,
      created_by: 'Admin',
    });
    return json({ok:true});
  }

  return json({error:'Unknown intent'},{status:400});
}

/* ─── Page ───────────────────────────────────────────────────── */
export default function CrmPage() {
  const {configured, dbError, customers, tagsAll, kpis} = useLoaderData();

  const [search,        setSearch]        = useState('');
  const [countryFilter, setCountryFilter] = useState('All');
  const [statusFilter,  setStatusFilter]  = useState('All');
  const [tagFilter,     setTagFilter]     = useState('All');
  const [page,          setPage]          = useState(0);

  const [selected,    setSelected]    = useState(null);
  const [drawerTab,   setDrawerTab]   = useState('Overview');
  const [createOpen,  setCreateOpen]  = useState(false);

  const tagsMap = useMemo(() => {
    const m = {};
    (tagsAll||[]).forEach(t => {
      if (!m[t.customer_id]) m[t.customer_id] = [];
      m[t.customer_id].push(t.tag);
    });
    return m;
  }, [tagsAll]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (customers||[]).filter(c => {
      const n = cusName(c).toLowerCase();
      if (q && !n.includes(q)
          && !(c.email||'').toLowerCase().includes(q)
          && !(c.phone||'').includes(q)
          && !(c.customer_number||'').toLowerCase().includes(q)) return false;
      if (statusFilter  !== 'All' && c.status  !== statusFilter)  return false;
      if (countryFilter !== 'All' && c.country !== countryFilter) return false;
      if (tagFilter !== 'All' && !(tagsMap[c.id]||[]).includes(tagFilter)) return false;
      return true;
    });
  }, [customers, search, statusFilter, countryFilter, tagFilter, tagsMap]);

  const paginated  = filtered.slice(page * PAGE_SIZE, (page+1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  function openCustomer(c) {
    setSelected(c);
    setDrawerTab('Overview');
  }

  useEffect(() => {
    if (!selected) return;
    const h = e => { if (e.key === 'Escape') setSelected(null); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [selected]);

  if (!configured) {
    return (
      <div className="min-h-screen bg-bc-dark flex items-center justify-center">
        <p className="font-ui text-bc-secondary text-sm">Supabase not configured.</p>
      </div>
    );
  }

  const th = 'px-4 py-3 font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40 text-left';

  return (
    <div className="min-h-screen bg-bc-dark px-4 sm:px-8 py-8">

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-[1.6rem] sm:text-[2rem] text-white tracking-tight leading-none mb-1">CRM</h1>
          <p className="font-ui text-[0.72rem] text-bc-secondary/60 tracking-[0.08em] uppercase">Customer Relationship Management</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-2 font-ui text-[0.78rem] font-medium bg-bc-red text-white px-4 py-2.5 rounded-[10px] hover:bg-bc-red/80 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Create Customer
        </button>
      </div>

      {/* ── DB Error ── */}
      {dbError && (
        <div className="mb-6 px-4 py-3 rounded-[10px] bg-bc-red/10 border border-bc-red/20">
          <p className="font-ui text-[0.72rem] text-bc-red">Database error: {dbError}</p>
        </div>
      )}

      {/* ── KPI Grid ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <KpiTile label="Total Customers"  value={kpis?.totalCustomers ?? 0}   accent="#3b82f6" />
        <KpiTile label="New This Month"   value={kpis?.newThisMonth ?? 0}     accent="#22c55e" />
        <KpiTile label="Repeat Customers" value={kpis?.repeatCustomers ?? 0}  accent="#a78bfa" />
        <KpiTile label="VIP Customers"    value={kpis?.vipCustomers ?? 0}     accent="#f59e0b" />
        <KpiTile label="Trade Leads"      value={kpis?.tradeLeads ?? 0}       accent="#8b5cf6" />
        <KpiTile label="Refund Risk"      value={kpis?.refundRisk ?? 0}       accent="#ef4444" />
        <KpiTile label="Avg Order Value"  value={fmtMoney(kpis?.avgOrderValue)} accent="#22c55e" isText />
        <KpiTile label="Total Revenue"    value={fmtMoney(kpis?.totalRevenue)}  accent="#f59e0b" isText />
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {/* Search — full-width on mobile, fixed width on sm+ */}
        <div className="relative w-full sm:w-60">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-bc-secondary/40" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            type="text"
            placeholder="Search name, email, phone, ID…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            className="w-full pl-7 pr-3 py-1.5 bg-bc-surface border border-bc-divider rounded-[8px] font-ui text-[0.72rem] text-white placeholder-bc-secondary/30 focus:outline-none focus:border-bc-red/40"
          />
        </div>

        <select value={countryFilter} onChange={e => { setCountryFilter(e.target.value); setPage(0); }}
          className="bg-bc-surface border border-bc-divider rounded-[8px] px-3 py-1.5 font-ui text-[0.72rem] text-bc-secondary focus:outline-none focus:border-bc-red/40 appearance-none cursor-pointer">
          {COUNTRIES.map(c => <option key={c}>{c}</option>)}
        </select>

        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0); }}
          className="bg-bc-surface border border-bc-divider rounded-[8px] px-3 py-1.5 font-ui text-[0.72rem] text-bc-secondary focus:outline-none focus:border-bc-red/40 appearance-none cursor-pointer">
          <option value="All">All Statuses</option>
          {STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>

        <select value={tagFilter} onChange={e => { setTagFilter(e.target.value); setPage(0); }}
          className="bg-bc-surface border border-bc-divider rounded-[8px] px-3 py-1.5 font-ui text-[0.72rem] text-bc-secondary focus:outline-none focus:border-bc-red/40 appearance-none cursor-pointer">
          <option value="All">All Tags</option>
          {ALL_TAGS.map(t => <option key={t}>{t}</option>)}
        </select>

        {/* Count on its own row on mobile so it's always visible at the top of results */}
        <span className="font-ui text-[0.62rem] text-bc-secondary/40 w-full sm:w-auto sm:ml-auto">
          {filtered.length} customer{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Table ── */}
      <div className="bc-card overflow-hidden mb-4">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-bc-divider">
                {['Customer ID','Name','Email','Phone','Country','Orders','Lifetime Spend','Last Order','Status','Tags',''].map(h => (
                  <th key={h} className={`${th} ${h === '' ? 'w-8' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center font-ui text-[0.72rem] text-bc-secondary/30">
                    {(customers||[]).length === 0 ? 'No customers yet — create your first customer.' : 'No customers match the current filters.'}
                  </td>
                </tr>
              )}
              {paginated.map(c => (
                <tr
                  key={c.id}
                  onClick={() => openCustomer(c)}
                  className="border-b border-bc-divider/40 hover:bg-white/[0.03] cursor-pointer transition-colors duration-100 group"
                >
                  <td className="px-4 py-3 font-ui text-[0.65rem] text-bc-secondary/50 whitespace-nowrap">
                    {c.customer_number || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-bc-red/15 flex items-center justify-center shrink-0">
                        <span className="font-ui text-[0.65rem] text-bc-red font-semibold">
                          {cusName(c).charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <span className="font-ui text-[0.82rem] text-white group-hover:text-bc-red transition-colors truncate max-w-[140px]">
                        {cusName(c)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-ui text-[0.75rem] text-bc-secondary truncate max-w-[180px]">
                    {c.email || '—'}
                  </td>
                  <td className="px-4 py-3 font-ui text-[0.75rem] text-bc-secondary whitespace-nowrap">
                    {c.phone || '—'}
                  </td>
                  <td className="px-4 py-3 font-ui text-[0.75rem] text-bc-secondary whitespace-nowrap">
                    {FLAGS[c.country] || ''} {c.country || '—'}
                  </td>
                  <td className="px-4 py-3 font-ui text-[0.78rem] text-white text-center">
                    {c.total_orders ?? 0}
                  </td>
                  <td className="px-4 py-3 font-ui text-[0.82rem] text-white whitespace-nowrap">
                    {fmtMoney(c.lifetime_spend)}
                  </td>
                  <td className="px-4 py-3 font-ui text-[0.72rem] text-bc-secondary whitespace-nowrap">
                    {fmtDate(c.last_order_date)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.status || 'Lead'} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1 max-w-[160px]">
                      {(tagsMap[c.id]||[]).slice(0,2).map(t => (
                        <span key={t} className="font-ui text-[0.55rem] uppercase tracking-[0.06em] px-1.5 py-0.5 rounded-full bg-white/[0.06] text-bc-secondary/70 border border-bc-divider">
                          {t}
                        </span>
                      ))}
                      {(tagsMap[c.id]||[]).length > 2 && (
                        <span className="font-ui text-[0.55rem] text-bc-secondary/40">+{(tagsMap[c.id]||[]).length - 2}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <svg className="text-bc-secondary/30 group-hover:text-bc-red transition-colors" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mb-8">
          <span className="font-ui text-[0.65rem] text-bc-secondary/40">
            Page {page+1} of {totalPages} · {filtered.length} customers
          </span>
          <div className="flex gap-1.5">
            <button disabled={page === 0} onClick={() => setPage(p => p-1)}
              className="px-3 py-1.5 rounded-[8px] bc-card font-ui text-[0.7rem] text-bc-secondary disabled:opacity-30 hover:text-white transition-colors">
              ← Prev
            </button>
            <button disabled={page >= totalPages-1} onClick={() => setPage(p => p+1)}
              className="px-3 py-1.5 rounded-[8px] bc-card font-ui text-[0.7rem] text-bc-secondary disabled:opacity-30 hover:text-white transition-colors">
              Next →
            </button>
          </div>
        </div>
      )}

      {/* ── Drawer ── */}
      {selected && (
        <CustomerDrawer
          customer={selected}
          tagsMap={tagsMap}
          drawerTab={drawerTab}
          setDrawerTab={setDrawerTab}
          onClose={() => setSelected(null)}
          onCustomerUpdated={updated => setSelected(prev => ({...prev, ...updated}))}
        />
      )}

      {/* ── Create Customer Modal ── */}
      {createOpen && (
        <CreateCustomerModal
          onClose={() => setCreateOpen(false)}
        />
      )}
    </div>
  );
}

/* ─── Customer Drawer ────────────────────────────────────────── */
function CustomerDrawer({customer, tagsMap, drawerTab, setDrawerTab, onClose, onCustomerUpdated}) {
  const navigate = useNavigate();

  const detailFetcher = useFetcher();
  const noteFetcher   = useFetcher();
  const tagFetcher    = useFetcher();
  const commFetcher   = useFetcher();
  const statusFetcher = useFetcher();
  const actionFetcher = useFetcher();
  const editFetcher   = useFetcher();

  const [noteText,     setNoteText]     = useState('');
  const [commType,     setCommType]     = useState(COMM_TYPES[0]);
  const [commDesc,     setCommDesc]     = useState('');
  const [showCommForm, setShowCommForm] = useState(false);
  const [editOpen,     setEditOpen]     = useState(false);

  function reload() {
    detailFetcher.load(`/adminlogonprotocol/crm?customer_id=${customer.id}`);
  }

  useEffect(() => { reload(); }, [customer.id]);

  useEffect(() => {
    if (noteFetcher.state === 'idle' && noteFetcher.data?.ok) { reload(); setNoteText(''); }
  }, [noteFetcher.state]);

  useEffect(() => {
    if (tagFetcher.state === 'idle' && tagFetcher.data?.ok) reload();
  }, [tagFetcher.state]);

  useEffect(() => {
    if (commFetcher.state === 'idle' && commFetcher.data?.ok) { reload(); setCommDesc(''); setShowCommForm(false); }
  }, [commFetcher.state]);

  useEffect(() => {
    if (statusFetcher.state === 'idle' && statusFetcher.data?.ok) reload();
  }, [statusFetcher.state]);

  useEffect(() => {
    if (actionFetcher.state === 'idle' && actionFetcher.data?.ok) reload();
  }, [actionFetcher.state]);

  useEffect(() => {
    if (editFetcher.state === 'idle' && editFetcher.data?.ok) { setEditOpen(false); reload(); }
  }, [editFetcher.state]);

  const detail       = detailFetcher.data?.isDetail ? detailFetcher.data : null;
  const loading      = detailFetcher.state === 'loading';
  const liveTagNames = detail?.tags?.map(t => t.tag) ?? tagsMap[customer.id] ?? [];
  const name         = cusName(customer);

  function submitAction(intent) {
    const fd = new FormData();
    fd.append('intent', intent);
    fd.append('customer_id', customer.id);
    fd.append('old_status', customer.status || 'Lead');
    actionFetcher.submit(fd, {method:'POST', action:'/adminlogonprotocol/crm'});
    if (intent === 'mark_vip') onCustomerUpdated({status:'VIP'});
    if (intent === 'mark_trade_lead') onCustomerUpdated({status:'Trade Lead'});
    if (intent === 'deactivate') onCustomerUpdated({status:'Inactive'});
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[40] bg-black/50"
        style={{backdropFilter:'blur(2px)', WebkitBackdropFilter:'blur(2px)'}}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed top-0 right-0 h-full z-[50] flex flex-col"
        style={{
          width: 'min(700px, calc(100vw - 2rem))',
          paddingRight: 'env(safe-area-inset-right, 0px)',
          background: 'rgba(14,14,14,0.97)',
          borderLeft: '1px solid rgba(255,255,255,0.07)',
          boxShadow: '-8px 0 40px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-bc-divider shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-bc-red/15 flex items-center justify-center shrink-0">
              <span className="font-display text-[1rem] text-bc-red">{name.charAt(0).toUpperCase()}</span>
            </div>
            <div>
              <p className="font-ui text-[0.9rem] text-white font-semibold leading-tight">{name}</p>
              <p className="font-ui text-[0.62rem] text-bc-secondary/40">{customer.customer_number || 'No ID'}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-bc-secondary hover:text-white transition-colors p-1">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Profile strip */}
        <div className="px-6 py-4 border-b border-bc-divider shrink-0 bg-white/[0.02]">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div className="grid grid-cols-2 min-[500px]:grid-cols-3 gap-x-6 gap-y-2">
              {[
                {l:'Email',          v: customer.email || '—'},
                {l:'Phone',          v: customer.phone || '—'},
                {l:'Country',        v: `${FLAGS[customer.country]||''} ${customer.country||'—'}`},
                {l:'Customer Since', v: fmtDate(customer.created_at)},
                {l:'Last Order',     v: fmtDate(customer.last_order_date)},
                {l:'Status',         v: null},
              ].map(row => (
                <div key={row.l}>
                  <p className="font-ui text-[0.55rem] uppercase tracking-[0.1em] text-bc-secondary/40">{row.l}</p>
                  {row.v !== null
                    ? <p className="font-ui text-[0.75rem] text-white">{row.v}</p>
                    : <StatusBadge status={customer.status || 'Lead'} />
                  }
                </div>
              ))}
            </div>
            {/* Tags */}
            <div className="flex flex-wrap gap-1 max-w-[220px] self-start">
              {liveTagNames.map(t => (
                <span key={t} className="flex items-center gap-1 font-ui text-[0.6rem] uppercase tracking-[0.06em] px-2 py-0.5 rounded-full bg-white/[0.06] text-bc-secondary border border-bc-divider">
                  {t}
                  <button
                    onClick={() => {
                      const fd = new FormData();
                      fd.append('intent','remove_tag'); fd.append('customer_id',customer.id); fd.append('tag',t);
                      tagFetcher.submit(fd, {method:'POST', action:'/adminlogonprotocol/crm'});
                    }}
                    className="text-bc-secondary/40 hover:text-bc-red transition-colors ml-0.5"
                  >×</button>
                </span>
              ))}
              <select
                defaultValue=""
                onChange={e => {
                  if (!e.target.value) return;
                  const fd = new FormData();
                  fd.append('intent','add_tag'); fd.append('customer_id',customer.id); fd.append('tag',e.target.value);
                  tagFetcher.submit(fd, {method:'POST', action:'/adminlogonprotocol/crm'});
                  e.target.value = '';
                }}
                className="bg-bc-surface border border-bc-divider rounded-full px-2 py-0.5 font-ui text-[0.6rem] text-bc-secondary/50 focus:outline-none cursor-pointer appearance-none"
              >
                <option value="">+ Tag</option>
                {ALL_TAGS.filter(t => !liveTagNames.includes(t)).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="px-6 py-3 border-b border-bc-divider shrink-0 flex flex-wrap items-center gap-2">
          <ActionBtn icon="✉️" label="Email Customer" onClick={() => alert(`Email to ${customer.email}`)} />
          <ActionBtn icon="⭐" label="Send Review Request" onClick={() => {
            const fd = new FormData();
            fd.append('intent','send_review_request'); fd.append('customer_id',customer.id);
            commFetcher.submit(fd, {method:'POST', action:'/adminlogonprotocol/crm'});
          }} />
          <ActionBtn icon="📝" label="Add Note" onClick={() => setDrawerTab('Notes')} />
          <ActionBtn icon="✏️" label="Edit" onClick={() => setEditOpen(true)} />
          <ActionBtn icon="⭐" label="Mark VIP" onClick={() => submitAction('mark_vip')} />
          <ActionBtn icon="🏢" label="Trade Lead" onClick={() => submitAction('mark_trade_lead')} />
          <ActionBtn icon="🚫" label="Deactivate" onClick={() => submitAction('deactivate')} variant="danger" />

          {/* Status select — self-aligns to row start so it behaves on wrap */}
          <select
            value={customer.status || 'Lead'}
            onChange={e => {
              const fd = new FormData();
              fd.append('intent','update_status'); fd.append('customer_id',customer.id);
              fd.append('status',e.target.value); fd.append('old_status',customer.status||'Lead');
              statusFetcher.submit(fd, {method:'POST', action:'/adminlogonprotocol/crm'});
              onCustomerUpdated({status: e.target.value});
            }}
            className="bg-bc-surface border border-bc-divider rounded-[8px] px-2.5 py-1 font-ui text-[0.68rem] text-bc-secondary focus:outline-none appearance-none cursor-pointer hover:border-bc-red/40 transition-colors"
          >
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Metrics strip */}
        <div className="grid grid-cols-2 min-[400px]:grid-cols-4 border-b border-bc-divider shrink-0">
          {[
            {l:'Orders',        v: customer.total_orders ?? (detail?.orders?.length ?? 0)},
            {l:'Lifetime Spend',v: fmtMoney(customer.lifetime_spend)},
            {l:'Avg Order Value',v: fmtMoney(customer.average_order_value || (customer.total_orders ? (customer.lifetime_spend||0)/customer.total_orders : 0))},
            {l:'Refund Count',  v: customer.refund_count ?? 0},
          ].map(m => (
            <div key={m.l} className="px-4 py-2.5 border-r border-bc-divider last:border-0 text-center">
              <p className="font-display text-[1rem] text-white">{m.v}</p>
              <p className="font-ui text-[0.55rem] uppercase tracking-[0.08em] text-bc-secondary/40">{m.l}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-bc-divider shrink-0 overflow-x-auto" style={{WebkitOverflowScrolling:'touch', scrollbarWidth:'none', msOverflowStyle:'none'}}>
          {DETAIL_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setDrawerTab(tab)}
              className={`px-4 py-2.5 font-ui text-[0.68rem] uppercase tracking-[0.1em] whitespace-nowrap border-b-2 transition-all duration-150 ${
                drawerTab === tab
                  ? 'border-bc-red text-white'
                  : 'border-transparent text-bc-secondary/50 hover:text-bc-secondary'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="w-5 h-5 border-2 border-bc-red/30 border-t-bc-red rounded-full animate-spin" />
            </div>
          )}

          {/* ── OVERVIEW ── */}
          {!loading && drawerTab === 'Overview' && (
            <div className="px-6 py-5 space-y-6">
              <div>
                <p className="font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40 mb-3">Recent Activity</p>
                {(detail?.comms||[]).length === 0 && (
                  <p className="font-ui text-[0.72rem] text-bc-secondary/40">No communications recorded.</p>
                )}
                <div className="space-y-0">
                  {(detail?.comms||[]).slice(0,5).map(c => (
                    <div key={c.id} className="flex items-start gap-3 py-2.5 border-b border-bc-divider/30 last:border-0">
                      <span className="text-sm shrink-0 mt-0.5">{COMM_ICONS[c.communication_type] || '💬'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-ui text-[0.72rem] text-white">{c.communication_type}</p>
                        {c.description && <p className="font-ui text-[0.65rem] text-bc-secondary/50 truncate">{c.description}</p>}
                      </div>
                      <span className="font-ui text-[0.58rem] text-bc-secondary/30 shrink-0">{fmtDate(c.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40 mb-3">Latest Orders</p>
                {(detail?.orders||[]).length === 0 && (
                  <p className="font-ui text-[0.72rem] text-bc-secondary/40">No orders yet.</p>
                )}
                <div className="space-y-2">
                  {(detail?.orders||[]).slice(0,3).map(o => (
                    <div
                      key={o.id}
                      onClick={() => navigate(`/adminlogonprotocol/orders/${o.id}`)}
                      className="flex items-center justify-between py-3 px-4 rounded-[10px] bg-white/[0.03] border border-bc-divider cursor-pointer hover:border-bc-red/30 transition-colors"
                    >
                      <div>
                        <p className="font-ui text-[0.78rem] text-white">{o.order_number}</p>
                        <p className="font-ui text-[0.62rem] text-bc-secondary/40">{fmtDate(o.date)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-ui text-[0.82rem] text-white">{fmtMoney(o.total)}</p>
                        <p className={`font-ui text-[0.62rem] capitalize ${(ORDER_STATUS_CFG[o.status]||{}).text || 'text-bc-secondary'}`}>{o.status}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── ORDERS ── */}
          {!loading && drawerTab === 'Orders' && (
            <div className="px-6 py-5">
              {(detail?.orders||[]).length === 0 && (
                <p className="font-ui text-[0.72rem] text-bc-secondary/40">No orders found.</p>
              )}
              <div className="space-y-2">
                {(detail?.orders||[]).map(o => (
                  <div
                    key={o.id}
                    onClick={() => navigate(`/adminlogonprotocol/orders/${o.id}`)}
                    className="flex items-center justify-between py-3 px-4 rounded-[10px] bg-white/[0.03] border border-bc-divider cursor-pointer hover:border-bc-red/30 transition-colors group"
                  >
                    <div>
                      <p className="font-ui text-[0.78rem] text-white group-hover:text-bc-red transition-colors">{o.order_number}</p>
                      <p className="font-ui text-[0.62rem] text-bc-secondary/40">{fmtDate(o.date)}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <p className="font-ui text-[0.82rem] text-white">{fmtMoney(o.total)}</p>
                      <div className="flex gap-1.5">
                        <span className={`font-ui text-[0.58rem] capitalize ${(ORDER_STATUS_CFG[o.status]||{}).text || 'text-bc-secondary'}`}>{o.status}</span>
                        {o.payment_status && (
                          <span className={`font-ui text-[0.58rem] capitalize ${(ORDER_STATUS_CFG[o.payment_status]||{}).text || 'text-bc-secondary/40'}`}>· {o.payment_status}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── INVOICES ── */}
          {!loading && drawerTab === 'Invoices' && (
            <div className="px-6 py-5">
              {(detail?.invoices||[]).length === 0 && (
                <p className="font-ui text-[0.72rem] text-bc-secondary/40">No invoices found.</p>
              )}
              <div className="space-y-2">
                {(detail?.invoices||[]).map(inv => (
                  <div key={inv.id} className="flex items-center justify-between py-3 px-4 rounded-[10px] bg-white/[0.03] border border-bc-divider">
                    <div>
                      <p className="font-ui text-[0.78rem] text-white">{inv.invoice_number || '—'}</p>
                      <p className="font-ui text-[0.62rem] text-bc-secondary/40">Issued: {fmtDate(inv.issued_date)}</p>
                      {inv.due_date && <p className="font-ui text-[0.62rem] text-bc-secondary/40">Due: {fmtDate(inv.due_date)}</p>}
                    </div>
                    <div className="text-right">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-ui text-[0.6rem] uppercase tracking-[0.06em] bg-white/5 text-bc-secondary`}>
                        {inv.status || '—'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── COMMUNICATIONS ── */}
          {!loading && drawerTab === 'Communications' && (
            <div className="px-6 py-5">
              {/* Log form */}
              <div className="mb-5">
                {!showCommForm ? (
                  <button onClick={() => setShowCommForm(true)} className="flex items-center gap-1.5 font-ui text-[0.72rem] text-bc-secondary hover:text-white transition-colors">
                    <span className="text-bc-red">+</span> Log Communication
                  </button>
                ) : (
                  <div className="p-4 rounded-[10px] bg-white/[0.03] border border-bc-divider space-y-3">
                    <select value={commType} onChange={e => setCommType(e.target.value)}
                      className="w-full bg-bc-surface border border-bc-divider rounded-[8px] px-3 py-2 font-ui text-[0.72rem] text-white focus:outline-none focus:border-bc-red/40 appearance-none">
                      {COMM_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                    <textarea
                      value={commDesc} onChange={e => setCommDesc(e.target.value)}
                      placeholder="Description (optional)…" rows={2}
                      className="w-full bg-bc-surface border border-bc-divider rounded-[8px] px-3 py-2 font-ui text-[0.72rem] text-white placeholder-bc-secondary/30 focus:outline-none focus:border-bc-red/40 resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          const fd = new FormData();
                          fd.append('intent','add_communication'); fd.append('customer_id',customer.id);
                          fd.append('communication_type',commType); fd.append('description',commDesc);
                          fd.append('created_by','Admin');
                          commFetcher.submit(fd, {method:'POST', action:'/adminlogonprotocol/crm'});
                        }}
                        className="px-3 py-1.5 bg-bc-red rounded-[8px] font-ui text-[0.7rem] text-white hover:bg-bc-red/80 transition-colors"
                      >Log</button>
                      <button onClick={() => setShowCommForm(false)} className="px-3 py-1.5 bc-card rounded-[8px] font-ui text-[0.7rem] text-bc-secondary hover:text-white transition-colors">Cancel</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Timeline */}
              {(detail?.comms||[]).length === 0 && (
                <p className="font-ui text-[0.72rem] text-bc-secondary/40">No communications recorded.</p>
              )}
              <div className="relative">
                <div className="absolute left-[7px] top-0 bottom-0 w-px bg-bc-divider" />
                {(detail?.comms||[]).map(c => (
                  <div key={c.id} className="flex gap-4 mb-4 relative">
                    <div className="w-3.5 h-3.5 rounded-full bg-bc-surface border-2 border-bc-red/50 shrink-0 mt-1 relative z-10" />
                    <div className="flex-1 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{COMM_ICONS[c.communication_type] || '💬'}</span>
                        <p className="font-ui text-[0.75rem] text-white">{c.communication_type}</p>
                        {c.created_by && <span className="font-ui text-[0.58rem] text-bc-secondary/40 ml-auto">{c.created_by}</span>}
                      </div>
                      {c.description && <p className="font-ui text-[0.65rem] text-bc-secondary/60 mt-0.5">{c.description}</p>}
                      <p className="font-ui text-[0.6rem] text-bc-secondary/30 mt-1">{fmtDT(c.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── NOTES ── */}
          {!loading && drawerTab === 'Notes' && (
            <div className="px-6 py-5">
              <div className="mb-5 p-4 rounded-[10px] bg-white/[0.03] border border-bc-divider">
                <textarea
                  value={noteText} onChange={e => setNoteText(e.target.value)}
                  placeholder="Add a private note…" rows={3}
                  className="w-full bg-transparent font-ui text-[0.78rem] text-white placeholder-bc-secondary/30 focus:outline-none resize-none"
                />
                <div className="flex justify-end mt-2">
                  <button
                    disabled={!noteText.trim() || noteFetcher.state !== 'idle'}
                    onClick={() => {
                      const fd = new FormData();
                      fd.append('intent','add_note'); fd.append('customer_id',customer.id);
                      fd.append('note',noteText); fd.append('created_by','Admin');
                      noteFetcher.submit(fd, {method:'POST', action:'/adminlogonprotocol/crm'});
                    }}
                    className="px-4 py-1.5 bg-bc-red rounded-[8px] font-ui text-[0.7rem] text-white disabled:opacity-40 hover:bg-bc-red/80 transition-all"
                  >
                    {noteFetcher.state !== 'idle' ? 'Saving…' : 'Add Note'}
                  </button>
                </div>
              </div>

              {(detail?.notes||[]).length === 0 && (
                <p className="font-ui text-[0.72rem] text-bc-secondary/40">No notes yet.</p>
              )}
              <div className="space-y-3">
                {(detail?.notes||[]).map(n => (
                  <div key={n.id} className="p-4 rounded-[10px] bg-white/[0.03] border border-bc-divider group">
                    <p className="font-ui text-[0.78rem] text-white whitespace-pre-wrap">{n.note}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <div className="w-4 h-4 rounded-full bg-bc-red/20 flex items-center justify-center">
                        <span className="font-ui text-[0.5rem] text-bc-red">{(n.created_by||'A').charAt(0)}</span>
                      </div>
                      <span className="font-ui text-[0.6rem] text-bc-secondary/40">{n.created_by}</span>
                      <span className="font-ui text-[0.6rem] text-bc-secondary/25 ml-auto">{fmtDT(n.created_at)}</span>
                      <button
                        onClick={() => {
                          const fd = new FormData();
                          fd.append('intent','delete_note'); fd.append('note_id',n.id);
                          noteFetcher.submit(fd, {method:'POST', action:'/adminlogonprotocol/crm'});
                        }}
                        className="opacity-0 group-hover:opacity-100 text-bc-secondary/40 hover:text-bc-red transition-all font-ui text-[0.65rem] px-2 py-0.5 rounded-[6px] hover:bg-bc-red/10"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── REVIEWS ── */}
          {!loading && drawerTab === 'Reviews' && (
            <div className="px-6 py-5">
              <div className="flex gap-2 mb-6 flex-wrap">
                <button
                  onClick={() => {
                    const fd = new FormData();
                    fd.append('intent','send_review_request'); fd.append('customer_id',customer.id);
                    commFetcher.submit(fd, {method:'POST', action:'/adminlogonprotocol/crm'});
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 bg-bc-red rounded-[8px] font-ui text-[0.72rem] text-white hover:bg-bc-red/80 transition-colors"
                >
                  ⭐ Send Review Request
                </button>
              </div>

              <p className="font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40 mb-3">Review History</p>

              {(detail?.reviews||[]).length === 0 && (
                <p className="font-ui text-[0.72rem] text-bc-secondary/40">No review requests sent yet.</p>
              )}

              <div className="space-y-3">
                {(detail?.reviews||[]).map(r => (
                  <div key={r.id} className="p-4 rounded-[10px] bg-white/[0.03] border border-bc-divider">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-ui text-[0.65rem] text-bc-secondary/40">
                        Request sent: {r.review_request_sent_at ? fmtDT(r.review_request_sent_at) : '—'}
                      </p>
                      {r.rating && (
                        <div className="flex gap-0.5">
                          {[1,2,3,4,5].map(star => (
                            <span key={star} className={`text-sm ${star <= r.rating ? 'text-[#f59e0b]' : 'text-white/10'}`}>★</span>
                          ))}
                        </div>
                      )}
                    </div>
                    {r.review_submitted_at && (
                      <p className="font-ui text-[0.65rem] text-[#22c55e] mb-1">
                        Submitted: {fmtDT(r.review_submitted_at)}
                      </p>
                    )}
                    {r.review_text && (
                      <p className="font-ui text-[0.75rem] text-white/80 mt-1 italic">"{r.review_text}"</p>
                    )}
                    {r.review_url && (
                      <a href={r.review_url} target="_blank" rel="noopener noreferrer"
                        className="font-ui text-[0.65rem] text-[#3b82f6] hover:underline mt-1 inline-block">
                        View Review →
                      </a>
                    )}
                    {!r.review_submitted_at && !r.rating && (
                      <p className="font-ui text-[0.65rem] text-bc-secondary/30 italic">No response yet.</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {editOpen && (
        <EditCustomerModal
          customer={customer}
          fetcher={editFetcher}
          onClose={() => setEditOpen(false)}
        />
      )}
    </>
  );
}

/* ─── Create Customer Modal ──────────────────────────────────── */
function CreateCustomerModal({onClose}) {
  const fetcher    = useFetcher();
  const [error, setError] = useState(null);

  const saving  = fetcher.state !== 'idle';

  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data) {
      if (fetcher.data.ok) {
        onClose();
        // Force page reload to show new customer
        window.location.reload();
      } else if (fetcher.data.error) {
        setError(fetcher.data.error);
      }
    }
  }, [fetcher.state]);

  function submit(e) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.append('intent','create_customer');
    fetcher.submit(fd, {method:'POST', action:'/adminlogonprotocol/crm'});
  }

  const inp = 'w-full bg-bc-surface border border-bc-divider rounded-[10px] px-3 py-2 font-ui text-[0.82rem] text-white placeholder-bc-secondary/40 focus:outline-none focus:border-bc-red transition-colors';
  const lbl = 'flex flex-col gap-1';
  const sp  = 'font-ui text-[0.62rem] tracking-[0.1em] uppercase text-bc-secondary';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{background:'rgba(0,0,0,0.65)', backdropFilter:'blur(4px)'}}>
      <div className="bg-bc-bg border border-bc-divider rounded-[24px] w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-bc-divider shrink-0">
          <p className="font-display text-[1.4rem] text-white leading-none">CREATE CUSTOMER</p>
          <button onClick={onClose} className="text-bc-secondary hover:text-white transition-colors p-1">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 flex flex-col gap-4 overflow-y-auto min-h-0">
          <div className="grid grid-cols-2 gap-3">
            <label className={lbl}><span className={sp}>First Name</span>
              <input name="first_name" placeholder="James" className={inp} /></label>
            <label className={lbl}><span className={sp}>Last Name</span>
              <input name="last_name" placeholder="Harrington" className={inp} /></label>
          </div>
          <label className={lbl}><span className={sp}>Email *</span>
            <input name="email" type="email" required placeholder="james@example.com" className={inp} /></label>
          <label className={lbl}><span className={sp}>Phone</span>
            <input name="phone" placeholder="+61 4XX XXX XXX" className={inp} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className={lbl}><span className={sp}>Country</span>
              <select name="country" defaultValue="Australia" className={inp + ' appearance-none cursor-pointer'}>
                {COUNTRIES.filter(c => c !== 'All').map(c => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className={lbl}><span className={sp}>Status</span>
              <select name="status" defaultValue="Lead" className={inp + ' appearance-none cursor-pointer'}>
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <label className={lbl}><span className={sp}>Notes (optional)</span>
            <textarea name="note" placeholder="Initial notes about this customer…" rows={3}
              className={inp + ' resize-none'} />
          </label>
          {error && <p className="font-ui text-[0.75rem] text-bc-red">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 font-ui text-[0.78rem] text-bc-secondary border border-bc-divider rounded-[10px] py-2.5 hover:text-white transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 font-ui text-[0.78rem] font-medium bg-bc-red text-white rounded-[10px] py-2.5 hover:bg-bc-red/80 disabled:opacity-50 transition-colors">
              {saving ? 'Creating…' : 'Create Customer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Edit Customer Modal ────────────────────────────────────── */
function EditCustomerModal({customer, fetcher, onClose}) {
  const name = cusName(customer);
  const [first,   setFirst]   = useState(customer.first_name || name.split(' ')[0] || '');
  const [last,    setLast]    = useState(customer.last_name  || name.split(' ').slice(1).join(' ') || '');
  const [email,   setEmail]   = useState(customer.email   || '');
  const [phone,   setPhone]   = useState(customer.phone   || '');
  const [country, setCountry] = useState(customer.country || 'Australia');
  const [status,  setStatus]  = useState(customer.status  || 'Lead');

  const saving = fetcher.state !== 'idle';

  function submit(e) {
    e.preventDefault();
    const fd = new FormData();
    fd.append('intent','edit_customer'); fd.append('customer_id',customer.id);
    fd.append('first_name',first); fd.append('last_name',last);
    fd.append('email',email); fd.append('phone',phone);
    fd.append('country',country); fd.append('status',status);
    fetcher.submit(fd, {method:'POST', action:'/adminlogonprotocol/crm'});
  }

  const inp = 'w-full bg-bc-surface border border-bc-divider rounded-[8px] px-3 py-2 font-ui text-[0.78rem] text-white placeholder-bc-secondary/30 focus:outline-none focus:border-bc-red/40';
  const lbl = 'font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/50 mb-1';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-[16px] bc-card max-h-[90vh] flex flex-col overflow-hidden" style={{background:'rgba(18,18,18,0.98)'}}>
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <h2 className="font-display text-[1.1rem] text-white">Edit Customer</h2>
          <button onClick={onClose} className="text-bc-secondary hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <form onSubmit={submit} className="px-6 pb-6 space-y-3 overflow-y-auto min-h-0">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col"><span className={lbl}>First Name</span>
              <input value={first} onChange={e => setFirst(e.target.value)} className={inp} /></label>
            <label className="flex flex-col"><span className={lbl}>Last Name</span>
              <input value={last} onChange={e => setLast(e.target.value)} className={inp} /></label>
          </div>
          <label className="flex flex-col"><span className={lbl}>Email</span>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inp} /></label>
          <label className="flex flex-col"><span className={lbl}>Phone</span>
            <input value={phone} onChange={e => setPhone(e.target.value)} className={inp} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col">
              <span className={lbl}>Country</span>
              <select value={country} onChange={e => setCountry(e.target.value)} className={inp + ' appearance-none cursor-pointer'}>
                {COUNTRIES.filter(c => c !== 'All').map(c => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="flex flex-col">
              <span className={lbl}>Status</span>
              <select value={status} onChange={e => setStatus(e.target.value)} className={inp + ' appearance-none cursor-pointer'}>
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={saving}
              className="flex-1 py-2 bg-bc-red rounded-[10px] font-ui text-[0.78rem] text-white disabled:opacity-50 hover:bg-bc-red/80 transition-all">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2 bc-card border border-bc-divider rounded-[10px] font-ui text-[0.78rem] text-bc-secondary hover:text-white transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Sub-Components ─────────────────────────────────────────── */
function KpiTile({label, value, accent, isText, sub}) {
  return (
    <div className="bc-card px-3 py-3 sm:px-4 sm:py-4 min-h-[80px] flex flex-col justify-between">
      <div className="w-1 h-4 rounded-full mb-2" style={{background: accent}} />
      <p className={`leading-none mb-1 truncate ${isText ? 'font-ui text-[0.95rem] sm:text-[1.1rem] text-white' : 'font-display text-[1.4rem] sm:text-[1.6rem] text-white'}`}>{value}</p>
      <p className="font-ui text-[0.58rem] sm:text-[0.62rem] uppercase tracking-[0.08em] text-bc-secondary/60 leading-tight">{label}</p>
      {sub && <p className="font-ui text-[0.55rem] text-bc-secondary/30 mt-0.5">{sub}</p>}
    </div>
  );
}

function StatusBadge({status}) {
  const cfg = STATUS_CFG[status] || {bg:'bg-white/5', text:'text-bc-secondary/60'};
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-ui text-[0.6rem] uppercase tracking-[0.06em] ${cfg.bg} ${cfg.text}`}>
      {status}
    </span>
  );
}

function ActionBtn({icon, label, onClick, variant}) {
  const base = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] border font-ui text-[0.65rem] transition-all duration-150 whitespace-nowrap';
  const normal = 'bg-white/[0.04] border-bc-divider text-bc-secondary hover:text-white hover:bg-white/[0.08]';
  const danger = 'bg-bc-red/5 border-bc-red/20 text-bc-red/70 hover:text-bc-red hover:bg-bc-red/10';
  return (
    <button onClick={onClick} className={`${base} ${variant === 'danger' ? danger : normal}`}>
      <span>{icon}</span>{label}
    </button>
  );
}
