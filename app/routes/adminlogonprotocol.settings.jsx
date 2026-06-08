import {useState} from 'react';
import {useLoaderData, useFetcher} from '@remix-run/react';
import {json} from '@shopify/remix-oxygen';
import {getSupabase} from '~/lib/supabase.server';
import {AdminSidebar} from '~/components/AdminSidebar';
import {requireFinalAdmin} from '~/lib/auth.server';

export const meta = () => [{title: 'Settings | BlackCrow Admin'}];

/* ─── Constants ──────────────────────────────────────────────── */
const SECTIONS = [
  {id:'company',   label:'Company Details'},
  {id:'invoice',   label:'Invoice Settings'},
  {id:'order',     label:'Order Settings'},
  {id:'tax',       label:'Tax Settings'},
  {id:'branding',  label:'Branding'},
  {id:'email',     label:'Email Templates'},
  {id:'review',    label:'Review Templates'},
  {id:'countries', label:'Countries & Currencies'},
  {id:'shopify',   label:'Shopify Settings'},
  {id:'system',    label:'System Settings'},
];
const TAX_TYPES  = ['GST','VAT','Sales Tax','Custom'];
const CURRENCIES = ['AUD','USD','GBP','CAD','SEK'];
const CTRIES     = ['Australia','USA','UK','Canada','Sweden'];
const BOOL_OPTS  = [{value:'true',label:'Enabled'},{value:'false',label:'Disabled'}];
const EMAIL_TPLS = ['Invoice Email','Refund Email','Trade Invoice Email','Payment Reminder Email','Welcome Email'];
const VARS_HINT  = '{{customer_name}} {{invoice_number}} {{order_number}} {{total}} {{due_date}} {{business_name}}';
const IC = 'font-ui text-[0.78rem] bg-white/[0.04] border border-white/10 rounded-[10px] px-3 py-2 text-white placeholder-bc-secondary/40 outline-none focus:border-bc-red/40 transition-colors';
const SC = 'font-ui text-[0.78rem] bg-[#111] border border-white/10 rounded-[10px] px-3 py-2 text-white';

/* ─── Loader ─────────────────────────────────────────────────── */
export async function loader({request, context}) {
  await requireFinalAdmin(request);
  const sb = getSupabase();
  try {
    const [sR, eR, rvR, cR] = await Promise.all([
      sb.from('settings').select('*'),
      sb.from('email_templates').select('*').order('template_name'),
      sb.from('review_templates').select('*').order('template_name'),
      sb.from('country_settings').select('*').order('country'),
    ]);
    if (sR.error) throw sR.error;
    const sm = {};
    (sR.data||[]).forEach(s => { sm[s.setting_key] = s.setting_value; });
    return json({settings:sm, emailTemplates:eR.data||[], reviewTemplates:rvR.data||[], countrySettings:cR.data||[], dbError:null});
  } catch(e) {
    return json({settings:{}, emailTemplates:[], reviewTemplates:[], countrySettings:[], dbError:e.message});
  }
}

/* ─── Action ─────────────────────────────────────────────────── */
export async function action({request, context}) {
  await requireFinalAdmin(request);
  const form   = await request.formData();
  const intent = form.get('intent');
  const sb     = getSupabase();
  const now    = new Date().toISOString();

  if (intent === 'save_settings') {
    const upserts = [];
    for (const [k, v] of form.entries()) {
      if (k==='intent'||k==='_section') continue;
      upserts.push({setting_key:k, setting_value:String(v), updated_at:now});
    }
    if (upserts.length) await sb.from('settings').upsert(upserts, {onConflict:'setting_key'});
    return json({ok:true});
  }
  if (intent === 'save_email_template') {
    const id = form.get('id');
    const d  = {template_name:form.get('template_name'), subject:form.get('subject'), body:form.get('body'), updated_at:now};
    if (id) await sb.from('email_templates').update(d).eq('id',id);
    else    await sb.from('email_templates').insert(d);
    return json({ok:true});
  }
  if (intent === 'save_review_template') {
    const id = form.get('id');
    const d  = {template_name:form.get('template_name'), subject:form.get('subject'), body:form.get('body'), updated_at:now};
    if (id) await sb.from('review_templates').update(d).eq('id',id);
    else    await sb.from('review_templates').insert(d);
    return json({ok:true});
  }
  if (intent === 'save_country_setting') {
    const id = form.get('id');
    const d  = {country:form.get('country'), currency:form.get('currency'), tax_rate:parseFloat(form.get('tax_rate')||0), enabled:form.get('enabled')==='true', updated_at:now};
    if (id) await sb.from('country_settings').update(d).eq('id',id);
    else    await sb.from('country_settings').insert(d);
    return json({ok:true});
  }
  return json({ok:false, error:'Unknown intent'});
}

