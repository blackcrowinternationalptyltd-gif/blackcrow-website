import {useState, useMemo, useEffect} from 'react';
import {useLoaderData, useFetcher} from '@remix-run/react';
import {json} from '@shopify/remix-oxygen';
import {getSupabase} from '~/lib/supabase.server';
import {requireAdminUser, getCountryFilter} from '~/lib/auth.server';
import {AdminSidebar} from '~/components/AdminSidebar';

export const meta = () => [{title: 'Trade Accounts | BlackCrow Admin'}];

/* ─── Constants ────────────────────────────────────────────── */
const TIERS     = ['Retail','Trade','Distributor','Major Account'];
const STATUSES  = ['Pending','Approved','Distributor','Suspended','Rejected'];
const TERMS     = ['Prepaid','Due On Receipt','NET 7','NET 14','NET 30','NET 45','NET 60'];
const COUNTRIES = ['Australia','USA','UK','Canada','Sweden','New Zealand'];
const TABS      = ['Overview','Orders','Invoices','Communications','Notes','Pricing'];
const TIER_VOLS = {Retail:'1–9 units',Trade:'10–49 units',Distributor:'50–99 units','Major Account':'100+ units'};

const STATUS_CFG = {
  Pending:     {bg:'bg-[#f59e0b]/10', text:'text-[#f59e0b]'},
  Approved:    {bg:'bg-[#22c55e]/10', text:'text-[#22c55e]'},
  Distributor: {bg:'bg-[#3b82f6]/10', text:'text-[#60a5fa]'},
  Suspended:   {bg:'bg-bc-red/10',    text:'text-bc-red'},
  Rejected:    {bg:'bg-white/5',      text:'text-bc-secondary/50'},
};
const TIER_CFG = {
  Retail:          {bg:'bg-white/5',      text:'text-bc-secondary/70'},
  Trade:           {bg:'bg-[#f59e0b]/10', text:'text-[#f59e0b]'},
  Distributor:     {bg:'bg-[#3b82f6]/10', text:'text-[#60a5fa]'},
  'Major Account': {bg:'bg-bc-red/10',    text:'text-bc-red'},
};
const COMM_ICONS = {
  'Account Created':        '✦',
  'Account Approved':       '✅',
  'Status Changed':         '⚡',
  'Trade Tier Changed':     '🏷️',
  'Credit Limit Updated':   '💳',
  'Payment Terms Updated':  '📋',
  'Internal Note Added':    '📝',
  'Payment Reminder Sent':  '🔔',
  'Invoice Emailed':        '✉️',
  'Trade Invoice Generated':'🧾',
};

const fmtDate  = d => d ? new Date(d).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'}) : '—';
const fmtDT    = d => d ? new Date(d).toLocaleString('en-AU',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
const fmtMoney = v => v != null ? `$${Number(v).toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2})}` : '—';

/* ─── Loader ────────────────────────────────────────────────── */
export async function loader({request, context}) {
  const user = await requireAdminUser(request);
  const cf   = getCountryFilter(user);
  const sb  = getSupabase();
  const url = new URL(request.url);
  const tid = url.searchParams.get('trade_id');

  if (tid) {
    const [notes, comms, pricing] = await Promise.all([
      sb.from('trade_notes').select('*').eq('trade_account_id', tid).order('created_at',{ascending:false}),
      sb.from('trade_communications').select('*').eq('trade_account_id', tid).order('created_at',{ascending:false}),
      sb.from('trade_pricing_rules').select('*').eq('trade_account_id', tid).order('created_at',{ascending:true}),
    ]);
    const orders = await sb.from('orders').select('id,order_number,created_at,total_price,currency,financial_status').eq('trade_account_id', tid).order('created_at',{ascending:false}).limit(20);
    return json({isDetail:true, notes:notes.data??[], comms:comms.data??[], pricing:pricing.data??[], orders:orders.data??[]});
  }

  try {
    let qAccounts = sb.from('trade_accounts').select('id,trade_number,business_name,trading_name,business_number,country,address,website,status,trade_tier,payment_terms,credit_limit,lifetime_spend,total_orders,last_order_date,created_at,updated_at').order('created_at',{ascending:false});
    if (cf) qAccounts = qAccounts.eq('country', cf);

    const [accRes, conRes] = await Promise.all([
      qAccounts,
      sb.from('trade_contacts').select('id,trade_account_id,contact_name,email,phone'),
    ]);
    if (accRes.error) throw accRes.error;
    return json({accounts:accRes.data??[], contacts:conRes.data??[], dbError:null});
  } catch(e) {
    return json({accounts:[], contacts:[], dbError:e.message});
  }
}

/* ─── Action ────────────────────────────────────────────────── */
export async function action({request}) {
  const form   = await request.formData();
  const intent = form.get('intent');
  const sb     = getSupabase();

  if (intent === 'create_trade_account') {
    const acc = {
      business_name: form.get('business_name'),
      trading_name:  form.get('trading_name'),
      business_number: form.get('business_number'),
      country:       form.get('country'),
      address:       form.get('address'),
      website:       form.get('website'),
      trade_tier:    form.get('trade_tier') || 'Trade',
      payment_terms: form.get('payment_terms') || 'NET 30',
      credit_limit:  parseFloat(form.get('credit_limit') || 0),
      status:        form.get('status') || 'Pending',
    };
    const {data, error} = await sb.from('trade_accounts').insert(acc).select().single();
    if (error) return json({ok:false, error:error.message});
    if (data) {
      const contact = {trade_account_id:data.id, contact_name:form.get('contact_name'), email:form.get('email'), phone:form.get('phone')};
      await sb.from('trade_contacts').insert(contact);
      const note = form.get('notes');
      if (note) await sb.from('trade_notes').insert({trade_account_id:data.id, note, created_by:'Admin'});
      await sb.from('trade_communications').insert({trade_account_id:data.id, communication_type:'Account Created', description:`Trade account created for ${acc.business_name}`});
    }
    return json({ok:true});
  }

  if (intent === 'update_status') {
    const id = form.get('trade_id'), status = form.get('status');
    await sb.from('trade_accounts').update({status, updated_at:new Date().toISOString()}).eq('id',id);
    await sb.from('trade_communications').insert({trade_account_id:id, communication_type:`Status Changed to ${status}`, description:`Account status updated to ${status}`});
    return json({ok:true});
  }
  if (intent === 'change_tier') {
    const id = form.get('trade_id'), trade_tier = form.get('trade_tier');
    await sb.from('trade_accounts').update({trade_tier, updated_at:new Date().toISOString()}).eq('id',id);
    await sb.from('trade_communications').insert({trade_account_id:id, communication_type:'Trade Tier Changed', description:`Trade tier updated to ${trade_tier}`});
    return json({ok:true});
  }
  if (intent === 'set_credit_limit') {
    const id = form.get('trade_id'), credit_limit = parseFloat(form.get('credit_limit')||0);
    await sb.from('trade_accounts').update({credit_limit, updated_at:new Date().toISOString()}).eq('id',id);
    await sb.from('trade_communications').insert({trade_account_id:id, communication_type:'Credit Limit Updated', description:`Credit limit set to ${fmtMoney(credit_limit)}`});
    return json({ok:true});
  }
  if (intent === 'set_payment_terms') {
    const id = form.get('trade_id'), payment_terms = form.get('payment_terms');
    await sb.from('trade_accounts').update({payment_terms, updated_at:new Date().toISOString()}).eq('id',id);
    await sb.from('trade_communications').insert({trade_account_id:id, communication_type:'Payment Terms Updated', description:`Payment terms set to ${payment_terms}`});
    return json({ok:true});
  }
  if (intent === 'add_note') {
    const id = form.get('trade_id'), note = form.get('note');
    await sb.from('trade_notes').insert({trade_account_id:id, note, created_by:'Admin'});
    await sb.from('trade_communications').insert({trade_account_id:id, communication_type:'Internal Note Added', description:note.slice(0,80)});
    return json({ok:true});
  }
  if (intent === 'add_pricing_rule') {
    const id = form.get('trade_id');
    await sb.from('trade_pricing_rules').insert({trade_account_id:id, product_id:form.get('product_id')||null, minimum_quantity:parseInt(form.get('min_qty')||1), custom_price:parseFloat(form.get('custom_price')||0)});
    return json({ok:true});
  }
  if (intent === 'delete_pricing_rule') {
    await sb.from('trade_pricing_rules').delete().eq('id', form.get('rule_id'));
    return json({ok:true});
  }
  if (intent === 'send_payment_reminder') {
    const id = form.get('trade_id');
    await sb.from('trade_communications').insert({trade_account_id:id, communication_type:'Payment Reminder Sent', description:'Payment reminder sent to trade account contact'});
    return json({ok:true});
  }
  if (intent === 'generate_invoice') {
    const id = form.get('trade_id');
    await sb.from('trade_communications').insert({trade_account_id:id, communication_type:'Trade Invoice Generated', description:'Trade invoice generated and ready for download'});
    return json({ok:true});
  }
  if (intent === 'import_csv') {
    const csv = form.get('csv_data');
    if (!csv) return json({ok:false, error:'No CSV data received'});
    const lines = csv.trim().split('\n').filter(Boolean);
    if (lines.length < 2) return json({ok:false, error:'CSV must have a header row and at least one data row'});
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g,'').toLowerCase());
    const results = {created:0, errors:[]};
    for (let i = 1; i < lines.length; i++) {
      try {
        const vals = lines[i].match(/(".*?"|[^,]+)(?=,|$)/g)?.map(v => v.trim().replace(/^"|"$/g,'')) ?? lines[i].split(',').map(v=>v.trim());
        const row = {};
        headers.forEach((h,idx) => { row[h] = vals[idx] ?? ''; });
        const biz = row['business_name'] || row['business name'] || '';
        if (!biz) { results.errors.push(`Row ${i}: missing business_name`); continue; }
        const acc = {
          business_name:   biz,
          trading_name:    row['trading_name']    || row['trading name']    || null,
          business_number: row['business_number'] || row['business number'] || null,
          country:         row['country']         || 'Australia',
          address:         row['address']         || null,
          website:         row['website']         || null,
          trade_tier:      row['trade_tier']      || row['trade tier']      || 'Trade',
          payment_terms:   row['payment_terms']   || row['payment terms']   || 'NET 30',
          credit_limit:    parseFloat(row['credit_limit'] || row['credit limit'] || 0) || 0,
          status:          row['status']          || 'Pending',
        };
        const {data: created, error: accErr} = await sb.from('trade_accounts').insert(acc).select('id').single();
        if (accErr) { results.errors.push(`Row ${i} (${biz}): ${accErr.message}`); continue; }
        const contactName = row['contact_name'] || row['contact name'] || row['name'] || null;
        const email       = row['email'] || null;
        const phone       = row['phone'] || null;
        if (contactName || email || phone) {
          await sb.from('trade_contacts').insert({trade_account_id:created.id, contact_name:contactName, email, phone});
        }
        await sb.from('trade_communications').insert({trade_account_id:created.id, communication_type:'Account Created', description:`Imported from CSV: ${biz}`});
        results.created++;
      } catch(e) {
        results.errors.push(`Row ${i}: ${e.message}`);
      }
    }
    return json({ok:true, ...results});
  }

  if (intent === 'delete_trade_account') {
    const id = form.get('trade_id');
    // Cascade deletes handle related rows (contacts, notes, comms, pricing rules)
    const {error} = await sb.from('trade_accounts').delete().eq('id', id);
    if (error) return json({ok:false, error:error.message});
    return json({ok:true, deleted:true});
  }
  return json({ok:false, error:'Unknown intent'});
}