/* ─── UI primitives ──────────────────────────────────────────── */
function Field({label, hint, children}) {
  return (
    <div className="flex flex-col sm:grid py-3 border-b gap-2 sm:gap-4" style={{gridTemplateColumns:'210px 1fr', borderColor:'rgba(255,255,255,0.05)'}}>
      <div>
        <p className="font-ui text-[0.73rem] text-white">{label}</p>
        {hint && <p className="font-ui text-[0.6rem] text-bc-secondary/60 mt-0.5 leading-relaxed">{hint}</p>}
      </div>
      <div className="flex flex-col gap-1.5 justify-center">{children}</div>
    </div>
  );
}
function SaveBar({fetcher, label='Save Changes'}) {
  return (
    <div className="flex items-center justify-end gap-3 pt-4">
      {fetcher.data?.ok && <span className="font-ui text-[0.65rem] text-[#22c55e]">✓ Saved successfully</span>}
      {fetcher.data?.error && <span className="font-ui text-[0.65rem] text-bc-red">{fetcher.data.error}</span>}
      <button type="submit" disabled={fetcher.state==='submitting'}
        className="font-ui text-[0.72rem] px-5 py-2 rounded-[10px] bg-bc-red text-white hover:bg-bc-red/80 transition-colors disabled:opacity-50">
        {fetcher.state==='submitting' ? 'Saving…' : label}
      </button>
    </div>
  );
}
function Card({title, sub, children}) {
  return (
    <div style={{background:'rgba(255,255,255,0.02)',border:'1px solid rgba(255,255,255,0.07)'}} className="rounded-[16px] px-4 py-4 sm:px-6 sm:py-5 mb-4">
      <p className="font-ui text-[0.6rem] tracking-[0.15em] text-bc-secondary mb-1">{title}</p>
      {sub && <p className="font-ui text-[0.65rem] text-bc-secondary/50 mb-4">{sub}</p>}
      {!sub && <div className="mb-4"/>}
      {children}
    </div>
  );
}

/* ─── COMPANY ────────────────────────────────────────────────── */
function CompanySection({settings:s}) {
  const f = useFetcher();
  return (
    <Card title="COMPANY DETAILS" sub="Business registration and contact information">
      <f.Form method="post" action="/adminlogonprotocol/settings">
        <input type="hidden" name="intent" value="save_settings"/>
        {[
          ['company_name',  'Company Name',  'Full legal entity name',                  'BLACKCROW INTERNATIONAL PTY LTD'],
          ['trading_name',  'Trading Name',  'Name used for business operations',        'BLACKCROW AUTOMOTIVE ACCESSORIES'],
          ['abn',           'ABN',           'Australian Business Number',               '12 345 678 901'],
          ['address',       'Address',       'Full registered address',                  '123 Industrial Ave, Sydney NSW 2000'],
          ['phone',         'Phone',         null,                                       '+61 2 1234 5678'],
          ['email',         'Email',         null,                                       'admin@blackcrow.com'],
          ['website',       'Website',       null,                                       'https://blackcrow.com'],
        ].map(([key,label,hint,placeholder])=>(
          <Field key={key} label={label} hint={hint}>
            <input name={key} className={`${IC} w-full`} defaultValue={s[key]||''} placeholder={placeholder}/>
          </Field>
        ))}
        <SaveBar fetcher={f}/>
      </f.Form>
    </Card>
  );
}

/* ─── INVOICE ────────────────────────────────────────────────── */
function InvoiceSection({settings:s}) {
  const f = useFetcher();
  const [invPrefix, setInvPrefix] = useState(s.invoice_prefix||'BCA-INV-');
  const [invNum,    setInvNum]    = useState(s.invoice_start_number||'0000001');
  return (
    <Card title="INVOICE SETTINGS" sub="Invoice, refund, and trade numbering formats">
      <f.Form method="post" action="/adminlogonprotocol/settings">
        <input type="hidden" name="intent" value="save_settings"/>
        <Field label="Invoice Prefix" hint="Prefix for all customer invoices">
          <input name="invoice_prefix" className={`${IC} w-full sm:w-48`} value={invPrefix} onChange={e=>setInvPrefix(e.target.value)} placeholder="BCA-INV-"/>
        </Field>
        <Field label="Starting Number" hint="Next invoice number to generate">
          <input name="invoice_start_number" className={`${IC} w-full sm:w-48`} value={invNum} onChange={e=>setInvNum(e.target.value)} placeholder="0000001"/>
          <p className="font-ui text-[0.62rem] text-bc-secondary">Preview: <span className="text-bc-red font-medium">{invPrefix}{invNum}</span></p>
        </Field>
        <Field label="Refund Prefix" hint="Prefix for refund documents">
          <input name="refund_prefix" className={`${IC} w-full sm:w-48`} defaultValue={s.refund_prefix||'BCA-RFD-'} placeholder="BCA-RFD-"/>
        </Field>
        <Field label="Trade Invoice Prefix" hint="Prefix for trade account invoices">
          <input name="trade_invoice_prefix" className={`${IC} w-full sm:w-48`} defaultValue={s.trade_invoice_prefix||'BCA-TRD-'} placeholder="BCA-TRD-"/>
        </Field>
        <SaveBar fetcher={f}/>
      </f.Form>
    </Card>
  );
}

/* ─── ORDER ──────────────────────────────────────────────────── */
function OrderSection({settings:s}) {
  const f = useFetcher();
  const [prefix, setPrefix] = useState(s.order_prefix||'BCA-ORD-');
  const [num,    setNum]    = useState(s.order_start_number||'0000001');
  return (
    <Card title="ORDER SETTINGS" sub="Order numbering format">
      <f.Form method="post" action="/adminlogonprotocol/settings">
        <input type="hidden" name="intent" value="save_settings"/>
        <Field label="Order Prefix">
          <input name="order_prefix" className={`${IC} w-full sm:w-48`} value={prefix} onChange={e=>setPrefix(e.target.value)} placeholder="BCA-ORD-"/>
        </Field>
        <Field label="Starting Number">
          <input name="order_start_number" className={`${IC} w-full sm:w-48`} value={num} onChange={e=>setNum(e.target.value)} placeholder="0000001"/>
          <p className="font-ui text-[0.62rem] text-bc-secondary">Preview: <span className="text-bc-red font-medium">{prefix}{num}</span></p>
        </Field>
        <Field label="Customer Prefix" hint="Prefix for customer IDs">
          <input name="customer_prefix" className={`${IC} w-full sm:w-48`} defaultValue={s.customer_prefix||'BCA-CUS-'} placeholder="BCA-CUS-"/>
        </Field>
        <SaveBar fetcher={f}/>
      </f.Form>
    </Card>
  );
}