/* ─── Sub-components ─────────────────────────────────────────── */
function KpiTile({label, value, sub, color='text-white'}) {
  return (
    <div style={{background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)'}} className="rounded-[16px] px-5 py-4 flex flex-col gap-1">
      <p className="font-ui text-[0.6rem] tracking-[0.15em] text-bc-secondary">{label}</p>
      <p className={`font-display text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="font-ui text-[0.6rem] text-bc-secondary/60">{sub}</p>}
    </div>
  );
}
function StatusBadge({status}) {
  const c = STATUS_CFG[status] ?? {bg:'bg-white/5', text:'text-bc-secondary'};
  return <span className={`font-ui text-[0.58rem] tracking-[0.12em] px-2 py-[3px] rounded-full ${c.bg} ${c.text}`}>{status?.toUpperCase()}</span>;
}
function TierBadge({tier}) {
  const c = TIER_CFG[tier] ?? {bg:'bg-white/5', text:'text-bc-secondary'};
  return <span className={`font-ui text-[0.58rem] tracking-[0.12em] px-2 py-[3px] rounded-full ${c.bg} ${c.text}`}>{tier?.toUpperCase()}</span>;
}
function ActionBtn({onClick, children, red=false, disabled=false}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`font-ui text-[0.72rem] px-3 py-1.5 rounded-[8px] transition-all duration-150 border ${
        red ? 'border-bc-red/30 text-bc-red hover:bg-bc-red/10' : 'border-white/10 text-bc-secondary hover:text-white hover:bg-white/[0.06]'
      } disabled:opacity-40 disabled:cursor-not-allowed`}>
      {children}
    </button>
  );
}
function InfoField({label, value}) {
  return (
    <div>
      <p className="font-ui text-[0.58rem] tracking-[0.12em] text-bc-secondary mb-0.5">{label}</p>
      <p className="font-ui text-[0.8rem] text-white">{value || '—'}</p>
    </div>
  );
}

/* ─── Trade Drawer ───────────────────────────────────────────── */
function TradeDrawer({account, contact, onClose, onReload}) {
  const [tab, setTab]   = useState('Overview');
  const [confirm, setConfirm] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [creditInput, setCreditInput] = useState('');
  const [showCreditEdit, setShowCreditEdit] = useState(false);
  const [showTermsEdit, setShowTermsEdit] = useState(false);
  const [showTierEdit, setShowTierEdit]   = useState(false);
  const [newRule, setNewRule] = useState({product_id:'',min_qty:'1',custom_price:''});

  const detail    = useFetcher();
  const statusF   = useFetcher();
  const tierF     = useFetcher();
  const creditF   = useFetcher();
  const termsF    = useFetcher();
  const noteF     = useFetcher();
  const pricingF  = useFetcher();
  const deleteRF       = useFetcher();
  const reminderF      = useFetcher();
  const invoiceF       = useFetcher();
  const deleteAccountF = useFetcher();

  useEffect(() => {
    if (account?.id) detail.load(`/adminlogonprotocol/trade?trade_id=${account.id}`);
  }, [account?.id]);

  const refresh = () => {
    detail.load(`/adminlogonprotocol/trade?trade_id=${account.id}`);
    onReload();
  };

  useEffect(() => {
    if (statusF.data?.ok)  { setConfirm(null); refresh(); }
    if (tierF.data?.ok)    { setShowTierEdit(false); refresh(); }
    if (creditF.data?.ok)  { setShowCreditEdit(false); refresh(); }
    if (termsF.data?.ok)   { setShowTermsEdit(false); refresh(); }
    if (noteF.data?.ok)    { setNoteText(''); refresh(); }
    if (pricingF.data?.ok) { setNewRule({product_id:'',min_qty:'1',custom_price:''}); refresh(); }
    if (deleteRF.data?.ok) refresh();
    if (reminderF.data?.ok) refresh();
    if (invoiceF.data?.ok) refresh();
    if (deleteAccountF.data?.deleted) { onClose(); onReload(); }
  }, [statusF.data, tierF.data, creditF.data, termsF.data, noteF.data, pricingF.data, deleteRF.data, reminderF.data, invoiceF.data, deleteAccountF.data]);

  if (!account) return null;
  const d       = detail.data?.isDetail ? detail.data : null;
  const avail   = Math.max(0, (account.credit_limit||0) - (account.lifetime_spend||0));

  const submitStatus = (status) => {
    const fd = new FormData();
    fd.append('intent','update_status'); fd.append('trade_id',account.id); fd.append('status',status);
    statusF.submit(fd,{method:'post',action:'/adminlogonprotocol/trade'});
  };

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{width:'min(620px, 100vw)', background:'#111', borderLeft:'1px solid rgba(255,255,255,0.08)'}} className="h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{borderColor:'rgba(255,255,255,0.08)'}}>
          <div>
            <p className="font-ui text-[0.6rem] tracking-[0.15em] text-bc-secondary mb-0.5">{account.trade_number || '—'}</p>
            <h2 className="font-display text-lg text-white">{account.business_name}</h2>
            <div className="flex gap-2 mt-1">
              <StatusBadge status={account.status}/>
              <TierBadge tier={account.trade_tier}/>
            </div>
          </div>
          <button onClick={onClose} className="text-bc-secondary hover:text-white transition-colors p-1">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b px-6 overflow-x-auto" style={{borderColor:'rgba(255,255,255,0.08)'}}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`font-ui text-[0.68rem] tracking-[0.1em] py-3 mr-5 border-b-2 transition-colors duration-150 whitespace-nowrap flex-shrink-0 ${tab===t ? 'border-bc-red text-white' : 'border-transparent text-bc-secondary hover:text-white'}`}>
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* ── OVERVIEW ── */}
          {tab==='Overview' && <>
            <section>
              <p className="font-ui text-[0.6rem] tracking-[0.15em] text-bc-secondary mb-3">BUSINESS PROFILE</p>
              <div className="grid grid-cols-2 gap-4">
                <InfoField label="BUSINESS NAME"   value={account.business_name}/>
                <InfoField label="TRADING NAME"    value={account.trading_name}/>
                <InfoField label="ABN / BUS. NO."  value={account.business_number}/>
                <InfoField label="WEBSITE"         value={account.website}/>
                <InfoField label="COUNTRY"         value={account.country}/>
                <InfoField label="ADDRESS"         value={account.address}/>
              </div>
            </section>
            {contact && <section>
              <p className="font-ui text-[0.6rem] tracking-[0.15em] text-bc-secondary mb-3">CONTACT</p>
              <div className="grid grid-cols-2 gap-4">
                <InfoField label="CONTACT NAME" value={contact.contact_name}/>
                <InfoField label="EMAIL"        value={contact.email}/>
                <InfoField label="PHONE"        value={contact.phone}/>
              </div>
            </section>}
            <section>
              <p className="font-ui text-[0.6rem] tracking-[0.15em] text-bc-secondary mb-3">ACCOUNT INFORMATION</p>
              <div className="grid grid-cols-2 gap-4">
                <InfoField label="TRADE ID"       value={account.trade_number}/>
                <InfoField label="STATUS"         value={account.status}/>
                <InfoField label="TRADE TIER"     value={account.trade_tier}/>
                <InfoField label="PAYMENT TERMS"  value={account.payment_terms}/>
                <InfoField label="CREDIT LIMIT"   value={fmtMoney(account.credit_limit)}/>
                <InfoField label="AVAILABLE CREDIT" value={fmtMoney(avail)}/>
                <InfoField label="LIFETIME SPEND" value={fmtMoney(account.lifetime_spend)}/>
                <InfoField label="TOTAL ORDERS"   value={account.total_orders||'0'}/>
                <InfoField label="LAST ORDER"     value={fmtDate(account.last_order_date)}/>
                <InfoField label="CREATED"        value={fmtDate(account.created_at)}/>
              </div>
            </section>

            {/* Quick actions */}
            <section>
              <p className="font-ui text-[0.6rem] tracking-[0.15em] text-bc-secondary mb-3">ACTIONS</p>
              <div className="flex flex-wrap gap-2">
                {account.status!=='Approved'    && <ActionBtn onClick={() => submitStatus('Approved')}>Approve Account</ActionBtn>}
                {account.status!=='Rejected'    && <ActionBtn onClick={() => setConfirm('reject')} red>Reject Account</ActionBtn>}
                {account.status!=='Suspended'   && <ActionBtn onClick={() => setConfirm('suspend')} red>Suspend Account</ActionBtn>}
                {(account.status==='Suspended'||account.status==='Rejected') && <ActionBtn onClick={() => submitStatus('Pending')}>Reactivate Account</ActionBtn>}
                <ActionBtn onClick={() => setShowTierEdit(v=>!v)}>Change Trade Tier</ActionBtn>
                <ActionBtn onClick={() => setShowCreditEdit(v=>!v)}>Set Credit Limit</ActionBtn>
                <ActionBtn onClick={() => setShowTermsEdit(v=>!v)}>Set Payment Terms</ActionBtn>
                <ActionBtn onClick={() => { const fd=new FormData(); fd.append('intent','generate_invoice'); fd.append('trade_id',account.id); invoiceF.submit(fd,{method:'post',action:'/adminlogonprotocol/trade'}); }}>Generate Trade Invoice</ActionBtn>
                <ActionBtn onClick={() => { const fd=new FormData(); fd.append('intent','send_payment_reminder'); fd.append('trade_id',account.id); reminderF.submit(fd,{method:'post',action:'/adminlogonprotocol/trade'}); }}>Send Payment Reminder</ActionBtn>
                <ActionBtn onClick={() => setTab('Notes')}>Add Internal Note</ActionBtn>
                <ActionBtn onClick={() => setConfirm('delete')} red>Delete Account</ActionBtn>
              </div>

              {/* Confirm dialogs */}
              {confirm==='reject'  && <div className="mt-3 p-3 rounded-[10px] bg-bc-red/10 border border-bc-red/20"><p className="font-ui text-[0.72rem] text-bc-red mb-2">Reject this trade account?</p><div className="flex gap-2"><ActionBtn red onClick={() => submitStatus('Rejected')}>Yes, Reject</ActionBtn><ActionBtn onClick={() => setConfirm(null)}>Cancel</ActionBtn></div></div>}
              {confirm==='suspend' && <div className="mt-3 p-3 rounded-[10px] bg-bc-red/10 border border-bc-red/20"><p className="font-ui text-[0.72rem] text-bc-red mb-2">Suspend this account?</p><div className="flex gap-2"><ActionBtn red onClick={() => submitStatus('Suspended')}>Yes, Suspend</ActionBtn><ActionBtn onClick={() => setConfirm(null)}>Cancel</ActionBtn></div></div>}
              {confirm==='delete'  && (
                <div className="mt-3 p-3 rounded-[10px] bg-bc-red/10 border border-bc-red/30">
                  <p className="font-ui text-[0.72rem] text-bc-red mb-0.5 font-semibold">Permanently delete this trade account?</p>
                  <p className="font-ui text-[0.65rem] text-bc-red/70 mb-2">This will delete all contacts, notes, communications and pricing rules. This cannot be undone.</p>
                  <div className="flex gap-2">
                    <ActionBtn red onClick={() => {
                      const fd = new FormData();
                      fd.append('intent','delete_trade_account'); fd.append('trade_id',account.id);
                      deleteAccountF.submit(fd,{method:'post',action:'/adminlogonprotocol/trade'});
                    }}>
                      {deleteAccountF.state !== 'idle' ? 'Deleting…' : 'Yes, Delete Permanently'}
                    </ActionBtn>
                    <ActionBtn onClick={() => setConfirm(null)}>Cancel</ActionBtn>
                  </div>
                </div>
              )}

              {/* Change Tier */}
              {showTierEdit && (
                <tierF.Form method="post" action="/adminlogonprotocol/trade" className="mt-3 flex flex-wrap gap-2 items-center">
                  <input type="hidden" name="intent" value="change_tier"/>
                  <input type="hidden" name="trade_id" value={account.id}/>
                  <select name="trade_tier" defaultValue={account.trade_tier} className="font-ui text-[0.72rem] bg-transparent border border-white/15 rounded-[8px] px-2 py-1.5 text-white">
                    {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <button type="submit" className="font-ui text-[0.72rem] px-3 py-1.5 rounded-[8px] bg-bc-red/80 text-white hover:bg-bc-red transition-colors">Save</button>
                  <ActionBtn onClick={() => setShowTierEdit(false)}>Cancel</ActionBtn>
                </tierF.Form>
              )}

              {/* Set Credit Limit */}
              {showCreditEdit && (
                <creditF.Form method="post" action="/adminlogonprotocol/trade" className="mt-3 flex flex-wrap gap-2 items-center">
                  <input type="hidden" name="intent" value="set_credit_limit"/>
                  <input type="hidden" name="trade_id" value={account.id}/>
                  <input name="credit_limit" type="number" min="0" step="100" defaultValue={account.credit_limit||0} placeholder="Credit limit (AUD)" className="font-ui text-[0.72rem] bg-transparent border border-white/15 rounded-[8px] px-2 py-1.5 text-white w-44"/>
                  <button type="submit" className="font-ui text-[0.72rem] px-3 py-1.5 rounded-[8px] bg-bc-red/80 text-white hover:bg-bc-red transition-colors">Save</button>
                  <ActionBtn onClick={() => setShowCreditEdit(false)}>Cancel</ActionBtn>
                </creditF.Form>
              )}

              {/* Set Payment Terms */}
              {showTermsEdit && (
                <termsF.Form method="post" action="/adminlogonprotocol/trade" className="mt-3 flex flex-wrap gap-2 items-center">
                  <input type="hidden" name="intent" value="set_payment_terms"/>
                  <input type="hidden" name="trade_id" value={account.id}/>
                  <select name="payment_terms" defaultValue={account.payment_terms} className="font-ui text-[0.72rem] bg-transparent border border-white/15 rounded-[8px] px-2 py-1.5 text-white">
                    {TERMS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <button type="submit" className="font-ui text-[0.72rem] px-3 py-1.5 rounded-[8px] bg-bc-red/80 text-white hover:bg-bc-red transition-colors">Save</button>
                  <ActionBtn onClick={() => setShowTermsEdit(false)}>Cancel</ActionBtn>
                </termsF.Form>
              )}
            </section>
          </>}

          {/* ── ORDERS ── */}
          {tab==='Orders' && (
            <section>
              <p className="font-ui text-[0.6rem] tracking-[0.15em] text-bc-secondary mb-3">ORDER HISTORY</p>
              {!d ? <p className="font-ui text-[0.72rem] text-bc-secondary">Loading…</p> :
               d.orders.length===0 ? <p className="font-ui text-[0.72rem] text-bc-secondary">No orders found.</p> :
               <div className="overflow-x-auto"><table className="w-full text-left border-collapse">
                 <thead><tr>{['ORDER','DATE','AMOUNT','STATUS'].map(h=><th key={h} className="font-ui text-[0.6rem] tracking-[0.1em] text-bc-secondary pb-2 pr-4 whitespace-nowrap">{h}</th>)}</tr></thead>
                 <tbody>{d.orders.map(o=>(
                   <tr key={o.id} className="border-t" style={{borderColor:'rgba(255,255,255,0.05)'}}>
                     <td className="font-ui text-[0.72rem] text-bc-red py-2 pr-4 whitespace-nowrap">{o.order_number||o.id?.slice(0,8)}</td>
                     <td className="font-ui text-[0.72rem] text-bc-secondary pr-4 whitespace-nowrap">{fmtDate(o.created_at)}</td>
                     <td className="font-ui text-[0.72rem] text-white pr-4 whitespace-nowrap">{fmtMoney(o.total_price)} {o.currency}</td>
                     <td className="pr-4"><span className="font-ui text-[0.6rem] tracking-widest capitalize px-2 py-[3px] rounded-full bg-white/5 text-bc-secondary">{o.financial_status||'—'}</span></td>
                   </tr>
                 ))}</tbody>
               </table></div>}
            </section>
          )}

          {/* ── INVOICES ── */}
          {tab==='Invoices' && (
            <section>
              <p className="font-ui text-[0.6rem] tracking-[0.15em] text-bc-secondary mb-3">INVOICE HISTORY</p>
              <p className="font-ui text-[0.72rem] text-bc-secondary">Run Section 19 SQL and integrate with invoice system to enable trade invoices.</p>
              <div className="mt-4 flex gap-2">
                <ActionBtn onClick={() => { const fd=new FormData(); fd.append('intent','generate_invoice'); fd.append('trade_id',account.id); invoiceF.submit(fd,{method:'post',action:'/adminlogonprotocol/trade'}); }}>Generate Trade Invoice</ActionBtn>
              </div>
            </section>
          )}

          {/* ── COMMUNICATIONS ── */}
          {tab==='Communications' && (
            <section>
              <p className="font-ui text-[0.6rem] tracking-[0.15em] text-bc-secondary mb-3">COMMUNICATION TIMELINE</p>
              {!d ? <p className="font-ui text-[0.72rem] text-bc-secondary">Loading…</p> :
               d.comms.length===0 ? <p className="font-ui text-[0.72rem] text-bc-secondary">No communications yet.</p> :
               <div className="space-y-3">
                 {d.comms.map(c=>(
                   <div key={c.id} className="flex gap-3 items-start">
                     <span className="text-sm mt-0.5 flex-shrink-0">{COMM_ICONS[c.communication_type]||'•'}</span>
                     <div>
                       <p className="font-ui text-[0.72rem] text-white">{c.communication_type}</p>
                       {c.description && <p className="font-ui text-[0.65rem] text-bc-secondary mt-0.5">{c.description}</p>}
                       <p className="font-ui text-[0.6rem] text-bc-secondary/50 mt-0.5">{fmtDT(c.created_at)}</p>
                     </div>
                   </div>
                 ))}
               </div>}
            </section>
          )}

          {/* ── NOTES ── */}
          {tab==='Notes' && (
            <section>
              <p className="font-ui text-[0.6rem] tracking-[0.15em] text-bc-secondary mb-3">INTERNAL NOTES</p>
              <noteF.Form method="post" action="/adminlogonprotocol/trade" className="mb-4">
                <input type="hidden" name="intent" value="add_note"/>
                <input type="hidden" name="trade_id" value={account.id}/>
                <textarea name="note" value={noteText} onChange={e=>setNoteText(e.target.value)} rows={3} placeholder="Add a private note…"
                  className="w-full font-ui text-[0.78rem] bg-white/[0.04] border border-white/10 rounded-[10px] px-3 py-2.5 text-white placeholder-bc-secondary/40 resize-none mb-2"/>
                <button type="submit" disabled={!noteText.trim()}
                  className="font-ui text-[0.72rem] px-4 py-1.5 rounded-[8px] bg-bc-red/80 text-white hover:bg-bc-red transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  Save Note
                </button>
              </noteF.Form>
              {!d ? <p className="font-ui text-[0.72rem] text-bc-secondary">Loading…</p> :
               d.notes.length===0 ? <p className="font-ui text-[0.72rem] text-bc-secondary">No notes yet.</p> :
               <div className="space-y-3">
                 {d.notes.map(n=>(
                   <div key={n.id} style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.07)'}} className="rounded-[10px] px-4 py-3">
                     <p className="font-ui text-[0.78rem] text-white">{n.note}</p>
                     <p className="font-ui text-[0.6rem] text-bc-secondary/50 mt-1.5">{n.created_by} · {fmtDT(n.created_at)}</p>
                   </div>
                 ))}
               </div>}
            </section>
          )}

          {/* ── PRICING ── */}
          {tab==='Pricing' && (
            <section>
              <p className="font-ui text-[0.6rem] tracking-[0.15em] text-bc-secondary mb-3">CUSTOM TRADE PRICING</p>
              {/* Add rule form */}
              <div style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.07)'}} className="rounded-[10px] p-4 mb-4">
                <p className="font-ui text-[0.65rem] text-bc-secondary mb-3">ADD PRICING RULE</p>
                <pricingF.Form method="post" action="/adminlogonprotocol/trade" className="flex flex-wrap gap-2 items-end">
                  <input type="hidden" name="intent" value="add_pricing_rule"/>
                  <input type="hidden" name="trade_id" value={account.id}/>
                  <div className="flex flex-col gap-1">
                    <label className="font-ui text-[0.58rem] text-bc-secondary">PRODUCT / SKU</label>
                    <input name="product_id" value={newRule.product_id} onChange={e=>setNewRule(r=>({...r,product_id:e.target.value}))} placeholder="Product name or ID"
                      className="font-ui text-[0.72rem] bg-transparent border border-white/15 rounded-[8px] px-2 py-1.5 text-white w-40 placeholder-bc-secondary/40"/>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-ui text-[0.58rem] text-bc-secondary">MIN QTY</label>
                    <input name="min_qty" type="number" min="1" value={newRule.min_qty} onChange={e=>setNewRule(r=>({...r,min_qty:e.target.value}))}
                      className="font-ui text-[0.72rem] bg-transparent border border-white/15 rounded-[8px] px-2 py-1.5 text-white w-20"/>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-ui text-[0.58rem] text-bc-secondary">TRADE PRICE (AUD)</label>
                    <input name="custom_price" type="number" min="0" step="0.01" value={newRule.custom_price} onChange={e=>setNewRule(r=>({...r,custom_price:e.target.value}))} placeholder="0.00"
                      className="font-ui text-[0.72rem] bg-transparent border border-white/15 rounded-[8px] px-2 py-1.5 text-white w-28"/>
                  </div>
                  <button type="submit" className="font-ui text-[0.72rem] px-3 py-1.5 rounded-[8px] bg-bc-red/80 text-white hover:bg-bc-red transition-colors">Add Rule</button>
                </pricingF.Form>
              </div>
              {/* Rules table */}
              {!d ? <p className="font-ui text-[0.72rem] text-bc-secondary">Loading…</p> :
               d.pricing.length===0 ? <p className="font-ui text-[0.72rem] text-bc-secondary">No custom pricing rules yet.</p> :
               <div className="overflow-x-auto"><table className="w-full text-left border-collapse">
                 <thead><tr>{['PRODUCT','MIN QTY','TRADE PRICE',''].map((h,i)=><th key={i} className="font-ui text-[0.6rem] tracking-[0.1em] text-bc-secondary pb-2 pr-4 whitespace-nowrap">{h}</th>)}</tr></thead>
                 <tbody>{d.pricing.map(r=>(
                   <tr key={r.id} className="border-t" style={{borderColor:'rgba(255,255,255,0.05)'}}>
                     <td className="font-ui text-[0.72rem] text-white py-2 pr-4">{r.product_id||'—'}</td>
                     <td className="font-ui text-[0.72rem] text-bc-secondary pr-4">{r.minimum_quantity}</td>
                     <td className="font-ui text-[0.72rem] text-[#22c55e] pr-4">{fmtMoney(r.custom_price)}</td>
                     <td>
                       <deleteRF.Form method="post" action="/adminlogonprotocol/trade">
                         <input type="hidden" name="intent" value="delete_pricing_rule"/>
                         <input type="hidden" name="rule_id" value={r.id}/>
                         <button type="submit" className="font-ui text-[0.6rem] text-bc-red/60 hover:text-bc-red transition-colors">Delete</button>
                       </deleteRF.Form>
                     </td>
                   </tr>
                 ))}</tbody>
               </table></div>}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── CSV Export ─────────────────────────────────────────────── */
function exportCSV(accounts, contactMap) {
  const headers = [
    'trade_number','business_name','trading_name','business_number',
    'country','address','website','status','trade_tier','payment_terms',
    'credit_limit','lifetime_spend','total_orders','last_order_date',
    'contact_name','email','phone','created_at',
  ];
  const escape = v => {
    if (v == null || v === '') return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g,'""')}"` : s;
  };
  const rows = [headers.join(',')];
  for (const a of accounts) {
    const c = contactMap?.[a.id] ?? {};
    rows.push([
      a.trade_number, a.business_name, a.trading_name, a.business_number,
      a.country, a.address, a.website, a.status, a.trade_tier, a.payment_terms,
      a.credit_limit, a.lifetime_spend, a.total_orders, a.last_order_date,
      c.contact_name, c.email, c.phone, a.created_at,
    ].map(escape).join(','));
  }
  const blob = new Blob([rows.join('\n')], {type:'text/csv;charset=utf-8;'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `blackcrow-trade-accounts-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ─── Import CSV Modal ───────────────────────────────────────── */
function ImportCsvModal({onClose}) {
  const f = useFetcher();
  const [csvText,   setCsvText]   = useState('');
  const [fileName,  setFileName]  = useState('');
  const [parseErr,  setParseErr]  = useState('');
  const [tab,       setTab]       = useState('upload'); // 'upload' | 'paste'

  useEffect(() => {
    if (f.data?.ok) {
      // stay open to show result
    }
  }, [f.data]);

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.csv')) { setParseErr('Please select a .csv file'); return; }
    setFileName(file.name);
    setParseErr('');
    const reader = new FileReader();
    reader.onload = ev => setCsvText(ev.target?.result ?? '');
    reader.readAsText(file);
  }

  function handleImport() {
    if (!csvText.trim()) { setParseErr('No CSV data — upload a file or paste content'); return; }
    setParseErr('');
    const fd = new FormData();
    fd.append('intent', 'import_csv');
    fd.append('csv_data', csvText);
    f.submit(fd, {method:'post', action:'/adminlogonprotocol/trade'});
  }

  const busy    = f.state !== 'idle';
  const result  = f.data;
  const inp     = 'w-full bg-bc-surface border border-bc-divider rounded-[8px] px-3 py-2 font-ui text-[0.78rem] text-white placeholder-bc-secondary/30 focus:outline-none focus:border-bc-red/40';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{background:'rgba(0,0,0,0.65)', backdropFilter:'blur(4px)'}}
      onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="relative w-full max-w-lg rounded-[16px] bc-card p-6" style={{background:'rgba(18,18,18,0.98)'}}>
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-display text-[1.1rem] text-white">Import Trade Accounts</h2>
            <p className="font-ui text-[0.62rem] text-bc-secondary/40 mt-0.5">CSV format — see required columns below</p>
          </div>
          <button onClick={onClose} className="text-bc-secondary hover:text-white transition-colors p-1">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Tab switcher */}
        {!result && (
          <div className="flex gap-1 mb-4 p-1 rounded-[10px] bg-white/[0.04] border border-bc-divider">
            {['upload','paste'].map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex-1 py-1.5 rounded-[8px] font-ui text-[0.68rem] uppercase tracking-[0.08em] transition-all ${tab===t ? 'bg-bc-red text-white' : 'text-bc-secondary hover:text-white'}`}>
                {t === 'upload' ? '↑ Upload File' : '⌨ Paste CSV'}
              </button>
            ))}
          </div>
        )}

        {/* Result view */}
        {result ? (
          <div className="space-y-3">
            <div className={`p-4 rounded-[10px] border ${result.ok ? 'bg-[#22c55e]/10 border-[#22c55e]/20' : 'bg-bc-red/10 border-bc-red/20'}`}>
              {result.ok ? (
                <p className="font-ui text-[0.78rem] text-[#22c55e]">✓ Import complete — {result.created} account{result.created!==1?'s':''} created.</p>
              ) : (
                <p className="font-ui text-[0.78rem] text-bc-red">✗ Import failed: {result.error}</p>
              )}
            </div>
            {result.errors?.length > 0 && (
              <div className="p-3 rounded-[10px] bg-bc-red/5 border border-bc-red/10 max-h-32 overflow-y-auto">
                <p className="font-ui text-[0.6rem] uppercase tracking-[0.08em] text-bc-red/60 mb-1">{result.errors.length} row error{result.errors.length!==1?'s':''}</p>
                {result.errors.map((e,i) => <p key={i} className="font-ui text-[0.65rem] text-bc-secondary/70">{e}</p>)}
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={onClose} className="flex-1 py-2 bg-bc-red rounded-[10px] font-ui text-[0.78rem] text-white hover:bg-bc-red/80 transition-all">Done</button>
              {result.ok && <button onClick={() => { setCsvText(''); setFileName(''); f.load && (f.data=null); window.location.reload(); }} className="px-4 py-2 bc-card border border-bc-divider rounded-[10px] font-ui text-[0.72rem] text-bc-secondary hover:text-white transition-colors">Import More</button>}
            </div>
          </div>
        ) : (
          <>
            {/* Upload tab */}
            {tab === 'upload' && (
              <label className="flex flex-col items-center justify-center gap-3 p-8 rounded-[12px] border-2 border-dashed border-bc-divider hover:border-bc-red/40 cursor-pointer transition-colors mb-4 bg-white/[0.02]">
                <svg className="text-bc-secondary/40" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <div className="text-center">
                  <p className="font-ui text-[0.78rem] text-white">{fileName || 'Click to select CSV file'}</p>
                  <p className="font-ui text-[0.62rem] text-bc-secondary/40 mt-0.5">.csv files only</p>
                </div>
                <input type="file" accept=".csv" className="hidden" onChange={handleFile} />
              </label>
            )}

            {/* Paste tab */}
            {tab === 'paste' && (
              <textarea
                value={csvText} onChange={e => setCsvText(e.target.value)}
                placeholder={'business_name,country,status,trade_tier,...\nAcme Corp,Australia,Pending,Trade,...'}
                rows={6} className={inp + ' resize-none font-mono text-[0.65rem] mb-4'}
              />
            )}

            {/* Column reference */}
            <div className="mb-4 p-3 rounded-[10px] bg-white/[0.03] border border-bc-divider">
              <p className="font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40 mb-1.5">Required column</p>
              <p className="font-ui text-[0.65rem] text-bc-red font-mono">business_name</p>
              <p className="font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40 mt-2 mb-1">Optional columns</p>
              <p className="font-ui text-[0.62rem] text-bc-secondary/60 font-mono leading-relaxed">trading_name · business_number · country · address · website · status · trade_tier · payment_terms · credit_limit · contact_name · email · phone</p>
            </div>

            {parseErr && <p className="font-ui text-[0.68rem] text-bc-red mb-3">{parseErr}</p>}

            <div className="flex gap-2">
              <button onClick={handleImport} disabled={busy || !csvText.trim()}
                className="flex-1 py-2.5 bg-bc-red rounded-[10px] font-ui text-[0.78rem] text-white disabled:opacity-40 hover:bg-bc-red/80 transition-all">
                {busy ? 'Importing…' : `Import${csvText ? ` (${csvText.trim().split('\n').length - 1} rows)` : ''}`}
              </button>
              <button onClick={onClose} className="px-4 py-2 bc-card border border-bc-divider rounded-[10px] font-ui text-[0.78rem] text-bc-secondary hover:text-white transition-colors">
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Create Trade Account Modal ────────────────────────────── */
function CreateTradeModal({onClose}) {
  const f = useFetcher();
  useEffect(() => { if (f.data?.ok) onClose(); }, [f.data]);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.6)', backdropFilter:'blur(4px)'}} onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{maxHeight:'90vh', background:'#111', border:'1px solid rgba(255,255,255,0.1)'}} className="w-full max-w-[600px] rounded-[20px] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 z-10" style={{background:'#111', borderColor:'rgba(255,255,255,0.08)'}}>
          <h2 className="font-display text-base text-white">Create Trade Account</h2>
          <button onClick={onClose} className="text-bc-secondary hover:text-white transition-colors p-1">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <f.Form method="post" action="/adminlogonprotocol/trade" className="px-6 py-5 space-y-5">
          <input type="hidden" name="intent" value="create_trade_account"/>
          {f.data?.error && <p className="font-ui text-[0.72rem] text-bc-red">{f.data.error}</p>}

          <div>
            <p className="font-ui text-[0.6rem] tracking-[0.15em] text-bc-secondary mb-3">BUSINESS INFORMATION</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[['business_name','Business Name'],['trading_name','Trading Name'],['business_number','ABN / Business Number'],['website','Website']].map(([n,l])=>(
                <div key={n}>
                  <label className="font-ui text-[0.6rem] tracking-[0.1em] text-bc-secondary block mb-1">{l.toUpperCase()}</label>
                  <input name={n} placeholder={l} required={n==='business_name'} className="w-full font-ui text-[0.78rem] bg-white/[0.04] border border-white/10 rounded-[10px] px-3 py-2.5 text-white placeholder-bc-secondary/40"/>
                </div>
              ))}
              <div>
                <label className="font-ui text-[0.6rem] tracking-[0.1em] text-bc-secondary block mb-1">COUNTRY</label>
                <select name="country" className="w-full font-ui text-[0.78rem] bg-[#111] border border-white/10 rounded-[10px] px-3 py-2.5 text-white">
                  {COUNTRIES.map(c=><option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="font-ui text-[0.6rem] tracking-[0.1em] text-bc-secondary block mb-1">ADDRESS</label>
                <input name="address" placeholder="Full address" className="w-full font-ui text-[0.78rem] bg-white/[0.04] border border-white/10 rounded-[10px] px-3 py-2.5 text-white placeholder-bc-secondary/40"/>
              </div>
            </div>
          </div>

          <div>
            <p className="font-ui text-[0.6rem] tracking-[0.15em] text-bc-secondary mb-3">CONTACT</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[['contact_name','Contact Name'],['email','Email'],['phone','Phone']].map(([n,l])=>(
                <div key={n}>
                  <label className="font-ui text-[0.6rem] tracking-[0.1em] text-bc-secondary block mb-1">{l.toUpperCase()}</label>
                  <input name={n} type={n==='email'?'email':'text'} placeholder={l} className="w-full font-ui text-[0.78rem] bg-white/[0.04] border border-white/10 rounded-[10px] px-3 py-2.5 text-white placeholder-bc-secondary/40"/>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="font-ui text-[0.6rem] tracking-[0.15em] text-bc-secondary mb-3">TRADE TERMS</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="font-ui text-[0.6rem] tracking-[0.1em] text-bc-secondary block mb-1">TRADE TIER</label>
                <select name="trade_tier" className="w-full font-ui text-[0.78rem] bg-[#111] border border-white/10 rounded-[10px] px-3 py-2.5 text-white">
                  {TIERS.map(t=><option key={t} value={t}>{t} ({TIER_VOLS[t]})</option>)}
                </select>
              </div>
              <div>
                <label className="font-ui text-[0.6rem] tracking-[0.1em] text-bc-secondary block mb-1">PAYMENT TERMS</label>
                <select name="payment_terms" className="w-full font-ui text-[0.78rem] bg-[#111] border border-white/10 rounded-[10px] px-3 py-2.5 text-white">
                  {TERMS.map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="font-ui text-[0.6rem] tracking-[0.1em] text-bc-secondary block mb-1">CREDIT LIMIT (AUD)</label>
                <input name="credit_limit" type="number" min="0" step="100" defaultValue="0" placeholder="0" className="w-full font-ui text-[0.78rem] bg-white/[0.04] border border-white/10 rounded-[10px] px-3 py-2.5 text-white"/>
              </div>
              <div>
                <label className="font-ui text-[0.6rem] tracking-[0.1em] text-bc-secondary block mb-1">STATUS</label>
                <select name="status" className="w-full font-ui text-[0.78rem] bg-[#111] border border-white/10 rounded-[10px] px-3 py-2.5 text-white">
                  <option value="Pending">Pending</option>
                  <option value="Approved">Approved</option>
                </select>
              </div>
            </div>
          </div>

          <div>
            <label className="font-ui text-[0.6rem] tracking-[0.1em] text-bc-secondary block mb-1">NOTES</label>
            <textarea name="notes" rows={3} placeholder="Internal notes (optional)" className="w-full font-ui text-[0.78rem] bg-white/[0.04] border border-white/10 rounded-[10px] px-3 py-2.5 text-white placeholder-bc-secondary/40 resize-none"/>
          </div>

          <div className="flex gap-3 pt-2 border-t" style={{borderColor:'rgba(255,255,255,0.08)'}}>
            <button type="submit" name="status" value="Pending"
              className="font-ui text-[0.72rem] px-4 py-2 rounded-[10px] border border-white/15 text-bc-secondary hover:text-white hover:bg-white/[0.06] transition-colors">
              Save as Draft
            </button>
            <button type="submit"
              className="font-ui text-[0.72rem] px-5 py-2 rounded-[10px] bg-bc-red text-white hover:bg-bc-red/80 transition-colors">
              {f.state==='submitting' ? 'Creating…' : 'Create Trade Account'}
            </button>
            <button type="button" onClick={onClose} className="font-ui text-[0.72rem] px-4 py-2 rounded-[10px] text-bc-secondary hover:text-white transition-colors ml-auto">Cancel</button>
          </div>
        </f.Form>
      </div>
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────────── */
export default function TradePage() {
  const {accounts, contacts, dbError} = useLoaderData();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [showCreate, setShowCreate]     = useState(false);
  const [showImport, setShowImport]     = useState(false);
  const [search, setSearch]             = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterTier, setFilterTier]     = useState('');
  const [filterCountry, setFilterCountry] = useState('');
  const [filterTerms, setFilterTerms]   = useState('');
  const [reloadKey, setReloadKey]       = useState(0);

  /* contact map */
  const contactMap = useMemo(() => {
    const m = {};
    (contacts||[]).forEach(c => { m[c.trade_account_id] = c; });
    return m;
  }, [contacts]);

  /* KPIs */
  const kpi = useMemo(() => {
    const total      = accounts.length;
    const pending    = accounts.filter(a => a.status==='Pending').length;
    const approved   = accounts.filter(a => a.status==='Approved').length;
    const distrib    = accounts.filter(a => a.status==='Distributor' || a.trade_tier==='Distributor').length;
    const now        = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const rev        = accounts.filter(a => a.last_order_date >= monthStart.slice(0,10)).reduce((s,a) => s+(Number(a.lifetime_spend)||0), 0);
    const avgOrder   = total > 0 ? accounts.reduce((s,a)=>s+(Number(a.lifetime_spend)||0),0) / Math.max(1, accounts.reduce((s,a)=>s+(a.total_orders||0),0)) : 0;
    return {total, pending, approved, distrib, rev, avgOrder};
  }, [accounts]);

  /* Filtered */
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return accounts.filter(a => {
      const c = contactMap[a.id];
      if (q && ![a.business_name,a.trading_name,a.business_number,a.trade_number,c?.contact_name,c?.email,c?.phone].some(v => v?.toLowerCase().includes(q))) return false;
      if (filterStatus  && a.status!==filterStatus)   return false;
      if (filterTier    && a.trade_tier!==filterTier) return false;
      if (filterCountry && a.country!==filterCountry) return false;
      if (filterTerms   && a.payment_terms!==filterTerms) return false;
      return true;
    });
  }, [accounts, contactMap, search, filterStatus, filterTier, filterCountry, filterTerms]);

  const sel = selectedAccount ? accounts.find(a=>a.id===selectedAccount.id) : null;

  return (
    <div style={{minHeight:'100vh', background:'#0e0e0e', color:'white'}}>
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)}/>
      {showCreate  && <CreateTradeModal onClose={() => { setShowCreate(false); setReloadKey(k=>k+1); }}/>}
      {showImport  && <ImportCsvModal  onClose={() => { setShowImport(false);  setReloadKey(k=>k+1); }}/>}
      {sel && <TradeDrawer account={sel} contact={contactMap[sel.id]} onClose={() => setSelectedAccount(null)} onReload={() => setReloadKey(k=>k+1)}/>}
      {sel && <div className="fixed inset-0 z-[55] bg-black/40" style={{pointerEvents:'none'}}/>}

      <div className="max-w-[1600px] mx-auto px-6 py-8">
        {/* Top bar */}
        <div className="flex items-center gap-4 mb-8">
          <button onClick={() => setSidebarOpen(true)} className="text-bc-secondary hover:text-white transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <a href="/adminlogonprotocol" className="text-bc-secondary hover:text-white transition-colors">
            <img src="/blackcrow-logo.svg" alt="BlackCrow" className="h-6"/>
          </a>
          <span className="font-ui text-[0.6rem] tracking-[0.2em] text-bc-secondary">ADMIN DASHBOARD</span>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse"/>
            <span className="font-ui text-[0.6rem] tracking-[0.15em] text-[#22c55e]">Live</span>
          </div>
        </div>

        {/* Page header */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="font-display text-3xl text-white tracking-tight mb-1">TRADE ACCOUNTS</h1>
            <p className="font-ui text-[0.65rem] tracking-[0.18em] text-bc-secondary">WHOLESALE & DISTRIBUTOR COMMAND CENTER</p>
            {dbError && <p className="font-ui text-[0.65rem] text-bc-red mt-2">Database error: {dbError}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setShowImport(true)} className="flex items-center gap-2 font-ui text-[0.72rem] px-4 py-2 rounded-[10px] border border-white/10 text-bc-secondary hover:text-white hover:bg-white/[0.06] transition-all">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Import CSV
            </button>
            <button onClick={() => exportCSV(accounts, contactMap)} className="flex items-center gap-2 font-ui text-[0.72rem] px-4 py-2 rounded-[10px] border border-white/10 text-bc-secondary hover:text-white hover:bg-white/[0.06] transition-all">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export CSV
            </button>
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 font-ui text-[0.72rem] px-4 py-2 rounded-[10px] bg-bc-red text-white hover:bg-bc-red/80 transition-all">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Create Trade Account
            </button>
          </div>
        </div>

        {/* KPI Tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <KpiTile label="TOTAL TRADE ACCOUNTS" value={kpi.total}/>
          <KpiTile label="PENDING APPLICATIONS"  value={kpi.pending}  color="text-[#f59e0b]"/>
          <KpiTile label="APPROVED ACCOUNTS"     value={kpi.approved} color="text-[#22c55e]"/>
          <KpiTile label="DISTRIBUTOR ACCOUNTS"  value={kpi.distrib}  color="text-[#60a5fa]"/>
          <KpiTile label="TRADE REVENUE (MONTH)" value={fmtMoney(kpi.rev)} sub="USD · current month"/>
          <KpiTile label="AVG TRADE ORDER VALUE" value={fmtMoney(kpi.avgOrder)} sub="per order all time"/>
        </div>

        {/* Filters */}
        <div style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.07)'}} className="rounded-[14px] px-4 py-3 mb-4 flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2 bg-white/[0.04] border border-white/10 rounded-[10px] px-3 py-2 flex-1 min-w-[200px]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-bc-secondary flex-shrink-0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search business, contact, ABN, trade ID…"
              className="font-ui text-[0.78rem] bg-transparent text-white placeholder-bc-secondary/40 outline-none w-full"/>
          </div>
          {[
            [filterStatus,  setFilterStatus,  ['',...STATUSES], 'All Statuses'],
            [filterTier,    setFilterTier,    ['',...TIERS],    'All Tiers'],
            [filterCountry, setFilterCountry, ['',...COUNTRIES],'All Countries'],
            [filterTerms,   setFilterTerms,   ['',...TERMS],    'All Terms'],
          ].map(([val, setter, opts, placeholder], i) => (
            <select key={i} value={val} onChange={e=>setter(e.target.value)}
              className="font-ui text-[0.72rem] bg-[#0e0e0e] border border-white/10 rounded-[10px] px-3 py-2 text-white min-w-[120px]">
              {opts.map(o => <option key={o} value={o}>{o||placeholder}</option>)}
            </select>
          ))}
          <span className="font-ui text-[0.65rem] text-bc-secondary ml-auto">{filtered.length} account{filtered.length!==1?'s':''}</span>
        </div>

        {/* Table */}
        <div style={{background:'rgba(255,255,255,0.02)',border:'1px solid rgba(255,255,255,0.07)'}} className="rounded-[16px] overflow-hidden">
          <div className="overflow-x-auto"><table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr style={{borderBottom:'1px solid rgba(255,255,255,0.07)'}}>
                {['TRADE ID','BUSINESS NAME','CONTACT','COUNTRY','TIER','STATUS','TERMS','CREDIT LIMIT','LIFETIME SPEND','LAST ORDER'].map(h=>(
                  <th key={h} className="font-ui text-[0.58rem] tracking-[0.12em] text-bc-secondary px-4 py-3 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length===0 ? (
                <tr><td colSpan={10} className="font-ui text-[0.78rem] text-bc-secondary text-center py-10">
                  {dbError ? 'Run Section 19 SQL in Supabase to enable Trade Accounts.' : 'No trade accounts match the current filters.'}
                </td></tr>
              ) : filtered.map((a, i) => {
                const c = contactMap[a.id];
                return (
                  <tr key={a.id} onClick={() => setSelectedAccount(a)}
                    className="cursor-pointer transition-colors hover:bg-white/[0.03]"
                    style={{borderBottom: i<filtered.length-1 ? '1px solid rgba(255,255,255,0.05)' : 'none'}}>
                    <td className="px-4 py-3 font-ui text-[0.65rem] text-bc-red whitespace-nowrap">{a.trade_number||'—'}</td>
                    <td className="px-4 py-3">
                      <p className="font-ui text-[0.78rem] text-white">{a.business_name}</p>
                      {a.trading_name && <p className="font-ui text-[0.62rem] text-bc-secondary">{a.trading_name}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-ui text-[0.72rem] text-white">{c?.contact_name||'—'}</p>
                      <p className="font-ui text-[0.62rem] text-bc-secondary">{c?.email||''}</p>
                    </td>
                    <td className="px-4 py-3 font-ui text-[0.72rem] text-bc-secondary">{a.country||'—'}</td>
                    <td className="px-4 py-3"><TierBadge tier={a.trade_tier}/></td>
                    <td className="px-4 py-3"><StatusBadge status={a.status}/></td>
                    <td className="px-4 py-3 font-ui text-[0.65rem] text-bc-secondary whitespace-nowrap">{a.payment_terms||'—'}</td>
                    <td className="px-4 py-3 font-ui text-[0.72rem] text-white">{fmtMoney(a.credit_limit)}</td>
                    <td className="px-4 py-3 font-ui text-[0.72rem] text-[#22c55e]">{fmtMoney(a.lifetime_spend)}</td>
                    <td className="px-4 py-3 font-ui text-[0.65rem] text-bc-secondary whitespace-nowrap">{fmtDate(a.last_order_date)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>
      </div>
    </div>
  );
}