/* ─── TAX ────────────────────────────────────────────────────── */
function TaxSection({settings:s}) {
  const f = useFetcher();
  return (
    <Card title="TAX SETTINGS" sub="Tax configuration applied to invoices and orders">
      <f.Form method="post" action="/adminlogonprotocol/settings">
        <input type="hidden" name="intent" value="save_settings"/>
        <Field label="Tax Enabled">
          <select name="tax_enabled" defaultValue={s.tax_enabled||'true'} className={`${SC} w-full sm:w-40`}>
            {BOOL_OPTS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="Tax Type">
          <select name="tax_type" defaultValue={s.tax_type||'GST'} className={`${SC} w-full sm:w-40`}>
            {TAX_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Tax Name" hint="As it appears on invoices">
          <input name="tax_name" className={`${IC} w-full sm:w-48`} defaultValue={s.tax_name||'GST'} placeholder="GST"/>
        </Field>
        <Field label="Tax Rate %" hint="e.g. 10 for 10%">
          <input name="tax_percentage" type="number" min="0" max="100" step="0.1" className={`${IC} w-full sm:w-32`} defaultValue={s.tax_percentage||'10'} placeholder="10"/>
        </Field>
        <Field label="Apply Tax To" hint="Which document types include this tax">
          <select name="tax_applies_to" defaultValue={s.tax_applies_to||'all'} className={`${SC} w-full sm:w-48`}>
            <option value="all">All Invoices & Orders</option>
            <option value="invoices">Invoices Only</option>
            <option value="orders">Orders Only</option>
            <option value="domestic">Domestic Only</option>
          </select>
        </Field>
        <SaveBar fetcher={f}/>
      </f.Form>
    </Card>
  );
}

/* ─── BRANDING ───────────────────────────────────────────────── */
function BrandingSection({settings:s}) {
  const f = useFetcher();
  const [primary,   setPrimary]   = useState(s.primary_colour||'#cc0000');
  const [secondary, setSecondary] = useState(s.secondary_colour||'#ffffff');
  return (
    <Card title="BRANDING" sub="Visual identity applied across the dashboard and documents">
      <f.Form method="post" action="/adminlogonprotocol/settings">
        <input type="hidden" name="intent" value="save_settings"/>
        <Field label="Primary Colour" hint="Main brand colour — used on buttons and accents">
          <div className="flex items-center gap-2">
            <input type="color" value={primary} onChange={e=>setPrimary(e.target.value)}
              className="w-10 h-10 rounded-[8px] border border-white/10 cursor-pointer bg-transparent p-0.5"/>
            <input name="primary_colour" value={primary} onChange={e=>setPrimary(e.target.value)}
              className={`${IC} w-32`} placeholder="#cc0000"/>
          </div>
        </Field>
        <Field label="Secondary Colour" hint="Accent colour for headers and highlights">
          <div className="flex items-center gap-2">
            <input type="color" value={secondary} onChange={e=>setSecondary(e.target.value)}
              className="w-10 h-10 rounded-[8px] border border-white/10 cursor-pointer bg-transparent p-0.5"/>
            <input name="secondary_colour" value={secondary} onChange={e=>setSecondary(e.target.value)}
              className={`${IC} w-32`} placeholder="#ffffff"/>
          </div>
        </Field>
        <Field label="Company Logo URL" hint="Used in the admin header. Host on Supabase Storage or CDN.">
          <input name="logo_url" className={`${IC} w-full`} defaultValue={s.logo_url||''} placeholder="https://..."/>
        </Field>
        <Field label="Invoice Logo URL" hint="Logo printed at the top of all invoices">
          <input name="invoice_logo_url" className={`${IC} w-full`} defaultValue={s.invoice_logo_url||''} placeholder="https://..."/>
        </Field>
        <Field label="Favicon URL" hint="Browser tab icon">
          <input name="favicon_url" className={`${IC} w-full`} defaultValue={s.favicon_url||''} placeholder="https://..."/>
        </Field>
        <SaveBar fetcher={f}/>
      </f.Form>
    </Card>
  );
}

/* ─── EMAIL TEMPLATES ────────────────────────────────────────── */
function EmailSection({emailTemplates}) {
  const f = useFetcher();
  const [active, setActive] = useState(EMAIL_TPLS[0]);
  const tpl = emailTemplates.find(t => t.template_name === active);
  return (
    <Card title="EMAIL TEMPLATES" sub="Editable templates for all customer emails">
      {/* Template selector */}
      <div className="flex gap-2 flex-wrap mb-5">
        {EMAIL_TPLS.map(name => (
          <button key={name} type="button" onClick={() => setActive(name)}
            className={`font-ui text-[0.65rem] px-3 py-1.5 rounded-[8px] border transition-colors whitespace-nowrap ${active===name ? 'border-bc-red/50 bg-bc-red/10 text-white' : 'border-white/10 text-bc-secondary hover:text-white hover:border-white/20'}`}>
            {name}
          </button>
        ))}
      </div>
      <f.Form key={active} method="post" action="/adminlogonprotocol/settings">
        <input type="hidden" name="intent" value="save_email_template"/>
        {tpl?.id && <input type="hidden" name="id" value={tpl.id}/>}
        <input type="hidden" name="template_name" value={active}/>
        <Field label="Subject Line">
          <input name="subject" className={`${IC} w-full`} defaultValue={tpl?.subject||''} placeholder={`${active} — subject line`}/>
        </Field>
        <Field label="Email Body" hint={`Variables: ${VARS_HINT}`}>
          <textarea name="body" rows={9} className={`${IC} w-full resize-y`} defaultValue={tpl?.body||''} placeholder="Hi {{customer_name}},&#10;&#10;Your email body…"/>
        </Field>
        <p className="font-ui text-[0.58rem] text-bc-secondary/50 mt-2 leading-relaxed">Available variables: {VARS_HINT}</p>
        <SaveBar fetcher={f} label="Save Template"/>
      </f.Form>
    </Card>
  );
}

/* ─── REVIEW TEMPLATES ───────────────────────────────────────── */
function ReviewSection({reviewTemplates}) {
  const f   = useFetcher();
  const tpl = reviewTemplates[0];
  return (
    <Card title="REVIEW REQUEST TEMPLATES" sub="Templates sent to customers requesting reviews">
      <f.Form method="post" action="/adminlogonprotocol/settings">
        <input type="hidden" name="intent" value="save_review_template"/>
        {tpl?.id && <input type="hidden" name="id" value={tpl.id}/>}
        <input type="hidden" name="template_name" value="Default Review Request"/>
        <Field label="Subject Line">
          <input name="subject" className={`${IC} w-full`} defaultValue={tpl?.subject||''} placeholder="How was your experience with BlackCrow?"/>
        </Field>
        <Field label="Message" hint={`Variables: ${VARS_HINT}`}>
          <textarea name="body" rows={9} className={`${IC} w-full resize-y`} defaultValue={tpl?.body||''} placeholder="Hi {{customer_name}},&#10;&#10;Thank you for your recent order…"/>
        </Field>
        <p className="font-ui text-[0.58rem] text-bc-secondary/50 mt-2">Available variables: {VARS_HINT}</p>
        <SaveBar fetcher={f} label="Save Template"/>
      </f.Form>
    </Card>
  );
}

/* ─── COUNTRIES & CURRENCIES ─────────────────────────────────── */
function CountryRow({row}) {
  const f = useFetcher();
  return (
    <f.Form method="post" action="/adminlogonprotocol/settings"
      className="grid items-center gap-3 py-3 border-b" style={{gridTemplateColumns:'1fr 130px 100px 120px 80px', minWidth:'480px', borderColor:'rgba(255,255,255,0.05)'}}>
      <input type="hidden" name="intent" value="save_country_setting"/>
      {row.id && <input type="hidden" name="id" value={row.id}/>}
      <input type="hidden" name="country" value={row.country}/>
      <p className="font-ui text-[0.78rem] text-white">{row.country}</p>
      <select name="enabled" defaultValue={row.enabled===false?'false':'true'} className={`${SC} w-full`}>
        <option value="true">Enabled</option>
        <option value="false">Disabled</option>
      </select>
      <select name="currency" defaultValue={row.currency||'AUD'} className={`${SC} w-full`}>
        {CURRENCIES.map(c=><option key={c} value={c}>{c}</option>)}
      </select>
      <div className="flex items-center gap-1">
        <input name="tax_rate" type="number" min="0" max="100" step="0.1" defaultValue={row.tax_rate??10}
          className={`${IC} w-16`}/>
        <span className="font-ui text-[0.65rem] text-bc-secondary">%</span>
      </div>
      <button type="submit" className="font-ui text-[0.65rem] px-2 py-1.5 rounded-[8px] border border-white/10 text-bc-secondary hover:text-white transition-colors whitespace-nowrap">
        {f.state==='submitting'?'…':f.data?.ok?'✓ Saved':'Save'}
      </button>
    </f.Form>
  );
}
function CountriesSection({countrySettings}) {
  const rows = CTRIES.map(country => ({country, ...countrySettings.find(c=>c.country===country)}));
  const DEFAULTS = {Australia:'AUD',USA:'USD',UK:'GBP',Canada:'CAD',Sweden:'SEK'};
  const DEF_TAX  = {Australia:10,USA:0,UK:20,Canada:5,Sweden:25};
  return (
    <Card title="COUNTRIES & CURRENCIES" sub="Enable or disable trading regions and assign currencies">
      <div className="overflow-x-auto">
        <div className="grid font-ui text-[0.58rem] tracking-[0.1em] text-bc-secondary pb-2"
          style={{gridTemplateColumns:'1fr 130px 100px 120px 80px', gap:'0.75rem', minWidth:'480px'}}>
          {['COUNTRY','STATUS','CURRENCY','TAX RATE',''].map((h,i)=><span key={i}>{h}</span>)}
        </div>
        {rows.map(row => (
          <CountryRow key={row.country} row={{...row, currency:row.currency||DEFAULTS[row.country], tax_rate:row.tax_rate??DEF_TAX[row.country]}}/>
        ))}
      </div>
    </Card>
  );
}

/* ─── SHOPIFY ────────────────────────────────────────────────── */
function ShopifySection({settings:s}) {
  const f = useFetcher();
  return (
    <Card title="SHOPIFY SETTINGS" sub="Integration settings — ready for future activation">
      <div className="mb-4 px-3 py-2.5 rounded-[10px] bg-[#f59e0b]/10 border border-[#f59e0b]/20">
        <p className="font-ui text-[0.65rem] text-[#f59e0b]">Integration not yet active. Save credentials here to prepare for future connection.</p>
      </div>
      <f.Form method="post" action="/adminlogonprotocol/settings">
        <input type="hidden" name="intent" value="save_settings"/>
        <Field label="Connection Status">
          <span className="font-ui text-[0.65rem] tracking-[0.1em] px-2 py-1 rounded-full bg-white/5 text-bc-secondary/60">DISCONNECTED</span>
        </Field>
        <Field label="Store URL" hint="e.g. mystore.myshopify.com">
          <input name="shopify_store_url" className={`${IC} w-full`} defaultValue={s.shopify_store_url||''} placeholder="mystore.myshopify.com"/>
        </Field>
        <Field label="Storefront Token" hint="Public storefront API token">
          <input name="shopify_storefront_token" className={`${IC} w-full`} defaultValue={s.shopify_storefront_token||''} placeholder="Storefront access token"/>
        </Field>
        <Field label="Admin API Token" hint="Private admin API access token — stored securely">
          <input name="shopify_admin_token" type="password" className={`${IC} w-full`} defaultValue={s.shopify_admin_token||''} placeholder="shpat_xxxxxxxx"/>
        </Field>
        <p className="font-ui text-[0.6rem] tracking-[0.15em] text-bc-secondary mt-5 mb-1">SYNC SETTINGS</p>
        {[
          ['shopify_sync_products',   'Products',   'Sync product catalogue from Shopify'],
          ['shopify_sync_orders',     'Orders',     'Import orders from Shopify'],
          ['shopify_sync_inventory',  'Inventory',  'Sync inventory levels'],
          ['shopify_sync_customers',  'Customers',  'Import customer records'],
        ].map(([key,label,hint])=>(
          <Field key={key} label={label} hint={hint}>
            <select name={key} defaultValue={s[key]||'false'} className={`${SC} w-full sm:w-36`}>
              {BOOL_OPTS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        ))}
        <SaveBar fetcher={f}/>
      </f.Form>
    </Card>
  );
}

/* ─── SYSTEM ─────────────────────────────────────────────────── */
function SystemSection({settings:s}) {
  const f = useFetcher();
  const toggles = [
    ['maintenance_mode',         'Maintenance Mode',         'Take the dashboard offline for maintenance'],
    ['enable_notifications',     'Enable Notifications',     'Show system notifications across the dashboard'],
    ['enable_email_logging',     'Enable Email Logging',     'Log all outgoing emails to the database'],
    ['enable_activity_tracking', 'Enable Activity Tracking', 'Track all user actions across the dashboard'],
    ['enable_review_requests',   'Enable Review Requests',   'Automatically send review request emails after orders'],
  ];
  return (
    <Card title="SYSTEM SETTINGS" sub="Global system configuration and feature flags">
      <f.Form method="post" action="/adminlogonprotocol/settings">
        <input type="hidden" name="intent" value="save_settings"/>
        {toggles.map(([key,label,hint])=>(
          <Field key={key} label={label} hint={hint}>
            <select name={key} defaultValue={s[key]||'false'} className={`${SC} w-full sm:w-36`}>
              {BOOL_OPTS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        ))}
        <SaveBar fetcher={f}/>
      </f.Form>
    </Card>
  );
}

/* ─── Main Page ──────────────────────────────────────────────── */
export default function SettingsPage() {
  const {settings, emailTemplates, reviewTemplates, countrySettings, dbError} = useLoaderData();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [section, setSection]         = useState('company');

  return (
    <div style={{minHeight:'100vh', background:'#0e0e0e', color:'white', display:'flex', flexDirection:'column'}}>
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)}/>

      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 sm:px-6 py-4 flex-shrink-0 sticky top-0 z-20"
        style={{background:'rgba(14,14,14,0.97)', backdropFilter:'blur(12px)', borderBottom:'1px solid rgba(255,255,255,0.07)'}}>
        <button onClick={() => setSidebarOpen(true)} className="text-bc-secondary hover:text-white transition-colors flex-shrink-0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        <a href="/adminlogonprotocol" className="flex-shrink-0">
          <img src="/blackcrow-logo.svg" alt="BlackCrow" className="h-6"/>
        </a>
        <span className="font-ui text-[0.6rem] tracking-[0.2em] text-bc-secondary hidden sm:inline truncate">ADMIN DASHBOARD</span>
        <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse"/>
          <span className="font-ui text-[0.6rem] tracking-[0.15em] text-[#22c55e]">Live</span>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="flex flex-1 overflow-x-hidden overflow-y-hidden">

        {/* Left nav */}
        <div className="hidden sm:block flex-shrink-0 overflow-y-auto"
          style={{width:240, background:'rgba(255,255,255,0.015)', borderRight:'1px solid rgba(255,255,255,0.07)'}}>
          <div className="px-5 pt-5 pb-4 border-b" style={{borderColor:'rgba(255,255,255,0.07)'}}>
            <h1 className="font-display text-xl text-white tracking-tight">SETTINGS</h1>
            <p className="font-ui text-[0.58rem] tracking-[0.18em] text-bc-secondary mt-0.5">GLOBAL CONTROL PANEL</p>
          </div>
          {dbError && (
            <div className="mx-3 mt-3 p-2.5 rounded-[10px] bg-bc-red/10 border border-bc-red/20">
              <p className="font-ui text-[0.6rem] text-bc-red leading-relaxed">Run Section 20 SQL to activate settings storage.</p>
            </div>
          )}
          <nav className="px-3 py-3">
            {SECTIONS.map(s => (
              <button key={s.id} onClick={() => setSection(s.id)}
                className={`w-full text-left px-3 py-2.5 rounded-[10px] mb-0.5 font-ui text-[0.76rem] transition-all duration-150 flex items-center justify-between ${section===s.id ? 'bg-bc-red/10 text-white' : 'text-bc-secondary hover:text-white hover:bg-white/[0.05]'}`}>
                <span>{s.label}</span>
                {section===s.id && <span className="text-bc-red text-base leading-none">›</span>}
              </button>
            ))}
          </nav>
        </div>

        {/* Right content */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-4 sm:py-6">
          {/* Mobile section selector */}
          <div className="sm:hidden mb-4">
            <select value={section} onChange={e=>setSection(e.target.value)} className={`${SC} w-full`}>
              {SECTIONS.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          {section==='company'   && <CompanySection    settings={settings}/>}
          {section==='invoice'   && <InvoiceSection    settings={settings}/>}
          {section==='order'     && <OrderSection      settings={settings}/>}
          {section==='tax'       && <TaxSection        settings={settings}/>}
          {section==='branding'  && <BrandingSection   settings={settings}/>}
          {section==='email'     && <EmailSection      emailTemplates={emailTemplates}/>}
          {section==='review'    && <ReviewSection     reviewTemplates={reviewTemplates}/>}
          {section==='countries' && <CountriesSection  countrySettings={countrySettings}/>}
          {section==='shopify'   && <ShopifySection    settings={settings}/>}
          {section==='system'    && <SystemSection     settings={settings}/>}
        </div>
      </div>
    </div>
  );
}
